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
  | 'bottleneck';

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
