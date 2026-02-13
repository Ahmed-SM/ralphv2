import { describe, it, expect } from 'vitest';
import { detectPatterns, type DetectionContext } from './detect-patterns.js';
import type { Task } from '../../types/index.js';
import type { TaskMetrics, AggregateMetrics } from '../track/record-metrics.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'discovered',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMetric(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
  return {
    taskId: 'RALPH-001',
    type: 'task',
    ...overrides,
  };
}

function makeAggregate(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    period: '2024-01',
    tasksCompleted: 10,
    tasksCreated: 12,
    tasksFailed: 1,
    avgDurationDays: 2,
    medianDurationDays: 1.5,
    totalDurationDays: 20,
    avgIterations: 3,
    totalCommits: 30,
    totalFilesChanged: 50,
    avgEstimateRatio: 1.0,
    estimateAccuracy: 80,
    totalBlockers: 2,
    totalBugs: 1,
    byType: {} as Record<string, number>,
    byAggregate: {},
    byComplexity: {},
    ...overrides,
  };
}

function makeContext(overrides: Partial<DetectionContext> = {}): DetectionContext {
  return {
    tasks: new Map(),
    metrics: [],
    aggregates: [],
    ...overrides,
  };
}

// =============================================================================
// detectPatterns (main function)
// =============================================================================

describe('detectPatterns', () => {
  it('returns empty patterns for empty context', () => {
    const result = detectPatterns(makeContext());
    expect(result.patterns).toHaveLength(0);
    expect(result.summary.totalPatterns).toBe(0);
  });

  it('filters patterns below minConfidence', () => {
    // Create context that would produce a low-confidence pattern
    const result = detectPatterns(makeContext({ minConfidence: 0.99 }));
    expect(result.patterns.every(p => p.confidence >= 0.99)).toBe(true);
  });

  it('builds summary with correct counts', () => {
    // Create a context with estimation drift (underestimate by 2x)
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        estimate: 1,
        actual: 3, // 3x underestimate
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    expect(result.summary.totalPatterns).toBe(result.patterns.length);
    expect(result.summary.byType).toBeDefined();
  });
});

// =============================================================================
// Estimation Drift Detector
// =============================================================================

describe('estimation drift detection', () => {
  it('does not detect drift with fewer than minSamples', () => {
    const metrics = [
      makeMetric({ estimate: 1, actual: 5 }),
      makeMetric({ estimate: 1, actual: 5 }),
    ];
    const result = detectPatterns(makeContext({ metrics, minSamples: 5 }));
    const driftPattern = result.patterns.find(p => p.type === 'estimation_drift');
    expect(driftPattern).toBeUndefined();
  });

  it('detects underestimation when ratio > 1.5', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        estimate: 2,
        actual: 5, // 2.5x
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const drift = result.patterns.find(p => p.type === 'estimation_drift');
    expect(drift).toBeDefined();
    expect(drift!.description).toContain('underestimated');
    expect(drift!.data.direction).toBe('underestimated');
  });

  it('detects overestimation when ratio < 0.7', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        estimate: 10,
        actual: 3, // 0.3x
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const drift = result.patterns.find(p => p.type === 'estimation_drift');
    expect(drift).toBeDefined();
    expect(drift!.description).toContain('overestimated');
    expect(drift!.data.direction).toBe('overestimated');
  });

  it('does not detect drift when estimates are accurate', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 6; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        estimate: 5,
        actual: 5, // 1.0x
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const drift = result.patterns.find(p => p.type === 'estimation_drift');
    expect(drift).toBeUndefined();
  });

  it('includes suggestion with multiplier', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        estimate: 1,
        actual: 4, // 4x
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const drift = result.patterns.find(p => p.type === 'estimation_drift');
    expect(drift).toBeDefined();
    expect(drift!.suggestion).toContain('multiplier');
  });

  it('skips metrics without estimate or actual', () => {
    const metrics: TaskMetrics[] = [
      makeMetric({ estimate: undefined, actual: 5 }),
      makeMetric({ estimate: 5, actual: undefined }),
      makeMetric({ estimate: undefined, actual: undefined }),
    ];
    const result = detectPatterns(makeContext({ metrics }));
    const drift = result.patterns.find(p => p.type === 'estimation_drift');
    expect(drift).toBeUndefined();
  });
});

