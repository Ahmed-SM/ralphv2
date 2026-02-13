/**
 * Property-based tests for loop.ts (deriveTaskState, isBlocked)
 *
 * Verifies invariants of the event-sourcing state derivation
 * and task blocking logic.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveTaskState, isBlocked } from './loop.js';
import type { Task, TaskOperation, TaskCreateOp, TaskUpdateOp, TaskLinkOp, TaskRelateOp, TaskType, TaskStatus } from '../types/index.js';

// =============================================================================
// ARBITRARIES
// =============================================================================

const taskTypes: TaskType[] = ['epic', 'feature', 'task', 'subtask', 'bug', 'refactor', 'docs', 'test', 'spike'];
const taskStatuses: TaskStatus[] = ['discovered', 'pending', 'in_progress', 'blocked', 'review', 'done', 'cancelled'];

const taskIdArb = fc.integer({ min: 1, max: 999 }).map(n => `RALPH-${String(n).padStart(3, '0')}`);
const timestampArb = fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString());
const taskTypeArb = fc.constantFrom(...taskTypes);
const taskStatusArb = fc.constantFrom(...taskStatuses);

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    type: 'task',
    title: `Task ${id}`,
    description: '',
    status: 'discovered',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const createOpArb: fc.Arbitrary<TaskCreateOp> = fc.record({
  op: fc.constant('create' as const),
  task: fc.record({
    id: taskIdArb,
    type: taskTypeArb,
    title: fc.stringMatching(new RegExp('^[a-z ]{3,30}$')).map(s => s.trim() || 'task'),
    description: fc.constant(''),
    status: taskStatusArb,
    createdAt: timestampArb,
    updatedAt: timestampArb,
  }) as fc.Arbitrary<Task>,
  timestamp: timestampArb,
});

// =============================================================================
// PROPERTIES: deriveTaskState
// =============================================================================

describe('deriveTaskState — property-based', () => {

  it('returns empty map for empty log', () => {
    const tasks = deriveTaskState([]);
    expect(tasks.size).toBe(0);
  });

  it('create operations add tasks to the map', () => {
    fc.assert(
      fc.property(
        fc.array(createOpArb, { minLength: 1, maxLength: 20 }),
        (ops) => {
          // Ensure unique IDs
          const uniqueOps = ops.filter((op, i) =>
            ops.findIndex(o => o.task.id === op.task.id) === i
          );
          const tasks = deriveTaskState(uniqueOps);
          expect(tasks.size).toBe(uniqueOps.length);
          for (const op of uniqueOps) {
            expect(tasks.has(op.task.id)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('later creates with same ID overwrite earlier ones', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskTypeArb,
        taskTypeArb,
        timestampArb,
        (id, type1, type2, ts) => {
          const ops: TaskOperation[] = [
            { op: 'create', task: makeTask(id, { type: type1 }), timestamp: ts },
            { op: 'create', task: makeTask(id, { type: type2 }), timestamp: ts },
          ];
          const tasks = deriveTaskState(ops);
          expect(tasks.size).toBe(1);
          expect(tasks.get(id)!.type).toBe(type2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('update operations modify existing task fields', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskStatusArb,
        taskStatusArb,
        timestampArb,
        timestampArb,
        (id, initialStatus, newStatus, ts1, ts2) => {
          const ops: TaskOperation[] = [
            { op: 'create', task: makeTask(id, { status: initialStatus }), timestamp: ts1 },
            { op: 'update', id, changes: { status: newStatus }, timestamp: ts2 },
          ];
          const tasks = deriveTaskState(ops);
          expect(tasks.get(id)!.status).toBe(newStatus);
          expect(tasks.get(id)!.updatedAt).toBe(ts2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('update on non-existent task is silently ignored', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskStatusArb,
        timestampArb,
        (id, status, ts) => {
          const ops: TaskOperation[] = [
            { op: 'update', id, changes: { status }, timestamp: ts },
          ];
          const tasks = deriveTaskState(ops);
          expect(tasks.size).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('link operations set externalId and externalUrl', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('https://jira.example.com/PROJ-1', 'https://github.com/org/repo/issues/1'),
        timestampArb,
        timestampArb,
        (id, extId, extUrl, ts1, ts2) => {
          const ops: TaskOperation[] = [
            { op: 'create', task: makeTask(id), timestamp: ts1 },
            { op: 'link', id, externalId: extId, externalUrl: extUrl, timestamp: ts2 },
          ];
          const tasks = deriveTaskState(ops);
          expect(tasks.get(id)!.externalId).toBe(extId);
          expect(tasks.get(id)!.externalUrl).toBe(extUrl);
          expect(tasks.get(id)!.updatedAt).toBe(ts2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('link on non-existent task is silently ignored', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        timestampArb,
        (id, ts) => {
          const ops: TaskOperation[] = [
            { op: 'link', id, externalId: 'EXT-1', timestamp: ts },
          ];
          const tasks = deriveTaskState(ops);
          expect(tasks.size).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('relate operations build correct relationships', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskIdArb.filter((id): id is string => true), // reuse for target
        fc.constantFrom('blocks' as const, 'blockedBy' as const, 'parent' as const, 'subtask' as const),
        timestampArb,
        timestampArb,
        (id, targetId, relation, ts1, ts2) => {
          const ops: TaskOperation[] = [
            { op: 'create', task: makeTask(id), timestamp: ts1 },
            { op: 'relate', id, relation, targetId, timestamp: ts2 },
          ];
          const tasks = deriveTaskState(ops);
          const task = tasks.get(id)!;

          if (relation === 'blocks') {
            expect(task.blocks).toContain(targetId);
          } else if (relation === 'blockedBy') {
            expect(task.blockedBy).toContain(targetId);
          } else if (relation === 'parent') {
            expect(task.parent).toBe(targetId);
          } else if (relation === 'subtask') {
            expect(task.subtasks).toContain(targetId);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('multiple relates accumulate in arrays', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        fc.array(taskIdArb, { minLength: 2, maxLength: 5 }),
        timestampArb,
        (id, targetIds, ts) => {
          const ops: TaskOperation[] = [
            { op: 'create', task: makeTask(id), timestamp: ts },
            ...targetIds.map(tid => ({
              op: 'relate' as const,
              id,
              relation: 'blocks' as const,
              targetId: tid,
              timestamp: ts,
            })),
          ];
          const tasks = deriveTaskState(ops);
          expect(tasks.get(id)!.blocks!.length).toBe(targetIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('replaying the same log twice produces identical state', () => {
    fc.assert(
      fc.property(
        fc.array(createOpArb, { minLength: 1, maxLength: 10 }),
        (ops) => {
          const state1 = deriveTaskState(ops);
          const state2 = deriveTaskState(ops);
          expect(state1.size).toBe(state2.size);
          for (const [id, task] of state1) {
            const task2 = state2.get(id)!;
            expect(task.id).toBe(task2.id);
            expect(task.status).toBe(task2.status);
            expect(task.type).toBe(task2.type);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sequential updates apply in order (last write wins)', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        fc.array(taskStatusArb, { minLength: 2, maxLength: 10 }),
        timestampArb,
        (id, statuses, ts) => {
          const ops: TaskOperation[] = [
            { op: 'create', task: makeTask(id), timestamp: ts },
            ...statuses.map((s, i) => ({
              op: 'update' as const,
              id,
              changes: { status: s },
              timestamp: new Date(Date.parse(ts) + i * 1000).toISOString(),
            })),
          ];
          const tasks = deriveTaskState(ops);
          expect(tasks.get(id)!.status).toBe(statuses[statuses.length - 1]);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// =============================================================================
// PROPERTIES: isBlocked
// =============================================================================

describe('isBlocked — property-based', () => {

  it('task with no blockedBy is never blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskStatusArb,
        (id, status) => {
          const task = makeTask(id, { status });
          const allTasks = new Map<string, Task>([[id, task]]);
          expect(isBlocked(task, allTasks)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('task with empty blockedBy array is never blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        (id) => {
          const task = makeTask(id, { blockedBy: [] });
          const allTasks = new Map<string, Task>([[id, task]]);
          expect(isBlocked(task, allTasks)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('task blocked by a done task is NOT blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskIdArb,
        (id, blockerId) => {
          fc.pre(id !== blockerId);
          const blocker = makeTask(blockerId, { status: 'done' });
          const task = makeTask(id, { blockedBy: [blockerId] });
          const allTasks = new Map<string, Task>([
            [id, task],
            [blockerId, blocker],
          ]);
          expect(isBlocked(task, allTasks)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('task blocked by a cancelled task is NOT blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskIdArb,
        (id, blockerId) => {
          fc.pre(id !== blockerId);
          const blocker = makeTask(blockerId, { status: 'cancelled' });
          const task = makeTask(id, { blockedBy: [blockerId] });
          const allTasks = new Map<string, Task>([
            [id, task],
            [blockerId, blocker],
          ]);
          expect(isBlocked(task, allTasks)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('task blocked by an in_progress task IS blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskIdArb,
        fc.constantFrom('discovered', 'pending', 'in_progress', 'blocked', 'review') as fc.Arbitrary<TaskStatus>,
        (id, blockerId, blockerStatus) => {
          fc.pre(id !== blockerId);
          const blocker = makeTask(blockerId, { status: blockerStatus });
          const task = makeTask(id, { blockedBy: [blockerId] });
          const allTasks = new Map<string, Task>([
            [id, task],
            [blockerId, blocker],
          ]);
          expect(isBlocked(task, allTasks)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('task blocked by non-existent blocker is NOT blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskIdArb,
        (id, blockerId) => {
          fc.pre(id !== blockerId);
          const task = makeTask(id, { blockedBy: [blockerId] });
          // Only the task itself is in the map, blocker is missing
          const allTasks = new Map<string, Task>([[id, task]]);
          expect(isBlocked(task, allTasks)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('task with mixed blockers: some done, some not → IS blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        taskIdArb,
        taskIdArb,
        (id, doneBlockerId, activeBlockerId) => {
          fc.pre(id !== doneBlockerId && id !== activeBlockerId && doneBlockerId !== activeBlockerId);
          const doneBlocker = makeTask(doneBlockerId, { status: 'done' });
          const activeBlocker = makeTask(activeBlockerId, { status: 'in_progress' });
          const task = makeTask(id, { blockedBy: [doneBlockerId, activeBlockerId] });
          const allTasks = new Map<string, Task>([
            [id, task],
            [doneBlockerId, doneBlocker],
            [activeBlockerId, activeBlocker],
          ]);
          expect(isBlocked(task, allTasks)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('task with all blockers done → NOT blocked', () => {
    fc.assert(
      fc.property(
        taskIdArb,
        fc.array(taskIdArb, { minLength: 1, maxLength: 5 }),
        (id, blockerIds) => {
          const uniqueBlockerIds = [...new Set(blockerIds)].filter(bid => bid !== id);
          fc.pre(uniqueBlockerIds.length > 0);

          const task = makeTask(id, { blockedBy: uniqueBlockerIds });
          const allTasks = new Map<string, Task>([[id, task]]);
          for (const bid of uniqueBlockerIds) {
            allTasks.set(bid, makeTask(bid, { status: 'done' }));
          }
          expect(isBlocked(task, allTasks)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
