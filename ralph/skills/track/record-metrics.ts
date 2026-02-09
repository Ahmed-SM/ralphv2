/**
 * Record Metrics Skill
 *
 * Records execution metrics for learning and pattern detection.
 */

import type { Task, TaskType, TaskStatus, Complexity } from '../../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TaskMetrics {
  taskId: string;
  type: TaskType;
  complexity?: Complexity;

  // Time metrics
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  durationDays?: number;

  // Effort metrics
  iterations?: number;
  commits?: number;
  filesChanged?: number;
  linesChanged?: number;

  // Estimate accuracy
  estimate?: number;
  actual?: number;
  estimateRatio?: number;  // actual / estimate

  // Quality metrics
  blockers?: number;
  reopens?: number;
  bugs?: number;

  // Context
  aggregate?: string;
  domain?: string;
  tags?: string[];
}

export interface AggregateMetrics {
  period: string;  // e.g., "2024-01", "2024-W05"

  // Volume
  tasksCompleted: number;
  tasksCreated: number;
  tasksFailed: number;

  // Time
  avgDurationDays: number;
  medianDurationDays: number;
  totalDurationDays: number;

  // Effort
  avgIterations: number;
  totalCommits: number;
  totalFilesChanged: number;

  // Accuracy
  avgEstimateRatio: number;
  estimateAccuracy: number;  // % within 20% of estimate

  // Quality
  totalBlockers: number;
  totalBugs: number;

  // Breakdown
  byType: Record<TaskType, number>;
  byAggregate: Record<string, number>;
  byComplexity: Record<string, number>;
}

export interface MetricEvent {
  type: 'task_metric' | 'aggregate_metric' | 'milestone';
  timestamp: string;
  data: TaskMetrics | AggregateMetrics | MilestoneEvent;
}

export interface MilestoneEvent {
  milestone: string;
  tasksCompleted: number;
  duration: number;
  timestamp: string;
}

// =============================================================================
// METRIC RECORDING
// =============================================================================

/**
 * Record metrics for a completed task
 */
export function recordTaskMetrics(
  task: Task,
  executionData: {
    iterations?: number;
    commits?: number;
    filesChanged?: number;
    linesChanged?: number;
    blockers?: string[];
  } = {}
): TaskMetrics {
  const metrics: TaskMetrics = {
    taskId: task.id,
    type: task.type,
    complexity: task.complexity,
    aggregate: task.aggregate,
    domain: task.domain,
    tags: task.tags,
  };

  // Time metrics
  if (task.createdAt) {
    metrics.startedAt = task.createdAt;
  }
  if (task.completedAt) {
    metrics.completedAt = task.completedAt;
  }
  if (task.createdAt && task.completedAt) {
    const start = new Date(task.createdAt);
    const end = new Date(task.completedAt);
    metrics.durationMs = end.getTime() - start.getTime();
    metrics.durationDays = metrics.durationMs / (1000 * 60 * 60 * 24);
  }

  // Estimate accuracy
  if (task.estimate !== undefined) {
    metrics.estimate = task.estimate;
  }
  if (task.actual !== undefined) {
    metrics.actual = task.actual;
  } else if (executionData.iterations !== undefined) {
    metrics.actual = executionData.iterations;
  }
  if (metrics.estimate && metrics.actual) {
    metrics.estimateRatio = metrics.actual / metrics.estimate;
  }

  // Execution data
  if (executionData.iterations !== undefined) {
    metrics.iterations = executionData.iterations;
  }
  if (executionData.commits !== undefined) {
    metrics.commits = executionData.commits;
  }
  if (executionData.filesChanged !== undefined) {
    metrics.filesChanged = executionData.filesChanged;
  }
  if (executionData.linesChanged !== undefined) {
    metrics.linesChanged = executionData.linesChanged;
  }
  if (executionData.blockers) {
    metrics.blockers = executionData.blockers.length;
  }

  return metrics;
}

/**
 * Compute aggregate metrics from task metrics
 */
