/**
 * Link Commits Skill
 *
 * Links git commits to tasks and records activity.
 */

import type { Task, TaskOperation, TaskStatus } from '../../types/index.js';
import type { GitCommit, CommitTaskRef, CommitAction } from './parse-commits.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TaskActivity {
  taskId: string;
  type: 'commit' | 'branch' | 'pr' | 'merge';
  sha?: string;
  message?: string;
  author?: string;
  timestamp: string;
  action?: CommitAction;
  files?: string[];
}

export interface LinkResult {
  taskId: string;
  activities: TaskActivity[];
  statusChange?: {
    from: TaskStatus;
    to: TaskStatus;
    reason: string;
  };
}

export interface ProgressEvent {
  type: string;
  taskId?: string;
  timestamp: string;
  [key: string]: unknown;
}

// =============================================================================
// LINKING
// =============================================================================

/**
 * Link commit references to tasks and generate activities
 */
export function linkCommitsToTasks(
  refs: CommitTaskRef[],
  tasks: Map<string, Task>
): LinkResult[] {
  const results = new Map<string, LinkResult>();

  for (const ref of refs) {
    const task = tasks.get(ref.taskId);
    if (!task) {
      // Task doesn't exist, skip
      continue;
    }

    // Get or create result
    let result = results.get(ref.taskId);
    if (!result) {
      result = {
        taskId: ref.taskId,
        activities: [],
      };
      results.set(ref.taskId, result);
    }

    // Add activity
    result.activities.push({
      taskId: ref.taskId,
      type: 'commit',
      sha: ref.commit.sha,
      message: ref.commit.subject,
      author: ref.commit.author,
      timestamp: ref.commit.date || new Date().toISOString(),
      action: ref.action,
      files: ref.commit.files,
    });
  }

  return Array.from(results.values());
}

/**
 * Determine if a task's status should change based on activity
 */
export function inferStatusChange(
  task: Task,
  activities: TaskActivity[]
): { from: TaskStatus; to: TaskStatus; reason: string } | undefined {
  if (activities.length === 0) return undefined;

  const currentStatus = task.status;
  const latestActivity = activities[activities.length - 1];

  // If task is discovered/pending and has commits, move to in_progress
  if (currentStatus === 'discovered' || currentStatus === 'pending') {
    return {
      from: currentStatus,
      to: 'in_progress',
      reason: `Work detected: ${latestActivity.message}`,
    };
  }

  // Check for completion signals
  const hasCompleteAction = activities.some(a => a.action === 'complete');
  if (hasCompleteAction && currentStatus === 'in_progress') {
    return {
      from: currentStatus,
      to: 'done',
      reason: 'Marked complete in commit',
    };
  }

  return undefined;
}

/**
 * Generate task operations from link results
 */
export function generateLinkOperations(
  results: LinkResult[],
  tasks: Map<string, Task>
): TaskOperation[] {
  const operations: TaskOperation[] = [];
  const timestamp = new Date().toISOString();

  for (const result of results) {
    const task = tasks.get(result.taskId);
    if (!task) continue;

    // Check if status should change
    const statusChange = inferStatusChange(task, result.activities);

    if (statusChange) {
      operations.push({
        op: 'update',
        id: result.taskId,
        changes: {
          status: statusChange.to,
          updatedAt: timestamp,
        },
        source: 'git' as const,
        timestamp,
      });
    }
  }

  return operations;
}

/**
 * Generate progress events from activities
 */
export function generateProgressEvents(results: LinkResult[]): ProgressEvent[] {
  const events: ProgressEvent[] = [];

  for (const result of results) {
    for (const activity of result.activities) {
      events.push({
        type: 'git_activity',
        taskId: activity.taskId,
        activityType: activity.type,
        sha: activity.sha,
        message: activity.message,
        author: activity.author,
        action: activity.action,
        timestamp: activity.timestamp,
      });
    }

    if (result.statusChange) {
      events.push({
        type: 'status_change',
        taskId: result.taskId,
        from: result.statusChange.from,
        to: result.statusChange.to,
        reason: result.statusChange.reason,
        source: 'git',
        timestamp: new Date().toISOString(),
      });
    }
  }

  return events;
}

