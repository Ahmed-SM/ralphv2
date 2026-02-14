import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkCompletion,
  checkCriteria,
  checkTestPassing,
  checkFileExists,
  checkValidate,
  createCompletionContext,
  type CompletionContext,
  type CompletionCheckResult,
} from './completion.js';
import type { Task, CompletionCriteria, BashResult } from '../types/index.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: 'A test task',
    status: 'in_progress',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
  return {
    bash: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    fileExists: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function bashSuccess(stdout = ''): BashResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function bashFailure(exitCode = 1, stderr = 'error'): BashResult {
  return { stdout: '', stderr, exitCode };
}

// =============================================================================
// checkCompletion
// =============================================================================

describe('checkCompletion', () => {
  it('returns null when task has no completion criteria', async () => {
    const task = makeTask();
    const ctx = makeContext();
    const result = await checkCompletion(task, ctx);
    expect(result).toBeNull();
  });

  it('returns null when completion is undefined', async () => {
    const task = makeTask({ completion: undefined });
    const ctx = makeContext();
    const result = await checkCompletion(task, ctx);
    expect(result).toBeNull();
  });

  it('delegates to file_exists checker', async () => {
    const task = makeTask({
      completion: { type: 'file_exists', path: './output.ts' },
    });
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(true) });
    const result = await checkCompletion(task, ctx);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(true);
  });

  it('delegates to test_passing checker', async () => {
    const task = makeTask({
      completion: { type: 'test_passing', grep: 'RALPH-001' },
    });
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashSuccess()),
    });
    const result = await checkCompletion(task, ctx);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(true);
  });

  it('delegates to validate checker', async () => {
    const task = makeTask({
      completion: { type: 'validate', script: './validate.sh' },
    });
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashSuccess()),
    });
    const result = await checkCompletion(task, ctx);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(true);
  });
});

// =============================================================================
// checkCriteria — dispatch
// =============================================================================

describe('checkCriteria', () => {
  it('dispatches file_exists criteria', async () => {
    const criteria: CompletionCriteria = { type: 'file_exists', path: './out.ts' };
    const task = makeTask();
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(true) });
    const result = await checkCriteria(criteria, task, ctx);
    expect(result.complete).toBe(true);
    expect(result.artifacts).toContain('./out.ts');
  });

  it('dispatches test_passing criteria', async () => {
    const criteria: CompletionCriteria = { type: 'test_passing', grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({ bash: vi.fn().mockResolvedValue(bashSuccess()) });
    const result = await checkCriteria(criteria, task, ctx);
    expect(result.complete).toBe(true);
  });

  it('dispatches validate criteria', async () => {
    const criteria: CompletionCriteria = { type: 'validate', script: './check.sh' };
    const task = makeTask();
    const ctx = makeContext({ bash: vi.fn().mockResolvedValue(bashSuccess()) });
    const result = await checkCriteria(criteria, task, ctx);
    expect(result.complete).toBe(true);
  });
});

// =============================================================================
// checkTestPassing
// =============================================================================