export function computeAggregateMetrics(
  taskMetrics: TaskMetrics[],
  period: string
): AggregateMetrics {
  const completed = taskMetrics.filter(m => m.completedAt);

  // Initialize
  const aggregate: AggregateMetrics = {
    period,
    tasksCompleted: completed.length,
    tasksCreated: taskMetrics.length,
    tasksFailed: 0,
    avgDurationDays: 0,
    medianDurationDays: 0,
    totalDurationDays: 0,
    avgIterations: 0,
    totalCommits: 0,
    totalFilesChanged: 0,
    avgEstimateRatio: 0,
    estimateAccuracy: 0,
    totalBlockers: 0,
    totalBugs: 0,
    byType: {} as Record<TaskType, number>,
    byAggregate: {},
    byComplexity: {},
  };

  if (completed.length === 0) {
    return aggregate;
  }

  // Duration metrics
  const durations = completed
    .filter(m => m.durationDays !== undefined)
    .map(m => m.durationDays!);

  if (durations.length > 0) {
    aggregate.totalDurationDays = durations.reduce((a, b) => a + b, 0);
    aggregate.avgDurationDays = aggregate.totalDurationDays / durations.length;
    aggregate.medianDurationDays = median(durations);
  }

  // Iteration metrics
  const iterations = completed
    .filter(m => m.iterations !== undefined)
    .map(m => m.iterations!);

  if (iterations.length > 0) {
    aggregate.avgIterations = iterations.reduce((a, b) => a + b, 0) / iterations.length;
  }

  // Commit/file metrics
  aggregate.totalCommits = sum(completed.map(m => m.commits || 0));
  aggregate.totalFilesChanged = sum(completed.map(m => m.filesChanged || 0));

  // Estimate accuracy
  const withEstimates = completed.filter(m => m.estimateRatio !== undefined);
  if (withEstimates.length > 0) {
    aggregate.avgEstimateRatio =
      sum(withEstimates.map(m => m.estimateRatio!)) / withEstimates.length;

    const accurate = withEstimates.filter(m =>
      m.estimateRatio! >= 0.8 && m.estimateRatio! <= 1.2
    );
    aggregate.estimateAccuracy = (accurate.length / withEstimates.length) * 100;
  }

  // Quality metrics
  aggregate.totalBlockers = sum(completed.map(m => m.blockers || 0));
  aggregate.totalBugs = completed.filter(m => m.type === 'bug').length;

  // Breakdowns
  for (const m of completed) {
    // By type
    aggregate.byType[m.type] = (aggregate.byType[m.type] || 0) + 1;

    // By aggregate
    if (m.aggregate) {
      aggregate.byAggregate[m.aggregate] = (aggregate.byAggregate[m.aggregate] || 0) + 1;
    }

    // By complexity
    if (m.complexity) {
      aggregate.byComplexity[m.complexity] = (aggregate.byComplexity[m.complexity] || 0) + 1;
    }
  }

  return aggregate;
}

// =============================================================================
// PERSISTENCE
// =============================================================================

/**
 * Append metric event to learning.jsonl
 */
export async function appendMetricEvent(
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<void>,
  path: string,
  event: MetricEvent
): Promise<void> {
  let content = '';
  try {
    content = await readFile(path);
  } catch {
    // File doesn't exist
  }

  await writeFile(path, content + JSON.stringify(event) + '\n');
}

/**
 * Load metric events from learning.jsonl
 */
export async function loadMetricEvents(
  readFile: (path: string) => Promise<string>,
  path: string
): Promise<MetricEvent[]> {
  try {
    const content = await readFile(path);
    if (!content.trim()) return [];

    return content
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as MetricEvent)
      .filter(e =>
        e.type === 'task_metric' ||
        e.type === 'aggregate_metric' ||
        e.type === 'milestone'
      );
  } catch {
    return [];
  }
}

/**
 * Load all task metrics
 */
export async function loadTaskMetrics(
  readFile: (path: string) => Promise<string>,
  path: string
): Promise<TaskMetrics[]> {
  const events = await loadMetricEvents(readFile, path);
  return events
    .filter(e => e.type === 'task_metric')
    .map(e => e.data as TaskMetrics);
}

// =============================================================================
// HELPERS
// =============================================================================

function sum(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0);
}

function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Get current period string
 */
export function getCurrentPeriod(granularity: 'day' | 'week' | 'month' = 'month'): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  switch (granularity) {
    case 'day':
      return `${year}-${month}-${day}`;
    case 'week':
      const weekNum = getWeekNumber(now);
      return `${year}-W${String(weekNum).padStart(2, '0')}`;
    case 'month':
    default:
      return `${year}-${month}`;
  }
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Print metrics summary
 */
export function printMetricsSummary(aggregate: AggregateMetrics): void {
  console.log(`\nMetrics Summary (${aggregate.period})`);
  console.log('─'.repeat(40));

  console.log('\nVolume:');
  console.log(`  Tasks completed:    ${aggregate.tasksCompleted}`);
  console.log(`  Tasks created:      ${aggregate.tasksCreated}`);

  console.log('\nTime:');
  console.log(`  Avg duration:       ${aggregate.avgDurationDays.toFixed(1)} days`);
  console.log(`  Median duration:    ${aggregate.medianDurationDays.toFixed(1)} days`);
  console.log(`  Total duration:     ${aggregate.totalDurationDays.toFixed(1)} days`);

  console.log('\nEffort:');
  console.log(`  Avg iterations:     ${aggregate.avgIterations.toFixed(1)}`);
  console.log(`  Total commits:      ${aggregate.totalCommits}`);
  console.log(`  Total files:        ${aggregate.totalFilesChanged}`);

  console.log('\nAccuracy:');
  console.log(`  Estimate ratio:     ${aggregate.avgEstimateRatio.toFixed(2)}x`);
  console.log(`  Within 20%:         ${aggregate.estimateAccuracy.toFixed(0)}%`);

  console.log('\nQuality:');
  console.log(`  Total blockers:     ${aggregate.totalBlockers}`);
  console.log(`  Bugs fixed:         ${aggregate.totalBugs}`);

  if (Object.keys(aggregate.byType).length > 0) {
    console.log('\nBy Type:');
    for (const [type, count] of Object.entries(aggregate.byType)) {
      console.log(`  ${type}: ${count}`);
    }
  }
}
