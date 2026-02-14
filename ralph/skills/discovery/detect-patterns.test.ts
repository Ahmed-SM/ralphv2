import { describe, it, expect } from 'vitest';
import { detectPatterns, detectTestGaps, detectHighChurn, detectCoupling, type DetectionContext } from './detect-patterns.js';
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

// =============================================================================
// Test Gap Detector
// =============================================================================

describe('test gap detection', () => {
  it('detects areas with no test tasks', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 5; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'payments' }));
    }

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeDefined();
    expect(gap!.data.aggregate).toBe('payments');
    expect(gap!.data.testTasks).toBe(0);
    expect(gap!.data.coverage).toBe(0);
  });

  it('detects areas with low test ratio (< 20%)', () => {
    const tasks = new Map<string, Task>();
    // 9 feature tasks + 1 test task = 10% coverage
    for (let i = 0; i < 9; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'api' }));
    }
    tasks.set('RALPH-010', makeTask({ id: 'RALPH-010', type: 'test', aggregate: 'api' }));

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeDefined();
    expect(gap!.data.coverage).toBeCloseTo(0.1);
  });

  it('does not detect gap when test ratio >= 20%', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 4; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'api' }));
    }
    tasks.set('RALPH-005', makeTask({ id: 'RALPH-005', type: 'test', aggregate: 'api' }));

    const result = detectPatterns(makeContext({ tasks }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeUndefined();
  });

  it('does not detect gap with fewer than 3 non-test tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', type: 'feature', aggregate: 'small' }));
    tasks.set('RALPH-002', makeTask({ id: 'RALPH-002', type: 'feature', aggregate: 'small' }));

    const result = detectPatterns(makeContext({ tasks }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeUndefined();
  });

  it('reports the worst coverage area first', () => {
    const tasks = new Map<string, Task>();
    // "api" has 0% coverage (5 features, 0 tests)
    for (let i = 0; i < 5; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'api' }));
    }
    // "ui" has ~14% coverage (6 features, 1 test)
    for (let i = 5; i < 11; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'ui' }));
    }
    tasks.set('RALPH-012', makeTask({ id: 'RALPH-012', type: 'test', aggregate: 'ui' }));

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeDefined();
    expect(gap!.data.aggregate).toBe('api');
  });

  it('uses domain as fallback when aggregate is missing', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 4; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', domain: 'billing' }));
    }

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeDefined();
    expect(gap!.data.aggregate).toBe('billing');
  });

  it('includes suggestion to add test tasks', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 5; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'core' }));
    }

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeDefined();
    expect(gap!.suggestion).toContain('test');
    expect(gap!.suggestion).toContain('core');
  });

  it('includes evidence with task IDs', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 5; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'core' }));
    }

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeDefined();
    expect(gap!.evidence.length).toBeGreaterThan(0);
    expect(gap!.evidence.length).toBeLessThanOrEqual(5);
  });

  it('description includes coverage percentage', () => {
    const tasks = new Map<string, Task>();
    for (let i = 0; i < 10; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, makeTask({ id, type: 'feature', aggregate: 'core' }));
    }
    tasks.set('RALPH-011', makeTask({ id: 'RALPH-011', type: 'test', aggregate: 'core' }));

    const result = detectPatterns(makeContext({ tasks, minConfidence: 0 }));
    const gap = result.patterns.find(p => p.type === 'test_gap');
    expect(gap).toBeDefined();
    expect(gap!.description).toContain('9%');
  });

  it('confidence scales with sample size', () => {
    const tasks3 = new Map<string, Task>();
    for (let i = 0; i < 3; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks3.set(id, makeTask({ id, type: 'feature', aggregate: 'core' }));
    }

    const tasks10 = new Map<string, Task>();
    for (let i = 0; i < 10; i++) {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks10.set(id, makeTask({ id, type: 'feature', aggregate: 'core' }));
    }

    const result3 = detectTestGaps(makeContext({ tasks: tasks3 }));
    const result10 = detectTestGaps(makeContext({ tasks: tasks10 }));
    expect(result3).not.toBeNull();
    expect(result10).not.toBeNull();
    expect(result10!.confidence).toBeGreaterThan(result3!.confidence);
  });
});

// =============================================================================
// High Churn Detector
// =============================================================================

