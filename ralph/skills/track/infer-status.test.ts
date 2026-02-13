import { describe, it, expect } from 'vitest';
import {
  inferStatus,
  inferStatusFromPR,
  inferStatusFromBranch,
  inferStatuses,
  generateInferenceOperations,
  detectAnomalies,
} from './infer-status.js';
import type { Task } from '../../types/index.js';
import type { TaskGitSummary } from './link-commits.js';
import type { CommitAction } from './parse-commits.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'discovered',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<TaskGitSummary> = {}): TaskGitSummary {
  return {
    taskId: 'RALPH-001',
    commits: 0,
    authors: [],
    filesChanged: new Set(),
    actions: [],
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('inferStatus', () => {
  it('infers in_progress from first commit on discovered task', () => {
    const task = makeTask({ status: 'discovered' });
    const summary = makeSummary({ commits: 1 });

    const result = inferStatus(task, summary);
    expect(result.inferredStatus).toBe('in_progress');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('infers in_progress from first commit on pending task', () => {
    const task = makeTask({ status: 'pending' });
    const summary = makeSummary({ commits: 1 });

    const result = inferStatus(task, summary);
    expect(result.inferredStatus).toBe('in_progress');
  });

  it('infers done from complete action in commit', () => {
    const task = makeTask({ status: 'in_progress' });
    const summary = makeSummary({
      commits: 3,
      actions: ['implement', 'complete'] as CommitAction[],
    });

    const result = inferStatus(task, summary);
    expect(result.inferredStatus).toBe('done');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('infers in_progress from high activity', () => {
    const task = makeTask({ status: 'discovered' });
    const summary = makeSummary({ commits: 5 });

    const result = inferStatus(task, summary);
    expect(result.inferredStatus).toBe('in_progress');
  });

  it('does not change done task', () => {
    const task = makeTask({ status: 'done' });
    const summary = makeSummary({ commits: 0 });

    const result = inferStatus(task, summary);
    expect(result.inferredStatus).toBe('done');
  });

  it('uses custom high activity threshold', () => {
    const task = makeTask({ status: 'discovered' });
    const summary = makeSummary({ commits: 3 });

    const result = inferStatus(task, summary, { highActivityThreshold: 3 });
    expect(result.inferredStatus).toBe('in_progress');
  });

  it('infers in_progress from recent commit', () => {
    const task = makeTask({ status: 'discovered' });
    const recentDate = new Date(Date.now() - 1000 * 60 * 30).toISOString(); // 30 mins ago
    const summary = makeSummary({ commits: 1, lastCommit: recentDate });

    const result = inferStatus(task, summary);
    expect(result.inferredStatus).toBe('in_progress');
  });

  it('returns no change for task with no commits', () => {
    const task = makeTask({ status: 'discovered' });
    const summary = makeSummary({ commits: 0 });

    const result = inferStatus(task, summary);
    expect(result.inferredStatus).toBe('discovered');
    expect(result.confidence).toBe(0);
  });
});

describe('inferStatusFromPR', () => {
  it('infers in_progress from open PR on discovered task', () => {
    const task = makeTask({ status: 'discovered' });
    const pr = { number: 1, title: 'Feature', state: 'open' as const, branch: 'ralph/001' };

    const result = inferStatusFromPR(task, pr);
    expect(result.inferredStatus).toBe('in_progress');
  });

  it('infers review from open PR on in_progress task', () => {
    const task = makeTask({ status: 'in_progress' });
    const pr = { number: 1, title: 'Feature', state: 'open' as const, branch: 'ralph/001' };

    const result = inferStatusFromPR(task, pr);
    expect(result.inferredStatus).toBe('review');
  });

  it('infers done from merged PR', () => {
    const task = makeTask({ status: 'in_progress' });
    const pr = {
      number: 1,
      title: 'Feature',
      state: 'merged' as const,
      branch: 'ralph/001',
      mergedAt: '2025-01-15',
    };

    const result = inferStatusFromPR(task, pr);
    expect(result.inferredStatus).toBe('done');
    expect(result.confidence).toBe(0.95);
  });

  it('has low confidence for closed PR without merge', () => {
    const task = makeTask({ status: 'in_progress' });
    const pr = { number: 1, title: 'Feature', state: 'closed' as const, branch: 'ralph/001' };

    const result = inferStatusFromPR(task, pr);
    expect(result.confidence).toBeLessThan(0.5);
  });
});

describe('inferStatusFromBranch', () => {
  it('infers done from merged branch', () => {
    const task = makeTask({ status: 'in_progress' });
    const branch = { name: 'ralph/001', remote: false };

    const result = inferStatusFromBranch(task, branch, true);
    expect(result.inferredStatus).toBe('done');
    expect(result.confidence).toBe(0.9);
  });

  it('infers in_progress from existing branch', () => {
    const task = makeTask({ status: 'discovered' });
    const branch = { name: 'ralph/001', remote: false };

    const result = inferStatusFromBranch(task, branch, false);
    expect(result.inferredStatus).toBe('in_progress');
    expect(result.confidence).toBe(0.7);
  });
});

describe('inferStatuses', () => {
  it('filters by minimum confidence', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'discovered' }));

    const summaries = [makeSummary({ taskId: 'RALPH-001', commits: 1 })];

    const results = inferStatuses(tasks, summaries, { minConfidence: 0.95 });
    // confidence for first commit is 0.9, so should be filtered out at 0.95 threshold
    expect(results).toHaveLength(0);
  });

  it('returns inferences above confidence threshold', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'discovered' }));

    const summaries = [makeSummary({ taskId: 'RALPH-001', commits: 1 })];

    const results = inferStatuses(tasks, summaries, { minConfidence: 0.7 });
    expect(results).toHaveLength(1);
    expect(results[0].inferredStatus).toBe('in_progress');
  });

  it('skips tasks not in map', () => {
    const tasks = new Map<string, Task>();
    const summaries = [makeSummary({ taskId: 'RALPH-999', commits: 5 })];

    const results = inferStatuses(tasks, summaries);
    expect(results).toHaveLength(0);
  });
});

