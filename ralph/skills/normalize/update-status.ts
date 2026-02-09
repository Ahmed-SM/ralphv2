/**
 * Update Status Skill
 *
 * Updates issue status in external trackers based on Ralph task status.
 */

import type { Task, TaskStatus, TaskOperation } from '../../types/index.js';
import type { Tracker, TrackerConfig, Transition } from './tracker-interface.js';
import { mapStatusToRalph } from './tracker-interface.js';

export interface StatusUpdateResult {
  taskId: string;
  externalId: string;
  fromStatus: string;
  toStatus: string;
  success: boolean;
  error?: string;
  transition?: Transition;
}

export interface StatusSyncResult {
  taskId: string;
  externalId: string;
  localStatus: TaskStatus;
  remoteStatus: string;
  action: 'push' | 'pull' | 'conflict' | 'none';
  resolved?: TaskStatus;
  error?: string;
}

/**
 * Update issue status in tracker
 */
export async function updateIssueStatus(
  tracker: Tracker,
  task: Task,
  config: TrackerConfig
): Promise<StatusUpdateResult> {
  if (!task.externalId) {
    return {
      taskId: task.id,
      externalId: '',
      fromStatus: '',
      toStatus: '',
      success: false,
      error: 'Task not linked to external issue',
    };
  }

  const targetStatus = config.statusMap[task.status];
  if (!targetStatus) {
    return {
      taskId: task.id,
      externalId: task.externalId,
      fromStatus: '',
      toStatus: task.status,
      success: false,
      error: `No status mapping for ${task.status}`,
    };
  }

  try {
    // Get current status
    const issue = await tracker.getIssue(task.externalId);
    const currentStatus = issue.status;

    // Skip if already at target status
    if (currentStatus.toLowerCase() === targetStatus.toLowerCase()) {
      return {
        taskId: task.id,
        externalId: task.externalId,
        fromStatus: currentStatus,
        toStatus: targetStatus,
        success: true,
      };
    }

    // Get available transitions
    const transitions = await tracker.getTransitions(task.externalId);

    // Find matching transition
    const transition = findTransition(transitions, targetStatus);

    if (!transition) {
      return {
        taskId: task.id,
        externalId: task.externalId,
        fromStatus: currentStatus,
        toStatus: targetStatus,
        success: false,
        error: `No transition available to ${targetStatus}. Available: ${transitions.map(t => t.to).join(', ')}`,
      };
    }

    // Execute transition
    await tracker.transitionIssue(task.externalId, transition.name);

    return {
      taskId: task.id,
      externalId: task.externalId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      success: true,
      transition,
    };
  } catch (error) {
    return {
      taskId: task.id,
      externalId: task.externalId,
      fromStatus: '',
      toStatus: targetStatus,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sync status between task and issue
 */
export async function syncStatus(
  tracker: Tracker,
  task: Task,
  config: TrackerConfig,
  direction: 'push' | 'pull' | 'auto' = 'auto'
): Promise<StatusSyncResult> {
  if (!task.externalId) {
    return {
      taskId: task.id,
      externalId: '',
      localStatus: task.status,
      remoteStatus: '',
      action: 'none',
      error: 'Task not linked',
    };
  }

  try {
    const issue = await tracker.getIssue(task.externalId);
    const remoteRalphStatus = mapStatusToRalph(issue.status, config);

    // Statuses match
    if (remoteRalphStatus === task.status) {
      return {
        taskId: task.id,
        externalId: task.externalId,
        localStatus: task.status,
        remoteStatus: issue.status,
        action: 'none',
      };
    }

    // Determine direction
    let action: 'push' | 'pull' | 'conflict' = direction === 'auto' ? 'pull' : direction;

    // In auto mode, tracker wins (human authority)
    if (direction === 'auto') {
      return {
        taskId: task.id,
        externalId: task.externalId,
        localStatus: task.status,
        remoteStatus: issue.status,
        action: 'pull',
        resolved: remoteRalphStatus,
      };
    }

    if (action === 'push') {
      const result = await updateIssueStatus(tracker, task, config);
      return {
        taskId: task.id,
        externalId: task.externalId,
        localStatus: task.status,
        remoteStatus: issue.status,
        action: 'push',
        resolved: task.status,
        error: result.error,
      };
    }

    // Pull
    return {
      taskId: task.id,
      externalId: task.externalId,
      localStatus: task.status,
      remoteStatus: issue.status,
      action: 'pull',
      resolved: remoteRalphStatus,
    };
  } catch (error) {
    return {
      taskId: task.id,
      externalId: task.externalId,
      localStatus: task.status,
      remoteStatus: '',
      action: 'none',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Batch status sync
 */
export async function syncStatuses(
  tracker: Tracker,
  tasks: Task[],
  config: TrackerConfig,
  direction: 'push' | 'pull' | 'auto' = 'auto'
): Promise<StatusSyncResult[]> {
  const results: StatusSyncResult[] = [];

  for (const task of tasks) {
    if (task.externalId) {
      const result = await syncStatus(tracker, task, config, direction);
      results.push(result);
    }
  }

  return results;
}

/**
 * Find a transition to target status
 */
function findTransition(transitions: Transition[], targetStatus: string): Transition | undefined {
  const lower = targetStatus.toLowerCase();

  // Try exact match first
  let match = transitions.find(t =>
    t.to.toLowerCase() === lower ||
    t.name.toLowerCase() === lower
  );

  if (match) return match;

  // Try partial match
  match = transitions.find(t =>
    t.to.toLowerCase().includes(lower) ||
    t.name.toLowerCase().includes(lower) ||
    lower.includes(t.to.toLowerCase())
  );

  return match;
}

/**
 * Generate operations for status changes from tracker
 */
export function generateStatusOperations(
  results: StatusSyncResult[]
): TaskOperation[] {
  const operations: TaskOperation[] = [];
  const timestamp = new Date().toISOString();

  for (const result of results) {
    if (result.action === 'pull' && result.resolved) {
      operations.push({
        op: 'update',
        id: result.taskId,
        changes: {
          status: result.resolved,
          updatedAt: timestamp,
        },
        source: 'tracker',
        timestamp,
      });
    }
  }

  return operations;
}

/**
 * Print status sync results
 */
export function printStatusResults(results: StatusSyncResult[]): void {
  console.log('\nStatus Sync Results:');

  const pushed = results.filter(r => r.action === 'push' && !r.error);
  const pulled = results.filter(r => r.action === 'pull' && !r.error);
  const unchanged = results.filter(r => r.action === 'none' && !r.error);
  const failed = results.filter(r => r.error);

  console.log(`  Pushed (local → remote): ${pushed.length}`);
  console.log(`  Pulled (remote → local): ${pulled.length}`);
  console.log(`  Unchanged:               ${unchanged.length}`);
  console.log(`  Failed:                  ${failed.length}`);

  if (pushed.length > 0) {
    console.log('\nPushed:');
    for (const result of pushed) {
      console.log(`  → ${result.taskId}: ${result.localStatus} → ${result.remoteStatus}`);
    }
  }

  if (pulled.length > 0) {
    console.log('\nPulled:');
    for (const result of pulled) {
      console.log(`  ← ${result.taskId}: ${result.localStatus} ← ${result.remoteStatus}`);
    }
  }

  if (failed.length > 0) {
    console.log('\nFailed:');
    for (const result of failed) {
      console.log(`  ✗ ${result.taskId}: ${result.error}`);
    }
  }
}