// =============================================================================
// AGGREGATION
// =============================================================================

export interface TaskGitSummary {
  taskId: string;
  task?: Task;
  commits: number;
  firstCommit?: string;
  lastCommit?: string;
  authors: string[];
  filesChanged: Set<string>;
  actions: CommitAction[];
}

/**
 * Aggregate git activity by task
 */
export function aggregateByTask(
  refs: CommitTaskRef[],
  tasks: Map<string, Task>
): TaskGitSummary[] {
  const summaries = new Map<string, TaskGitSummary>();

  for (const ref of refs) {
    let summary = summaries.get(ref.taskId);
    if (!summary) {
      summary = {
        taskId: ref.taskId,
        task: tasks.get(ref.taskId),
        commits: 0,
        authors: [],
        filesChanged: new Set(),
        actions: [],
      };
      summaries.set(ref.taskId, summary);
    }

    summary.commits++;

    // Track dates
    const commitDate = ref.commit.date;
    if (!summary.firstCommit || commitDate < summary.firstCommit) {
      summary.firstCommit = commitDate;
    }
    if (!summary.lastCommit || commitDate > summary.lastCommit) {
      summary.lastCommit = commitDate;
    }

    // Track authors
    if (ref.commit.author && !summary.authors.includes(ref.commit.author)) {
      summary.authors.push(ref.commit.author);
    }

    // Track files
    if (ref.commit.files) {
      for (const file of ref.commit.files) {
        summary.filesChanged.add(file);
      }
    }

    // Track actions
    if (ref.action && !summary.actions.includes(ref.action)) {
      summary.actions.push(ref.action);
    }
  }

  return Array.from(summaries.values());
}

/**
 * Find tasks with no git activity
 */
export function findInactiveTasks(
  tasks: Map<string, Task>,
  refs: CommitTaskRef[]
): Task[] {
  const activeTasks = new Set(refs.map(r => r.taskId));

  return Array.from(tasks.values()).filter(
    task =>
      !activeTasks.has(task.id) &&
      task.status !== 'done' &&
      task.status !== 'cancelled'
  );
}

/**
 * Find orphan commits (commits without matching tasks)
 */
export function findOrphanRefs(
  refs: CommitTaskRef[],
  tasks: Map<string, Task>
): CommitTaskRef[] {
  return refs.filter(ref => !tasks.has(ref.taskId));
}

// =============================================================================
// PERSISTENCE
// =============================================================================

/**
 * Load existing progress events
 */
export async function loadProgressEvents(
  readFile: (path: string) => Promise<string>,
  path: string
): Promise<ProgressEvent[]> {
  try {
    const content = await readFile(path);
    if (!content.trim()) return [];

    return content
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ProgressEvent);
  } catch {
    return [];
  }
}

/**
 * Append progress events
 */
export async function appendProgressEvents(
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<void>,
  path: string,
  events: ProgressEvent[]
): Promise<void> {
  if (events.length === 0) return;

  let content = '';
  try {
    content = await readFile(path);
  } catch {
    // File doesn't exist
  }

  const newLines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(path, content + newLines);
}

/**
 * Check if commit was already processed
 */
export function isCommitProcessed(
  sha: string,
  events: ProgressEvent[]
): boolean {
  return events.some(
    e => e.type === 'git_activity' && e.sha === sha
  );
}

/**
 * Filter out already processed commits
 */
export function filterNewCommits(
  refs: CommitTaskRef[],
  events: ProgressEvent[]
): CommitTaskRef[] {
  const processedShas = new Set(
    events
      .filter(e => e.type === 'git_activity' && e.sha)
      .map(e => e.sha as string)
  );

  return refs.filter(ref => !processedShas.has(ref.commit.sha));
}
