import { describe, it, expect } from 'vitest';
import {
  validateOperation,
  validateCreate,
  validateUpdate,
  validateRelate,
  validateOperationLog,
  isValidTransition,
  getAllowedTransitions,
  type ValidationError,
  type ValidationResult,
} from './validate-task.js';
import type {
  Task,
  TaskOperation,
  TaskCreateOp,
  TaskUpdateOp,
  TaskLinkOp,
  TaskRelateOp,
  TaskStatus,
} from '../../types/index.js';

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

function tasksMap(...tasks: Task[]): Map<string, Task> {
  const map = new Map<string, Task>();
  for (const t of tasks) map.set(t.id, t);
  return map;
}

// =============================================================================
// isValidTransition
// =============================================================================

describe('isValidTransition', () => {
  it('allows discovered → pending', () => {
    expect(isValidTransition('discovered', 'pending')).toBe(true);
  });

  it('allows discovered → cancelled', () => {
    expect(isValidTransition('discovered', 'cancelled')).toBe(true);
  });

  it('rejects discovered → in_progress (must go through pending)', () => {
    expect(isValidTransition('discovered', 'in_progress')).toBe(false);
  });

  it('rejects discovered → done', () => {
    expect(isValidTransition('discovered', 'done')).toBe(false);
  });

  it('allows pending → in_progress', () => {
    expect(isValidTransition('pending', 'in_progress')).toBe(true);
  });

  it('allows pending → blocked', () => {
    expect(isValidTransition('pending', 'blocked')).toBe(true);
  });

  it('allows in_progress → done', () => {
    expect(isValidTransition('in_progress', 'done')).toBe(true);
  });

  it('allows in_progress → blocked', () => {
    expect(isValidTransition('in_progress', 'blocked')).toBe(true);
  });

  it('allows in_progress → review', () => {
    expect(isValidTransition('in_progress', 'review')).toBe(true);
  });

  it('allows blocked → pending', () => {
    expect(isValidTransition('blocked', 'pending')).toBe(true);
  });

  it('allows review → done', () => {
    expect(isValidTransition('review', 'done')).toBe(true);
  });

  it('allows review → cancelled', () => {
    expect(isValidTransition('review', 'cancelled')).toBe(true);
  });

  it('rejects done → any (terminal)', () => {
    expect(isValidTransition('done', 'pending')).toBe(false);
    expect(isValidTransition('done', 'in_progress')).toBe(false);
    expect(isValidTransition('done', 'cancelled')).toBe(false);
  });

  it('rejects cancelled → any (terminal)', () => {
    expect(isValidTransition('cancelled', 'pending')).toBe(false);
    expect(isValidTransition('cancelled', 'in_progress')).toBe(false);
    expect(isValidTransition('cancelled', 'done')).toBe(false);
  });

  it('rejects same-status "transition"', () => {
    // isValidTransition only checks if from→to is in the allowed list
    // discovered→discovered is not listed
    expect(isValidTransition('pending', 'pending')).toBe(false);
  });

  it('returns false for unknown status', () => {
    expect(isValidTransition('unknown' as TaskStatus, 'pending')).toBe(false);
  });
});

// =============================================================================
// getAllowedTransitions
// =============================================================================

describe('getAllowedTransitions', () => {
  it('returns pending and cancelled for discovered', () => {
    expect(getAllowedTransitions('discovered')).toEqual(['pending', 'cancelled']);
  });

  it('returns in_progress, blocked, cancelled for pending', () => {
    expect(getAllowedTransitions('pending')).toEqual(['in_progress', 'blocked', 'cancelled']);
  });

  it('returns empty for done (terminal)', () => {
    expect(getAllowedTransitions('done')).toEqual([]);
  });

  it('returns empty for cancelled (terminal)', () => {
    expect(getAllowedTransitions('cancelled')).toEqual([]);
  });

  it('returns empty for unknown status', () => {
    expect(getAllowedTransitions('unknown' as TaskStatus)).toEqual([]);
  });
});

// =============================================================================
// validateCreate
// =============================================================================

