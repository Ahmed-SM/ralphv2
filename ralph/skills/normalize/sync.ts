/**
 * Tracker Sync
 *
 * Orchestrates synchronization between Ralph tasks and external trackers.
 */

import type { Task, TaskOperation, TaskStatus } from '../../types/index.js';
import type {
  Tracker,
  TrackerConfig,
  AuthConfig,
  SyncResult,
  SyncOptions,
  SyncError,
  ExternalIssue,
} from './tracker-interface.js';
import { createTracker, mapStatusToRalph, formatDescription } from './tracker-interface.js';

// =============================================================================
// SYNC ENGINE
// =============================================================================

export interface SyncContext {
  tracker: Tracker;
  config: TrackerConfig;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  tasksPath: string;
}

/**
 * Sync tasks to tracker
 */
export async function syncToTracker(
  context: SyncContext,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    duration: 0,
  };

  console.log(`Syncing to ${context.tracker.name}...`);

  // Load tasks
  const tasks = await loadTasks(context);
  console.log(`  Loaded ${tasks.size} tasks`);

  // Filter tasks if needed
  let tasksToSync = Array.from(tasks.values());

  if (options.taskIds && options.taskIds.length > 0) {
    tasksToSync = tasksToSync.filter(t => options.taskIds!.includes(t.id));
  }

  if (options.statuses && options.statuses.length > 0) {
    tasksToSync = tasksToSync.filter(t => options.statuses!.includes(t.status));
  }

  console.log(`  Tasks to sync: ${tasksToSync.length}`);

  // Process each task
  for (const task of tasksToSync) {
    result.processed++;

    try {
      if (task.externalId) {
        // Task already linked - update if needed
        if (options.force) {
          await updateExternalIssue(context, task);
          result.updated++;
          console.log(`  ✓ Updated ${task.id} → ${task.externalId}`);
        } else {
          result.skipped++;
          console.log(`  - Skipped ${task.id} (already linked)`);
        }
      } else {
        // Create new issue
        const issue = await createExternalIssue(context, task, tasks);
        result.created++;
        console.log(`  ✓ Created ${task.id} → ${issue.key}`);

        // Record the link
        await recordLink(context, task.id, issue.key, issue.url);
      }
    } catch (error) {
      const syncError: SyncError = {
        taskId: task.id,
        externalId: task.externalId,
        operation: task.externalId ? 'update' : 'create',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      result.errors.push(syncError);
      console.log(`  ✗ Failed ${task.id}: ${syncError.error}`);
    }
  }

  result.duration = Date.now() - startTime;

  return result;
}

/**
 * Pull updates from tracker
 */