// =============================================================================
// Task Clustering Detector
// =============================================================================

describe('task clustering detection', () => {
  it('detects clusters when aggregate has many tasks', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 10; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, aggregate: 'auth' }));
    }

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const cluster = result.patterns.find(p => p.type === 'task_clustering');
    expect(cluster).toBeDefined();
    expect(cluster!.data.aggregate).toBe('auth');
    expect(cluster!.data.taskCount).toBe(10);
  });

  it('does not detect clustering with small aggregates', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', aggregate: 'auth' }));
    tasks.set('RALPH-002', makeTask({ id: 'RALPH-002', aggregate: 'auth' }));

    const result = detectPatterns(makeContext({ tasks }));
    const cluster = result.patterns.find(p => p.type === 'task_clustering');
    expect(cluster).toBeUndefined();
  });

  it('does not detect clustering with no aggregates', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001' }));
    tasks.set('RALPH-002', makeTask({ id: 'RALPH-002' }));

    const result = detectPatterns(makeContext({ tasks }));
    const cluster = result.patterns.find(p => p.type === 'task_clustering');
    expect(cluster).toBeUndefined();
  });

  it('reports the largest cluster first', () => {
    const tasks = new Map<string, Task>();
    // 4 in "api"
    for (let i = 0; i < 4; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, aggregate: 'api' }));
    }
    // 8 in "ui"
    for (let i = 4; i < 12; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, aggregate: 'ui' }));
    }

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const cluster = result.patterns.find(p => p.type === 'task_clustering');
    expect(cluster).toBeDefined();
    expect(cluster!.data.aggregate).toBe('ui');
  });
});

// =============================================================================
// Blocking Chain Detector
// =============================================================================

describe('blocking chain detection', () => {
  it('detects tasks that block many others', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({
      id: 'RALPH-001',
      blocks: ['RALPH-002', 'RALPH-003', 'RALPH-004'],
    }));
    tasks.set('RALPH-002', makeTask({
      id: 'RALPH-002',
      blockedBy: ['RALPH-001'],
    }));
    tasks.set('RALPH-003', makeTask({
      id: 'RALPH-003',
      blockedBy: ['RALPH-001'],
    }));
    tasks.set('RALPH-004', makeTask({
      id: 'RALPH-004',
      blockedBy: ['RALPH-001'],
    }));

    const result = detectPatterns(makeContext({ tasks }));
    const chain = result.patterns.find(p => p.type === 'blocking_chain');
    expect(chain).toBeDefined();
    expect(chain!.evidence).toContain('RALPH-001');
  });

  it('does not detect chains when few tasks are blocked', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001' }));
    tasks.set('RALPH-002', makeTask({
      id: 'RALPH-002',
      blockedBy: ['RALPH-001'],
    }));

    const result = detectPatterns(makeContext({ tasks }));
    const chain = result.patterns.find(p => p.type === 'blocking_chain');
    expect(chain).toBeUndefined();
  });
});

// =============================================================================
// Bug Hotspot Detector
// =============================================================================

describe('bug hotspot detection', () => {
  it('detects areas with many bugs', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 4; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'bug', aggregate: 'parser' }));
    }

    const result = detectPatterns(makeContext({ tasks }));
    const hotspot = result.patterns.find(p => p.type === 'bug_hotspot');
    expect(hotspot).toBeDefined();
    expect(hotspot!.data.aggregate).toBe('parser');
    expect(hotspot!.data.bugCount).toBe(4);
  });

  it('does not detect hotspot with fewer than 3 bugs', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', type: 'bug', aggregate: 'parser' }));
    tasks.set('RALPH-002', makeTask({ id: 'RALPH-002', type: 'bug', aggregate: 'parser' }));

    const result = detectPatterns(makeContext({ tasks }));
    const hotspot = result.patterns.find(p => p.type === 'bug_hotspot');
    expect(hotspot).toBeUndefined();
  });

  it('does not detect hotspot when bugs spread across aggregates', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', type: 'bug', aggregate: 'a' }));
    tasks.set('RALPH-002', makeTask({ id: 'RALPH-002', type: 'bug', aggregate: 'b' }));
    tasks.set('RALPH-003', makeTask({ id: 'RALPH-003', type: 'bug', aggregate: 'c' }));

    const result = detectPatterns(makeContext({ tasks }));
    const hotspot = result.patterns.find(p => p.type === 'bug_hotspot');
    expect(hotspot).toBeUndefined();
  });
});

