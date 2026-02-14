/**
 * Task Schema Validation
 *
 * Enforces the validation rules from specs/task-schema.md:
 * 1. id must be unique
 * 2. parent must exist if specified
 * 3. blockedBy tasks must exist
 * 4. status transitions must follow lifecycle
 * 5. completedAt required when status is done
 *
 * Validation is applied to TaskOperations before they are accepted
 * into the operation log.
 */

import type {
  Task,
  TaskStatus,
  TaskOperation,
  TaskCreateOp,
  TaskUpdateOp,
  TaskRelateOp,
} from '../../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ValidationError {
  rule: string;
  message: string;
  taskId: string;
  operation: TaskOperation['op'];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// =============================================================================
// STATUS LIFECYCLE
// =============================================================================

/**
 * Allowed status transitions per specs/task-schema.md lifecycle diagram:
 *
 * discovered → pending → in_progress → done
 *                 ↓           ↓
 *              blocked     review
 *                 ↓           ↓
 *              pending      done/cancelled
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  discovered: ['pending', 'cancelled'],
  pending:    ['in_progress', 'blocked', 'cancelled'],
  in_progress:['done', 'blocked', 'review', 'cancelled'],
  blocked:    ['pending', 'cancelled'],
  review:     ['done', 'cancelled'],
  done:       [],       // terminal state
  cancelled:  [],       // terminal state
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: TaskStatus): TaskStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

// =============================================================================
// OPERATION VALIDATORS
// =============================================================================

/**
 * Validate a create operation.
 * Rules: unique id, completedAt presence.
 */
export function validateCreate(
  op: TaskCreateOp,
  existingTasks: Map<string, Task>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Rule 1: id must be unique
  if (existingTasks.has(op.task.id)) {
    errors.push({
      rule: 'unique_id',
      message: `Task ID '${op.task.id}' already exists`,
      taskId: op.task.id,
      operation: 'create',
    });
  }

  // Rule 2: parent must exist if specified
  if (op.task.parent && !existingTasks.has(op.task.parent)) {
    errors.push({
      rule: 'parent_exists',
      message: `Parent task '${op.task.parent}' does not exist`,
      taskId: op.task.id,
      operation: 'create',
    });
  }

  // Rule 3: blockedBy tasks must exist
  if (op.task.blockedBy) {
    for (const blockerId of op.task.blockedBy) {
      if (!existingTasks.has(blockerId)) {
        errors.push({
          rule: 'blocker_exists',
          message: `Blocking task '${blockerId}' does not exist`,
          taskId: op.task.id,
          operation: 'create',
        });
      }
    }
  }

  // Rule 5: completedAt required when status is done
  if (op.task.status === 'done' && !op.task.completedAt) {
    errors.push({
      rule: 'completed_at_required',
      message: `completedAt is required when status is 'done'`,
      taskId: op.task.id,
      operation: 'create',
    });
  }

  return errors;
}

/**
 * Validate an update operation.
 * Rules: task must exist, valid transition, completedAt.
 */
export function validateUpdate(
  op: TaskUpdateOp,
  existingTasks: Map<string, Task>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  const task = existingTasks.get(op.id);
  if (!task) {
    errors.push({
      rule: 'task_exists',
      message: `Task '${op.id}' does not exist`,
      taskId: op.id,
      operation: 'update',
    });
    return errors; // Can't validate further without the task
  }

  // Rule 4: status transitions must follow lifecycle
  if (op.changes.status && op.changes.status !== task.status) {
    if (!isValidTransition(task.status, op.changes.status)) {
      errors.push({
        rule: 'valid_transition',
        message: `Invalid status transition: '${task.status}' → '${op.changes.status}' (allowed: ${getAllowedTransitions(task.status).join(', ') || 'none'})`,
        taskId: op.id,
        operation: 'update',
      });
    }
  }

  // Rule 5: completedAt required when transitioning to done
  if (op.changes.status === 'done' && !op.changes.completedAt && !task.completedAt) {
    errors.push({
      rule: 'completed_at_required',
      message: `completedAt is required when status is 'done'`,
      taskId: op.id,
      operation: 'update',
    });
  }

  // Rule 2: parent must exist if being set
  if (op.changes.parent && !existingTasks.has(op.changes.parent)) {
    errors.push({
      rule: 'parent_exists',
      message: `Parent task '${op.changes.parent}' does not exist`,
      taskId: op.id,
      operation: 'update',
    });
  }

  // Rule 3: blockedBy tasks must exist if being set
  if (op.changes.blockedBy) {
    for (const blockerId of op.changes.blockedBy) {
      if (!existingTasks.has(blockerId)) {
        errors.push({
          rule: 'blocker_exists',
          message: `Blocking task '${blockerId}' does not exist`,
          taskId: op.id,
          operation: 'update',
        });
      }
    }
  }

  return errors;
}

