import { describe, it, expect } from 'vitest';
import { deriveTaskState, isBlocked } from './loop.js';
import type { Task, TaskOperation, TaskCreateOp, TaskUpdateOp, TaskLinkOp, TaskRelateOp } from '../types/index.js';

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

function createOp(task: Task, timestamp = '2025-01-01T00:00:00Z'): TaskCreateOp {
  return { op: 'create', task, timestamp };
}

function updateOp(id: string, changes: Partial<Task>, timestamp = '2025-01-02T00:00:00Z'): TaskUpdateOp {
  return { op: 'update', id, changes, timestamp };
}

function linkOp(id: string, externalId: string, externalUrl?: string, timestamp = '2025-01-02T00:00:00Z'): TaskLinkOp {
  return { op: 'link', id, externalId, externalUrl, timestamp };
}

function relateOp(id: string, relation: 'blocks' | 'blockedBy' | 'parent' | 'subtask', targetId: string, timestamp = '2025-01-02T00:00:00Z'): TaskRelateOp {
  return { op: 'relate', id, relation, targetId, timestamp };
}

// =============================================================================
// TESTS
// =============================================================================

describe('deriveTaskState', () => {
  it('returns empty map for empty log', () => {
    const tasks = deriveTaskState([]);
    expect(tasks.size).toBe(0);
  });

  it('creates task from create operation', () => {
    const task = makeTask({ id: 'RALPH-001' });
    const tasks = deriveTaskState([createOp(task)]);

    expect(tasks.size).toBe(1);
    expect(tasks.get('RALPH-001')).toBeDefined();
    expect(tasks.get('RALPH-001')!.title).toBe('Test task');
  });

  it('applies update operation', () => {
    const task = makeTask({ id: 'RALPH-001', status: 'discovered' });
    const log: TaskOperation[] = [
      createOp(task),
      updateOp('RALPH-001', { status: 'in_progress' }),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.get('RALPH-001')!.status).toBe('in_progress');
    expect(tasks.get('RALPH-001')!.updatedAt).toBe('2025-01-02T00:00:00Z');
  });

  it('applies link operation', () => {
    const task = makeTask({ id: 'RALPH-001' });
    const log: TaskOperation[] = [
      createOp(task),
      linkOp('RALPH-001', 'JIRA-123', 'https://jira.example.com/JIRA-123'),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.get('RALPH-001')!.externalId).toBe('JIRA-123');
    expect(tasks.get('RALPH-001')!.externalUrl).toBe('https://jira.example.com/JIRA-123');
  });

  it('applies relate operations', () => {
    const task1 = makeTask({ id: 'RALPH-001' });
    const task2 = makeTask({ id: 'RALPH-002' });

    const log: TaskOperation[] = [
      createOp(task1),
      createOp(task2),
      relateOp('RALPH-001', 'blocks', 'RALPH-002'),
      relateOp('RALPH-002', 'blockedBy', 'RALPH-001'),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.get('RALPH-001')!.blocks).toContain('RALPH-002');
    expect(tasks.get('RALPH-002')!.blockedBy).toContain('RALPH-001');
  });

  it('applies parent relation', () => {
    const task = makeTask({ id: 'RALPH-002' });
    const log: TaskOperation[] = [
      createOp(task),
      relateOp('RALPH-002', 'parent', 'RALPH-001'),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.get('RALPH-002')!.parent).toBe('RALPH-001');
  });

  it('applies subtask relation', () => {
    const task = makeTask({ id: 'RALPH-001' });
    const log: TaskOperation[] = [
      createOp(task),
      relateOp('RALPH-001', 'subtask', 'RALPH-002'),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.get('RALPH-001')!.subtasks).toContain('RALPH-002');
  });

  it('handles multiple creates', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001' })),
      createOp(makeTask({ id: 'RALPH-002', title: 'Second task' })),
      createOp(makeTask({ id: 'RALPH-003', title: 'Third task' })),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.size).toBe(3);
  });

  it('ignores update for non-existent task', () => {
    const log: TaskOperation[] = [
      updateOp('RALPH-999', { status: 'done' }),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.size).toBe(0);
  });

  it('replays operations in order', () => {
    const task = makeTask({ id: 'RALPH-001', status: 'discovered' });
    const log: TaskOperation[] = [
      createOp(task),
      updateOp('RALPH-001', { status: 'in_progress' }, '2025-01-02'),
      updateOp('RALPH-001', { status: 'done' }, '2025-01-03'),
    ];

    const tasks = deriveTaskState(log);
    expect(tasks.get('RALPH-001')!.status).toBe('done');
  });
});

describe('isBlocked', () => {
  it('returns false for task with no blockers', () => {
    const task = makeTask();
    const allTasks = new Map<string, Task>();
    expect(isBlocked(task, allTasks)).toBe(false);
  });

  it('returns false for empty blockedBy array', () => {
    const task = makeTask({ blockedBy: [] });
    const allTasks = new Map<string, Task>();
    expect(isBlocked(task, allTasks)).toBe(false);
  });

  it('returns true when blocker is not done', () => {
    const task = makeTask({ id: 'RALPH-002', blockedBy: ['RALPH-001'] });
    const blocker = makeTask({ id: 'RALPH-001', status: 'in_progress' });

    const allTasks = new Map<string, Task>();
    allTasks.set('RALPH-001', blocker);
    allTasks.set('RALPH-002', task);

    expect(isBlocked(task, allTasks)).toBe(true);
  });

  it('returns false when blocker is done', () => {
    const task = makeTask({ id: 'RALPH-002', blockedBy: ['RALPH-001'] });
    const blocker = makeTask({ id: 'RALPH-001', status: 'done' });

    const allTasks = new Map<string, Task>();
    allTasks.set('RALPH-001', blocker);
    allTasks.set('RALPH-002', task);

    expect(isBlocked(task, allTasks)).toBe(false);
  });

  it('returns false when blocker is cancelled', () => {
    const task = makeTask({ id: 'RALPH-002', blockedBy: ['RALPH-001'] });
    const blocker = makeTask({ id: 'RALPH-001', status: 'cancelled' });

    const allTasks = new Map<string, Task>();
    allTasks.set('RALPH-001', blocker);
    allTasks.set('RALPH-002', task);

    expect(isBlocked(task, allTasks)).toBe(false);
  });

  it('returns true if any blocker is not done', () => {
    const task = makeTask({ id: 'RALPH-003', blockedBy: ['RALPH-001', 'RALPH-002'] });
    const blocker1 = makeTask({ id: 'RALPH-001', status: 'done' });
    const blocker2 = makeTask({ id: 'RALPH-002', status: 'in_progress' });

    const allTasks = new Map<string, Task>();
    allTasks.set('RALPH-001', blocker1);
    allTasks.set('RALPH-002', blocker2);
    allTasks.set('RALPH-003', task);

    expect(isBlocked(task, allTasks)).toBe(true);
  });

  it('returns false when blocker does not exist in map', () => {
    const task = makeTask({ id: 'RALPH-002', blockedBy: ['RALPH-999'] });
    const allTasks = new Map<string, Task>();
    allTasks.set('RALPH-002', task);

    expect(isBlocked(task, allTasks)).toBe(false);
  });
});
