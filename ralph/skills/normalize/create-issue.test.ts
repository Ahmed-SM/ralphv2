import { describe, it, expect, vi } from 'vitest';
import { createIssue, createIssues, generateLinkOperations } from './create-issue.js';
import type { Tracker, TrackerConfig, ExternalIssue } from './tracker-interface.js';
import type { Task, TaskType, TaskStatus } from '../../types/index.js';
import type { CreateIssueResult } from './create-issue.js';

// =============================================================================
// FIXTURES
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: 'A test task',
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
    createSubtask: vi.fn().mockResolvedValue(makeIssue({ key: 'RALPH-2', type: 'Sub-task' })),
    linkIssues: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    getTransitions: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('createIssue', () => {
  it('creates issue for task without external ID', async () => {
    const tracker = makeTracker();
    const task = makeTask();
    const config = makeConfig();

    const result = await createIssue(tracker, task, config);

    expect(result.taskId).toBe('RALPH-001');
    expect(result.issue).toBeDefined();
    expect(result.issue!.key).toBe('RALPH-1');
    expect(result.skipped).toBeUndefined();
    expect(tracker.createIssue).toHaveBeenCalledWith(task);
  });

  it('skips task already linked to external issue', async () => {
    const tracker = makeTracker();
    const task = makeTask({ externalId: 'JIRA-123' });
    const config = makeConfig();

    const result = await createIssue(tracker, task, config);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('JIRA-123');
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it('skips task with unmapped type', async () => {
    const tracker = makeTracker();
    const task = makeTask({ type: 'task' });
    const config = makeConfig({ issueTypeMap: {} as Record<TaskType, string> });

    const result = await createIssue(tracker, task, config);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('task');
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it('adds comment when option is set', async () => {
    const tracker = makeTracker();
    const task = makeTask();
    const config = makeConfig();

    await createIssue(tracker, task, config, { addComment: true });

    expect(tracker.addComment).toHaveBeenCalledWith(
      'RALPH-1',
      'Created from Ralph task RALPH-001'
    );
  });

  it('uses comment template with replacements', async () => {
    const tracker = makeTracker();
    const task = makeTask({ id: 'RALPH-042', title: 'My Feature' });
    const config = makeConfig();

    await createIssue(tracker, task, config, {
      addComment: true,
      commentTemplate: 'Task {taskId}: {title}',
    });

    expect(tracker.addComment).toHaveBeenCalledWith('RALPH-1', 'Task RALPH-042: My Feature');
  });

  it('returns error when tracker throws', async () => {
    const tracker = makeTracker({
      createIssue: vi.fn().mockRejectedValue(new Error('API error')),
    });
    const task = makeTask();
    const config = makeConfig();

    const result = await createIssue(tracker, task, config);

    expect(result.error).toBe('API error');
    expect(result.issue).toBeUndefined();
  });

  it('handles non-Error throws gracefully', async () => {
    const tracker = makeTracker({
      createIssue: vi.fn().mockRejectedValue('string error'),
    });
    const task = makeTask();
    const config = makeConfig();

    const result = await createIssue(tracker, task, config);

    expect(result.error).toBe('Unknown error');
  });
});

describe('createIssues', () => {
  it('creates issues for multiple tasks', async () => {
    let callCount = 0;
    const tracker = makeTracker({
      createIssue: vi.fn().mockImplementation(async (task: Task) => {
        callCount++;
        return makeIssue({ key: `RALPH-${callCount}` });
      }),
    });
    const tasks = [makeTask({ id: 'RALPH-001' }), makeTask({ id: 'RALPH-002' })];
    const config = makeConfig();

    const results = await createIssues(tracker, tasks, config);

    expect(results).toHaveLength(2);
    expect(results[0].issue!.key).toBe('RALPH-1');
    expect(results[1].issue!.key).toBe('RALPH-2');
  });

  it('creates subtask under parent when parent already created', async () => {
    const tracker = makeTracker({
      createIssue: vi.fn().mockResolvedValue(makeIssue({ key: 'RALPH-P' })),
      createSubtask: vi.fn().mockResolvedValue(makeIssue({ key: 'RALPH-S', type: 'Sub-task' })),
    });

    const parent = makeTask({ id: 'RALPH-001', type: 'task' });
    const child = makeTask({ id: 'RALPH-002', type: 'subtask', parent: 'RALPH-001' });
    const config = makeConfig();

    const results = await createIssues(tracker, [parent, child], config);

    expect(results).toHaveLength(2);
    expect(tracker.createSubtask).toHaveBeenCalledWith('RALPH-P', child);
  });

  it('falls back to regular issue when createSubtask fails', async () => {
    const tracker = makeTracker({
      createIssue: vi.fn().mockResolvedValue(makeIssue({ key: 'RALPH-1' })),
      createSubtask: vi.fn().mockRejectedValue(new Error('Subtask not supported')),
    });

    const parent = makeTask({ id: 'RALPH-001', type: 'task' });
    const child = makeTask({ id: 'RALPH-002', type: 'subtask', parent: 'RALPH-001' });
    const config = makeConfig();

    const results = await createIssues(tracker, [parent, child], config);

    // Child should fall back to regular createIssue
    expect(results).toHaveLength(2);
    expect(tracker.createIssue).toHaveBeenCalledTimes(2);
  });

  it('processes parents before children regardless of input order', async () => {
    const callOrder: string[] = [];
    const tracker = makeTracker({
      createIssue: vi.fn().mockImplementation(async (task: Task) => {
        callOrder.push(task.id);
        return makeIssue({ key: task.id });
      }),
    });

    const child = makeTask({ id: 'RALPH-002', parent: 'RALPH-001' });
    const parent = makeTask({ id: 'RALPH-001' });
    const config = makeConfig();

    // Pass child first, parent second — should still process parent first
    await createIssues(tracker, [child, parent], config);

    expect(callOrder[0]).toBe('RALPH-001');
  });

  it('skips subtask creation when createSubtasks is false', async () => {
    const tracker = makeTracker({
      createIssue: vi.fn().mockResolvedValue(makeIssue({ key: 'RALPH-1' })),
    });

    const parent = makeTask({ id: 'RALPH-001' });
    const child = makeTask({ id: 'RALPH-002', parent: 'RALPH-001' });
    const config = makeConfig();

    await createIssues(tracker, [parent, child], config, { createSubtasks: false });

    // Should NOT call createSubtask, both go through createIssue
    expect(tracker.createSubtask).not.toHaveBeenCalled();
  });
});

describe('generateLinkOperations', () => {
  it('generates link operations for created issues', () => {
    const results: CreateIssueResult[] = [
      { taskId: 'RALPH-001', issue: makeIssue({ key: 'JIRA-1', url: 'http://jira/1' }) },
      { taskId: 'RALPH-002', issue: makeIssue({ key: 'JIRA-2', url: 'http://jira/2' }) },
    ];

    const ops = generateLinkOperations(results);

    expect(ops).toHaveLength(2);
    expect(ops[0].op).toBe('link');
    expect(ops[0]).toHaveProperty('id', 'RALPH-001');
    expect(ops[0]).toHaveProperty('externalId', 'JIRA-1');
    expect(ops[0]).toHaveProperty('externalUrl', 'http://jira/1');
  });

  it('skips results without issues', () => {
    const results: CreateIssueResult[] = [
      { taskId: 'RALPH-001', skipped: true, skipReason: 'Already linked' },
      { taskId: 'RALPH-002', error: 'API error' },
      { taskId: 'RALPH-003', issue: makeIssue({ key: 'JIRA-3' }) },
    ];

    const ops = generateLinkOperations(results);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toHaveProperty('id', 'RALPH-003');
  });

  it('returns empty array for no results', () => {
    expect(generateLinkOperations([])).toHaveLength(0);
  });

  it('all operations share the same timestamp', () => {
    const results: CreateIssueResult[] = [
      { taskId: 'RALPH-001', issue: makeIssue({ key: 'J-1' }) },
      { taskId: 'RALPH-002', issue: makeIssue({ key: 'J-2' }) },
    ];

    const ops = generateLinkOperations(results);

    expect(ops[0].timestamp).toBe(ops[1].timestamp);
  });
});
