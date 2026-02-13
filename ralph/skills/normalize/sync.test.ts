import { describe, it, expect, vi } from 'vitest';
import { syncToTracker, syncFromTracker, syncBidirectional, printSyncSummary } from './sync.js';
import type { SyncContext } from './sync.js';
import type { Tracker, TrackerConfig, ExternalIssue, SyncResult } from './tracker-interface.js';
import type { Task, TaskType, TaskStatus, TaskOperation } from '../../types/index.js';

// =============================================================================
// FIXTURES
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'pending',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    type: 'jira',
    project: 'RALPH',
    issueTypeMap: {
      epic: 'Epic',
      feature: 'Story',
      task: 'Task',
      subtask: 'Sub-task',
      bug: 'Bug',
      refactor: 'Task',
      docs: 'Task',
      test: 'Task',
      spike: 'Spike',
    } as Record<TaskType, string>,
    statusMap: {
      discovered: 'Backlog',
      pending: 'To Do',
      in_progress: 'In Progress',
      blocked: 'Blocked',
      review: 'In Review',
      done: 'Done',
      cancelled: 'Cancelled',
    } as Record<TaskStatus, string>,
    autoCreate: true,
    autoTransition: true,
    autoComment: false,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<ExternalIssue> = {}): ExternalIssue {
  return {
    id: '10001',
    key: 'RALPH-1',
    url: 'https://jira.example.com/browse/RALPH-1',
    title: 'Test task',
    description: '',
    status: 'To Do',
    type: 'Task',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTracker(overrides: Partial<Tracker> = {}): Tracker {
  return {
    name: 'mock-jira',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    createIssue: vi.fn().mockResolvedValue(makeIssue()),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue(makeIssue()),
    findIssues: vi.fn().mockResolvedValue([]),
    createSubtask: vi.fn().mockResolvedValue(makeIssue()),
    linkIssues: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    getTransitions: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Build a JSONL string from task operations */
function buildTasksJsonl(ops: TaskOperation[]): string {
  return ops.map(op => JSON.stringify(op)).join('\n') + '\n';
}

function makeContext(overrides: Partial<SyncContext> = {}): SyncContext {
  const store: Record<string, string> = {};
  return {
    tracker: makeTracker(),
    config: makeConfig(),
    readFile: vi.fn().mockImplementation(async (path: string) => store[path] || ''),
    writeFile: vi.fn().mockImplementation(async (path: string, content: string) => {
      store[path] = content;
    }),
    tasksPath: './state/tasks.jsonl',
    ...overrides,
  };
}

// =============================================================================
// TESTS: syncToTracker
// =============================================================================

describe('syncToTracker', () => {
  it('creates issues for tasks without external IDs', async () => {
    const task = makeTask({ id: 'RALPH-001' });
    const createOp: TaskOperation = { op: 'create', task, timestamp: '2025-01-01T00:00:00Z' };
    const jsonl = buildTasksJsonl([createOp]);

    const tracker = makeTracker();
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncToTracker(ctx);

    expect(result.processed).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(tracker.createIssue).toHaveBeenCalledWith(task);
  });

  it('skips tasks already linked (no force)', async () => {
    const task = makeTask({ id: 'RALPH-001', externalId: 'JIRA-1' });
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'link', id: 'RALPH-001', externalId: 'JIRA-1', externalUrl: 'http://j/1', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker();
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncToTracker(ctx);

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it('updates linked tasks when force is true', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'link', id: 'RALPH-001', externalId: 'JIRA-1', externalUrl: 'http://j/1', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker();
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncToTracker(ctx, { force: true });

    expect(result.updated).toBe(1);
    expect(tracker.updateIssue).toHaveBeenCalled();
  });

  it('filters by task IDs', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'create', task: makeTask({ id: 'RALPH-002' }), timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker();
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncToTracker(ctx, { taskIds: ['RALPH-002'] });

    expect(result.processed).toBe(1);
    expect(result.created).toBe(1);
  });

  it('filters by statuses', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001', status: 'pending' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'create', task: makeTask({ id: 'RALPH-002', status: 'done' }), timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker();
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncToTracker(ctx, { statuses: ['pending'] });

    expect(result.processed).toBe(1);
  });

  it('records errors for failed creates', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker({
      createIssue: vi.fn().mockRejectedValue(new Error('Permission denied')),
    });
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncToTracker(ctx);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe('RALPH-001');
    expect(result.errors[0].error).toBe('Permission denied');
    expect(result.errors[0].operation).toBe('create');
  });

  it('handles empty tasks file', async () => {
    const ctx = makeContext({
      readFile: vi.fn().mockResolvedValue(''),
    });

    const result = await syncToTracker(ctx);

    expect(result.processed).toBe(0);
    expect(result.created).toBe(0);
  });

  it('records duration', async () => {
    const ctx = makeContext({
      readFile: vi.fn().mockResolvedValue(''),
    });

    const result = await syncToTracker(ctx);

    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// TESTS: syncFromTracker
// =============================================================================

describe('syncFromTracker', () => {
  it('updates local status when tracker status differs', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'link', id: 'RALPH-001', externalId: 'JIRA-1', externalUrl: 'http://j/1', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'Done' })),
    });

    const store: Record<string, string> = { './state/tasks.jsonl': jsonl };
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockImplementation(async (path: string) => store[path] || ''),
      writeFile: vi.fn().mockImplementation(async (path: string, content: string) => {
        store[path] = content;
      }),
    });

    const result = await syncFromTracker(ctx);

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips when statuses match', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001', status: 'pending' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'link', id: 'RALPH-001', externalId: 'JIRA-1', externalUrl: 'http://j/1', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'To Do' })),
    });
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncFromTracker(ctx);

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('only processes linked tasks', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'create', task: makeTask({ id: 'RALPH-002' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'link', id: 'RALPH-002', externalId: 'JIRA-2', externalUrl: 'http://j/2', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'Done' })),
    });
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncFromTracker(ctx);

    // Only RALPH-002 is linked
    expect(result.processed).toBe(1);
  });

  it('records errors for failed gets', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
      { op: 'link', id: 'RALPH-001', externalId: 'JIRA-1', externalUrl: 'http://j/1', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker({
      getIssue: vi.fn().mockRejectedValue(new Error('Not found')),
    });
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncFromTracker(ctx);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('Not found');
  });
});