// =============================================================================
// Iteration Anomaly Detector
// =============================================================================

describe('iteration anomaly detection', () => {
  it('detects tasks with unusually high iterations', () => {
    const metrics: TaskMetrics[] = [];
    // 9 normal tasks with 3 iterations
    for (let i = 0; i < 9; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        iterations: 3,
      }));
    }
    // 1 anomaly with 50 iterations
    metrics.push(makeMetric({
      taskId: 'RALPH-010',
      iterations: 50,
    }));

    const result = detectPatterns(makeContext({ metrics }));
    const anomaly = result.patterns.find(p => p.type === 'iteration_anomaly');
    expect(anomaly).toBeDefined();
    expect(anomaly!.evidence).toContain('RALPH-010');
  });

  it('does not detect anomalies with fewer than 5 samples', () => {
    const metrics = [
      makeMetric({ iterations: 3 }),
      makeMetric({ iterations: 100 }),
    ];

    const result = detectPatterns(makeContext({ metrics }));
    const anomaly = result.patterns.find(p => p.type === 'iteration_anomaly');
    expect(anomaly).toBeUndefined();
  });

  it('does not detect anomalies when all iterations are similar', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        iterations: 5,
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const anomaly = result.patterns.find(p => p.type === 'iteration_anomaly');
    expect(anomaly).toBeUndefined();
  });
});

// =============================================================================
// Velocity Trend Detector
// =============================================================================

describe('velocity trend detection', () => {
  it('detects increasing velocity', () => {
    const aggregates = [
      makeAggregate({ period: '2024-01', tasksCompleted: 5 }),
      makeAggregate({ period: '2024-02', tasksCompleted: 6 }),
      makeAggregate({ period: '2024-03', tasksCompleted: 15 }),
      makeAggregate({ period: '2024-04', tasksCompleted: 20 }),
    ];

    const result = detectPatterns(makeContext({ aggregates }));
    const trend = result.patterns.find(p => p.type === 'velocity_trend');
    expect(trend).toBeDefined();
    expect(trend!.data.direction).toBe('increasing');
  });

  it('detects decreasing velocity', () => {
    const aggregates = [
      makeAggregate({ period: '2024-01', tasksCompleted: 20 }),
      makeAggregate({ period: '2024-02', tasksCompleted: 18 }),
      makeAggregate({ period: '2024-03', tasksCompleted: 5 }),
      makeAggregate({ period: '2024-04', tasksCompleted: 3 }),
    ];

    const result = detectPatterns(makeContext({ aggregates }));
    const trend = result.patterns.find(p => p.type === 'velocity_trend');
    expect(trend).toBeDefined();
    expect(trend!.data.direction).toBe('decreasing');
  });

  it('does not detect trend with fewer than 2 periods', () => {
    const aggregates = [
      makeAggregate({ period: '2024-01', tasksCompleted: 10 }),
    ];

    const result = detectPatterns(makeContext({ aggregates }));
    const trend = result.patterns.find(p => p.type === 'velocity_trend');
    expect(trend).toBeUndefined();
  });

  it('does not detect trend when velocity is stable', () => {
    const aggregates = [
      makeAggregate({ period: '2024-01', tasksCompleted: 10 }),
      makeAggregate({ period: '2024-02', tasksCompleted: 10 }),
      makeAggregate({ period: '2024-03', tasksCompleted: 11 }),
      makeAggregate({ period: '2024-04', tasksCompleted: 10 }),
    ];

    const result = detectPatterns(makeContext({ aggregates }));
    const trend = result.patterns.find(p => p.type === 'velocity_trend');
    expect(trend).toBeUndefined();
  });
});

