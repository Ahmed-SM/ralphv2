/**
 * Detect Patterns Skill
 *
 * Detects patterns in execution history for learning.
 */

import type { Task, TaskType, TaskStatus } from '../../types/index.js';
import type { TaskMetrics, AggregateMetrics } from '../track/record-metrics.js';

// =============================================================================
// TYPES
// =============================================================================

export type PatternType =
  | 'estimation_drift'
  | 'task_clustering'
  | 'blocking_chain'
  | 'complexity_signal'
  | 'bug_hotspot'
  | 'test_gap'
  | 'high_churn'
  | 'coupling'
  | 'iteration_anomaly'
  | 'failure_mode'
  | 'velocity_trend'
  | 'bottleneck'
  | 'spec_drift'
  | 'plan_drift'
  | 'knowledge_staleness';

export interface DetectedPattern {
  type: PatternType;
  confidence: number;  // 0-1
  description: string;
  data: Record<string, unknown>;
  evidence: string[];
  suggestion?: string;
  timestamp: string;
}

export interface PatternDetectionResult {
  patterns: DetectedPattern[];
  summary: PatternSummary;
}

export interface PatternSummary {
  totalPatterns: number;
  highConfidence: number;
  byType: Record<PatternType, number>;
  topSuggestions: string[];
}

// =============================================================================
// PATTERN DETECTION
// =============================================================================

export interface DetectionContext {
  tasks: Map<string, Task>;
  metrics: TaskMetrics[];
  aggregates: AggregateMetrics[];
  minConfidence?: number;
  minSamples?: number;
}

/**
 * Run all pattern detectors
 */
export function detectPatterns(context: DetectionContext): PatternDetectionResult {
  const minConfidence = context.minConfidence ?? 0.6;
  const patterns: DetectedPattern[] = [];

  // Run each detector
  const detectors = [
    detectEstimationDrift,
    detectTaskClustering,
    detectBlockingChains,
    detectBugHotspots,
    detectIterationAnomalies,
    detectVelocityTrends,
    detectBottlenecks,
    detectComplexitySignals,
    detectTestGaps,
    detectHighChurn,
    detectCoupling,
    detectFailureModes,
    detectSpecDrift,
    detectPlanDrift,
    detectKnowledgeStaleness,
  ];

  for (const detector of detectors) {
    const detected = detector(context);
    if (detected && detected.confidence >= minConfidence) {
      patterns.push(detected);
    }
  }

  // Build summary
  const summary = buildSummary(patterns);

  return { patterns, summary };
}

// =============================================================================
// INDIVIDUAL DETECTORS
// =============================================================================

/**
 * Detect systematic estimation errors
 */