/**
 * Validate a relate operation.
 * Rules: both source and target must exist.
 */
export function validateRelate(
  op: TaskRelateOp,
  existingTasks: Map<string, Task>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!existingTasks.has(op.id)) {
    errors.push({
      rule: 'task_exists',
      message: `Task '${op.id}' does not exist`,
      taskId: op.id,
      operation: 'relate',
    });
  }

  if (!existingTasks.has(op.targetId)) {
    const relatedRule = op.relation === 'parent' ? 'parent_exists'
      : op.relation === 'blockedBy' ? 'blocker_exists'
      : 'task_exists';
    errors.push({
      rule: relatedRule,
      message: `Target task '${op.targetId}' does not exist`,
      taskId: op.id,
      operation: 'relate',
    });
  }

  return errors;
}

// =============================================================================
// MAIN VALIDATION FUNCTION
// =============================================================================

/**
 * Validate a single TaskOperation against the current state.
 *
 * @param op - The operation to validate
 * @param existingTasks - Current derived task state (from replaying the log)
 * @returns ValidationResult with valid flag and list of errors
 */
export function validateOperation(
  op: TaskOperation,
  existingTasks: Map<string, Task>,
): ValidationResult {
  let errors: ValidationError[];

  switch (op.op) {
    case 'create':
      errors = validateCreate(op, existingTasks);
      break;
    case 'update':
      errors = validateUpdate(op, existingTasks);
      break;
    case 'relate':
      errors = validateRelate(op, existingTasks);
      break;
    case 'link':
      // Link operations just need the task to exist
      errors = [];
      if (!existingTasks.has(op.id)) {
        errors.push({
          rule: 'task_exists',
          message: `Task '${op.id}' does not exist`,
          taskId: op.id,
          operation: 'link',
        });
      }
      break;
    default:
      errors = [];
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate an entire operation log, replaying from the start.
 *
 * Returns all validation errors found during replay.
 * This is useful for auditing an existing tasks.jsonl file.
 */
export function validateOperationLog(log: TaskOperation[]): ValidationResult {
  const tasks = new Map<string, Task>();
  const allErrors: ValidationError[] = [];

  for (const op of log) {
    const result = validateOperation(op, tasks);
    allErrors.push(...result.errors);

    // Apply the operation to maintain state for subsequent validations
    // (even if invalid, we apply it so later operations can reference it)
    applyOperation(op, tasks);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Apply a single operation to the task state.
 * This mirrors the logic in loop.ts deriveTaskState but for single operations.
 */
function applyOperation(op: TaskOperation, tasks: Map<string, Task>): void {
  switch (op.op) {
    case 'create':
      tasks.set(op.task.id, { ...op.task });
      break;
    case 'update': {
      const task = tasks.get(op.id);
      if (task) {
        Object.assign(task, op.changes, { updatedAt: op.timestamp });
      }
      break;
    }
    case 'link': {
      const task = tasks.get(op.id);
      if (task) {
        task.externalId = op.externalId;
        task.externalUrl = op.externalUrl;
        task.updatedAt = op.timestamp;
      }
      break;
    }
    case 'relate': {
      const task = tasks.get(op.id);
      if (task) {
        if (op.relation === 'blocks') {
          task.blocks = task.blocks || [];
          task.blocks.push(op.targetId);
        } else if (op.relation === 'blockedBy') {
          task.blockedBy = task.blockedBy || [];
          task.blockedBy.push(op.targetId);
        } else if (op.relation === 'parent') {
          task.parent = op.targetId;
        } else if (op.relation === 'subtask') {
          task.subtasks = task.subtasks || [];
          task.subtasks.push(op.targetId);
        }
        task.updatedAt = op.timestamp;
      }
      break;
    }
  }
}
