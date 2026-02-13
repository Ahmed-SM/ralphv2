import { describe, it, expect } from 'vitest';
import {
  recordTaskMetrics,
  computeAggregateMetrics,
  appendMetricEvent,
  loadMetricEvents,
  loadTaskMetrics,
  getCurrentPeriod,
  type TaskMetrics,
  type MetricEvent,
} from './record-metrics.js';
import type { Task } from '../../types/index.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'done',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
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

// =============================================================================
// recordTaskMetrics
// =============================================================================

describe('recordTaskMetrics', () => {
  it('records basic task identity fields', () => {
    const task = makeTask({ type: 'bug', complexity: 'moderate', aggregate: 'parser', domain: 'core' });
    const metrics = recordTaskMetrics(task);
    expect(metrics.taskId).toBe('RALPH-001');
    expect(metrics.type).toBe('bug');
    expect(metrics.complexity).toBe('moderate');
    expect(metrics.aggregate).toBe('parser');
    expect(metrics.domain).toBe('core');
  });

  it('calculates duration from createdAt and completedAt', () => {
    const task = makeTask({
      createdAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-03T00:00:00Z',
    });
    const metrics = recordTaskMetrics(task);
    expect(metrics.durationMs).toBe(2 * 24 * 60 * 60 * 1000);
    expect(metrics.durationDays).toBeCloseTo(2, 5);
  });

  it('does not calculate duration when completedAt is missing', () => {
    const task = makeTask({ completedAt: undefined });
    const metrics = recordTaskMetrics(task);
    expect(metrics.durationMs).toBeUndefined();
    expect(metrics.durationDays).toBeUndefined();
  });

  it('records estimate and actual from task', () => {
    const task = makeTask({ estimate: 3, actual: 5 });
    const metrics = recordTaskMetrics(task);
    expect(metrics.estimate).toBe(3);
    expect(metrics.actual).toBe(5);
    expect(metrics.estimateRatio).toBeCloseTo(5 / 3);
  });

  it('uses execution iterations as actual when task.actual is undefined', () => {
    const task = makeTask({ estimate: 3, actual: undefined });
    const metrics = recordTaskMetrics(task, { iterations: 4 });
    expect(metrics.actual).toBe(4);
    expect(metrics.estimateRatio).toBeCloseTo(4 / 3);
  });

  it('records execution data', () => {
    const task = makeTask();
    const metrics = recordTaskMetrics(task, {
      iterations: 5,
      commits: 3,
      filesChanged: 10,
      linesChanged: 200,
      blockers: ['RALPH-002'],
    });
    expect(metrics.iterations).toBe(5);
    expect(metrics.commits).toBe(3);
    expect(metrics.filesChanged).toBe(10);
    expect(metrics.linesChanged).toBe(200);
    expect(metrics.blockers).toBe(1);
  });

  it('handles task with no execution data', () => {
    const task = makeTask();
    const metrics = recordTaskMetrics(task);
    expect(metrics.iterations).toBeUndefined();
    expect(metrics.commits).toBeUndefined();
    expect(metrics.filesChanged).toBeUndefined();
    expect(metrics.blockers).toBeUndefined();
  });

  it('records tags from task', () => {
    const task = makeTask({ tags: ['urgent', 'security'] });
    const metrics = recordTaskMetrics(task);
    expect(metrics.tags).toEqual(['urgent', 'security']);
  });
});

// =============================================================================
// computeAggregateMetrics
// =============================================================================

