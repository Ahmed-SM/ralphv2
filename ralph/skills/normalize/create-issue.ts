/**
 * Create Issue Skill
 *
 * Creates issues in external trackers from Ralph tasks.
 */

import type { Task, TaskOperation } from '../../types/index.js';
import type { Tracker, TrackerConfig, ExternalIssue, SyncError } from './tracker-interface.js';
import { taskToIssue } from './tracker-interface.js';

export interface CreateIssueOptions {
  /** Create subtasks under parent issues */
  createSubtasks: boolean;
  /** Link related issues */
  linkRelated: boolean;
  /** Add initial comment */
  addComment: boolean;
  /** Comment template */
  commentTemplate?: string;
}

export interface CreateIssueResult {
  taskId: string;
  issue?: ExternalIssue;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Create an issue for a single task
 */
export async function createIssue(
  tracker: Tracker,
  task: Task,
  config: TrackerConfig,
  options: Partial<CreateIssueOptions> = {}
): Promise<CreateIssueResult> {
  // Skip if already has external ID
  if (task.externalId) {
    return {
      taskId: task.id,
      skipped: true,
      skipReason: `Already linked to ${task.externalId}`,
    };
  }

  // Skip certain types if not configured
  if (!config.issueTypeMap[task.type]) {
    return {
      taskId: task.id,
      skipped: true,
      skipReason: `No issue type mapping for ${task.type}`,
    };
  }

  try {
    const issue = await tracker.createIssue(task);

    // Add comment if requested
    if (options.addComment) {
      const comment = options.commentTemplate
        ?.replace('{taskId}', task.id)
        ?.replace('{title}', task.title)
        || `Created from Ralph task ${task.id}`;

      await tracker.addComment(issue.key, comment);
    }

    return {
      taskId: task.id,
      issue,
    };
  } catch (error) {
    return {
      taskId: task.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create issues for multiple tasks
 */
export async function createIssues(
  tracker: Tracker,
  tasks: Task[],
  config: TrackerConfig,
  options: Partial<CreateIssueOptions> = {}
): Promise<CreateIssueResult[]> {
  const results: CreateIssueResult[] = [];

  // Sort tasks: parents first, then children
  const sorted = sortTasksByHierarchy(tasks);

  // Keep track of created issues for parent linking
  const createdIssues = new Map<string, ExternalIssue>();

  for (const task of sorted) {
    // Handle subtasks specially
    if (task.parent && options.createSubtasks !== false) {
      const parentIssue = createdIssues.get(task.parent);

      if (parentIssue) {
        try {
          const issue = await tracker.createSubtask(parentIssue.key, task);
          createdIssues.set(task.id, issue);
          results.push({ taskId: task.id, issue });
          continue;
        } catch (error) {
          // Fall back to regular issue
          console.warn(`Could not create subtask, creating regular issue: ${error}`);
        }
      }
    }

    const result = await createIssue(tracker, task, config, options);
    results.push(result);

    if (result.issue) {
      createdIssues.set(task.id, result.issue);
    }
  }

  return results;
}

/**
 * Sort tasks so parents come before children
 */
function sortTasksByHierarchy(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const sorted: Task[] = [];
  const visited = new Set<string>();

  function visit(task: Task): void {
    if (visited.has(task.id)) return;

    // Visit parent first
    if (task.parent && taskMap.has(task.parent) && !visited.has(task.parent)) {
      visit(taskMap.get(task.parent)!);
    }

    visited.add(task.id);
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task);
  }

  return sorted;
}

/**
 * Generate task operations for linking created issues
 */
export function generateLinkOperations(
  results: CreateIssueResult[]
): TaskOperation[] {
  const operations: TaskOperation[] = [];
  const timestamp = new Date().toISOString();

  for (const result of results) {
    if (result.issue) {
      operations.push({
        op: 'link',
        id: result.taskId,
        externalId: result.issue.key,
        externalUrl: result.issue.url,
        timestamp,
      });
    }
  }

  return operations;
}

/**
 * Print create results
 */
export function printCreateResults(results: CreateIssueResult[]): void {
  console.log('\nCreate Results:');

  const created = results.filter(r => r.issue);
  const skipped = results.filter(r => r.skipped);
  const failed = results.filter(r => r.error);

  console.log(`  Created: ${created.length}`);
  console.log(`  Skipped: ${skipped.length}`);
  console.log(`  Failed:  ${failed.length}`);

  if (created.length > 0) {
    console.log('\nCreated Issues:');
    for (const result of created) {
      console.log(`  ✓ ${result.taskId} → ${result.issue!.key}`);
    }
  }

  if (failed.length > 0) {
    console.log('\nFailed:');
    for (const result of failed) {
      console.log(`  ✗ ${result.taskId}: ${result.error}`);
    }
  }
}
