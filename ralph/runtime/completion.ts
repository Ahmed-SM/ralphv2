/**
 * Completion Detection — Checks whether a task is complete.
 *
 * Implements the four completion detection strategies from
 * specs/loop-mechanics.md §Completion Detection:
 *
 *   1. Explicit  — LLM / agent declares done (handled outside this module)
 *   2. test_passing — Run `npm test -- --grep "<id>"` (exit 0 = complete)
 *   3. file_exists  — Check that an expected file exists and is non-empty
 *   4. validate     — Run a custom validation script (exit 0 = complete)
 *
 * Each checker returns a CompletionCheckResult indicating pass/fail with
 * an optional reason string.
 */

import type { Task, CompletionCriteria, BashResult } from '../types/index.js';

export interface CompletionCheckResult {
  complete: boolean;
  reason: string;
  artifacts?: string[];
}

/**
 * Abstraction over the sandbox / executor so the module stays testable
 * without needing real filesystem or shell access.
 */
export interface CompletionContext {
  bash(command: string): Promise<BashResult>;
  fileExists(path: string): Promise<boolean>;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Check whether a task's completion criteria are satisfied.
 *
 * Returns `null` when the task has no completion criteria defined,
 * signalling that the caller should fall through to other detection methods
 * (e.g. explicit LLM completion or heuristic).
 */
export async function checkCompletion(
  task: Task,
  ctx: CompletionContext,
): Promise<CompletionCheckResult | null> {
  if (!task.completion) return null;
  return checkCriteria(task.completion, task, ctx);
}

/**
 * Evaluate a single CompletionCriteria against the current environment.
 */
export async function checkCriteria(
  criteria: CompletionCriteria,
  task: Task,
  ctx: CompletionContext,
): Promise<CompletionCheckResult> {
  switch (criteria.type) {
    case 'test_passing':
      return checkTestPassing(criteria, task, ctx);
    case 'file_exists':
      return checkFileExists(criteria, ctx);
    case 'validate':
      return checkValidate(criteria, task, ctx);
    default: {
      // Exhaustiveness guard — if a new criteria type is added to the union
      // TypeScript will flag this at compile time.
      const _exhaustive: never = criteria;
      return {
        complete: false,
        reason: `Unknown completion type: ${(_exhaustive as CompletionCriteria).type}`,
      };
    }
  }
}

// =============================================================================
// STRATEGY: test_passing
// =============================================================================

/**
 * Runs a test command and checks the exit code.
 *
 * Default command: `npm test -- --grep "<grep>"`
 * Custom command:  whatever the task specifies in `criteria.command`.
 *
 * Exit 0 → complete. Anything else → not complete.
 */
export async function checkTestPassing(
  criteria: Extract<CompletionCriteria, { type: 'test_passing' }>,
  task: Task,
  ctx: CompletionContext,
): Promise<CompletionCheckResult> {
  const grep = criteria.grep || task.id;
  const command = criteria.command ?? `npm test -- --grep "${grep}"`;

  try {
    const result = await ctx.bash(command);
    if (result.exitCode === 0) {
      return {
        complete: true,
        reason: `Tests passed: ${command}`,
        artifacts: [],
      };
    }
    return {
      complete: false,
      reason: `Tests failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`.slice(0, 500),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      complete: false,
      reason: `Test command error: ${msg}`,
    };
  }
}

// =============================================================================
// STRATEGY: file_exists
// =============================================================================

/**
 * Checks that the file at `criteria.path` exists.
 */
export async function checkFileExists(
  criteria: Extract<CompletionCriteria, { type: 'file_exists' }>,
  ctx: CompletionContext,
): Promise<CompletionCheckResult> {
  const exists = await ctx.fileExists(criteria.path);
  if (exists) {
    return {
      complete: true,
      reason: `Artifact exists: ${criteria.path}`,
      artifacts: [criteria.path],
    };
  }
  return {
    complete: false,
    reason: `Artifact missing: ${criteria.path}`,
  };
}

// =============================================================================
// STRATEGY: validate
// =============================================================================

/**
 * Runs a custom validation script. Exit 0 means the task is complete.
 *
 * The script receives the task ID as an environment variable RALPH_TASK_ID.
 */
export async function checkValidate(
  criteria: Extract<CompletionCriteria, { type: 'validate' }>,
  task: Task,
  ctx: CompletionContext,
): Promise<CompletionCheckResult> {
  const script = criteria.script;

  try {
    const result = await ctx.bash(`RALPH_TASK_ID=${task.id} ${script}`);
    if (result.exitCode === 0) {
      return {
        complete: true,
        reason: `Validation passed: ${script}`,
        artifacts: result.stdout.trim() ? result.stdout.trim().split('\n') : [],
      };
    }
    return {
      complete: false,
      reason: `Validation failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`.slice(0, 500),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      complete: false,
      reason: `Validation error: ${msg}`,
    };
  }
}

// =============================================================================
// ADAPTER: Create CompletionContext from Executor
// =============================================================================

/**
 * Build a CompletionContext from the standard Executor interface.
 */
export function createCompletionContext(executor: {
  bash(command: string): Promise<BashResult>;
  readFile(path: string): Promise<string>;
}): CompletionContext {
  return {
    bash: (cmd: string) => executor.bash(cmd),
    fileExists: async (path: string) => {
      try {
        const content = await executor.readFile(path);
        return content.length > 0;
      } catch {
        return false;
      }
    },
  };
}