// =============================================================================
// TESTS: syncBidirectional
// =============================================================================

describe('syncBidirectional', () => {
  it('pulls first then pushes', async () => {
    const ops: TaskOperation[] = [
      { op: 'create', task: makeTask({ id: 'RALPH-001' }), timestamp: '2025-01-01T00:00:00Z' },
    ];
    const jsonl = buildTasksJsonl(ops);

    const tracker = makeTracker();
    const ctx = makeContext({
      tracker,
      readFile: vi.fn().mockResolvedValue(jsonl),
    });

    const result = await syncBidirectional(ctx);

    expect(result.pull).toBeDefined();
    expect(result.push).toBeDefined();
    expect(result.pull.processed).toBeGreaterThanOrEqual(0);
    expect(result.push.processed).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// TESTS: printSyncSummary
// =============================================================================

describe('printSyncSummary', () => {
  it('prints summary without errors', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result: SyncResult = {
      processed: 5,
      created: 3,
      updated: 1,
      skipped: 1,
      errors: [],
      duration: 1234,
    };

    printSyncSummary(result, 'push');

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('PUSH');
    expect(output).toContain('Processed: 5');
    expect(output).toContain('Created:   3');
    expect(output).not.toContain('- RALPH');

    consoleSpy.mockRestore();
  });

  it('prints errors when present', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result: SyncResult = {
      processed: 1,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ taskId: 'RALPH-001', operation: 'create', error: 'API fail' }],
      duration: 100,
    };

    printSyncSummary(result, 'pull');

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('PULL');
    expect(output).toContain('RALPH-001');
    expect(output).toContain('API fail');

    consoleSpy.mockRestore();
  });
});