describe('validateCreate', () => {
  it('returns no errors for valid create with empty state', () => {
    const op = createOp(makeTask());
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(0);
  });

  it('errors on duplicate id', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = createOp(makeTask({ id: 'RALPH-001' }));
    const errors = validateCreate(op, existing);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('unique_id');
    expect(errors[0].taskId).toBe('RALPH-001');
  });

  it('errors when parent does not exist', () => {
    const op = createOp(makeTask({ parent: 'RALPH-999' }));
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('parent_exists');
    expect(errors[0].message).toContain('RALPH-999');
  });

  it('no error when parent exists', () => {
    const parent = makeTask({ id: 'RALPH-001' });
    const existing = tasksMap(parent);
    const op = createOp(makeTask({ id: 'RALPH-002', parent: 'RALPH-001' }));
    const errors = validateCreate(op, existing);
    expect(errors).toHaveLength(0);
  });

  it('errors when blockedBy task does not exist', () => {
    const op = createOp(makeTask({ blockedBy: ['RALPH-999'] }));
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('blocker_exists');
  });

  it('errors for each missing blocker', () => {
    const op = createOp(makeTask({ blockedBy: ['RALPH-999', 'RALPH-998'] }));
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(2);
    expect(errors.every(e => e.rule === 'blocker_exists')).toBe(true);
  });

  it('no error when all blockers exist', () => {
    const existing = tasksMap(
      makeTask({ id: 'RALPH-002' }),
      makeTask({ id: 'RALPH-003' }),
    );
    const op = createOp(makeTask({ id: 'RALPH-001', blockedBy: ['RALPH-002', 'RALPH-003'] }));
    const errors = validateCreate(op, existing);
    expect(errors).toHaveLength(0);
  });

  it('errors when status is done but no completedAt', () => {
    const op = createOp(makeTask({ status: 'done' }));
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('completed_at_required');
  });

  it('no error when status is done with completedAt', () => {
    const op = createOp(makeTask({ status: 'done', completedAt: '2025-01-01T00:00:00Z' }));
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(0);
  });

  it('no error when status is not done without completedAt', () => {
    const op = createOp(makeTask({ status: 'pending' }));
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(0);
  });

  it('can return multiple errors at once', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = createOp(makeTask({
      id: 'RALPH-001',
      parent: 'RALPH-999',
      status: 'done',
    }));
    const errors = validateCreate(op, existing);
    // unique_id + parent_exists + completed_at_required
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// validateUpdate
// =============================================================================

describe('validateUpdate', () => {
  it('returns no errors for valid status transition', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'discovered' }));
    const op = updateOp('RALPH-001', { status: 'pending' });
    const errors = validateUpdate(op, existing);
    expect(errors).toHaveLength(0);
  });

  it('errors when task does not exist', () => {
    const op = updateOp('RALPH-999', { status: 'pending' });
    const errors = validateUpdate(op, new Map());
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('task_exists');
  });

  it('returns early on non-existent task (no further checks)', () => {
    const op = updateOp('RALPH-999', { status: 'done' });
    const errors = validateUpdate(op, new Map());
    // Only task_exists error, not completedAt error
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('task_exists');
  });

  it('errors on invalid status transition', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'discovered' }));
    const op = updateOp('RALPH-001', { status: 'done' });
    const errors = validateUpdate(op, existing);
    expect(errors.some(e => e.rule === 'valid_transition')).toBe(true);
    expect(errors[0].message).toContain('discovered');
    expect(errors[0].message).toContain('done');
  });

  it('no error when status is unchanged', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'pending' }));
    const op = updateOp('RALPH-001', { status: 'pending' });
    const errors = validateUpdate(op, existing);
    // Same status is not a transition, so no error
    expect(errors.filter(e => e.rule === 'valid_transition')).toHaveLength(0);
  });

  it('errors when transitioning to done without completedAt', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'in_progress' }));
    const op = updateOp('RALPH-001', { status: 'done' });
    const errors = validateUpdate(op, existing);
    expect(errors.some(e => e.rule === 'completed_at_required')).toBe(true);
  });

  it('no error when transitioning to done with completedAt', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'in_progress' }));
    const op = updateOp('RALPH-001', { status: 'done', completedAt: '2025-01-02T00:00:00Z' });
    const errors = validateUpdate(op, existing);
    expect(errors).toHaveLength(0);
  });

  it('no completedAt error if task already has completedAt', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'in_progress', completedAt: '2025-01-01T00:00:00Z' }));
    const op = updateOp('RALPH-001', { status: 'done' });
    const errors = validateUpdate(op, existing);
    expect(errors.filter(e => e.rule === 'completed_at_required')).toHaveLength(0);
  });

  it('errors when setting parent to non-existent task', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = updateOp('RALPH-001', { parent: 'RALPH-999' });
    const errors = validateUpdate(op, existing);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('parent_exists');
  });

  it('errors when setting blockedBy to non-existent tasks', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = updateOp('RALPH-001', { blockedBy: ['RALPH-999'] });
    const errors = validateUpdate(op, existing);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('blocker_exists');
  });

  it('no error for title-only update', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = updateOp('RALPH-001', { title: 'New title' });
    const errors = validateUpdate(op, existing);
    expect(errors).toHaveLength(0);
  });

  it('transition error message includes allowed transitions', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'done' }));
    const op = updateOp('RALPH-001', { status: 'in_progress' });
    const errors = validateUpdate(op, existing);
    expect(errors[0].message).toContain('none');
  });
});