describe('checkTestPassing', () => {
  it('returns complete when tests pass (exit 0)', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({ bash: vi.fn().mockResolvedValue(bashSuccess('3 tests passed')) });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.complete).toBe(true);
    expect(result.reason).toContain('Tests passed');
    expect(result.artifacts).toEqual([]);
  });

  it('uses default npm test command with grep', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-042' };
    const task = makeTask();
    const bash = vi.fn().mockResolvedValue(bashSuccess());
    const ctx = makeContext({ bash });
    await checkTestPassing(criteria, task, ctx);
    expect(bash).toHaveBeenCalledWith('npm test -- --grep "RALPH-042"');
  });

  it('uses custom command when specified', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001', command: 'vitest run --grep RALPH-001' };
    const task = makeTask();
    const bash = vi.fn().mockResolvedValue(bashSuccess());
    const ctx = makeContext({ bash });
    await checkTestPassing(criteria, task, ctx);
    expect(bash).toHaveBeenCalledWith('vitest run --grep RALPH-001');
  });

  it('falls back to task ID when grep is empty', async () => {
    const criteria = { type: 'test_passing' as const, grep: '' };
    const task = makeTask({ id: 'RALPH-007' });
    const bash = vi.fn().mockResolvedValue(bashSuccess());
    const ctx = makeContext({ bash });
    await checkTestPassing(criteria, task, ctx);
    expect(bash).toHaveBeenCalledWith('npm test -- --grep "RALPH-007"');
  });

  it('returns incomplete when tests fail (exit 1)', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(1, 'FAIL: 2 tests failed')),
    });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('Tests failed');
    expect(result.reason).toContain('exit 1');
  });

  it('includes stderr in failure reason', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(1, 'AssertionError: expected 1 to be 2')),
    });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.reason).toContain('AssertionError');
  });

  it('uses stdout when stderr is empty in failure', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue({ stdout: 'test output', stderr: '', exitCode: 1 }),
    });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.reason).toContain('test output');
  });

  it('handles non-zero exit codes beyond 1', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(137, 'killed')),
    });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('exit 137');
  });

  it('handles bash throwing an error', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockRejectedValue(new Error('Command not found')),
    });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('Test command error');
    expect(result.reason).toContain('Command not found');
  });

  it('handles non-Error throws from bash', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockRejectedValue('string error'),
    });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('Unknown error');
  });

  it('truncates long failure reasons to 500 chars', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'RALPH-001' };
    const task = makeTask();
    const longStderr = 'x'.repeat(1000);
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(1, longStderr)),
    });
    const result = await checkTestPassing(criteria, task, ctx);
    expect(result.reason.length).toBeLessThanOrEqual(500);
  });
});

// =============================================================================
// checkFileExists
// =============================================================================

describe('checkFileExists', () => {
  it('returns complete when file exists', async () => {
    const criteria = { type: 'file_exists' as const, path: './specs/task-schema.md' };
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(true) });
    const result = await checkFileExists(criteria, ctx);
    expect(result.complete).toBe(true);
    expect(result.reason).toContain('Artifact exists');
    expect(result.artifacts).toEqual(['./specs/task-schema.md']);
  });

  it('returns incomplete when file does not exist', async () => {
    const criteria = { type: 'file_exists' as const, path: './output/missing.ts' };
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(false) });
    const result = await checkFileExists(criteria, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('Artifact missing');
    expect(result.reason).toContain('./output/missing.ts');
  });

  it('checks the correct path', async () => {
    const criteria = { type: 'file_exists' as const, path: './dist/bundle.js' };
    const fileExists = vi.fn().mockResolvedValue(false);
    const ctx = makeContext({ fileExists });
    await checkFileExists(criteria, ctx);
    expect(fileExists).toHaveBeenCalledWith('./dist/bundle.js');
  });

  it('includes path in artifacts on success', async () => {
    const criteria = { type: 'file_exists' as const, path: './report.html' };
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(true) });
    const result = await checkFileExists(criteria, ctx);
    expect(result.artifacts).toContain('./report.html');
  });

  it('has no artifacts on failure', async () => {
    const criteria = { type: 'file_exists' as const, path: './nope.txt' };
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(false) });
    const result = await checkFileExists(criteria, ctx);
    expect(result.artifacts).toBeUndefined();
  });
});

// =============================================================================
// checkValidate
// =============================================================================