function detectEstimationDrift(context: DetectionContext): DetectedPattern | null {
  const minSamples = context.minSamples ?? 5;

  const withEstimates = context.metrics.filter(
    m => m.estimate !== undefined && m.actual !== undefined
  );

  if (withEstimates.length < minSamples) {
    return null;
  }

  const ratios = withEstimates.map(m => m.actual! / m.estimate!);
  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

  // Significant drift is > 1.5x or < 0.7x
  if (avgRatio >= 0.7 && avgRatio <= 1.5) {
    return null;
  }

  const direction = avgRatio > 1 ? 'underestimated' : 'overestimated';
  const multiplier = avgRatio > 1 ? avgRatio : 1 / avgRatio;

  return {
    type: 'estimation_drift',
    confidence: Math.min(withEstimates.length / 10, 1) * 0.9,
    description: `Tasks are systematically ${direction} by ${multiplier.toFixed(1)}x`,
    data: {
      avgRatio,
      samples: withEstimates.length,
      direction,
    },
    evidence: withEstimates.slice(0, 5).map(m => m.taskId),
    suggestion: `Apply a ${avgRatio.toFixed(1)}x multiplier to future estimates`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect tasks that tend to spawn related tasks
 */
function detectTaskClustering(context: DetectionContext): DetectedPattern | null {
  const byAggregate = new Map<string, Task[]>();

  for (const task of context.tasks.values()) {
    if (task.aggregate) {
      const list = byAggregate.get(task.aggregate) || [];
      list.push(task);
      byAggregate.set(task.aggregate, list);
    }
  }

  // Find aggregates with many tasks
  const clusters = Array.from(byAggregate.entries())
    .filter(([, tasks]) => tasks.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  if (clusters.length === 0) {
    return null;
  }

  const topCluster = clusters[0];

  return {
    type: 'task_clustering',
    confidence: Math.min(topCluster[1].length / 10, 1) * 0.8,
    description: `"${topCluster[0]}" aggregate has ${topCluster[1].length} tasks`,
    data: {
      aggregate: topCluster[0],
      taskCount: topCluster[1].length,
      clusters: clusters.slice(0, 5).map(([name, tasks]) => ({
        name,
        count: tasks.length,
      })),
    },
    evidence: topCluster[1].slice(0, 5).map(t => t.id),
    suggestion: `Consider breaking down "${topCluster[0]}" into sub-aggregates`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect chains of blocking tasks
 */
function detectBlockingChains(context: DetectionContext): DetectedPattern | null {
  const blocked = Array.from(context.tasks.values()).filter(
    t => t.blockedBy && t.blockedBy.length > 0
  );

  if (blocked.length < 2) {
    return null;
  }

  // Find tasks that block many others
  const blockCounts = new Map<string, number>();
  for (const task of context.tasks.values()) {
    if (task.blocks) {
      blockCounts.set(task.id, task.blocks.length);
    }
  }

  const topBlockers = Array.from(blockCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  if (topBlockers.length === 0) {
    return null;
  }

  return {
    type: 'blocking_chain',
    confidence: 0.75,
    description: `${topBlockers.length} tasks are blocking multiple others`,
    data: {
      blockers: topBlockers.slice(0, 5).map(([id, count]) => ({ id, count })),
      totalBlocked: blocked.length,
    },
    evidence: topBlockers.slice(0, 5).map(([id]) => id),
    suggestion: 'Prioritize blocking tasks to unblock downstream work',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect areas with many bugs
 */
function detectBugHotspots(context: DetectionContext): DetectedPattern | null {
  const bugs = Array.from(context.tasks.values()).filter(t => t.type === 'bug');

  if (bugs.length < 3) {
    return null;
  }

  // Group by aggregate
  const byAggregate = new Map<string, Task[]>();
  for (const bug of bugs) {
    const key = bug.aggregate || 'unknown';
    const list = byAggregate.get(key) || [];
    list.push(bug);
    byAggregate.set(key, list);
  }

  const hotspots = Array.from(byAggregate.entries())
    .filter(([, tasks]) => tasks.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  if (hotspots.length === 0) {
    return null;
  }

  const topHotspot = hotspots[0];

  return {
    type: 'bug_hotspot',
    confidence: Math.min(topHotspot[1].length / 5, 1) * 0.85,
    description: `"${topHotspot[0]}" has ${topHotspot[1].length} bugs`,
    data: {
      aggregate: topHotspot[0],
      bugCount: topHotspot[1].length,
      totalBugs: bugs.length,
      hotspots: hotspots.slice(0, 5).map(([name, tasks]) => ({
        name,
        count: tasks.length,
      })),
    },
    evidence: topHotspot[1].map(t => t.id),
    suggestion: `Review and refactor "${topHotspot[0]}" to reduce bug density`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect tasks with unusually high iteration counts
 */
function detectIterationAnomalies(context: DetectionContext): DetectedPattern | null {
  const withIterations = context.metrics.filter(m => m.iterations !== undefined);

  if (withIterations.length < 5) {
    return null;
  }

  const iterations = withIterations.map(m => m.iterations!);
  const avg = iterations.reduce((a, b) => a + b, 0) / iterations.length;
  const stdDev = Math.sqrt(
    iterations.reduce((sum, i) => sum + Math.pow(i - avg, 2), 0) / iterations.length
  );

  // Find outliers (> 2 std deviations)
  const threshold = avg + 2 * stdDev;
  const anomalies = withIterations.filter(m => m.iterations! > threshold);

  if (anomalies.length === 0) {
    return null;
  }

  return {
    type: 'iteration_anomaly',
    confidence: 0.8,
    description: `${anomalies.length} tasks required unusually many iterations`,
    data: {
      avgIterations: avg,
      threshold,
      anomalyCount: anomalies.length,
      anomalies: anomalies.map(m => ({
        taskId: m.taskId,
        iterations: m.iterations,
      })),
    },
    evidence: anomalies.map(m => m.taskId),
    suggestion: 'Investigate why these tasks required extra iterations',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect velocity trends over time
 */
function detectVelocityTrends(context: DetectionContext): DetectedPattern | null {
  if (context.aggregates.length < 2) {
    return null;
  }

  // Sort by period
  const sorted = [...context.aggregates].sort((a, b) =>
    a.period.localeCompare(b.period)
  );

  // Compare recent vs older periods
  const midpoint = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, midpoint);
  const recent = sorted.slice(midpoint);

  const olderAvg = older.reduce((sum, a) => sum + a.tasksCompleted, 0) / older.length;
  const recentAvg = recent.reduce((sum, a) => sum + a.tasksCompleted, 0) / recent.length;

  const change = (recentAvg - olderAvg) / olderAvg;

  // Significant change is > 20%
  if (Math.abs(change) < 0.2) {
    return null;
  }

  const direction = change > 0 ? 'increasing' : 'decreasing';

  return {
    type: 'velocity_trend',
    confidence: 0.7,
    description: `Velocity is ${direction} (${(change * 100).toFixed(0)}% change)`,
    data: {
      olderAvg,
      recentAvg,
      change,
      direction,
      periods: sorted.length,
    },
    evidence: sorted.map(a => a.period),
    suggestion: direction === 'decreasing'
      ? 'Investigate causes of velocity decrease'
      : 'Document what\'s driving increased velocity',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect bottleneck task types or areas
 */
function detectBottlenecks(context: DetectionContext): DetectedPattern | null {
  const withDuration = context.metrics.filter(m => m.durationDays !== undefined);

  if (withDuration.length < 5) {
    return null;
  }

  // Group by type
  const byType = new Map<TaskType, number[]>();
  for (const m of withDuration) {
    const list = byType.get(m.type) || [];
    list.push(m.durationDays!);
    byType.set(m.type, list);
  }

  // Find slowest type
  const typeAvgs = Array.from(byType.entries())
    .filter(([, durations]) => durations.length >= 2)
    .map(([type, durations]) => ({
      type,
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      count: durations.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  if (typeAvgs.length < 2) {
    return null;
  }

  const slowest = typeAvgs[0];
  const overallAvg = withDuration.reduce((sum, m) => sum + m.durationDays!, 0) / withDuration.length;

  // Bottleneck if > 1.5x slower than average
  if (slowest.avg < overallAvg * 1.5) {
    return null;
  }

  return {
    type: 'bottleneck',
    confidence: Math.min(slowest.count / 5, 1) * 0.75,
    description: `"${slowest.type}" tasks are ${(slowest.avg / overallAvg).toFixed(1)}x slower than average`,
    data: {
      slowestType: slowest.type,
      avgDuration: slowest.avg,
      overallAvg,
      ratio: slowest.avg / overallAvg,
      typeBreakdown: typeAvgs,
    },
    evidence: withDuration
      .filter(m => m.type === slowest.type)
      .slice(0, 5)
      .map(m => m.taskId),
    suggestion: `Investigate why "${slowest.type}" tasks take longer`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect complexity signals from metrics
 */
function detectComplexitySignals(context: DetectionContext): DetectedPattern | null {
  const withComplexity = context.metrics.filter(m => m.complexity);

  if (withComplexity.length < 5) {
    return null;
  }

  // Check if complexity correlates with duration
  const byComplexity = new Map<string, number[]>();
  for (const m of withComplexity) {
    if (m.durationDays !== undefined) {
      const list = byComplexity.get(m.complexity!) || [];
      list.push(m.durationDays);
      byComplexity.set(m.complexity!, list);
    }
  }

  const complexityOrder = ['trivial', 'simple', 'moderate', 'complex'];
  const avgs = complexityOrder
    .filter(c => byComplexity.has(c))
    .map(c => ({
      complexity: c,
      avg: byComplexity.get(c)!.reduce((a, b) => a + b, 0) / byComplexity.get(c)!.length,
    }));

  if (avgs.length < 2) {
    return null;
  }

  // Check if avgs are in expected order
  let ordered = true;
  for (let i = 1; i < avgs.length; i++) {
    if (avgs[i].avg < avgs[i - 1].avg) {
      ordered = false;
      break;
    }
  }

  if (!ordered) {
    return {
      type: 'complexity_signal',
      confidence: 0.7,
      description: 'Complexity ratings don\'t correlate with actual duration',
      data: {
        avgs,
        ordered: false,
      },
      evidence: withComplexity.slice(0, 5).map(m => m.taskId),
      suggestion: 'Review complexity estimation criteria',
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Detect areas with low test coverage (few test tasks relative to feature/bug tasks)
 */
export function detectTestGaps(context: DetectionContext): DetectedPattern | null {
  // Group tasks by aggregate
  const byAggregate = new Map<string, { total: number; tests: number; taskIds: string[] }>();

  for (const task of context.tasks.values()) {
    const key = task.aggregate || task.domain || 'unknown';
    const entry = byAggregate.get(key) || { total: 0, tests: 0, taskIds: [] };
    entry.total++;
    if (task.type === 'test') {
      entry.tests++;
    }
    entry.taskIds.push(task.id);
    byAggregate.set(key, entry);
  }

  // Find areas with many tasks but few/no tests
  const gaps = Array.from(byAggregate.entries())
    .filter(([, stats]) => {
      const nonTestCount = stats.total - stats.tests;
      return nonTestCount >= 3 && stats.tests / stats.total < 0.2;
    })
    .sort((a, b) => {
      // Sort by test ratio ascending (worst coverage first)
      const ratioA = a[1].tests / a[1].total;
      const ratioB = b[1].tests / b[1].total;
      return ratioA - ratioB;
    });

  if (gaps.length === 0) {
    return null;
  }

  const worstGap = gaps[0];
  const coverage = worstGap[1].tests / worstGap[1].total;

  return {
    type: 'test_gap',
    confidence: Math.min(worstGap[1].total / 10, 1) * 0.8,
    description: `"${worstGap[0]}" has ${(coverage * 100).toFixed(0)}% test coverage (${worstGap[1].tests}/${worstGap[1].total} tasks are tests)`,
    data: {
      aggregate: worstGap[0],
      totalTasks: worstGap[1].total,
      testTasks: worstGap[1].tests,
      coverage,
      gaps: gaps.slice(0, 5).map(([name, stats]) => ({
        name,
        total: stats.total,
        tests: stats.tests,
        coverage: stats.tests / stats.total,
      })),
    },
    evidence: worstGap[1].taskIds.slice(0, 5),
    suggestion: `Add test tasks for "${worstGap[0]}" to improve coverage`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect files/areas that change frequently (high churn indicates instability)
 */
export function detectHighChurn(context: DetectionContext): DetectedPattern | null {
  const minSamples = context.minSamples ?? 5;

  // Group metrics by aggregate, summing filesChanged
  const byAggregate = new Map<string, { totalFiles: number; taskCount: number; taskIds: string[] }>();

  for (const m of context.metrics) {
    if (m.filesChanged === undefined || m.filesChanged === 0) continue;
    const key = m.aggregate || m.domain || 'unknown';
    const entry = byAggregate.get(key) || { totalFiles: 0, taskCount: 0, taskIds: [] };
    entry.totalFiles += m.filesChanged;
    entry.taskCount++;
    entry.taskIds.push(m.taskId);
    byAggregate.set(key, entry);
  }

  // Find areas with high churn (many file changes across multiple tasks)
  const churnAreas = Array.from(byAggregate.entries())
    .filter(([, stats]) => stats.taskCount >= minSamples)
    .map(([name, stats]) => ({
      name,
      ...stats,
      avgFilesPerTask: stats.totalFiles / stats.taskCount,
    }))
    .sort((a, b) => b.totalFiles - a.totalFiles);

  if (churnAreas.length === 0) {
    return null;
  }

  // Compare top churn area to overall average
  const allFiles = Array.from(byAggregate.values()).reduce((sum, s) => sum + s.totalFiles, 0);
  const allTasks = Array.from(byAggregate.values()).reduce((sum, s) => sum + s.taskCount, 0);
  const overallAvg = allTasks > 0 ? allFiles / allTasks : 0;

  const topChurn = churnAreas[0];

  // High churn if > 1.5x the overall average files per task
  if (overallAvg > 0 && topChurn.avgFilesPerTask < overallAvg * 1.5) {
    return null;
  }

  return {
    type: 'high_churn',
    confidence: Math.min(topChurn.taskCount / 10, 1) * 0.75,
    description: `"${topChurn.name}" has high churn (${topChurn.totalFiles} file changes across ${topChurn.taskCount} tasks)`,
    data: {
      aggregate: topChurn.name,
      totalFiles: topChurn.totalFiles,
      taskCount: topChurn.taskCount,
      avgFilesPerTask: topChurn.avgFilesPerTask,
      overallAvg,
      churnAreas: churnAreas.slice(0, 5).map(a => ({
        name: a.name,
        totalFiles: a.totalFiles,
        taskCount: a.taskCount,
        avgFilesPerTask: a.avgFilesPerTask,
      })),
    },
    evidence: topChurn.taskIds.slice(0, 5),
    suggestion: `Investigate instability in "${topChurn.name}" — frequent file changes may indicate design issues`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect coupling between areas (changes to A require changes to B)
 */
export function detectCoupling(context: DetectionContext): DetectedPattern | null {
  // Group tasks by their tags to find co-occurring aggregates/domains
  // A task that touches multiple aggregates indicates coupling
  const pairCounts = new Map<string, { count: number; taskIds: string[] }>();

  for (const m of context.metrics) {
    const areas: string[] = [];
    if (m.aggregate) areas.push(m.aggregate);
    if (m.domain && m.domain !== m.aggregate) areas.push(m.domain);
    if (m.tags) {
      for (const tag of m.tags) {
        if (tag !== m.aggregate && tag !== m.domain) {
          areas.push(tag);
        }
      }
    }

    // Generate pairs from areas touched by this task
    for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        const pair = [areas[i], areas[j]].sort().join(' <-> ');
        const entry = pairCounts.get(pair) || { count: 0, taskIds: [] };
        entry.count++;
        entry.taskIds.push(m.taskId);
        pairCounts.set(pair, entry);
      }
    }
  }

  // Find pairs that co-occur frequently (>= 3 times)
  const coupledPairs = Array.from(pairCounts.entries())
    .filter(([, stats]) => stats.count >= 3)
    .sort((a, b) => b[1].count - a[1].count);

  if (coupledPairs.length === 0) {
    return null;
  }

  const topPair = coupledPairs[0];
  const [areaA, areaB] = topPair[0].split(' <-> ');

  return {
    type: 'coupling',
    confidence: Math.min(topPair[1].count / 8, 1) * 0.8,
    description: `"${areaA}" and "${areaB}" are coupled (co-changed in ${topPair[1].count} tasks)`,
    data: {
      areaA,
      areaB,
      coChangeCount: topPair[1].count,
      pairs: coupledPairs.slice(0, 5).map(([pair, stats]) => ({
        pair,
        count: stats.count,
      })),
    },
    evidence: topPair[1].taskIds.slice(0, 5),
    suggestion: `Consider decoupling "${areaA}" and "${areaB}" to reduce change dependencies`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect recurring failure patterns — areas or task types that fail repeatedly
 *
 * Groups failed/blocked tasks by aggregate/domain/type and identifies
 * concentrations of failures that suggest systemic issues.
 * Per spec: requires >= 2 recurring failures in the same area.
 */
export function detectFailureModes(context: DetectionContext): DetectedPattern | null {
  // Collect failed tasks: blocked or tasks with high blocker counts in metrics
  const failedTasks: Array<{ taskId: string; aggregate?: string; domain?: string; type: TaskType; reason?: string }> = [];

  // From task map: tasks in blocked status
  for (const task of context.tasks.values()) {
    if (task.status === 'blocked' || task.status === 'cancelled') {
      failedTasks.push({
        taskId: task.id,
        aggregate: task.aggregate,
        domain: task.domain,
        type: task.type,
      });
    }
  }

  // From metrics: tasks with blockers > 0 (indicates they hit blockers during execution)
  for (const m of context.metrics) {
    if (m.blockers !== undefined && m.blockers > 0) {
      // Avoid duplicates if task is already in failedTasks
      if (!failedTasks.some(f => f.taskId === m.taskId)) {
        failedTasks.push({
          taskId: m.taskId,
          aggregate: m.aggregate,
          domain: m.domain,
          type: m.type,
        });
      }
    }
  }

  if (failedTasks.length < 2) {
    return null;
  }

  // Group by area (aggregate or domain fallback)
  const byArea = new Map<string, typeof failedTasks>();
  for (const f of failedTasks) {
    const key = f.aggregate || f.domain || 'unknown';
    const list = byArea.get(key) || [];
    list.push(f);
    byArea.set(key, list);
  }

  // Find areas with recurring failures (>= 2)
  const recurringAreas = Array.from(byArea.entries())
    .filter(([, failures]) => failures.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  if (recurringAreas.length === 0) {
    // Fall back to grouping by type
    const byType = new Map<string, typeof failedTasks>();
    for (const f of failedTasks) {
      const list = byType.get(f.type) || [];
      list.push(f);
      byType.set(f.type, list);
    }

    const recurringTypes = Array.from(byType.entries())
      .filter(([, failures]) => failures.length >= 2)
      .sort((a, b) => b[1].length - a[1].length);

    if (recurringTypes.length === 0) {
      return null;
    }

    const topType = recurringTypes[0];
    return {
      type: 'failure_mode',
      confidence: Math.min(topType[1].length / 6, 1) * 0.8,
      description: `"${topType[0]}" tasks have ${topType[1].length} failures — recurring failure pattern`,
      data: {
        groupBy: 'type',
        group: topType[0],
        failureCount: topType[1].length,
        totalFailures: failedTasks.length,
        failures: recurringTypes.slice(0, 5).map(([name, failures]) => ({
          name,
          count: failures.length,
        })),
      },
      evidence: topType[1].map(f => f.taskId),
      suggestion: `Investigate why "${topType[0]}" tasks fail repeatedly — may indicate a systemic issue`,
      timestamp: new Date().toISOString(),
    };
  }

  const topArea = recurringAreas[0];
  // Calculate failure rate for the area vs total tasks in that area
  const totalTasksInArea = Array.from(context.tasks.values())
    .filter(t => (t.aggregate || t.domain || 'unknown') === topArea[0]).length;
  const failureRate = totalTasksInArea > 0 ? topArea[1].length / totalTasksInArea : 0;

  return {
    type: 'failure_mode',
    confidence: Math.min(topArea[1].length / 6, 1) * 0.8,
    description: `"${topArea[0]}" has ${topArea[1].length} failures${totalTasksInArea > 0 ? ` (${(failureRate * 100).toFixed(0)}% failure rate)` : ''}`,
    data: {
      groupBy: 'area',
      group: topArea[0],
      failureCount: topArea[1].length,
      totalFailures: failedTasks.length,
      totalTasksInArea,
      failureRate,
      failures: recurringAreas.slice(0, 5).map(([name, failures]) => ({
        name,
        count: failures.length,
      })),
    },
    evidence: topArea[1].map(f => f.taskId),
    suggestion: `Investigate recurring failures in "${topArea[0]}" — ${topArea[1].length} tasks have failed`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect spec drift — when tasks in an area repeatedly hit blockers or fail,
 * indicating the spec doesn't match codebase reality.
 *
 * Signal: high blocker/failure rate per domain/aggregate compared to overall rate.
 * Requires >= 3 completed tasks in the area and a failure rate > 30%.
 */
export function detectSpecDrift(context: DetectionContext): DetectedPattern | null {
  const minSamples = context.minSamples ?? 3;

  // Collect per-area stats: total completed tasks and failed/blocked ones
  const byArea = new Map<string, { total: number; failed: number; taskIds: string[] }>();

  for (const task of context.tasks.values()) {
    if (task.status === 'done' || task.status === 'blocked' || task.status === 'cancelled') {
      const key = task.aggregate || task.domain || 'unknown';
      const entry = byArea.get(key) || { total: 0, failed: 0, taskIds: [] };
      entry.total++;
      if (task.status === 'blocked' || task.status === 'cancelled') {
        entry.failed++;
      }
      entry.taskIds.push(task.id);
      byArea.set(key, entry);
    }
  }

  // Also incorporate metrics-based blockers for completed tasks
  for (const m of context.metrics) {
    if (m.blockers !== undefined && m.blockers > 0) {
      const key = m.aggregate || m.domain || 'unknown';
      const entry = byArea.get(key) || { total: 0, failed: 0, taskIds: [] };
      // Only count if not already counted from task status
      if (!entry.taskIds.includes(m.taskId)) {
        entry.total++;
        entry.failed++;
        entry.taskIds.push(m.taskId);
        byArea.set(key, entry);
      } else {
        // Task already counted by status; if it's not already failed, add the failure
        const task = context.tasks.get(m.taskId);
        if (task && task.status === 'done') {
          entry.failed++;
        }
      }
    }
  }

  // Find areas with high failure rate
  const driftAreas = Array.from(byArea.entries())
    .filter(([, stats]) => stats.total >= minSamples && stats.failed / stats.total > 0.3)
    .sort((a, b) => (b[1].failed / b[1].total) - (a[1].failed / a[1].total));

  if (driftAreas.length === 0) {
    return null;
  }

  const worst = driftAreas[0];
  const failureRate = worst[1].failed / worst[1].total;

  return {
    type: 'spec_drift',
    confidence: Math.min(worst[1].total / 8, 1) * 0.8,
    description: `"${worst[0]}" has a ${(failureRate * 100).toFixed(0)}% failure rate (${worst[1].failed}/${worst[1].total}) — specs may not match codebase reality`,
    data: {
      area: worst[0],
      failureRate,
      failedCount: worst[1].failed,
      totalCount: worst[1].total,
      driftAreas: driftAreas.slice(0, 5).map(([name, stats]) => ({
        name,
        failureRate: stats.failed / stats.total,
        failed: stats.failed,
        total: stats.total,
      })),
    },
    evidence: worst[1].taskIds.slice(0, 5),
    suggestion: `Review and update specs for "${worst[0]}" — high failure rate suggests spec/reality mismatch`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect plan drift — when tasks spawn unexpected subtasks or have many
 * child tasks not anticipated in the original plan structure.
 *
 * Signal: areas where parent tasks generate many subtasks relative to
 * original task count, suggesting the plan underestimated scope.
 * Requires >= 2 parent tasks spawning subtasks.
 */
export function detectPlanDrift(context: DetectionContext): DetectedPattern | null {
  // Count tasks with parentId (subtasks) per area
  const byArea = new Map<string, { planned: number; spawned: number; parentIds: Set<string>; taskIds: string[] }>();

  for (const task of context.tasks.values()) {
    const key = task.aggregate || task.domain || 'unknown';
    const entry = byArea.get(key) || { planned: 0, spawned: 0, parentIds: new Set(), taskIds: [] };

    if (task.parentId) {
      entry.spawned++;
      entry.parentIds.add(task.parentId);
    } else {
      entry.planned++;
    }
    entry.taskIds.push(task.id);
    byArea.set(key, entry);
  }

  // Find areas where subtask ratio is high (many spawned vs planned)
  const driftAreas = Array.from(byArea.entries())
    .filter(([, stats]) => stats.parentIds.size >= 2 && stats.spawned > stats.planned * 0.5)
    .sort((a, b) => (b[1].spawned / b[1].planned) - (a[1].spawned / a[1].planned));

  if (driftAreas.length === 0) {
    return null;
  }

  const worst = driftAreas[0];
  const spawnRatio = worst[1].spawned / worst[1].planned;

  return {
    type: 'plan_drift',
    confidence: Math.min(worst[1].parentIds.size / 5, 1) * 0.75,
    description: `"${worst[0]}" has ${worst[1].spawned} subtasks from ${worst[1].parentIds.size} parents (${(spawnRatio * 100).toFixed(0)}% spawn ratio) — plan may underestimate scope`,
    data: {
      area: worst[0],
      spawnRatio,
      spawnedCount: worst[1].spawned,
      plannedCount: worst[1].planned,
      parentCount: worst[1].parentIds.size,
      driftAreas: driftAreas.slice(0, 5).map(([name, stats]) => ({
        name,
        spawnRatio: stats.spawned / stats.planned,
        spawned: stats.spawned,
        planned: stats.planned,
        parents: stats.parentIds.size,
      })),
    },
    evidence: worst[1].taskIds.slice(0, 5),
    suggestion: `Update implementation plan for "${worst[0]}" — unexpected subtask growth indicates scope underestimation`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect knowledge staleness — when file changes concentrate in areas
 * not covered by any aggregate/domain, suggesting specs are outdated
 * or missing coverage for active development areas.
 *
 * Signal: metrics with no aggregate AND no domain (unknown areas) that
 * have significant file churn relative to the total.
 * Requires >= 3 tasks in unknown areas and > 40% of total file changes.
 */
export function detectKnowledgeStaleness(context: DetectionContext): DetectedPattern | null {
  let unknownFiles = 0;
  let unknownTasks = 0;
  let totalFiles = 0;
  let totalTasks = 0;
  const unknownTaskIds: string[] = [];

  for (const m of context.metrics) {
    const files = m.filesChanged ?? 0;
    if (files === 0) continue;

    totalFiles += files;
    totalTasks++;

    if (!m.aggregate && !m.domain) {
      unknownFiles += files;
      unknownTasks++;
      unknownTaskIds.push(m.taskId);
    }
  }

  if (unknownTasks < 3 || totalFiles === 0) {
    return null;
  }

  const unknownRatio = unknownFiles / totalFiles;

  if (unknownRatio <= 0.4) {
    return null;
  }

  return {
    type: 'knowledge_staleness',
    confidence: Math.min(unknownTasks / 8, 1) * 0.7,
    description: `${(unknownRatio * 100).toFixed(0)}% of file changes (${unknownFiles}/${totalFiles}) are in uncategorized areas — specs may be missing coverage`,
    data: {
      unknownRatio,
      unknownFiles,
      unknownTasks,
      totalFiles,
      totalTasks,
    },
    evidence: unknownTaskIds.slice(0, 5),
    suggestion: 'Review and update specs to cover active development areas that lack aggregate/domain classification',
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function buildSummary(patterns: DetectedPattern[]): PatternSummary {
  const byType: Record<PatternType, number> = {} as Record<PatternType, number>;

  for (const pattern of patterns) {
    byType[pattern.type] = (byType[pattern.type] || 0) + 1;
  }

  const highConfidence = patterns.filter(p => p.confidence >= 0.8);
  const topSuggestions = patterns
    .filter(p => p.suggestion)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(p => p.suggestion!);

  return {
    totalPatterns: patterns.length,
    highConfidence: highConfidence.length,
    byType,
    topSuggestions,
  };
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Print detected patterns
 */
export function printPatterns(result: PatternDetectionResult): void {
  console.log('\nDetected Patterns');
  console.log('─'.repeat(40));

  if (result.patterns.length === 0) {
    console.log('  No significant patterns detected');
    return;
  }

  console.log(`\nFound ${result.patterns.length} patterns:\n`);

  for (const pattern of result.patterns) {
    const conf = (pattern.confidence * 100).toFixed(0);
    console.log(`  [${pattern.type}] (${conf}% confidence)`);
    console.log(`    ${pattern.description}`);
    if (pattern.suggestion) {
      console.log(`    → ${pattern.suggestion}`);
    }
    console.log();
  }

  if (result.summary.topSuggestions.length > 0) {
    console.log('Top Suggestions:');
    for (const suggestion of result.summary.topSuggestions) {
      console.log(`  • ${suggestion}`);
    }
  }
}