// =============================================================================
// validateRelate
// =============================================================================

describe('validateRelate', () => {
  it('returns no errors when both tasks exist', () => {
    const existing = tasksMap(
      makeTask({ id: 'RALPH-001' }),
      makeTask({ id: 'RALPH-002' }),
    );
    const op = relateOp('RALPH-001', 'blocks', 'RALPH-002');
    const errors = validateRelate(op, existing);
    expect(errors).toHaveLength(0);
  });

  it('errors when source task does not exist', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-002' }));
    const op = relateOp('RALPH-001', 'blocks', 'RALPH-002');
    const errors = validateRelate(op, existing);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('task_exists');
    expect(errors[0].taskId).toBe('RALPH-001');
  });

  it('errors when target task does not exist', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = relateOp('RALPH-001', 'blocks', 'RALPH-999');
    const errors = validateRelate(op, existing);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('RALPH-999');
  });

  it('errors when both tasks do not exist', () => {
    const op = relateOp('RALPH-001', 'blocks', 'RALPH-002');
    const errors = validateRelate(op, new Map());
    expect(errors).toHaveLength(2);
  });

  it('uses parent_exists rule for parent relation target', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = relateOp('RALPH-001', 'parent', 'RALPH-999');
    const errors = validateRelate(op, existing);
    expect(errors[0].rule).toBe('parent_exists');
  });

  it('uses blocker_exists rule for blockedBy relation target', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = relateOp('RALPH-001', 'blockedBy', 'RALPH-999');
    const errors = validateRelate(op, existing);
    expect(errors[0].rule).toBe('blocker_exists');
  });

  it('uses task_exists rule for subtask relation target', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = relateOp('RALPH-001', 'subtask', 'RALPH-999');
    const errors = validateRelate(op, existing);
    expect(errors[0].rule).toBe('task_exists');
  });
});

// =============================================================================
// validateOperation (dispatcher)
// =============================================================================