describe('checkValidate', () => {
  it('returns complete when script exits 0', async () => {
    const criteria = { type: 'validate' as const, script: './skills/validate-001.ts' };
    const task = makeTask({ id: 'RALPH-001' });
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashSuccess()),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.complete).toBe(true);
    expect(result.reason).toContain('Validation passed');
    expect(result.reason).toContain('./skills/validate-001.ts');
  });

  it('passes RALPH_TASK_ID environment variable', async () => {
    const criteria = { type: 'validate' as const, script: './validate.sh' };
    const task = makeTask({ id: 'RALPH-042' });
    const bash = vi.fn().mockResolvedValue(bashSuccess());
    const ctx = makeContext({ bash });
    await checkValidate(criteria, task, ctx);
    expect(bash).toHaveBeenCalledWith('RALPH_TASK_ID=RALPH-042 ./validate.sh');
  });

  it('returns incomplete when script exits non-zero', async () => {
    const criteria = { type: 'validate' as const, script: './check.sh' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(2, 'validation failed')),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('Validation failed');
    expect(result.reason).toContain('exit 2');
  });

  it('captures stdout as artifacts when script succeeds', async () => {
    const criteria = { type: 'validate' as const, script: './validate.sh' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashSuccess('./output/a.ts\n./output/b.ts')),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.complete).toBe(true);
    expect(result.artifacts).toEqual(['./output/a.ts', './output/b.ts']);
  });

  it('returns empty artifacts when stdout is empty on success', async () => {
    const criteria = { type: 'validate' as const, script: './validate.sh' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashSuccess('')),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.artifacts).toEqual([]);
  });

  it('handles script throwing an error', async () => {
    const criteria = { type: 'validate' as const, script: './missing.sh' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockRejectedValue(new Error('ENOENT')),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('Validation error');
    expect(result.reason).toContain('ENOENT');
  });

  it('handles non-Error throws', async () => {
    const criteria = { type: 'validate' as const, script: './bad.sh' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockRejectedValue(42),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('Unknown error');
  });

  it('truncates long failure reasons to 500 chars', async () => {
    const criteria = { type: 'validate' as const, script: './check.sh' };
    const task = makeTask();
    const longOutput = 'y'.repeat(1000);
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(1, longOutput)),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.reason.length).toBeLessThanOrEqual(500);
  });

  it('includes stderr in failure reason', async () => {
    const criteria = { type: 'validate' as const, script: './check.sh' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(1, 'missing field: name')),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.reason).toContain('missing field: name');
  });

  it('uses stdout when stderr is empty in failure', async () => {
    const criteria = { type: 'validate' as const, script: './check.sh' };
    const task = makeTask();
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue({ stdout: 'validation output', stderr: '', exitCode: 1 }),
    });
    const result = await checkValidate(criteria, task, ctx);
    expect(result.reason).toContain('validation output');
  });
});

// =============================================================================
// createCompletionContext
// =============================================================================

describe('createCompletionContext', () => {
  it('creates context with bash passthrough', async () => {
    const bashFn = vi.fn().mockResolvedValue(bashSuccess('hello'));
    const executor = { bash: bashFn, readFile: vi.fn() };
    const ctx = createCompletionContext(executor);
    const result = await ctx.bash('echo hello');
    expect(bashFn).toHaveBeenCalledWith('echo hello');
    expect(result.stdout).toBe('hello');
  });

  it('fileExists returns true when readFile returns non-empty content', async () => {
    const readFile = vi.fn().mockResolvedValue('file content');
    const executor = { bash: vi.fn(), readFile };
    const ctx = createCompletionContext(executor);
    const exists = await ctx.fileExists('./some-file.ts');
    expect(exists).toBe(true);
    expect(readFile).toHaveBeenCalledWith('./some-file.ts');
  });

  it('fileExists returns false when readFile returns empty string', async () => {
    const readFile = vi.fn().mockResolvedValue('');
    const executor = { bash: vi.fn(), readFile };
    const ctx = createCompletionContext(executor);
    const exists = await ctx.fileExists('./empty.ts');
    expect(exists).toBe(false);
  });

  it('fileExists returns false when readFile throws', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const executor = { bash: vi.fn(), readFile };
    const ctx = createCompletionContext(executor);
    const exists = await ctx.fileExists('./missing.ts');
    expect(exists).toBe(false);
  });
});

// =============================================================================
// Integration: checkCompletion + executeTaskLoop wiring
// =============================================================================