export async function syncFromTracker(
  context: SyncContext,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    duration: 0,
  };

  console.log(`Pulling from ${context.tracker.name}...`);

  // Load tasks
  const tasks = await loadTasks(context);
  const linkedTasks = Array.from(tasks.values()).filter(t => t.externalId);

  console.log(`  Linked tasks: ${linkedTasks.length}`);

  for (const task of linkedTasks) {
    result.processed++;

    try {
      const issue = await context.tracker.getIssue(task.externalId!);
      const trackerStatus = mapStatusToRalph(issue.status, context.config);

      if (trackerStatus !== task.status) {
        // Update local status
        await recordStatusChange(context, task.id, trackerStatus, 'tracker');
        result.updated++;
        console.log(`  ✓ Updated ${task.id}: ${task.status} → ${trackerStatus}`);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors.push({
        taskId: task.id,
        externalId: task.externalId,
        operation: 'update',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

/**
 * Bidirectional sync
 */
export async function syncBidirectional(
  context: SyncContext,
  options: SyncOptions = {}
): Promise<{ push: SyncResult; pull: SyncResult }> {
  // Pull first (tracker wins for status)
  const pull = await syncFromTracker(context, options);

  // Then push
  const push = await syncToTracker(context, options);

  return { push, pull };
}

// =============================================================================
// HELPERS
// =============================================================================

async function loadTasks(context: SyncContext): Promise<Map<string, Task>> {
  const tasks = new Map<string, Task>();

  try {
    const content = await context.readFile(context.tasksPath);
    if (!content.trim()) return tasks;

    const lines = content.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      const op = JSON.parse(line) as TaskOperation;

      switch (op.op) {
        case 'create':
          tasks.set(op.task.id, { ...op.task });
          break;

        case 'update': {
          const task = tasks.get(op.id);
          if (task) {
            Object.assign(task, op.changes);
          }
          break;
        }

        case 'link': {
          const task = tasks.get(op.id);
          if (task) {
            task.externalId = op.externalId;
            task.externalUrl = op.externalUrl;
          }
          break;
        }
      }
    }
  } catch {
    // File doesn't exist
  }

  return tasks;
}

async function createExternalIssue(
  context: SyncContext,
  task: Task,
  allTasks: Map<string, Task>
): Promise<ExternalIssue> {
  // Check if parent needs to be synced first
  if (task.parent) {
    const parentTask = allTasks.get(task.parent);
    if (parentTask && !parentTask.externalId) {
      // Sync parent first
      const parentIssue = await createExternalIssue(context, parentTask, allTasks);
      await recordLink(context, parentTask.id, parentIssue.key, parentIssue.url);
      parentTask.externalId = parentIssue.key;
    }
  }

  // Create the issue
  if (task.parent && task.type === 'subtask') {
    const parentTask = allTasks.get(task.parent);
    if (parentTask?.externalId) {
      return context.tracker.createSubtask(parentTask.externalId, task);
    }
  }

  return context.tracker.createIssue(task);
}

async function updateExternalIssue(
  context: SyncContext,
  task: Task
): Promise<void> {
  if (!task.externalId) return;

  await context.tracker.updateIssue(task.externalId, {
    title: task.title,
    description: formatDescription(task),
    status: context.config.statusMap[task.status],
  });
}

async function recordLink(
  context: SyncContext,
  taskId: string,
  externalId: string,
  externalUrl: string
): Promise<void> {
  const op: TaskOperation = {
    op: 'link',
    id: taskId,
    externalId,
    externalUrl,
    timestamp: new Date().toISOString(),
  };

  let content = '';
  try {
    content = await context.readFile(context.tasksPath);
  } catch {
    // File doesn't exist
  }

  await context.writeFile(context.tasksPath, content + JSON.stringify(op) + '\n');
}

async function recordStatusChange(
  context: SyncContext,
  taskId: string,
  status: TaskStatus,
  source: string
): Promise<void> {
  const op: TaskOperation = {
    op: 'update',
    id: taskId,
    changes: { status },
    source: source as 'tracker',
    timestamp: new Date().toISOString(),
  };

  let content = '';
  try {
    content = await context.readFile(context.tasksPath);
  } catch {
    // File doesn't exist
  }

  await context.writeFile(context.tasksPath, content + JSON.stringify(op) + '\n');
}

// =============================================================================
// FACTORY
// =============================================================================

export interface CreateSyncContextOptions {
  configPath: string;
  tasksPath?: string;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

export async function createSyncContext(
  options: CreateSyncContextOptions
): Promise<SyncContext> {
  // Load config
  const configContent = await options.readFile(options.configPath);
  const config = JSON.parse(configContent) as TrackerConfig;

  // Get auth from environment
  const auth: AuthConfig = {
    type: 'token',
    email: process.env.RALPH_JIRA_EMAIL || process.env.JIRA_EMAIL,
    token: process.env.RALPH_JIRA_TOKEN || process.env.JIRA_TOKEN,
  };

  if (!auth.email || !auth.token) {
    throw new Error(
      'Missing Jira credentials. Set RALPH_JIRA_EMAIL and RALPH_JIRA_TOKEN environment variables.'
    );
  }

  // Create tracker
  const tracker = await createTracker(config, auth);

  return {
    tracker,
    config,
    readFile: options.readFile,
    writeFile: options.writeFile,
    tasksPath: options.tasksPath || './state/tasks.jsonl',
  };
}

// =============================================================================
// SUMMARY
// =============================================================================

export function printSyncSummary(result: SyncResult, direction: 'push' | 'pull' | 'both'): void {
  console.log('\n═══════════════════════════════════════════');
  console.log(`  SYNC ${direction.toUpperCase()} SUMMARY`);
  console.log('═══════════════════════════════════════════\n');

  console.log(`Processed: ${result.processed}`);
  console.log(`Created:   ${result.created}`);
  console.log(`Updated:   ${result.updated}`);
  console.log(`Skipped:   ${result.skipped}`);
  console.log(`Errors:    ${result.errors.length}`);
  console.log(`Duration:  ${(result.duration / 1000).toFixed(1)}s`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  - ${error.taskId}: ${error.error}`);
    }
  }

  console.log('\n═══════════════════════════════════════════\n');
}
