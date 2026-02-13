import { describe, it, expect, vi } from 'vitest';
import {
  updateIssueStatus,
  syncStatus,
  syncStatuses,
  generateStatusOperations,
} from './update-status.js';
import type { Tracker, TrackerConfig, ExternalIssue, Transition } from './tracker-interface.js';
import type { Task, TaskType, TaskStatus } from '../../types/index.js';
import type { StatusSyncResult } from './update-status.js';

// =============================================================================
// FIXTURES
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'in_progress',
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

function makeTransitions(): Transition[] {
  return [
    { id: '1', name: 'Start Progress', to: 'In Progress' },
    { id: '2', name: 'Done', to: 'Done' },
    { id: '3', name: 'In Review', to: 'In Review' },
  ];
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
    getTransitions: vi.fn().mockResolvedValue(makeTransitions()),
    addComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// =============================================================================
// TESTS: updateIssueStatus
// =============================================================================

describe('updateIssueStatus', () => {
  it('fails when task has no external ID', async () => {
    const tracker = makeTracker();
    const task = makeTask({ externalId: undefined });
    const config = makeConfig();

    const result = await updateIssueStatus(tracker, task, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not linked');
  });

  it('fails when status has no mapping', async () => {
    const tracker = makeTracker();
    const task = makeTask({ externalId: 'JIRA-1', status: 'in_progress' });
    const config = makeConfig({ statusMap: {} as Record<TaskStatus, string> });

    const result = await updateIssueStatus(tracker, task, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No status mapping');
  });

  it('succeeds when issue already at target status', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'In Progress' })),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'in_progress' });
    const config = makeConfig();

    const result = await updateIssueStatus(tracker, task, config);

    expect(result.success).toBe(true);
    expect(result.fromStatus).toBe('In Progress');
    expect(result.toStatus).toBe('In Progress');
    expect(tracker.transitionIssue).not.toHaveBeenCalled();
  });

  it('transitions issue to new status', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'To Do' })),
      getTransitions: vi.fn().mockResolvedValue(makeTransitions()),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'in_progress' });
    const config = makeConfig();

    const result = await updateIssueStatus(tracker, task, config);

    expect(result.success).toBe(true);
    expect(result.fromStatus).toBe('To Do');
    expect(result.toStatus).toBe('In Progress');
    expect(result.transition).toBeDefined();
    expect(tracker.transitionIssue).toHaveBeenCalledWith('JIRA-1', 'Start Progress');
  });

  it('fails when no valid transition exists', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'To Do' })),
      getTransitions: vi.fn().mockResolvedValue([
        { id: '1', name: 'Cancel', to: 'Cancelled' },
      ]),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'done' });
    const config = makeConfig();

    const result = await updateIssueStatus(tracker, task, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No transition available');
    expect(result.error).toContain('Cancelled');
  });

  it('handles API errors gracefully', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });
    const task = makeTask({ externalId: 'JIRA-1' });
    const config = makeConfig();

    const result = await updateIssueStatus(tracker, task, config);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
  });

  it('matches transitions by name case-insensitively', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'To Do' })),
      getTransitions: vi.fn().mockResolvedValue([
        { id: '1', name: 'done', to: 'done' },
      ]),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'done' });
    const config = makeConfig();

    const result = await updateIssueStatus(tracker, task, config);

    expect(result.success).toBe(true);
  });
});

// =============================================================================
// TESTS: syncStatus
// =============================================================================

describe('syncStatus', () => {
  it('returns none action when task not linked', async () => {
    const tracker = makeTracker();
    const task = makeTask({ externalId: undefined });
    const config = makeConfig();

    const result = await syncStatus(tracker, task, config);

    expect(result.action).toBe('none');
    expect(result.error).toContain('not linked');
  });

  it('returns none when statuses already match', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'In Progress' })),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'in_progress' });
    const config = makeConfig();

    const result = await syncStatus(tracker, task, config);

    expect(result.action).toBe('none');
  });

  it('auto mode: pulls status from tracker (tracker wins)', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'Done' })),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'in_progress' });
    const config = makeConfig();

    const result = await syncStatus(tracker, task, config, 'auto');

    expect(result.action).toBe('pull');
    expect(result.resolved).toBe('done');
  });

  it('push mode: pushes local status to tracker', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'To Do' })),
      getTransitions: vi.fn().mockResolvedValue(makeTransitions()),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'in_progress' });
    const config = makeConfig();

    const result = await syncStatus(tracker, task, config, 'push');

    expect(result.action).toBe('push');
    expect(result.resolved).toBe('in_progress');
  });

  it('pull mode: pulls tracker status to local', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'Done' })),
    });
    const task = makeTask({ externalId: 'JIRA-1', status: 'pending' });
    const config = makeConfig();

    const result = await syncStatus(tracker, task, config, 'pull');

    expect(result.action).toBe('pull');
    expect(result.resolved).toBe('done');
  });

  it('handles API error', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockRejectedValue(new Error('404 Not Found')),
    });
    const task = makeTask({ externalId: 'JIRA-1' });
    const config = makeConfig();

    const result = await syncStatus(tracker, task, config);

    expect(result.action).toBe('none');
    expect(result.error).toBe('404 Not Found');
  });
});