describe('checkCompletion integration scenarios', () => {
  it('file_exists: complete when artifact appears after work', async () => {
    const task = makeTask({
      completion: { type: 'file_exists', path: './dist/output.js' },
    });

    // Simulate file appearing
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(true) });
    const result = await checkCompletion(task, ctx);
    expect(result!.complete).toBe(true);
    expect(result!.artifacts).toContain('./dist/output.js');
  });

  it('file_exists: incomplete when artifact is still missing', async () => {
    const task = makeTask({
      completion: { type: 'file_exists', path: './dist/output.js' },
    });
    const ctx = makeContext({ fileExists: vi.fn().mockResolvedValue(false) });
    const result = await checkCompletion(task, ctx);
    expect(result!.complete).toBe(false);
  });

  it('test_passing: complete when task-specific tests pass', async () => {
    const task = makeTask({
      id: 'RALPH-042',
      completion: { type: 'test_passing', grep: 'RALPH-042' },
    });
    const bash = vi.fn().mockResolvedValue(bashSuccess('5 tests passed'));
    const ctx = makeContext({ bash });
    const result = await checkCompletion(task, ctx);
    expect(result!.complete).toBe(true);
    expect(bash).toHaveBeenCalledWith('npm test -- --grep "RALPH-042"');
  });

  it('test_passing: incomplete when tests fail', async () => {
    const task = makeTask({
      completion: { type: 'test_passing', grep: 'RALPH-001' },
    });
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(1, '2 failing')),
    });
    const result = await checkCompletion(task, ctx);
    expect(result!.complete).toBe(false);
  });

  it('validate: complete when custom script passes', async () => {
    const task = makeTask({
      completion: { type: 'validate', script: './scripts/check-output.sh' },
    });
    const bash = vi.fn().mockResolvedValue(bashSuccess('./artifacts/report.pdf'));
    const ctx = makeContext({ bash });
    const result = await checkCompletion(task, ctx);
    expect(result!.complete).toBe(true);
    expect(result!.artifacts).toEqual(['./artifacts/report.pdf']);
  });

  it('validate: incomplete when custom script fails', async () => {
    const task = makeTask({
      completion: { type: 'validate', script: './scripts/check-output.sh' },
    });
    const ctx = makeContext({
      bash: vi.fn().mockResolvedValue(bashFailure(1, 'missing required output')),
    });
    const result = await checkCompletion(task, ctx);
    expect(result!.complete).toBe(false);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('edge cases', () => {
  it('CompletionCheckResult shape has required fields', () => {
    const result: CompletionCheckResult = {
      complete: true,
      reason: 'done',
    };
    expect(result).toHaveProperty('complete');
    expect(result).toHaveProperty('reason');
  });

  it('CompletionCheckResult artifacts is optional', () => {
    const result: CompletionCheckResult = {
      complete: false,
      reason: 'not done',
    };
    expect(result.artifacts).toBeUndefined();
  });

  it('test_passing with custom command ignores grep entirely', async () => {
    const criteria = { type: 'test_passing' as const, grep: 'ignored', command: 'pytest -k test_foo' };
    const task = makeTask();
    const bash = vi.fn().mockResolvedValue(bashSuccess());
    const ctx = makeContext({ bash });
    await checkTestPassing(criteria, task, ctx);
    expect(bash).toHaveBeenCalledWith('pytest -k test_foo');
  });

  it('file_exists with empty path still calls fileExists', async () => {
    const criteria = { type: 'file_exists' as const, path: '' };
    const fileExists = vi.fn().mockResolvedValue(false);
    const ctx = makeContext({ fileExists });
    await checkFileExists(criteria, ctx);
    expect(fileExists).toHaveBeenCalledWith('');
  });

  it('validate with complex script path works', async () => {
    const criteria = { type: 'validate' as const, script: 'node ./scripts/validate.js --strict' };
    const task = makeTask({ id: 'RALPH-100' });
    const bash = vi.fn().mockResolvedValue(bashSuccess());
    const ctx = makeContext({ bash });
    await checkValidate(criteria, task, ctx);
    expect(bash).toHaveBeenCalledWith('RALPH_TASK_ID=RALPH-100 node ./scripts/validate.js --strict');
  });
});