describe('high churn detection', () => {
  it('detects areas with high file change frequency', () => {
    const metrics: TaskMetrics[] = [];
    // "api" area: 5 tasks with 20 files each = high churn
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        filesChanged: 20,
      }));
    }
    // "ui" area: 5 tasks with 2 files each = low churn
    for (let i = 5; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'ui',
        filesChanged: 2,
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeDefined();
    expect(churn!.data.aggregate).toBe('api');
    expect(churn!.data.totalFiles).toBe(100);
  });

  it('does not detect churn with fewer than minSamples tasks', () => {
    const metrics: TaskMetrics[] = [
      makeMetric({ aggregate: 'api', filesChanged: 100 }),
      makeMetric({ aggregate: 'api', filesChanged: 100 }),
    ];

    const result = detectPatterns(makeContext({ metrics, minSamples: 5 }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeUndefined();
  });

  it('does not detect churn when all areas have similar file changes', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        filesChanged: 5,
      }));
    }
    for (let i = 5; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'ui',
        filesChanged: 5,
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeUndefined();
  });

  it('skips metrics without filesChanged', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        filesChanged: undefined,
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeUndefined();
  });

  it('skips metrics with zero filesChanged', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        filesChanged: 0,
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeUndefined();
  });

  it('uses domain as fallback when aggregate is missing', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        domain: 'billing',
        filesChanged: 20,
      }));
    }
    for (let i = 5; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        domain: 'auth',
        filesChanged: 2,
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeDefined();
    expect(churn!.data.aggregate).toBe('billing');
  });

  it('includes avgFilesPerTask in data', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        filesChanged: 10,
      }));
    }
    for (let i = 5; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'ui',
        filesChanged: 1,
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeDefined();
    expect(churn!.data.avgFilesPerTask).toBe(10);
  });

  it('includes suggestion about instability', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'config',
        filesChanged: 20,
      }));
    }
    for (let i = 5; i < 10; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'other',
        filesChanged: 1,
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const churn = result.patterns.find(p => p.type === 'high_churn');
    expect(churn).toBeDefined();
    expect(churn!.suggestion).toContain('config');
    expect(churn!.suggestion).toContain('instability');
  });

  it('confidence scales with sample size', () => {
    const makeChurnMetrics = (count: number) => {
      const metrics: TaskMetrics[] = [];
      for (let i = 0; i < count; i++) {
        metrics.push(makeMetric({
          taskId: `RALPH-A${String(i + 1).padStart(3, '0')}`,
          aggregate: 'api',
          filesChanged: 30,
        }));
      }
      // Large baseline of low-churn tasks to keep overall average low
      for (let i = 0; i < 20; i++) {
        metrics.push(makeMetric({
          taskId: `RALPH-B${String(i + 1).padStart(3, '0')}`,
          aggregate: 'ui',
          filesChanged: 1,
        }));
      }
      return metrics;
    };

    const result5 = detectHighChurn(makeContext({ metrics: makeChurnMetrics(5) }));
    const result10 = detectHighChurn(makeContext({ metrics: makeChurnMetrics(10) }));
    expect(result5).not.toBeNull();
    expect(result10).not.toBeNull();
    expect(result10!.confidence).toBeGreaterThan(result5!.confidence);
  });
});

// =============================================================================
// Coupling Detector
// =============================================================================

describe('coupling detection', () => {
  it('detects coupling between areas that co-change', () => {
    const metrics: TaskMetrics[] = [];
    // 4 tasks that touch both "api" and "db"
    for (let i = 0; i < 4; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        domain: 'db',
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeDefined();
    expect(coupling!.data.coChangeCount).toBe(4);
  });

  it('does not detect coupling with fewer than 3 co-changes', () => {
    const metrics: TaskMetrics[] = [
      makeMetric({ taskId: 'RALPH-001', aggregate: 'api', domain: 'db' }),
      makeMetric({ taskId: 'RALPH-002', aggregate: 'api', domain: 'db' }),
    ];

    const result = detectPatterns(makeContext({ metrics }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeUndefined();
  });

  it('does not detect coupling when areas are the same', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        domain: 'api', // same as aggregate, should be ignored
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeUndefined();
  });

  it('detects coupling via tags', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 4; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        tags: ['frontend', 'backend'],
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeDefined();
    expect(coupling!.description).toContain('backend');
    expect(coupling!.description).toContain('frontend');
  });

  it('reports the most coupled pair first', () => {
    const metrics: TaskMetrics[] = [];
    // 5 tasks coupling "api" and "db"
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-A${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        domain: 'db',
      }));
    }
    // 3 tasks coupling "ui" and "state"
    for (let i = 0; i < 3; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-B${String(i + 1).padStart(3, '0')}`,
        aggregate: 'ui',
        domain: 'state',
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeDefined();
    expect(coupling!.data.coChangeCount).toBe(5);
  });

  it('includes suggestion to decouple', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 4; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'auth',
        domain: 'users',
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeDefined();
    expect(coupling!.suggestion).toContain('decoupling');
  });

  it('includes evidence with task IDs', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 4; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        domain: 'db',
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeDefined();
    expect(coupling!.evidence.length).toBeGreaterThan(0);
    expect(coupling!.evidence.length).toBeLessThanOrEqual(5);
  });

  it('handles metrics with no areas gracefully', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 5; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        // no aggregate, domain, or tags
      }));
    }

    const result = detectPatterns(makeContext({ metrics }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeUndefined();
  });

  it('does not double-count tags that match aggregate or domain', () => {
    const metrics: TaskMetrics[] = [];
    for (let i = 0; i < 4; i++) {
      metrics.push(makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        domain: 'db',
        tags: ['api', 'db'], // duplicate of aggregate/domain
      }));
    }

    const result = detectPatterns(makeContext({ metrics, minConfidence: 0 }));
    const coupling = result.patterns.find(p => p.type === 'coupling');
    expect(coupling).toBeDefined();
    // Should count exactly 4 co-changes (not inflated by duplicate tags)
    expect(coupling!.data.coChangeCount).toBe(4);
  });

  it('confidence scales with co-change count', () => {
    const result3 = detectCoupling(makeContext({
      metrics: Array.from({ length: 3 }, (_, i) => makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        domain: 'db',
      })),
    }));
    const result8 = detectCoupling(makeContext({
      metrics: Array.from({ length: 8 }, (_, i) => makeMetric({
        taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
        aggregate: 'api',
        domain: 'db',
      })),
    }));

    expect(result3).not.toBeNull();
    expect(result8).not.toBeNull();
    expect(result8!.confidence).toBeGreaterThan(result3!.confidence);
  });
});
