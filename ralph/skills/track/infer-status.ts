/**
 * Infer Status Skill
 *
 * Infers task status from git activity patterns.
 */

import type { Task, TaskStatus, TaskOperation } from '../../types/index.js';
import type { CommitTaskRef, CommitAction, GitBranch } from './parse-commits.js';
import type { TaskActivity, TaskGitSummary } from './link-commits.js';

// =============================================================================
// TYPES
// =============================================================================

export interface StatusInference {
  taskId: string;
  currentStatus: TaskStatus;
  inferredStatus: TaskStatus;
  confidence: number;  // 0-1
  reason: string;
  evidence: string[];
}

export interface PRInfo {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  branch: string;
  taskId?: string;
  mergedAt?: string;
}

// =============================================================================
// STATUS INFERENCE
// =============================================================================

/**
 * Infer status from git activity
 */
export function inferStatus(
  task: Task,
  summary: TaskGitSummary,
  options: InferenceOptions = {}
): StatusInference {
  const evidence: string[] = [];
  let inferredStatus = task.status;
  let confidence = 0;
  let reason = 'No change detected';

  // Rule 1: First commit moves to in_progress
  if (
    (task.status === 'discovered' || task.status === 'pending') &&
    summary.commits > 0
  ) {
    inferredStatus = 'in_progress';
    confidence = 0.9;
    reason = 'Work detected in commits';
    evidence.push(`${summary.commits} commit(s) found`);
  }

  // Rule 2: Complete action in commit
  if (
    task.status === 'in_progress' &&
    summary.actions.includes('complete')
  ) {
    inferredStatus = 'done';
    confidence = 0.8;
    reason = 'Completion signal in commit message';
    evidence.push('Commit contains "complete" or similar');
  }

  // Rule 3: High commit activity suggests in_progress
  if (
    task.status !== 'done' &&
    summary.commits >= (options.highActivityThreshold || 5)
  ) {
    if (task.status !== 'in_progress') {
      inferredStatus = 'in_progress';
      confidence = 0.7;
      reason = 'High commit activity';
      evidence.push(`${summary.commits} commits indicate active work`);
    }
  }

  // Rule 4: Recent commit activity
  if (summary.lastCommit && task.status !== 'done') {
    const lastCommitDate = new Date(summary.lastCommit);
    const now = new Date();
    const daysSinceLastCommit = (now.getTime() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceLastCommit < 1 && task.status !== 'in_progress') {
      inferredStatus = 'in_progress';
      confidence = 0.85;
      reason = 'Recent commit activity';
      evidence.push('Commit within last 24 hours');
    }
  }

  return {
    taskId: task.id,
    currentStatus: task.status,
    inferredStatus,
    confidence,
    reason,
    evidence,
  };
}

/**
 * Infer status from PR state
 */
export function inferStatusFromPR(
  task: Task,
  pr: PRInfo
): StatusInference {
  const evidence: string[] = [];
  let inferredStatus = task.status;
  let confidence = 0;
  let reason = 'No change detected';

  evidence.push(`PR #${pr.number}: ${pr.state}`);

  switch (pr.state) {
    case 'open':
      if (task.status === 'discovered' || task.status === 'pending') {
        inferredStatus = 'in_progress';
        confidence = 0.9;
        reason = 'PR opened';
      } else if (task.status === 'in_progress') {
        inferredStatus = 'review';
        confidence = 0.85;
        reason = 'PR under review';
      }
      break;

    case 'merged':
      inferredStatus = 'done';
      confidence = 0.95;
      reason = 'PR merged';
      evidence.push(`Merged at ${pr.mergedAt}`);
      break;

    case 'closed':
      // Closed without merge - might be abandoned or moved
      // Don't change status automatically
      confidence = 0.3;
      reason = 'PR closed without merge';
      break;
  }

  return {
    taskId: task.id,
    currentStatus: task.status,
    inferredStatus,
    confidence,
    reason,
    evidence,
  };
}

/**
 * Infer status from branch state
 */
export function inferStatusFromBranch(
  task: Task,
  branch: GitBranch,
  merged: boolean
): StatusInference {
  const evidence: string[] = [];
  let inferredStatus = task.status;
  let confidence = 0;
  let reason = 'No change detected';

  evidence.push(`Branch: ${branch.name}`);

  if (merged) {
    inferredStatus = 'done';
    confidence = 0.9;
    reason = 'Branch merged';
    evidence.push('Branch merged to main');
  } else if (branch.name) {
    if (task.status === 'discovered' || task.status === 'pending') {
      inferredStatus = 'in_progress';
      confidence = 0.7;
      reason = 'Feature branch exists';
    }
  }

  return {
    taskId: task.id,
    currentStatus: task.status,
    inferredStatus,
    confidence,
    reason,
    evidence,
  };
}

// =============================================================================
// BATCH INFERENCE
// =============================================================================

export interface InferenceOptions {
  /** Minimum confidence to apply change */
  minConfidence?: number;
  /** Number of commits considered "high activity" */
  highActivityThreshold?: number;
  /** Include PR state in inference */
  includePRs?: boolean;
  /** Include branch state in inference */
  includeBranches?: boolean;
}

/**
 * Infer status for multiple tasks
 */