describe('computeAggregateMetrics', () => {
  it('handles empty metrics array', () => {
    const agg = computeAggregateMetrics([], '2024-01');
    expect(agg.period).toBe('2024-01');
    expect(agg.tasksCompleted).toBe(0);
    expect(agg.tasksCreated).toBe(0);
    expect(agg.avgDurationDays).toBe(0);
  });

  it('counts completed vs created tasks', () => {
    const metrics = [
      makeMetric({ completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ completedAt: '2024-01-15T00:00:00Z' }),
      makeMetric({ completedAt: undefined }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.tasksCreated).toBe(3);
    expect(agg.tasksCompleted).toBe(2);
  });

  it('computes duration statistics', () => {
    const metrics = [
      makeMetric({ durationDays: 2, completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ durationDays: 4, completedAt: '2024-01-15T00:00:00Z' }),
      makeMetric({ durationDays: 6, completedAt: '2024-01-20T00:00:00Z' }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.avgDurationDays).toBeCloseTo(4);
    expect(agg.medianDurationDays).toBeCloseTo(4);
    expect(agg.totalDurationDays).toBeCloseTo(12);
  });

  it('computes median correctly for even number of values', () => {
    const metrics = [
      makeMetric({ durationDays: 1, completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ durationDays: 3, completedAt: '2024-01-15T00:00:00Z' }),
      makeMetric({ durationDays: 5, completedAt: '2024-01-20T00:00:00Z' }),
      makeMetric({ durationDays: 7, completedAt: '2024-01-25T00:00:00Z' }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.medianDurationDays).toBeCloseTo(4); // (3 + 5) / 2
  });

  it('computes iteration averages', () => {
    const metrics = [
      makeMetric({ iterations: 3, completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ iterations: 7, completedAt: '2024-01-15T00:00:00Z' }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.avgIterations).toBeCloseTo(5);
  });

  it('sums commits and files changed', () => {
    const metrics = [
      makeMetric({ commits: 5, filesChanged: 10, completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ commits: 3, filesChanged: 8, completedAt: '2024-01-15T00:00:00Z' }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.totalCommits).toBe(8);
    expect(agg.totalFilesChanged).toBe(18);
  });

  it('computes estimate accuracy', () => {
    const metrics = [
      makeMetric({ estimateRatio: 1.0, completedAt: '2024-01-10T00:00:00Z' }), // within 20%
      makeMetric({ estimateRatio: 1.1, completedAt: '2024-01-15T00:00:00Z' }), // within 20%
      makeMetric({ estimateRatio: 2.0, completedAt: '2024-01-20T00:00:00Z' }), // outside 20%
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.estimateAccuracy).toBeCloseTo(66.67, 0);
    expect(agg.avgEstimateRatio).toBeCloseTo((1.0 + 1.1 + 2.0) / 3);
  });

  it('breaks down by type', () => {
    const metrics = [
      makeMetric({ type: 'feature', completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ type: 'feature', completedAt: '2024-01-15T00:00:00Z' }),
      makeMetric({ type: 'bug', completedAt: '2024-01-20T00:00:00Z' }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.byType['feature']).toBe(2);
    expect(agg.byType['bug']).toBe(1);
  });

  it('breaks down by aggregate and complexity', () => {
    const metrics = [
      makeMetric({ aggregate: 'auth', complexity: 'simple', completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ aggregate: 'auth', complexity: 'complex', completedAt: '2024-01-15T00:00:00Z' }),
      makeMetric({ aggregate: 'api', complexity: 'simple', completedAt: '2024-01-20T00:00:00Z' }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.byAggregate['auth']).toBe(2);
    expect(agg.byAggregate['api']).toBe(1);
    expect(agg.byComplexity['simple']).toBe(2);
    expect(agg.byComplexity['complex']).toBe(1);
  });

  it('counts bug tasks in quality metrics', () => {
    const metrics = [
      makeMetric({ type: 'bug', blockers: 2, completedAt: '2024-01-10T00:00:00Z' }),
      makeMetric({ type: 'bug', blockers: 1, completedAt: '2024-01-15T00:00:00Z' }),
      makeMetric({ type: 'feature', blockers: 0, completedAt: '2024-01-20T00:00:00Z' }),
    ];
    const agg = computeAggregateMetrics(metrics, '2024-01');
    expect(agg.totalBugs).toBe(2);
    expect(agg.totalBlockers).toBe(3);
  });
});

// =============================================================================
// Persistence (appendMetricEvent, loadMetricEvents, loadTaskMetrics)
// =============================================================================

describe('appendMetricEvent', () => {
  it('appends event as JSONL to empty file', async () => {
    let written = '';
    const event: MetricEvent = {
      type: 'task_metric',
      timestamp: '2024-01-01T00:00:00Z',
      data: makeMetric(),
    };

    await appendMetricEvent(
      async () => { throw new Error('ENOENT'); },
      async (_path, content) => { written = content; },
      'learning.jsonl',
      event
    );

    expect(written).toBe(JSON.stringify(event) + '\n');
  });

  it('appends to existing content', async () => {
    const existing = '{"type":"task_metric","timestamp":"2024-01-01T00:00:00Z","data":{}}\n';
    let written = '';
    const event: MetricEvent = {
      type: 'milestone',
      timestamp: '2024-01-02T00:00:00Z',
      data: { milestone: 'test', tasksCompleted: 5, duration: 100, timestamp: '2024-01-02T00:00:00Z' },
    };

    await appendMetricEvent(
      async () => existing,
      async (_path, content) => { written = content; },
      'learning.jsonl',
      event
    );

    expect(written).toContain(existing);
    expect(written.endsWith(JSON.stringify(event) + '\n')).toBe(true);
  });
});

describe('loadMetricEvents', () => {
  it('loads events from JSONL content', async () => {
    const events: MetricEvent[] = [
      { type: 'task_metric', timestamp: '2024-01-01T00:00:00Z', data: makeMetric() },
      { type: 'milestone', timestamp: '2024-01-02T00:00:00Z', data: { milestone: 'test', tasksCompleted: 5, duration: 100, timestamp: '2024-01-02T00:00:00Z' } },
    ];
    const content = events.map(e => JSON.stringify(e)).join('\n');

    const loaded = await loadMetricEvents(async () => content, 'learning.jsonl');
    expect(loaded).toHaveLength(2);
    expect(loaded[0].type).toBe('task_metric');
    expect(loaded[1].type).toBe('milestone');
  });

  it('returns empty array for empty file', async () => {
    const loaded = await loadMetricEvents(async () => '', 'learning.jsonl');
    expect(loaded).toHaveLength(0);
  });

  it('returns empty array when file does not exist', async () => {
    const loaded = await loadMetricEvents(
      async () => { throw new Error('ENOENT'); },
      'learning.jsonl'
    );
    expect(loaded).toHaveLength(0);
  });

  it('skips blank lines in JSONL', async () => {
    const content = '{"type":"task_metric","timestamp":"2024-01-01T00:00:00Z","data":{}}\n\n\n{"type":"milestone","timestamp":"2024-01-02T00:00:00Z","data":{}}\n';
    const loaded = await loadMetricEvents(async () => content, 'learning.jsonl');
    // milestone has no valid data fields, but the event type is valid
    expect(loaded.length).toBeGreaterThanOrEqual(1);
  });

  it('filters out invalid event types', async () => {
    const content = '{"type":"invalid_type","timestamp":"2024-01-01T00:00:00Z","data":{}}\n';
    const loaded = await loadMetricEvents(async () => content, 'learning.jsonl');
    expect(loaded).toHaveLength(0);
  });
});

describe('loadTaskMetrics', () => {
  it('loads only task_metric events', async () => {
    const events = [
      { type: 'task_metric', timestamp: '2024-01-01T00:00:00Z', data: { taskId: 'RALPH-001', type: 'task' } },
      { type: 'milestone', timestamp: '2024-01-02T00:00:00Z', data: { milestone: 'done' } },
      { type: 'task_metric', timestamp: '2024-01-03T00:00:00Z', data: { taskId: 'RALPH-002', type: 'bug' } },
    ];
    const content = events.map(e => JSON.stringify(e)).join('\n');

    const metrics = await loadTaskMetrics(async () => content, 'learning.jsonl');
    expect(metrics).toHaveLength(2);
    expect(metrics[0].taskId).toBe('RALPH-001');
    expect(metrics[1].taskId).toBe('RALPH-002');
  });

  it('returns empty array when no task_metric events', async () => {
    const content = '{"type":"milestone","timestamp":"2024-01-01T00:00:00Z","data":{}}\n';
    const metrics = await loadTaskMetrics(async () => content, 'learning.jsonl');
    expect(metrics).toHaveLength(0);
  });
});

// =============================================================================
// getCurrentPeriod
// =============================================================================

describe('getCurrentPeriod', () => {
  it('returns month format by default', () => {
    const period = getCurrentPeriod();
    expect(period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns day format when specified', () => {
    const period = getCurrentPeriod('day');
    expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns week format when specified', () => {
    const period = getCurrentPeriod('week');
    expect(period).toMatch(/^\d{4}-W\d{2}$/);
  });
});