describe('validateOperation', () => {
  it('dispatches create operations', () => {
    const op = createOp(makeTask());
    const result = validateOperation(op, new Map());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('dispatches update operations', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001', status: 'discovered' }));
    const op = updateOp('RALPH-001', { status: 'done' }); // invalid
    const result = validateOperation(op, existing);
    expect(result.valid).toBe(false);
  });

  it('dispatches relate operations', () => {
    const op = relateOp('RALPH-001', 'blocks', 'RALPH-002');
    const result = validateOperation(op, new Map());
    expect(result.valid).toBe(false);
  });

  it('validates link operations (task must exist)', () => {
    const op = linkOp('RALPH-999', 'JIRA-123');
    const result = validateOperation(op, new Map());
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe('task_exists');
  });

  it('accepts link operations when task exists', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = linkOp('RALPH-001', 'JIRA-123');
    const result = validateOperation(op, existing);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// validateOperationLog
// =============================================================================

describe('validateOperationLog', () => {
  it('returns valid for empty log', () => {
    const result = validateOperationLog([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a clean log with no errors', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001', status: 'discovered' })),
      createOp(makeTask({ id: 'RALPH-002', status: 'discovered' })),
      updateOp('RALPH-001', { status: 'pending' }),
      updateOp('RALPH-001', { status: 'in_progress' }),
      relateOp('RALPH-001', 'blocks', 'RALPH-002'),
      updateOp('RALPH-001', { status: 'done', completedAt: '2025-01-03T00:00:00Z' }, '2025-01-03T00:00:00Z'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('catches duplicate id in log', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001' })),
      createOp(makeTask({ id: 'RALPH-001' })), // duplicate
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.rule === 'unique_id')).toBe(true);
  });

  it('catches invalid transition in log', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001', status: 'discovered' })),
      updateOp('RALPH-001', { status: 'done' }), // invalid skip
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.rule === 'valid_transition')).toBe(true);
  });

  it('catches missing parent reference in log', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001', parent: 'RALPH-999' })),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.rule === 'parent_exists')).toBe(true);
  });

  it('continues validation after invalid operations', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001' })),
      createOp(makeTask({ id: 'RALPH-001' })), // invalid: duplicate
      updateOp('RALPH-001', { status: 'done' }), // invalid: bad transition
    ];
    const result = validateOperationLog(log);
    // Both errors should be collected
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('applies operations so later references resolve', () => {
    // Create RALPH-001, then create RALPH-002 with parent RALPH-001
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001' })),
      createOp(makeTask({ id: 'RALPH-002', parent: 'RALPH-001' })),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('validates relate against accumulated state', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001' })),
      createOp(makeTask({ id: 'RALPH-002' })),
      relateOp('RALPH-001', 'blockedBy', 'RALPH-002'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('catches relate with missing target in accumulated state', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001' })),
      relateOp('RALPH-001', 'blockedBy', 'RALPH-999'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(false);
  });

  it('validates full lifecycle: discovered → pending → in_progress → done', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001', status: 'discovered' })),
      updateOp('RALPH-001', { status: 'pending' }, '2025-01-02T00:00:00Z'),
      updateOp('RALPH-001', { status: 'in_progress' }, '2025-01-03T00:00:00Z'),
      updateOp('RALPH-001', { status: 'done', completedAt: '2025-01-04T00:00:00Z' }, '2025-01-04T00:00:00Z'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('validates blocked → pending → in_progress cycle', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001', status: 'discovered' })),
      updateOp('RALPH-001', { status: 'pending' }, '2025-01-02T00:00:00Z'),
      updateOp('RALPH-001', { status: 'blocked' }, '2025-01-03T00:00:00Z'),
      updateOp('RALPH-001', { status: 'pending' }, '2025-01-04T00:00:00Z'),
      updateOp('RALPH-001', { status: 'in_progress' }, '2025-01-05T00:00:00Z'),
      updateOp('RALPH-001', { status: 'done', completedAt: '2025-01-06T00:00:00Z' }, '2025-01-06T00:00:00Z'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('validates review → done path', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001', status: 'discovered' })),
      updateOp('RALPH-001', { status: 'pending' }, '2025-01-02T00:00:00Z'),
      updateOp('RALPH-001', { status: 'in_progress' }, '2025-01-03T00:00:00Z'),
      updateOp('RALPH-001', { status: 'review' }, '2025-01-04T00:00:00Z'),
      updateOp('RALPH-001', { status: 'done', completedAt: '2025-01-05T00:00:00Z' }, '2025-01-05T00:00:00Z'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('validates review → cancelled path', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001', status: 'discovered' })),
      updateOp('RALPH-001', { status: 'pending' }),
      updateOp('RALPH-001', { status: 'in_progress' }),
      updateOp('RALPH-001', { status: 'review' }),
      updateOp('RALPH-001', { status: 'cancelled' }),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('validates link operation in log', () => {
    const log: TaskOperation[] = [
      createOp(makeTask({ id: 'RALPH-001' })),
      linkOp('RALPH-001', 'JIRA-123', 'https://jira.example.com/JIRA-123'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(true);
  });

  it('catches link for non-existent task in log', () => {
    const log: TaskOperation[] = [
      linkOp('RALPH-999', 'JIRA-123'),
    ];
    const result = validateOperationLog(log);
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('edge cases', () => {
  it('empty blockedBy array is fine', () => {
    const op = createOp(makeTask({ blockedBy: [] }));
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(0);
  });

  it('undefined blockedBy is fine', () => {
    const op = createOp(makeTask());
    const errors = validateCreate(op, new Map());
    expect(errors).toHaveLength(0);
  });

  it('update with no changes is fine', () => {
    const existing = tasksMap(makeTask({ id: 'RALPH-001' }));
    const op = updateOp('RALPH-001', {});
    const errors = validateUpdate(op, existing);
    expect(errors).toHaveLength(0);
  });

  it('all errors include operation type', () => {
    const op = createOp(makeTask({ id: 'RALPH-001', parent: 'RALPH-999', status: 'done' }));
    const errors = validateCreate(op, new Map());
    expect(errors.every(e => e.operation === 'create')).toBe(true);
  });

  it('all errors include taskId', () => {
    const op = createOp(makeTask({ id: 'RALPH-001', parent: 'RALPH-999' }));
    const errors = validateCreate(op, new Map());
    expect(errors.every(e => e.taskId === 'RALPH-001')).toBe(true);
  });

  it('ValidationResult has correct shape', () => {
    const result = validateOperation(createOp(makeTask()), new Map());
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