export function inferStatuses(
  tasks: Map<string, Task>,
  summaries: TaskGitSummary[],
  options: InferenceOptions = {}
): StatusInference[] {
  const inferences: StatusInference[] = [];
  const minConfidence = options.minConfidence ?? 0.7;

  for (const summary of summaries) {
    const task = tasks.get(summary.taskId);
    if (!task) continue;

    const inference = inferStatus(task, summary, options);

    // Only include if confident enough and status changes
    if (
      inference.confidence >= minConfidence &&
      inference.inferredStatus !== inference.currentStatus
    ) {
      inferences.push(inference);
    }
  }

  return inferences;
}

/**
 * Generate task operations from inferences
 */
export function generateInferenceOperations(
  inferences: StatusInference[],
  minConfidence = 0.7
): TaskOperation[] {
  const operations: TaskOperation[] = [];
  const timestamp = new Date().toISOString();

  for (const inference of inferences) {
    if (
      inference.confidence >= minConfidence &&
      inference.inferredStatus !== inference.currentStatus
    ) {
      operations.push({
        op: 'update',
        id: inference.taskId,
        changes: {
          status: inference.inferredStatus,
          updatedAt: timestamp,
        },
        source: 'git' as const,
        timestamp,
      });
    }
  }

  return operations;
}

// =============================================================================
// ANOMALY DETECTION
// =============================================================================

export interface StatusAnomaly {
  taskId: string;
  type: 'stale' | 'orphan_branch' | 'long_running' | 'no_activity';
  message: string;
  severity: 'low' | 'medium' | 'high';
  data: Record<string, unknown>;
}

/**
 * Detect status anomalies
 */
export function detectAnomalies(
  tasks: Map<string, Task>,
  summaries: TaskGitSummary[],
  options: {
    staleDays?: number;
    longRunningDays?: number;
  } = {}
): StatusAnomaly[] {
  const anomalies: StatusAnomaly[] = [];
  const staleDays = options.staleDays ?? 14;
  const longRunningDays = options.longRunningDays ?? 30;
  const now = new Date();

  // Build summary map
  const summaryMap = new Map(summaries.map(s => [s.taskId, s]));

  for (const task of tasks.values()) {
    // Skip completed/cancelled tasks
    if (task.status === 'done' || task.status === 'cancelled') continue;

    const summary = summaryMap.get(task.id);

    // Check for stale tasks (in_progress but no recent commits)
    if (task.status === 'in_progress' && summary?.lastCommit) {
      const lastCommitDate = new Date(summary.lastCommit);
      const daysSinceCommit = (now.getTime() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceCommit > staleDays) {
        anomalies.push({
          taskId: task.id,
          type: 'stale',
          message: `No commits in ${Math.floor(daysSinceCommit)} days`,
          severity: daysSinceCommit > staleDays * 2 ? 'high' : 'medium',
          data: { daysSinceCommit, lastCommit: summary.lastCommit },
        });
      }
    }

    // Check for long-running tasks
    if (summary?.firstCommit) {
      const firstCommitDate = new Date(summary.firstCommit);
      const daysRunning = (now.getTime() - firstCommitDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysRunning > longRunningDays && task.status !== 'done') {
        anomalies.push({
          taskId: task.id,
          type: 'long_running',
          message: `Task running for ${Math.floor(daysRunning)} days`,
          severity: daysRunning > longRunningDays * 2 ? 'high' : 'medium',
          data: { daysRunning, firstCommit: summary.firstCommit },
        });
      }
    }

    // Check for tasks with no activity
    if (
      (task.status === 'in_progress' || task.status === 'pending') &&
      !summary
    ) {
      anomalies.push({
        taskId: task.id,
        type: 'no_activity',
        message: 'Task has no git activity',
        severity: 'low',
        data: { status: task.status },
      });
    }
  }

  return anomalies;
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Print inference results
 */
export function printInferences(inferences: StatusInference[]): void {
  console.log('\nStatus Inferences:');

  if (inferences.length === 0) {
    console.log('  No status changes inferred');
    return;
  }

  for (const inf of inferences) {
    const arrow = inf.currentStatus === inf.inferredStatus ? '=' : '→';
    const conf = (inf.confidence * 100).toFixed(0);
    console.log(`  ${inf.taskId}: ${inf.currentStatus} ${arrow} ${inf.inferredStatus} (${conf}%)`);
    console.log(`    Reason: ${inf.reason}`);
    if (inf.evidence.length > 0) {
      console.log(`    Evidence: ${inf.evidence.join(', ')}`);
    }
  }
}

/**
 * Print anomalies
 */
export function printAnomalies(anomalies: StatusAnomaly[]): void {
  console.log('\nAnomalies Detected:');

  if (anomalies.length === 0) {
    console.log('  No anomalies detected');
    return;
  }

  const bySeverity = {
    high: anomalies.filter(a => a.severity === 'high'),
    medium: anomalies.filter(a => a.severity === 'medium'),
    low: anomalies.filter(a => a.severity === 'low'),
  };

  for (const [severity, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;
    console.log(`\n  ${severity.toUpperCase()}:`);
    for (const anomaly of items) {
      console.log(`    - ${anomaly.taskId}: ${anomaly.message}`);
    }
  }
}