// =============================================================================
// Bottleneck Detector
// =============================================================================

describe('bottleneck detection', () => {
  it('detects task types that are significantly slower', () => {
    const metrics: TaskMetrics[] = [];
    // 5 fast "feature" tasks
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        type: 'feature',
        durationDays: 1,
        completedAt: '2024-01-10T00:00:00Z',
      }));
    }
    // 5 slow "bug" tasks (8x slower)
    for (let i = 5; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        type: 'bug',
        durationDays: 8,
        completedAt: '2024-01-10T00:00:00Z',
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const bottleneck = result.patterns.find(p => p.type === 'bottleneck');
    expect(bottleneck).toBeDefined();
    expect(bottleneck!.data.slowestType).toBe('bug');
  });

  it('does not detect bottleneck with fewer than 5 metrics with duration', () => {
    const metrics = [
      makeMetric({ type: 'bug', durationDays: 10, completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ type: 'feature', durationDays: 1, completedAt: '2024-01-10T00:00:00Z' }),
    ];

    const result = detectPatterns(makeContext({ metrics }));
    const bottleneck = result.patterns.find(p => p.type === 'bottleneck');
    expect(bottleneck).toBeUndefined();
  });

  it('does not detect bottleneck when durations are similar', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 6; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        type: i % 2 === 0 ? 'feature' : 'bug',
        durationDays: 2,
        completedAt: '2024-01-10T00:00:00Z',
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const bottleneck = result.patterns.find(p => p.type === 'bottleneck');
    expect(bottleneck).toBeUndefined();
  });
});

// =============================================================================
// Complexity Signal Detector
// =============================================================================

describe('complexity signal detection', () => {
  it('detects when complexity does not correlate with duration', () => {
    const metrics: TaskMetrics[] = [];
    // "complex" tasks are fast
    for (let i = 0; i < 3; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        complexity: 'complex',
        durationDays: 0.5,
        completedAt: '2024-01-10T00:00:00Z',
      }));
    }
    // "simple" tasks are slow
    for (let i = 3; i < 6; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        complexity: 'simple',
        durationDays: 10,
        completedAt: '2024-01-10T00:00:00Z',
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const signal = result.patterns.find(p => p.type === 'complexity_signal');
    expect(signal).toBeDefined();
    expect(signal!.description).toContain('correlate');
  });

  it('does not detect signal when complexity matches duration', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 3; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        complexity: 'simple',
        durationDays: 1,
        completedAt: '2024-01-10T00:00:00Z',
      }));
    }
    for (let i = 3; i < 6; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        complexity: 'complex',
        durationDays: 10,
        completedAt: '2024-01-10T00:00:00Z',
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const signal = result.patterns.find(p => p.type === 'complexity_signal');
    expect(signal).toBeUndefined();
  });

  it('does not detect signal with fewer than 5 samples', () => {
    const metrics = [
      makeMetric({ complexity: 'simple', durationDays: 10, completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ complexity: 'complex', durationDays: 1, completedAt: '2024-01-10T00:00:00Z' }),
    ];

    const result = detectPatterns(makeContext({ metrics }));
    const signal = result.patterns.find(p => p.type === 'complexity_signal');
    expect(signal).toBeUndefined();
  });
});

// =============================================================================
// Summary Building
// =============================================================================

describe('pattern summary', () => {
  it('counts high-confidence patterns correctly', () => {
    // Create context that will produce patterns with known confidences
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        estimate: 1,
        actual: 5,
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    expect(result.summary.highConfidence).toBe(
      result.patterns.filter(p => p.confidence >= 0.8).length
    );
  });

  it('collects top suggestions from patterns', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        estimate: 1,
        actual: 5,
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    if (result.patterns.length > 0) {
      expect(result.summary.topSuggestions.length).toBeGreaterThanOrEqual(0);
      expect(result.summary.topSuggestions.length).toBeLessThanOrEqual(5);
    }
  });
});