describe('generateInferenceOperations', () => {
  it('generates update ops for status changes', () => {
    const inferences = [{
      taskId: 'RALPH-001',
      currentStatus: 'discovered' as const,
      inferredStatus: 'in_progress' as const,
      confidence: 0.9,
      reason: 'Work detected',
      evidence: ['1 commit found'],
    }];

    const ops = generateInferenceOperations(inferences);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('update');
  });

  it('filters by min confidence', () => {
    const inferences = [{
      taskId: 'RALPH-001',
      currentStatus: 'discovered' as const,
      inferredStatus: 'in_progress' as const,
      confidence: 0.5,
      reason: 'Weak signal',
      evidence: [],
    }];

    const ops = generateInferenceOperations(inferences, 0.7);
    expect(ops).toHaveLength(0);
  });

  it('skips when status unchanged', () => {
    const inferences = [{
      taskId: 'RALPH-001',
      currentStatus: 'in_progress' as const,
      inferredStatus: 'in_progress' as const,
      confidence: 0.9,
      reason: 'No change',
      evidence: [],
    }];

    const ops = generateInferenceOperations(inferences);
    expect(ops).toHaveLength(0);
  });
});

describe('detectAnomalies', () => {
  it('detects stale tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'in_progress' }));

    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago
    const summaries = [makeSummary({
      taskId: 'RALPH-001',
      commits: 2,
      lastCommit: oldDate,
    })];

    const anomalies = detectAnomalies(tasks, summaries, { staleDays: 14 });
    expect(anomalies.some(a => a.type === 'stale')).toBe(true);
  });

  it('detects long running tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'in_progress' }));

    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
    const summaries = [makeSummary({
      taskId: 'RALPH-001',
      commits: 10,
      firstCommit: oldDate,
      lastCommit: new Date().toISOString(),
    })];

    const anomalies = detectAnomalies(tasks, summaries, { longRunningDays: 30 });
    expect(anomalies.some(a => a.type === 'long_running')).toBe(true);
  });

  it('detects no-activity tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'in_progress' }));

    const anomalies = detectAnomalies(tasks, []);
    expect(anomalies.some(a => a.type === 'no_activity')).toBe(true);
  });

  it('skips completed and cancelled tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'done' }));
    tasks.set('RALPH-002', makeTask({ id: 'RALPH-002', status: 'cancelled' }));

    const anomalies = detectAnomalies(tasks, []);
    expect(anomalies).toHaveLength(0);
  });

  it('assigns higher severity for very stale tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'in_progress' }));

    const veryOldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days
    const summaries = [makeSummary({
      taskId: 'RALPH-001',
      commits: 1,
      lastCommit: veryOldDate,
    })];

    const anomalies = detectAnomalies(tasks, summaries, { staleDays: 14 });
    const stale = anomalies.find(a => a.type === 'stale');
    expect(stale?.severity).toBe('high');
  });
});