// =============================================================================
// TESTS: syncStatuses
// =============================================================================

describe('syncStatuses', () => {
  it('syncs statuses for linked tasks only', async () => {
    const tracker = makeTracker({
      getIssue: vi.fn().mockResolvedValue(makeIssue({ status: 'In Progress' })),
    });
    const tasks = [
      makeTask({ id: 'RALPH-001', externalId: 'JIRA-1', status: 'in_progress' }),
      makeTask({ id: 'RALPH-002', externalId: undefined, status: 'pending' }),
      makeTask({ id: 'RALPH-003', externalId: 'JIRA-3', status: 'in_progress' }),
    ];
    const config = makeConfig();

    const results = await syncStatuses(tracker, tasks, config);

    expect(results).toHaveLength(2);
    expect(results.map(r => r.taskId)).toEqual(['RALPH-001', 'RALPH-003']);
  });

  it('returns empty array for tasks with no external IDs', async () => {
    const tracker = makeTracker();
    const tasks = [makeTask({ externalId: undefined })];
    const config = makeConfig();

    const results = await syncStatuses(tracker, tasks, config);

    expect(results).toHaveLength(0);
  });
});

// =============================================================================
// TESTS: generateStatusOperations
// =============================================================================

describe('generateStatusOperations', () => {
  it('generates update operations for pull actions', () => {
    const results: StatusSyncResult[] = [
      {
        taskId: 'RALPH-001',
        externalId: 'JIRA-1',
        localStatus: 'pending',
        remoteStatus: 'Done',
        action: 'pull',
        resolved: 'done',
      },
      {
        taskId: 'RALPH-002',
        externalId: 'JIRA-2',
        localStatus: 'pending',
        remoteStatus: 'In Progress',
        action: 'pull',
        resolved: 'in_progress',
      },
    ];

    const ops = generateStatusOperations(results);

    expect(ops).toHaveLength(2);
    expect(ops[0].op).toBe('update');
    expect(ops[0]).toHaveProperty('id', 'RALPH-001');
    expect((ops[0] as any).changes.status).toBe('done');
    expect((ops[0] as any).source).toBe('tracker');
  });

  it('skips push actions', () => {
    const results: StatusSyncResult[] = [
      {
        taskId: 'RALPH-001',
        externalId: 'JIRA-1',
        localStatus: 'in_progress',
        remoteStatus: 'To Do',
        action: 'push',
        resolved: 'in_progress',
      },
    ];

    const ops = generateStatusOperations(results);

    expect(ops).toHaveLength(0);
  });

  it('skips none actions', () => {
    const results: StatusSyncResult[] = [
      {
        taskId: 'RALPH-001',
        externalId: 'JIRA-1',
        localStatus: 'in_progress',
        remoteStatus: 'In Progress',
        action: 'none',
      },
    ];

    const ops = generateStatusOperations(results);

    expect(ops).toHaveLength(0);
  });

  it('skips pull without resolved status', () => {
    const results: StatusSyncResult[] = [
      {
        taskId: 'RALPH-001',
        externalId: 'JIRA-1',
        localStatus: 'pending',
        remoteStatus: 'Unknown',
        action: 'pull',
        resolved: undefined,
      },
    ];

    const ops = generateStatusOperations(results);

    expect(ops).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(generateStatusOperations([])).toHaveLength(0);
  });

  it('all operations have tracker as source', () => {
    const results: StatusSyncResult[] = [
      {
        taskId: 'RALPH-001',
        externalId: 'J-1',
        localStatus: 'pending',
        remoteStatus: 'Done',
        action: 'pull',
        resolved: 'done',
      },
      {
        taskId: 'RALPH-002',
        externalId: 'J-2',
        localStatus: 'pending',
        remoteStatus: 'Blocked',
        action: 'pull',
        resolved: 'blocked',
      },
    ];

    const ops = generateStatusOperations(results);
    for (const op of ops) {
      expect((op as any).source).toBe('tracker');
    }
  });
});
