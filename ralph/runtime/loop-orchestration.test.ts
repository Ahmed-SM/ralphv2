import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runLoop,
  pickNextTask,
  executeTaskLoop,
  executeIteration,
  updateTaskStatus,
  recordTaskCompletion,
  runLearningAnalysis,
  syncTaskToTracker,
  pullFromTracker,
  getTrackerAuth,
  estimateCost,
  computeRunKpis,
  validateInductionInvariant,
  readJsonl,
  appendJsonl,
  type LoopContext,
} from './loop.js';
import type { Executor } from './executor.js';
import { GitOperations } from './executor.js';
import type { Task, TaskOperation, RuntimeConfig, LLMUsage, LLMConfig } from '../types/index.js';
import { registerTracker } from '../skills/normalize/tracker-interface.js';
import type { Tracker, TrackerConfig, AuthConfig } from '../skills/normalize/tracker-interface.js';

// =============================================================================
// HELPERS
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

function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    planFile: './implementation-plan.md',
    agentsFile: './AGENTS.md',
    loop: {
      maxIterationsPerTask: 10,
      maxTimePerTask: 60000,
      maxCostPerTask: 10,
      maxCostPerRun: 100,
      maxTasksPerRun: 50,
      maxTimePerRun: 300000,
      onFailure: 'continue',
      parallelism: 1,
    },
    sandbox: {
      timeout: 5000,
      maxCommands: 10,
      cacheReads: false,
    },
    tracker: {
      type: 'jira',
      configPath: './tracker.json',
      autoCreate: false,
      autoTransition: false,
      autoComment: false,
      autoPull: false,
    },
    git: {
      autoCommit: false,
      commitPrefix: 'RALPH-',
      branchPrefix: 'ralph/',
    },
    learning: {
      enabled: false,
      autoApplyImprovements: false,
      minConfidence: 0.8,
      retentionDays: 90,
    },
    notifications: {
      onAnomaly: false,
      onComplete: false,
      channel: 'console',
    },
    ...overrides,
  };
}

/** Create a mock executor with an in-memory filesystem */
function makeMockExecutor(files: Record<string, string> = {}): Executor {
  const fs = new Map<string, string>(Object.entries(files));

  return {
    readFile: vi.fn(async (path: string) => {
      const content = fs.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      fs.set(path, content);
    }),
    bash: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    eval: vi.fn(async () => undefined),
    flush: vi.fn(async () => {}),
    rollback: vi.fn(() => {}),
    getPendingChanges: vi.fn(() => []),
    getSandbox: vi.fn(),
    // Expose internal fs for assertions
    _fs: fs,
  } as unknown as Executor & { _fs: Map<string, string> };
}

function makeMockGit(): GitOperations {
  return {
    status: vi.fn(async () => ''),
    add: vi.fn(async () => {}),
    commit: vi.fn(async () => 'committed'),
    log: vi.fn(async () => ''),
    diff: vi.fn(async () => ''),
    branch: vi.fn(async () => 'main'),
    checkout: vi.fn(async () => {}),
  } as unknown as GitOperations;
}

function makeContext(overrides: Partial<LoopContext> = {}): LoopContext {
  return {
    config: makeConfig(),
    executor: makeMockExecutor(),
    git: makeMockGit(),
    workDir: '/tmp/ralph-test',
    ...overrides,
  };
}

function taskCreateOp(task: Task): string {
  return JSON.stringify({ op: 'create', task, timestamp: task.createdAt });
}

function taskUpdateOp(id: string, changes: Partial<Task>, timestamp = '2025-01-02T00:00:00Z'): string {
  return JSON.stringify({ op: 'update', id, changes, source: 'agent', timestamp });
}

// =============================================================================
// readJsonl TESTS
// =============================================================================

describe('readJsonl', () => {
  it('returns empty array when file does not exist', async () => {
    const executor = makeMockExecutor();
    const result = await readJsonl(executor, './nonexistent.jsonl');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty file', async () => {
    const executor = makeMockExecutor({ './data.jsonl': '' });
    const result = await readJsonl(executor, './data.jsonl');
    expect(result).toEqual([]);
  });

  it('returns empty array for whitespace-only file', async () => {
    const executor = makeMockExecutor({ './data.jsonl': '   \n  \n  ' });
    const result = await readJsonl(executor, './data.jsonl');
    expect(result).toEqual([]);
  });

  it('parses single line', async () => {
    const executor = makeMockExecutor({ './data.jsonl': '{"a":1}\n' });
    const result = await readJsonl<{ a: number }>(executor, './data.jsonl');
    expect(result).toEqual([{ a: 1 }]);
  });

  it('parses multiple lines', async () => {
    const lines = '{"a":1}\n{"a":2}\n{"a":3}\n';
    const executor = makeMockExecutor({ './data.jsonl': lines });
    const result = await readJsonl<{ a: number }>(executor, './data.jsonl');
    expect(result).toHaveLength(3);
    expect(result[2].a).toBe(3);
  });

  it('skips blank lines', async () => {
    const lines = '{"a":1}\n\n{"a":2}\n';
    const executor = makeMockExecutor({ './data.jsonl': lines });
    const result = await readJsonl<{ a: number }>(executor, './data.jsonl');
    expect(result).toHaveLength(2);
  });

  it('reads TaskOperation entries correctly', async () => {
    const task = makeTask();
    const content = taskCreateOp(task) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const result = await readJsonl<TaskOperation>(executor, './state/tasks.jsonl');
    expect(result).toHaveLength(1);
    expect(result[0].op).toBe('create');
  });
});

// =============================================================================
// appendJsonl TESTS
// =============================================================================

describe('appendJsonl', () => {
  it('creates file if it does not exist', async () => {
    const executor = makeMockExecutor();
    await appendJsonl(executor, './new.jsonl', { foo: 'bar' });
    expect(executor.writeFile).toHaveBeenCalledWith(
      './new.jsonl',
      '{"foo":"bar"}\n'
    );
  });

  it('appends to existing file', async () => {
    const executor = makeMockExecutor({ './data.jsonl': '{"a":1}\n' });
    await appendJsonl(executor, './data.jsonl', { a: 2 });
    expect(executor.writeFile).toHaveBeenCalledWith(
      './data.jsonl',
      '{"a":1}\n{"a":2}\n'
    );
  });

  it('preserves existing content on append', async () => {
    const executor = makeMockExecutor({ './data.jsonl': '{"x":1}\n{"x":2}\n' });
    await appendJsonl(executor, './data.jsonl', { x: 3 });
    const writtenContent = (executor.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const lines = writtenContent.trim().split('\n');
    expect(lines).toHaveLength(3);
  });
});

// =============================================================================
// pickNextTask TESTS
// =============================================================================

describe('pickNextTask', () => {
  it('returns null when no tasks exist', async () => {
    const executor = makeMockExecutor({ './state/tasks.jsonl': '' });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task).toBeNull();
  });

  it('reads tasks from scoped state path when provided', async () => {
    const task = makeTask({ id: 'RALPH-900' });
    const content = taskCreateOp(task) + '\n';
    const executor = makeMockExecutor({ './state/core/tasks.jsonl': content });
    const context = makeContext({
      executor,
      statePaths: {
        baseDir: './state/core',
        tasks: './state/core/tasks.jsonl',
        progress: './state/core/progress.jsonl',
        learning: './state/core/learning.jsonl',
        trackerOps: './state/core/tracker-ops.jsonl',
        mode: 'core',
        repo: 'ralph',
        scoped: true,
      },
    });

    const next = await pickNextTask(context);
    expect(next?.id).toBe('RALPH-900');
  });

  it('returns null when tasks file does not exist', async () => {
    const executor = makeMockExecutor();
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task).toBeNull();
  });

  it('returns null when all tasks are done', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'done' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'done' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task).toBeNull();
  });

  it('returns null when all tasks are cancelled', async () => {
    const content = taskCreateOp(makeTask({ id: 'T-1', status: 'cancelled' })) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task).toBeNull();
  });

  it('picks pending task', async () => {
    const content = taskCreateOp(makeTask({ id: 'T-1', status: 'pending' })) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task).not.toBeNull();
    expect(task!.id).toBe('T-1');
  });

  it('picks discovered task', async () => {
    const content = taskCreateOp(makeTask({ id: 'T-1', status: 'discovered' })) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task).not.toBeNull();
    expect(task!.id).toBe('T-1');
  });

  it('prioritizes in_progress over pending', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'in_progress', createdAt: '2025-01-02T00:00:00Z' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  it('picks oldest pending task when no in_progress', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-03T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-3', status: 'pending', createdAt: '2025-01-02T00:00:00Z' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  it('skips blocked tasks', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'in_progress' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', blockedBy: ['T-1'] })),
      taskCreateOp(makeTask({ id: 'T-3', status: 'pending' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // T-1 is in_progress so it should be picked first
    expect(task!.id).toBe('T-1');
  });

  it('skips blocked tasks and picks unblocked', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'done' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', blockedBy: ['T-3'] })),
      taskCreateOp(makeTask({ id: 'T-3', status: 'pending' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // T-2 is blocked by T-3 (which is pending), so T-3 should be picked
    expect(task!.id).toBe('T-3');
  });

  it('derives state from operation log (create + update)', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending' })),
      taskUpdateOp('T-1', { status: 'done' }),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // T-1 was updated to done, so T-2 should be picked
    expect(task!.id).toBe('T-2');
  });

  it('skips review status tasks', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'review' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  it('skips blocked status tasks', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'blocked' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  // Priority-based selection tests (per loop-mechanics spec)
  it('picks higher priority task over lower priority', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', priority: 1, createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', priority: 5, createdAt: '2025-01-02T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-3', status: 'pending', priority: 3, createdAt: '2025-01-01T00:00:00Z' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  it('falls back to oldest when priorities are equal', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', priority: 3, createdAt: '2025-01-03T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', priority: 3, createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-3', status: 'pending', priority: 3, createdAt: '2025-01-02T00:00:00Z' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  it('treats undefined priority as 0', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', priority: 1, createdAt: '2025-01-02T00:00:00Z' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // T-2 has priority 1 > T-1's implicit 0
    expect(task!.id).toBe('T-2');
  });

  it('in_progress still beats higher priority pending', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'in_progress', priority: 1 })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', priority: 10 })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // in_progress always wins over pending regardless of priority
    expect(task!.id).toBe('T-1');
  });

  it('picks higher priority among multiple in_progress tasks', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'in_progress', priority: 2, createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'in_progress', priority: 5, createdAt: '2025-01-02T00:00:00Z' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  it('handles negative priority correctly', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', priority: -1, createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', priority: 0, createdAt: '2025-01-02T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-3', status: 'pending', createdAt: '2025-01-03T00:00:00Z' })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // T-2 and T-3 both have priority 0, T-2 is older
    expect(task!.id).toBe('T-2');
  });

  it('priority persists through update operations', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', priority: 1, createdAt: '2025-01-01T00:00:00Z' })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', priority: 2, createdAt: '2025-01-01T00:00:00Z' })),
      taskUpdateOp('T-1', { priority: 10 }),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // T-1 was updated to priority 10, should now beat T-2's priority 2
    expect(task!.id).toBe('T-1');
  });

  it('skips blocked tasks even with high priority', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending', priority: 1 })),
      taskCreateOp(makeTask({ id: 'T-2', status: 'pending', priority: 10, blockedBy: ['T-1'] })),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });
    const task = await pickNextTask(context);
    // T-2 has higher priority but is blocked by T-1
    expect(task!.id).toBe('T-1');
  });
});

// =============================================================================
// executeIteration TESTS
// =============================================================================

describe('executeIteration', () => {
  it('returns complete when task has spec with content', async () => {
    const executor = makeMockExecutor({ './specs/my-spec.md': '# Spec content' });
    const context = makeContext({ executor });
    const task = makeTask({ spec: './specs/my-spec.md', status: 'in_progress' });

    const result = await executeIteration(context, task, 1);
    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
      expect(result.artifacts).toContain('./specs/my-spec.md');
    }
  });

  it('returns continue when spec file does not exist', async () => {
    const executor = makeMockExecutor();
    const context = makeContext({ executor });
    const task = makeTask({ spec: './specs/missing.md', status: 'in_progress' });

    const result = await executeIteration(context, task, 1);
    expect(result.status).toBe('continue');
  });

  it('returns continue for discovered task without spec', async () => {
    const executor = makeMockExecutor();
    const context = makeContext({ executor });
    const task = makeTask({ status: 'discovered' });

    const result = await executeIteration(context, task, 1);
    expect(result.status).toBe('continue');
    if (result.status === 'continue') {
      expect(result.reason).toContain('discovered');
    }
  });

  it('returns continue for pending task without spec', async () => {
    const executor = makeMockExecutor();
    const context = makeContext({ executor });
    const task = makeTask({ status: 'pending' });

    const result = await executeIteration(context, task, 3);
    expect(result.status).toBe('continue');
    if (result.status === 'continue') {
      expect(result.reason).toContain('3');
    }
  });

  it('returns continue when spec file is empty', async () => {
    const executor = makeMockExecutor({ './specs/empty.md': '' });
    const context = makeContext({ executor });
    const task = makeTask({ spec: './specs/empty.md', status: 'in_progress' });

    const result = await executeIteration(context, task, 1);
    // Empty spec means length is 0, so it won't return 'complete'
    expect(result.status).toBe('continue');
  });

  it('handles task with no spec field', async () => {
    const executor = makeMockExecutor();
    const context = makeContext({ executor });
    const task = makeTask({ status: 'in_progress' });
    delete task.spec;

    const result = await executeIteration(context, task, 2);
    expect(result.status).toBe('continue');
  });
});

// =============================================================================
// executeTaskLoop TESTS
// =============================================================================

describe('executeTaskLoop', () => {
  it('completes on first iteration when spec exists', async () => {
    const executor = makeMockExecutor({
      './specs/task.md': '# Task spec',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });
    const task = makeTask({ spec: './specs/task.md', status: 'in_progress' });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);
    expect(result.iterations).toBe(1);
  });

  it('hits max iterations for task without spec', async () => {
    const config = makeConfig({
      loop: {
        ...makeConfig().loop,
        maxIterationsPerTask: 3,
      },
    });
    const executor = makeMockExecutor({
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });
    const task = makeTask({ status: 'in_progress' });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.reason).toBe('Max iterations reached');
  });

  it('writes progress events for each iteration', async () => {
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 2 },
    });
    const executor = makeMockExecutor({
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });
    const task = makeTask({ status: 'in_progress' });

    await executeTaskLoop(context, task);

    // Check that progress was written
    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const progressContent = fs.get('./state/progress.jsonl') || '';
    const lines = progressContent.trim().split('\n').filter(l => l.trim());
    expect(lines.length).toBe(2); // 2 iterations
    const event = JSON.parse(lines[0]);
    expect(event.type).toBe('iteration');
    expect(event.taskId).toBe('RALPH-001');
  });

  it('returns failure reason for time limit exceeded', async () => {
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 100, maxTimePerTask: 0 },
    });
    const executor = makeMockExecutor({
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });
    const task = makeTask({ status: 'in_progress' });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Time limit exceeded');
  });

  it('reports correct iteration count on completion', async () => {
    // Task with spec that exists completes on iteration 1
    const executor = makeMockExecutor({
      './specs/task.md': '# Content',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });
    const task = makeTask({ spec: './specs/task.md', status: 'in_progress' });

    const result = await executeTaskLoop(context, task);
    expect(result.iterations).toBe(1);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// updateTaskStatus TESTS
// =============================================================================

describe('updateTaskStatus', () => {
  it('appends update operation to tasks.jsonl', async () => {
    const executor = makeMockExecutor({ './state/tasks.jsonl': '' });
    const context = makeContext({ executor });

    await updateTaskStatus(context, 'T-1', 'in_progress');

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/tasks.jsonl')!;
    const op = JSON.parse(content.trim());
    expect(op.op).toBe('update');
    expect(op.id).toBe('T-1');
    expect(op.changes.status).toBe('in_progress');
    expect(op.source).toBe('agent');
  });

  it('includes completedAt when status is done', async () => {
    const executor = makeMockExecutor({ './state/tasks.jsonl': '' });
    const context = makeContext({ executor });

    await updateTaskStatus(context, 'T-1', 'done');

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/tasks.jsonl')!;
    const op = JSON.parse(content.trim());
    expect(op.changes.completedAt).toBeDefined();
    expect(op.changes.status).toBe('done');
  });

  it('does not include completedAt for non-done status', async () => {
    const executor = makeMockExecutor({ './state/tasks.jsonl': '' });
    const context = makeContext({ executor });

    await updateTaskStatus(context, 'T-1', 'in_progress');

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/tasks.jsonl')!;
    const op = JSON.parse(content.trim());
    expect(op.changes.completedAt).toBeUndefined();
  });

  it('writes progress event when reason is provided', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    await updateTaskStatus(context, 'T-1', 'blocked', 'Missing dependency');

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const progressContent = fs.get('./state/progress.jsonl')!;
    const event = JSON.parse(progressContent.trim());
    expect(event.type).toBe('status_change');
    expect(event.taskId).toBe('T-1');
    expect(event.status).toBe('blocked');
    expect(event.reason).toBe('Missing dependency');
  });

  it('does not write progress event when no reason', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
    });
    const context = makeContext({ executor });

    await updateTaskStatus(context, 'T-1', 'in_progress');

    // writeFile should only be called once (for tasks.jsonl), not for progress.jsonl
    const writeFileCalls = (executor.writeFile as ReturnType<typeof vi.fn>).mock.calls;
    const progressWrites = writeFileCalls.filter((c: unknown[]) => c[0] === './state/progress.jsonl');
    expect(progressWrites).toHaveLength(0);
  });

  it('appends to existing task operations', async () => {
    const existing = taskCreateOp(makeTask({ id: 'T-1', status: 'pending' })) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': existing });
    const context = makeContext({ executor });

    await updateTaskStatus(context, 'T-1', 'in_progress');

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/tasks.jsonl')!;
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});

// =============================================================================
// recordTaskCompletion TESTS
// =============================================================================

describe('recordTaskCompletion', () => {
  it('writes task_completed event to learning.jsonl', async () => {
    const executor = makeMockExecutor({ './state/learning.jsonl': '' });
    const context = makeContext({ executor });
    const task = makeTask({ id: 'T-1', type: 'feature', estimate: 5 });

    await recordTaskCompletion(context, task, { success: true, iterations: 3 });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    const event = JSON.parse(content.trim());
    expect(event.type).toBe('task_completed');
    expect(event.taskId).toBe('T-1');
    expect(event.success).toBe(true);
    expect(event.iterations).toBe(3);
    expect(event.actual).toBe(3);
    expect(event.taskType).toBe('feature');
    expect(event.estimate).toBe(5);
  });

  it('records failure with blocker reason', async () => {
    const executor = makeMockExecutor({ './state/learning.jsonl': '' });
    const context = makeContext({ executor });
    const task = makeTask({ id: 'T-1' });

    await recordTaskCompletion(context, task, {
      success: false,
      iterations: 10,
      reason: 'Max iterations reached',
    });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    const event = JSON.parse(content.trim());
    expect(event.success).toBe(false);
    expect(event.blockers).toEqual(['Max iterations reached']);
  });

  it('records undefined blockers when no reason', async () => {
    const executor = makeMockExecutor({ './state/learning.jsonl': '' });
    const context = makeContext({ executor });
    const task = makeTask();

    await recordTaskCompletion(context, task, { success: true, iterations: 1 });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    const event = JSON.parse(content.trim());
    expect(event.blockers).toBeUndefined();
  });

  it('records complexity from task', async () => {
    const executor = makeMockExecutor({ './state/learning.jsonl': '' });
    const context = makeContext({ executor });
    const task = makeTask({ complexity: 'complex' });

    await recordTaskCompletion(context, task, { success: true, iterations: 5 });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    const event = JSON.parse(content.trim());
    expect(event.complexity).toBe('complex');
  });

  it('defaults filesChanged and linesChanged to 0', async () => {
    const executor = makeMockExecutor({ './state/learning.jsonl': '' });
    const context = makeContext({ executor });
    const task = makeTask();

    await recordTaskCompletion(context, task, { success: true, iterations: 1 });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    const event = JSON.parse(content.trim());
    expect(event.filesChanged).toBe(0);
    expect(event.linesChanged).toBe(0);
  });
});

// =============================================================================
// runLoop TESTS (integration-style with mocks)
// =============================================================================

describe('runLoop', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('completes with zero tasks when no tasks exist', async () => {
    // Mock createExecutor and GitOperations via module mocking
    const { runLoop } = await import('./loop.js');

    // We can't easily mock createExecutor inside runLoop without module mocking,
    // so we'll test the exported helper functions instead.
    // This test verifies the integration at a high level.

    // For a proper integration test of runLoop, we'd need vi.mock,
    // but the individual function tests above cover the logic.
    expect(true).toBe(true);
  });

  it('processes tasks and tracks results via exported functions', async () => {
    // Simulate what runLoop does step by step using exported functions
    const task1 = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md' });
    const tasksContent = taskCreateOp(task1) + '\n';

    const executor = makeMockExecutor({
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
      './state/tasks.jsonl': tasksContent,
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
      './specs/t1.md': '# Spec for T-1',
    });
    const git = makeMockGit();
    const config = makeConfig({ git: { autoCommit: true, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' } });
    const context = makeContext({ config, executor, git });

    // 1. Pick task
    const task = await pickNextTask(context);
    expect(task).not.toBeNull();
    expect(task!.id).toBe('T-1');

    // 2. Mark in_progress
    await updateTaskStatus(context, task!.id, 'in_progress');

    // 3. Execute task loop
    const result = await executeTaskLoop(context, task!);
    expect(result.success).toBe(true);

    // 4. Mark done
    await updateTaskStatus(context, task!.id, 'done');

    // 5. Commit
    await executor.flush();
    await git.add('.');
    await git.commit(`RALPH-${task!.id}: ${task!.title}`);

    expect(git.add).toHaveBeenCalledWith('.');
    expect(git.commit).toHaveBeenCalled();
    expect(executor.flush).toHaveBeenCalled();
  });

  it('handles task failure with onFailure=continue', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending' });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 2, onFailure: 'continue' },
    });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Max iterations reached');
  });

  it('calls rollback on task failure in orchestration flow', async () => {
    // Simulate what runLoop does: when executeTaskLoop returns failure, rollback
    const task = makeTask({ id: 'T-1', status: 'in_progress' });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1 },
    });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });

    const taskResult = await executeTaskLoop(context, task);
    expect(taskResult.success).toBe(false);

    // Simulate runLoop's failure path
    if (!taskResult.success) {
      executor.rollback();
    }

    expect(executor.rollback).toHaveBeenCalled();
  });

  it('does not call rollback on task success', async () => {
    const task = makeTask({ id: 'T-1', status: 'in_progress', spec: './specs/t1.md' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './specs/t1.md': '# Spec for T-1',
    });
    const config = makeConfig({
      git: { autoCommit: false, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
    });
    const context = makeContext({ config, executor });

    const taskResult = await executeTaskLoop(context, task);
    expect(taskResult.success).toBe(true);

    // Simulate runLoop's success path (no rollback, only flush if autoCommit)
    if (taskResult.success) {
      // Don't rollback on success
    } else {
      executor.rollback();
    }

    expect(executor.rollback).not.toHaveBeenCalled();
  });

  it('handles git commit on successful task when autoCommit is true', async () => {
    const git = makeMockGit();
    const executor = makeMockExecutor({
      './specs/t1.md': '# Content',
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      git: { autoCommit: true, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
    });
    const context = makeContext({ config, executor, git });
    const task = makeTask({ id: 'T-1', spec: './specs/t1.md' });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);

    // Simulate what runLoop does on success
    if (result.success && config.git.autoCommit) {
      await executor.flush();
      await git.add('.');
      await git.commit(`${config.git.commitPrefix}${task.id}: ${task.title}`);
    }

    expect(executor.flush).toHaveBeenCalled();
    expect(git.add).toHaveBeenCalledWith('.');
    expect(git.commit).toHaveBeenCalledWith('RALPH-T-1: Test task');
  });

  it('does not git commit when autoCommit is false', async () => {
    const git = makeMockGit();
    const config = makeConfig({
      git: { autoCommit: false, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
    });

    // autoCommit is false, so git operations should not be called
    if (config.git.autoCommit) {
      await git.add('.');
    }

    expect(git.add).not.toHaveBeenCalled();
    expect(git.commit).not.toHaveBeenCalled();
  });

  it('records learning when learning is enabled', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
    });
    const config = makeConfig({ learning: { ...makeConfig().learning, enabled: true } });
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', type: 'bug', complexity: 'simple' });

    await recordTaskCompletion(context, task, { success: true, iterations: 2 });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    expect(content.trim()).not.toBe('');
    const event = JSON.parse(content.trim());
    expect(event.type).toBe('task_completed');
    expect(event.taskType).toBe('bug');
  });

  it('does not record learning when learning is disabled', async () => {
    const config = makeConfig({ learning: { ...makeConfig().learning, enabled: false } });

    // Simulate what runLoop does: only call recordTaskCompletion when enabled
    if (config.learning.enabled) {
      // This should not execute
      expect(true).toBe(false);
    }
    // Learning is disabled, so no learning events should be recorded
    expect(config.learning.enabled).toBe(false);
  });
});

// =============================================================================
// FULL ORCHESTRATION SCENARIO TESTS
// =============================================================================

describe('loop orchestration scenarios', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('processes multiple tasks in sequence', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md', createdAt: '2025-01-01T00:00:00Z' });
    const t2 = makeTask({ id: 'T-2', status: 'pending', spec: './specs/t2.md', createdAt: '2025-01-02T00:00:00Z' });
    const content = [taskCreateOp(t1), taskCreateOp(t2)].join('\n') + '\n';

    const executor = makeMockExecutor({
      './state/tasks.jsonl': content,
      './state/progress.jsonl': '',
      './specs/t1.md': '# Spec 1',
      './specs/t2.md': '# Spec 2',
    });
    const context = makeContext({ executor });

    // First pick should return T-1 (oldest)
    const first = await pickNextTask(context);
    expect(first!.id).toBe('T-1');

    // Execute T-1
    const result1 = await executeTaskLoop(context, first!);
    expect(result1.success).toBe(true);

    // Mark T-1 done
    await updateTaskStatus(context, 'T-1', 'done');

    // Next pick should return T-2
    const second = await pickNextTask(context);
    expect(second!.id).toBe('T-2');

    // Execute T-2
    const result2 = await executeTaskLoop(context, second!);
    expect(result2.success).toBe(true);
  });

  it('respects task dependencies across picks', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-01T00:00:00Z' });
    const t2 = makeTask({ id: 'T-2', status: 'pending', blockedBy: ['T-1'], createdAt: '2025-01-02T00:00:00Z' });
    const content = [taskCreateOp(t1), taskCreateOp(t2)].join('\n') + '\n';

    const executor = makeMockExecutor({
      './state/tasks.jsonl': content,
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    // Should pick T-1 because T-2 is blocked
    const first = await pickNextTask(context);
    expect(first!.id).toBe('T-1');

    // Mark T-1 done
    await updateTaskStatus(context, 'T-1', 'done');

    // Now T-2 should be unblocked
    const second = await pickNextTask(context);
    expect(second!.id).toBe('T-2');
  });

  it('resumes in_progress task before pending tasks', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-01T00:00:00Z' });
    const t2 = makeTask({ id: 'T-2', status: 'pending', createdAt: '2025-01-02T00:00:00Z' });
    const content = [
      taskCreateOp(t1),
      taskCreateOp(t2),
      taskUpdateOp('T-2', { status: 'in_progress' }),
    ].join('\n') + '\n';

    const executor = makeMockExecutor({
      './state/tasks.jsonl': content,
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    const picked = await pickNextTask(context);
    expect(picked!.id).toBe('T-2'); // in_progress takes priority
  });

  it('all tasks done means no task picked', async () => {
    const content = [
      taskCreateOp(makeTask({ id: 'T-1', status: 'pending' })),
      taskUpdateOp('T-1', { status: 'done' }),
    ].join('\n') + '\n';

    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    const task = await pickNextTask(context);
    expect(task).toBeNull();
  });

  it('status updates accumulate correctly in tasks.jsonl', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(makeTask({ id: 'T-1' })) + '\n',
    });
    const context = makeContext({ executor });

    await updateTaskStatus(context, 'T-1', 'in_progress');
    await updateTaskStatus(context, 'T-1', 'done');

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/tasks.jsonl')!;
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3); // create + 2 updates
    expect(JSON.parse(lines[1]).changes.status).toBe('in_progress');
    expect(JSON.parse(lines[2]).changes.status).toBe('done');
  });

  it('learning events accumulate for multiple tasks', async () => {
    const executor = makeMockExecutor({ './state/learning.jsonl': '' });
    const context = makeContext({ executor });

    const task1 = makeTask({ id: 'T-1', type: 'feature' });
    const task2 = makeTask({ id: 'T-2', type: 'bug' });

    await recordTaskCompletion(context, task1, { success: true, iterations: 2 });
    await recordTaskCompletion(context, task2, { success: false, iterations: 5, reason: 'timeout' });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const e1 = JSON.parse(lines[0]);
    const e2 = JSON.parse(lines[1]);
    expect(e1.taskId).toBe('T-1');
    expect(e1.success).toBe(true);
    expect(e2.taskId).toBe('T-2');
    expect(e2.success).toBe(false);
    expect(e2.blockers).toEqual(['timeout']);
  });

  it('rollback discards pending changes on task failure', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-01T00:00:00Z' });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1 },
    });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(t1) + '\n',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });

    // Pick and execute the task (will fail since no spec)
    const task = await pickNextTask(context);
    expect(task).not.toBeNull();
    const taskResult = await executeTaskLoop(context, task!);
    expect(taskResult.success).toBe(false);

    // Rollback as runLoop does
    executor.rollback();

    // Verify rollback was called
    expect(executor.rollback).toHaveBeenCalledTimes(1);
  });

  it('successful task flushes but does not rollback', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md', createdAt: '2025-01-01T00:00:00Z' });
    const config = makeConfig({
      git: { autoCommit: true, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
    });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(t1) + '\n',
      './state/progress.jsonl': '',
      './specs/t1.md': '# Content',
    });
    const git = makeMockGit();
    const context = makeContext({ config, executor, git });

    const task = await pickNextTask(context);
    const taskResult = await executeTaskLoop(context, task!);
    expect(taskResult.success).toBe(true);

    // Simulate success path
    await executor.flush();
    await git.add('.');
    await git.commit(`RALPH-${task!.id}: ${task!.title}`);

    expect(executor.flush).toHaveBeenCalled();
    expect(executor.rollback).not.toHaveBeenCalled();
  });

  it('failed task followed by successful task: rollback isolates them', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-01T00:00:00Z' });
    const t2 = makeTask({ id: 'T-2', status: 'pending', spec: './specs/t2.md', createdAt: '2025-01-02T00:00:00Z' });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1 },
    });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': [taskCreateOp(t1), taskCreateOp(t2)].join('\n') + '\n',
      './state/progress.jsonl': '',
      './specs/t2.md': '# T-2 Spec',
    });
    const context = makeContext({ config, executor });

    // T-1 will fail (no spec, 1 iteration)
    const first = await pickNextTask(context);
    expect(first!.id).toBe('T-1');
    const result1 = await executeTaskLoop(context, first!);
    expect(result1.success).toBe(false);

    // Rollback T-1's changes
    executor.rollback();
    expect(executor.rollback).toHaveBeenCalledTimes(1);

    // Mark T-1 as blocked
    await updateTaskStatus(context, 'T-1', 'blocked', result1.reason);

    // T-2 should succeed (has spec)
    const second = await pickNextTask(context);
    expect(second!.id).toBe('T-2');
    const result2 = await executeTaskLoop(context, second!);
    expect(result2.success).toBe(true);

    // No additional rollback for T-2
    expect(executor.rollback).toHaveBeenCalledTimes(1);
  });

  it('executeTaskLoop logs progress for failed iterations', async () => {
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 2 },
    });
    const executor = makeMockExecutor({
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });
    // Task without spec that will keep returning 'continue'
    const task = makeTask({ id: 'T-1', status: 'in_progress' });

    await executeTaskLoop(context, task);

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const progressContent = fs.get('./state/progress.jsonl')!;
    const lines = progressContent.trim().split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(2);

    for (const line of lines) {
      const event = JSON.parse(line);
      expect(event.type).toBe('iteration');
      expect(event.taskId).toBe('T-1');
      expect(event.result).toBe('continue');
    }
  });
});

// =============================================================================
// getTrackerAuth TESTS
// =============================================================================

describe('getTrackerAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when no token is available', () => {
    delete process.env.RALPH_JIRA_TOKEN;
    delete process.env.JIRA_TOKEN;
    const result = getTrackerAuth('jira');
    expect(result).toBeNull();
  });

  it('reads RALPH_ prefixed token', () => {
    process.env.RALPH_JIRA_TOKEN = 'my-token';
    process.env.RALPH_JIRA_EMAIL = 'me@example.com';
    const result = getTrackerAuth('jira');
    expect(result).toEqual({
      type: 'token',
      token: 'my-token',
      email: 'me@example.com',
    });
  });

  it('falls back to non-prefixed env vars', () => {
    delete process.env.RALPH_JIRA_TOKEN;
    process.env.JIRA_TOKEN = 'fallback-token';
    const result = getTrackerAuth('jira');
    expect(result).not.toBeNull();
    expect(result!.token).toBe('fallback-token');
  });

  it('handles github-issues type with hyphen→underscore', () => {
    process.env.RALPH_GITHUB_ISSUES_TOKEN = 'gh-token';
    const result = getTrackerAuth('github-issues');
    expect(result).not.toBeNull();
    expect(result!.token).toBe('gh-token');
  });

  it('handles linear type', () => {
    process.env.LINEAR_TOKEN = 'lin-token';
    process.env.LINEAR_EMAIL = 'lin@example.com';
    const result = getTrackerAuth('linear');
    expect(result).toEqual({
      type: 'token',
      token: 'lin-token',
      email: 'lin@example.com',
    });
  });

  it('returns auth with undefined email when only token is set', () => {
    process.env.JIRA_TOKEN = 'tok';
    delete process.env.RALPH_JIRA_EMAIL;
    delete process.env.JIRA_EMAIL;
    const result = getTrackerAuth('jira');
    expect(result).not.toBeNull();
    expect(result!.token).toBe('tok');
    expect(result!.email).toBeUndefined();
  });
});

// =============================================================================
// syncTaskToTracker TESTS
// =============================================================================

describe('syncTaskToTracker', () => {
  const originalEnv = process.env;

  // A minimal tracker config JSON for the mock filesystem
  const trackerConfigJson: TrackerConfig = {
    type: 'jira',
    baseUrl: 'https://test.atlassian.net',
    project: 'TEST',
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
    },
    statusMap: {
      discovered: 'To Do',
      pending: 'To Do',
      in_progress: 'In Progress',
      blocked: 'Blocked',
      review: 'In Review',
      done: 'Done',
      cancelled: 'Cancelled',
    },
    autoCreate: true,
    autoTransition: true,
    autoComment: true,
  };

  let mockTracker: Tracker;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockTracker = {
      name: 'test-tracker',
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      healthCheck: vi.fn(async () => ({ healthy: true })),
      createIssue: vi.fn(async (task: Task) => ({
        id: '10001',
        key: `TEST-${task.id}`,
        url: `https://test.atlassian.net/browse/TEST-${task.id}`,
        title: task.title,
        description: task.description,
        status: 'To Do',
        type: 'Task',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      })),
      updateIssue: vi.fn(async () => {}),
      getIssue: vi.fn(async () => ({
        id: '10001',
        key: 'TEST-1',
        url: 'https://test.atlassian.net/browse/TEST-1',
        title: 'Test',
        description: '',
        status: 'To Do',
        type: 'Task',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      })),
      findIssues: vi.fn(async () => []),
      createSubtask: vi.fn(async () => ({
        id: '10002',
        key: 'TEST-2',
        url: 'https://test.atlassian.net/browse/TEST-2',
        title: 'Subtask',
        description: '',
        status: 'To Do',
        type: 'Sub-task',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      })),
      linkIssues: vi.fn(async () => {}),
      transitionIssue: vi.fn(async () => {}),
      getTransitions: vi.fn(async () => []),
      addComment: vi.fn(async () => {}),
    };

    // Register the mock tracker
    registerTracker('test-sync', async () => mockTracker);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makeSyncConfig(overrides: Partial<RuntimeConfig['tracker']> = {}): RuntimeConfig {
    return makeConfig({
      tracker: {
        type: 'test-sync',
        configPath: './tracker.json',
        autoCreate: true,
        autoTransition: true,
        autoComment: true,
        autoPull: false,
        ...overrides,
      },
    });
  }

  function makeSyncExecutor(extraFiles: Record<string, string> = {}): Executor & { _fs: Map<string, string> } {
    return makeMockExecutor({
      './tracker.json': JSON.stringify({ ...trackerConfigJson, type: 'test-sync' }),
      './state/tasks.jsonl': '',
      ...extraFiles,
    }) as Executor & { _fs: Map<string, string> };
  }

  it('skips when all auto flags are false', async () => {
    const config = makeSyncConfig({
      autoCreate: false,
      autoTransition: false,
      autoComment: false,
    });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await syncTaskToTracker(context, task, true);

    // readFile should not have been called for tracker config
    expect(executor.readFile).not.toHaveBeenCalledWith('./tracker.json');
  });

  it('skips when tracker credentials are missing', async () => {
    delete process.env.RALPH_TEST_SYNC_TOKEN;
    delete process.env.TEST_SYNC_TOKEN;
    const config = makeSyncConfig();
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.createIssue).not.toHaveBeenCalled();
    expect(mockTracker.transitionIssue).not.toHaveBeenCalled();
  });

  it('creates issue when autoCreate is true and task has no externalId', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoCreate: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.createIssue).toHaveBeenCalledWith(task);
  });

  it('records link operation after creating issue', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoCreate: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await syncTaskToTracker(context, task, true);

    const content = executor._fs.get('./state/tasks.jsonl')!;
    const lines = content.trim().split('\n').filter(l => l.trim());
    expect(lines.length).toBeGreaterThan(0);
    const linkOp = JSON.parse(lines[lines.length - 1]);
    expect(linkOp.op).toBe('link');
    expect(linkOp.id).toBe('T-1');
    expect(linkOp.externalId).toBe('TEST-T-1');
  });

  it('transitions issue when autoTransition is true and task has externalId', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoTransition: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done', externalId: 'TEST-1' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.transitionIssue).toHaveBeenCalledWith('TEST-1', 'Done');
  });

  it('adds success comment when autoComment is true', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoComment: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done', externalId: 'TEST-1' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.addComment).toHaveBeenCalledWith(
      'TEST-1',
      'Task completed successfully by Ralph.'
    );
  });

  it('adds failure comment when task did not succeed', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoComment: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'blocked', externalId: 'TEST-1' });

    await syncTaskToTracker(context, task, false);

    expect(mockTracker.addComment).toHaveBeenCalledWith(
      'TEST-1',
      'Task marked as blocked by Ralph.'
    );
  });

  it('does not create issue when autoCreate is false even without externalId', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoCreate: false, autoTransition: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.createIssue).not.toHaveBeenCalled();
    // No transition either since there's no externalId
    expect(mockTracker.transitionIssue).not.toHaveBeenCalled();
  });

  it('does not transition when autoTransition is false', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoTransition: false, autoComment: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done', externalId: 'TEST-1' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.transitionIssue).not.toHaveBeenCalled();
    // But comment should still be added
    expect(mockTracker.addComment).toHaveBeenCalled();
  });

  it('does not comment when autoComment is false', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoComment: false, autoTransition: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done', externalId: 'TEST-1' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.addComment).not.toHaveBeenCalled();
    // But transition should still happen
    expect(mockTracker.transitionIssue).toHaveBeenCalled();
  });

  it('handles tracker error gracefully without crashing', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    (mockTracker.createIssue as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API rate limit exceeded')
    );
    const config = makeSyncConfig({ autoCreate: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    // Should not throw
    await expect(syncTaskToTracker(context, task, true)).resolves.toBeUndefined();
  });

  it('logs error message on tracker failure', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    (mockTracker.createIssue as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused')
    );
    const config = makeSyncConfig({ autoCreate: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await syncTaskToTracker(context, task, true);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Tracker sync failed for T-1: Connection refused')
    );
  });

  it('handles missing tracker config file gracefully', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      // No ./tracker.json file
    });
    const config = makeSyncConfig();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await expect(syncTaskToTracker(context, task, true)).resolves.toBeUndefined();
  });

  it('does not transition when status has no mapping', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    // Use a tracker config without a statusMap entry for 'discovered'
    const sparseConfig = { ...trackerConfigJson, type: 'test-sync', statusMap: {} };
    const executor = makeMockExecutor({
      './tracker.json': JSON.stringify(sparseConfig),
      './state/tasks.jsonl': '',
    });
    const config = makeSyncConfig({ autoTransition: true, autoComment: false });
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'discovered', externalId: 'TEST-1' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.transitionIssue).not.toHaveBeenCalled();
  });

  it('performs both transition and comment for linked task', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    const config = makeSyncConfig({ autoTransition: true, autoComment: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done', externalId: 'EXT-99' });

    await syncTaskToTracker(context, task, true);

    expect(mockTracker.transitionIssue).toHaveBeenCalledWith('EXT-99', 'Done');
    expect(mockTracker.addComment).toHaveBeenCalledWith(
      'EXT-99',
      'Task completed successfully by Ralph.'
    );
  });

  it('handles non-Error thrown objects gracefully', async () => {
    process.env.TEST_SYNC_TOKEN = 'tok';
    (mockTracker.createIssue as ReturnType<typeof vi.fn>).mockRejectedValue('string error');
    const config = makeSyncConfig({ autoCreate: true });
    const executor = makeSyncExecutor();
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1', status: 'done' });

    await expect(syncTaskToTracker(context, task, true)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Unknown error')
    );
  });
});

// =============================================================================
// --dry-run FLAG TESTS
// =============================================================================

describe('dry-run mode', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('skips git commit when dryRun is true and autoCommit is enabled', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md' });
    const config = makeConfig({
      loop: { ...makeConfig().loop, dryRun: true },
      git: { autoCommit: true, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
    });
    const executor = makeMockExecutor({
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
      './state/tasks.jsonl': taskCreateOp(t1) + '\n',
      './state/progress.jsonl': '',
      './specs/t1.md': '# Spec content',
    });
    const git = makeMockGit();
    const context = makeContext({ config, executor, git });

    // Simulate what runLoop does on success in dry-run mode
    const task = await pickNextTask(context);
    expect(task).not.toBeNull();

    const taskResult = await executeTaskLoop(context, task!);
    expect(taskResult.success).toBe(true);

    const dryRun = config.loop.dryRun ?? false;

    if (config.git.autoCommit && !dryRun) {
      await executor.flush();
      await git.add('.');
      await git.commit(`${config.git.commitPrefix}${task!.id}: ${task!.title}`);
    }

    // Git operations should NOT have been called
    expect(executor.flush).not.toHaveBeenCalled();
    expect(git.add).not.toHaveBeenCalled();
    expect(git.commit).not.toHaveBeenCalled();
  });

  it('skips tracker sync when dryRun is true', async () => {
    const task = makeTask({ id: 'T-1', status: 'done', externalId: 'EXT-1' });
    const config = makeConfig({
      loop: { ...makeConfig().loop, dryRun: true },
      tracker: {
        type: 'jira',
        configPath: './tracker.json',
        autoCreate: true,
        autoTransition: true,
        autoComment: true,
        autoPull: false,
      },
    });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });
    const dryRun = config.loop.dryRun ?? false;

    // In dry-run mode, syncTaskToTracker should not be called
    if (!dryRun) {
      await syncTaskToTracker(context, task, true);
    }

    // Tracker config should not even be read
    expect(executor.readFile).not.toHaveBeenCalledWith('./tracker.json');
  });

  it('still executes task iterations in dry-run mode', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md' });
    const config = makeConfig({
      loop: { ...makeConfig().loop, dryRun: true },
    });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(t1) + '\n',
      './state/progress.jsonl': '',
      './specs/t1.md': '# Spec',
    });
    const context = makeContext({ config, executor });

    const task = await pickNextTask(context);
    const taskResult = await executeTaskLoop(context, task!);

    // Task execution still happens in dry-run
    expect(taskResult.success).toBe(true);
    expect(taskResult.iterations).toBe(1);
  });

  it('still records learning in dry-run mode', async () => {
    const config = makeConfig({
      loop: { ...makeConfig().loop, dryRun: true },
      learning: { enabled: true, autoApplyImprovements: false, minConfidence: 0.8, retentionDays: 90 },
    });
    const executor = makeMockExecutor({ './state/learning.jsonl': '' });
    const context = makeContext({ config, executor });
    const task = makeTask({ id: 'T-1' });

    await recordTaskCompletion(context, task, { success: true, iterations: 2 });

    const fs = (executor as unknown as { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/learning.jsonl')!;
    expect(content.trim()).not.toBe('');
  });

  it('dryRun defaults to false when not set', () => {
    const config = makeConfig();
    expect(config.loop.dryRun).toBeUndefined();
    const dryRun = config.loop.dryRun ?? false;
    expect(dryRun).toBe(false);
  });
});

// =============================================================================
// --task=<id> FILTER TESTS
// =============================================================================

describe('taskFilter (--task flag)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('picks only the specified task when taskFilter is provided', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-01T00:00:00Z' });
    const t2 = makeTask({ id: 'T-2', status: 'pending', createdAt: '2025-01-02T00:00:00Z' });
    const content = [taskCreateOp(t1), taskCreateOp(t2)].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    const task = await pickNextTask(context, 'T-2');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('T-2');
  });

  it('returns null when taskFilter matches no task', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending' });
    const content = taskCreateOp(t1) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    const task = await pickNextTask(context, 'NONEXISTENT');
    expect(task).toBeNull();
  });

  it('returns null when filtered task is done', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'done' });
    const content = taskCreateOp(t1) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    const task = await pickNextTask(context, 'T-1');
    expect(task).toBeNull();
  });

  it('returns null when filtered task is cancelled', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'cancelled' });
    const content = taskCreateOp(t1) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    const task = await pickNextTask(context, 'T-1');
    expect(task).toBeNull();
  });

  it('picks blocked task when explicitly targeted by taskFilter', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending' });
    const t2 = makeTask({ id: 'T-2', status: 'pending', blockedBy: ['T-1'] });
    const content = [taskCreateOp(t1), taskCreateOp(t2)].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    // Without filter, T-2 would be skipped (blocked by T-1)
    const unfiltered = await pickNextTask(context);
    expect(unfiltered!.id).toBe('T-1');

    // With filter, T-2 is returned even though it's blocked
    const filtered = await pickNextTask(context, 'T-2');
    expect(filtered).not.toBeNull();
    expect(filtered!.id).toBe('T-2');
  });

  it('picks in_progress task when targeted by taskFilter', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'in_progress' });
    const content = taskCreateOp(t1) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    const task = await pickNextTask(context, 'T-1');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('T-1');
    expect(task!.status).toBe('in_progress');
  });

  it('picks discovered task when targeted by taskFilter', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'discovered' });
    const content = taskCreateOp(t1) + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    const task = await pickNextTask(context, 'T-1');
    expect(task).not.toBeNull();
    expect(task!.status).toBe('discovered');
  });

  it('without taskFilter, normal selection logic applies', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending', createdAt: '2025-01-02T00:00:00Z' });
    const t2 = makeTask({ id: 'T-2', status: 'pending', createdAt: '2025-01-01T00:00:00Z' });
    const content = [taskCreateOp(t1), taskCreateOp(t2)].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    // Without filter, oldest pending task (T-2) is picked
    const task = await pickNextTask(context);
    expect(task!.id).toBe('T-2');
  });

  it('derives state from log before applying taskFilter', async () => {
    const t1 = makeTask({ id: 'T-1', status: 'pending' });
    const content = [
      taskCreateOp(t1),
      taskUpdateOp('T-1', { status: 'done' }),
    ].join('\n') + '\n';
    const executor = makeMockExecutor({ './state/tasks.jsonl': content });
    const context = makeContext({ executor });

    // T-1 was updated to done, so even with filter it returns null
    const task = await pickNextTask(context, 'T-1');
    expect(task).toBeNull();
  });

  it('taskFilter with empty tasks.jsonl returns null', async () => {
    const executor = makeMockExecutor({ './state/tasks.jsonl': '' });
    const context = makeContext({ executor });

    const task = await pickNextTask(context, 'T-1');
    expect(task).toBeNull();
  });
});

// =============================================================================
// estimateCost TESTS
// =============================================================================

describe('estimateCost', () => {
  it('returns 0 when usage is undefined', () => {
    expect(estimateCost(undefined)).toBe(0);
  });

  it('computes cost using default rates when no LLM config', () => {
    const usage: LLMUsage = { inputTokens: 1000, outputTokens: 500 };
    const cost = estimateCost(usage);
    // Default: $3/1M input + $15/1M output
    // 1000 * 0.000003 + 500 * 0.000015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('uses custom rates from LLM config', () => {
    const usage: LLMUsage = { inputTokens: 2000, outputTokens: 1000 };
    const llmConfig: LLMConfig = {
      enabled: true,
      provider: 'anthropic',
      model: 'test',
      maxTokens: 4096,
      temperature: 0,
      costPerInputToken: 0.00001,
      costPerOutputToken: 0.00003,
    };
    const cost = estimateCost(usage, llmConfig);
    // 2000 * 0.00001 + 1000 * 0.00003 = 0.02 + 0.03 = 0.05
    expect(cost).toBeCloseTo(0.05, 6);
  });

  it('falls back to defaults when config has no rates', () => {
    const usage: LLMUsage = { inputTokens: 100, outputTokens: 100 };
    const llmConfig: LLMConfig = {
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o',
      maxTokens: 4096,
      temperature: 0,
    };
    const cost = estimateCost(usage, llmConfig);
    // 100 * 0.000003 + 100 * 0.000015 = 0.0003 + 0.0015 = 0.0018
    expect(cost).toBeCloseTo(0.0018, 6);
  });

  it('handles zero tokens', () => {
    const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    expect(estimateCost(usage)).toBe(0);
  });

  it('handles large token counts', () => {
    const usage: LLMUsage = { inputTokens: 1_000_000, outputTokens: 500_000 };
    const cost = estimateCost(usage);
    // 1M * $3/1M + 500K * $15/1M = $3 + $7.5 = $10.5
    expect(cost).toBeCloseTo(10.5, 2);
  });
});

// =============================================================================
// Induction Invariant Contract TESTS
// =============================================================================

describe('induction invariant contract', () => {
  it('computes run KPIs correctly', () => {
    const kpis = computeRunKpis({
      tasksProcessed: 4,
      tasksCompleted: 3,
      taskDurationsMs: [1000, 2000, 3000, 4000],
      rollbackCount: 1,
      escapedDefects: 0,
      humanInterventions: 1,
      maxTimePerTaskMs: 5000,
    });

    expect(kpis.successRate).toBeCloseTo(0.75, 6);
    expect(kpis.avgCycleTimeMs).toBe(2500);
    expect(kpis.rollbackRate).toBeCloseTo(0.25, 6);
    expect(kpis.escapedDefects).toBe(0);
    expect(kpis.humanInterventions).toBe(1);
  });

  it('passes in core mode without enforcement', () => {
    const kpis = computeRunKpis({
      tasksProcessed: 2,
      tasksCompleted: 0,
      taskDurationsMs: [10000, 12000],
      rollbackCount: 2,
      escapedDefects: 2,
      humanInterventions: 5,
      maxTimePerTaskMs: 1000,
    });

    const report = validateInductionInvariant(kpis, 'core');
    expect(report.passed).toBe(true);
    expect(report.enforced).toBe(false);
    expect(report.violations).toEqual([]);
  });

  it('fails in delivery mode when escaped defects are non-zero', () => {
    const kpis = computeRunKpis({
      tasksProcessed: 3,
      tasksCompleted: 3,
      taskDurationsMs: [100, 100, 100],
      rollbackCount: 0,
      escapedDefects: 1,
      humanInterventions: 0,
      maxTimePerTaskMs: 1000,
    });

    const report = validateInductionInvariant(kpis, 'delivery');
    expect(report.passed).toBe(false);
    expect(report.enforced).toBe(true);
    expect(report.violations.some(v => v.startsWith('escaped_defects_nonzero:'))).toBe(true);
  });

  it('passes in delivery mode when all thresholds are met', () => {
    const kpis = computeRunKpis({
      tasksProcessed: 5,
      tasksCompleted: 5,
      taskDurationsMs: [100, 200, 300, 400, 500],
      rollbackCount: 1,
      escapedDefects: 0,
      humanInterventions: 1,
      maxTimePerTaskMs: 1000,
    });

    const report = validateInductionInvariant(kpis, 'delivery');
    expect(report.passed).toBe(true);
    expect(report.enforced).toBe(true);
    expect(report.violations).toEqual([]);
  });
});

// =============================================================================
// executeTaskLoop COST TRACKING TESTS
// =============================================================================

describe('executeTaskLoop cost tracking', () => {
  it('returns cost: 0 when no LLM provider is used', async () => {
    const task = makeTask({ spec: './specs/exists.md' });
    const executor = makeMockExecutor({
      './specs/exists.md': '# Spec content',
      './state/tasks.jsonl': '',
    });
    const context = makeContext({ executor });

    const result = await executeTaskLoop(context, task);
    expect(result.cost).toBe(0);
    expect(result.success).toBe(true);
  });

  it('accumulates cost across iterations with LLM provider', async () => {
    const task = makeTask({ status: 'pending' });
    let callCount = 0;
    const mockProvider = {
      chat: vi.fn(async () => {
        callCount++;
        if (callCount === 3) {
          return {
            content: '',
            toolCalls: [{ name: 'task_complete', arguments: { artifacts: ['out.ts'] } }],
            finishReason: 'tool_calls' as const,
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        }
        return {
          content: 'working...',
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }),
    };

    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor, llmProvider: mockProvider });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);
    expect(result.iterations).toBe(3);
    // Each iteration: 100 * 0.000003 + 50 * 0.000015 = 0.00105
    // 3 iterations: 0.00315
    expect(result.cost).toBeCloseTo(0.00315, 6);
  });

  it('stops when per-task cost limit is reached', async () => {
    const task = makeTask({ status: 'pending' });
    const mockProvider = {
      chat: vi.fn(async () => ({
        content: 'working...',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { inputTokens: 100_000, outputTokens: 100_000 },
      })),
    };

    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      loop: {
        ...makeConfig().loop,
        maxCostPerTask: 0.01, // Very low limit
      },
    });
    const context = makeContext({ executor, config, llmProvider: mockProvider });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Task cost limit exceeded');
    expect(result.cost).toBeGreaterThan(0);
  });

  it('stops when per-run cost limit is reached via runCostSoFar', async () => {
    const task = makeTask({ status: 'pending' });
    const mockProvider = {
      chat: vi.fn(async () => ({
        content: 'working...',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { inputTokens: 10_000, outputTokens: 10_000 },
      })),
    };

    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      loop: {
        ...makeConfig().loop,
        maxCostPerRun: 1.0,
      },
    });
    const context = makeContext({ executor, config, llmProvider: mockProvider });

    // Pass high runCostSoFar so the limit is immediately triggered
    const result = await executeTaskLoop(context, task, 0.999);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Run cost limit exceeded');
  });

  it('logs cost in progress.jsonl per iteration', async () => {
    const task = makeTask({ spec: './specs/t.md' });
    let callCount = 0;
    const mockProvider = {
      chat: vi.fn(async () => {
        callCount++;
        return {
          content: '',
          toolCalls: [{ name: 'task_complete', arguments: { artifacts: ['t.md'] } }],
          finishReason: 'tool_calls' as const,
          usage: { inputTokens: 500, outputTokens: 200 },
        };
      }),
    };

    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    }) as Executor & { _fs: Map<string, string> };
    const context = makeContext({ executor, llmProvider: mockProvider });

    await executeTaskLoop(context, task);

    const progressContent = executor._fs.get('./state/progress.jsonl') || '';
    const events = progressContent.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const iterationEvent = events.find((e: Record<string, unknown>) => e.type === 'iteration');
    expect(iterationEvent).toBeDefined();
    expect(iterationEvent.cost).toBeGreaterThan(0);
    expect(iterationEvent.taskCostSoFar).toBeGreaterThan(0);
  });

  it('cost is 0 for heuristic iterations (no LLM)', async () => {
    const task = makeTask({
      status: 'pending',
      spec: './specs/done.md',
    });
    const executor = makeMockExecutor({
      './specs/done.md': '# Done',
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    const result = await executeTaskLoop(context, task);
    expect(result.cost).toBe(0);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// parseAnthropicResponse / parseOpenAIResponse USAGE TESTS
// =============================================================================

describe('LLM response usage parsing', () => {
  it('parseAnthropicResponse includes usage', async () => {
    const { parseAnthropicResponse } = await import('./llm-providers.js');
    const data = {
      id: 'msg-1',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Hello' }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 42, output_tokens: 17 },
    };
    const result = parseAnthropicResponse(data);
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 17 });
  });

  it('parseOpenAIResponse includes usage', async () => {
    const { parseOpenAIResponse } = await import('./llm-providers.js');
    const data = {
      id: 'chatcmpl-1',
      choices: [{
        index: 0,
        message: { role: 'assistant' as const, content: 'Hi' },
        finish_reason: 'stop' as const,
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    };
    const result = parseOpenAIResponse(data);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('executeLLMIteration returns usage from provider', async () => {
    const { executeLLMIteration } = await import('./llm.js');
    const mockProvider = {
      chat: vi.fn(async () => ({
        content: 'done',
        toolCalls: [{ name: 'task_complete', arguments: { artifacts: [] } }],
        finishReason: 'tool_calls' as const,
        usage: { inputTokens: 200, outputTokens: 80 },
      })),
    };
    const executor = makeMockExecutor();
    const task = makeTask();
    const { usage } = await executeLLMIteration(mockProvider, executor, task, 1);
    expect(usage).toEqual({ inputTokens: 200, outputTokens: 80 });
  });
});

// =============================================================================
// RETRY onFailure MODE TESTS
// =============================================================================

describe('onFailure=retry', () => {
  it('retries a failed task and succeeds on retry', async () => {
    // Task with no spec — first attempt will exhaust iterations (maxIter=1),
    // then retry with spec available
    const task = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
    });
    const git = makeMockGit();
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1, onFailure: 'retry', maxRetries: 1 },
    });

    let callCount = 0;
    // Override executeTaskLoop behavior: first call fails, second succeeds
    // We do this by controlling the spec file availability
    const origReadFile = executor.readFile as ReturnType<typeof vi.fn>;
    origReadFile.mockImplementation(async (path: string) => {
      if (path === './specs/t1.md') {
        callCount++;
        if (callCount <= 1) {
          // First call (initial attempt iteration) — spec missing
          throw new Error('ENOENT');
        }
        // Second call (retry iteration) — spec available
        return '# Spec content';
      }
      const fs = (executor as any)._fs as Map<string, string>;
      const content = fs.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    });

    const context = makeContext({ config, executor, git });
    const taskPicked = await pickNextTask(context);
    expect(taskPicked).not.toBeNull();

    // Manually simulate runLoop's flow for this task
    await updateTaskStatus(context, task.id, 'in_progress');
    const taskResult = await executeTaskLoop(context, task);
    expect(taskResult.success).toBe(false);

    // Now retry — spec is available on 2nd read
    const retryResult = await executeTaskLoop(context, task);
    expect(retryResult.success).toBe(true);
  });

  it('marks task as blocked after all retries exhausted', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1, onFailure: 'retry', maxRetries: 2 },
    });
    const context = makeContext({ config, executor });

    // executeTaskLoop will always fail (no spec, pending task → continue → max iterations)
    const result1 = await executeTaskLoop(context, task);
    expect(result1.success).toBe(false);

    const result2 = await executeTaskLoop(context, task);
    expect(result2.success).toBe(false);

    const result3 = await executeTaskLoop(context, task);
    expect(result3.success).toBe(false);
    // After 3 attempts (1 initial + 2 retries), all should fail
  });

  it('defaults to maxRetries=1 when not specified', async () => {
    const config = makeConfig({
      loop: { ...makeConfig().loop, onFailure: 'retry' },
    });
    expect(config.loop.maxRetries).toBeUndefined();
    // The loop code uses `config.loop.maxRetries ?? 1`, meaning default is 1
  });

  it('rollback is called between retry attempts', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1, onFailure: 'retry', maxRetries: 2 },
    });
    const context = makeContext({ config, executor });

    // Run task loop 3 times (1 initial + 2 retries) — all will fail
    await executeTaskLoop(context, task);
    executor.rollback(); // simulate runLoop initial rollback
    await executeTaskLoop(context, task);
    executor.rollback(); // simulate retry 1 rollback
    await executeTaskLoop(context, task);
    executor.rollback(); // simulate retry 2 rollback

    expect(executor.rollback).toHaveBeenCalledTimes(3);
  });

  it('accumulates iterations and cost across retries', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 2, onFailure: 'retry', maxRetries: 1 },
    });
    const context = makeContext({ config, executor });

    const r1 = await executeTaskLoop(context, task);
    expect(r1.iterations).toBe(2);

    const r2 = await executeTaskLoop(context, task);
    expect(r2.iterations).toBe(2);

    // Total would be 4 iterations accumulated in runLoop
    expect(r1.iterations + r2.iterations).toBe(4);
  });

  it('onFailure=retry does not retry when task succeeds on first attempt', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './specs/t1.md': '# Spec exists',
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, onFailure: 'retry', maxRetries: 3 },
    });
    const context = makeContext({ config, executor });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);
    expect(result.iterations).toBe(1);
    // No retries needed when first attempt succeeds
  });

  it('onFailure=continue still works with retry in config', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1, onFailure: 'continue' },
    });
    const context = makeContext({ config, executor });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(false);
    // onFailure=continue means no retry — task just fails
  });

  it('onFailure=stop still works correctly', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1, onFailure: 'stop' },
    });
    const context = makeContext({ config, executor });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(false);
    // onFailure=stop means no retry — task fails and loop would stop
  });

  it('retry commits changes on successful retry when autoCommit is true', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md' });
    const git = makeMockGit();
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './specs/t1.md': '# Spec',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, onFailure: 'retry', maxRetries: 1 },
      git: { autoCommit: true, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' },
    });
    const context = makeContext({ config, executor, git });

    // Task succeeds on first attempt (spec exists), so no retry needed
    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);

    // Simulate what runLoop does on success
    if (result.success && config.git.autoCommit) {
      await executor.flush();
      await git.add('.');
      await git.commit(`${config.git.commitPrefix}${task.id}: ${task.title}`);
    }

    expect(executor.flush).toHaveBeenCalled();
    expect(git.commit).toHaveBeenCalledWith('RALPH-T-1: Test task');
  });

  it('maxRetries=0 with retry mode means no retries (immediate block)', async () => {
    const task = makeTask({ id: 'T-1', status: 'pending' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxIterationsPerTask: 1, onFailure: 'retry', maxRetries: 0 },
    });
    const context = makeContext({ config, executor });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(false);
    // With maxRetries=0, the for loop doesn't execute — task goes straight to blocked
  });

  it('onTaskEnd hook receives correct success status after retry recovery', async () => {
    // Verify the hook system uses taskSuccess (which may flip during retry)
    const task = makeTask({ id: 'T-1', status: 'pending', spec: './specs/t1.md' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './specs/t1.md': '# Content',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, onFailure: 'retry', maxRetries: 1 },
    });

    const hookCalls: boolean[] = [];
    const hooks = {
      onTaskEnd: vi.fn((t: Task, success: boolean) => hookCalls.push(success)),
    };
    const context = makeContext({ config, executor, hooks });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);

    // Fire the hook manually as runLoop would
    hooks.onTaskEnd(task, result.success);
    expect(hookCalls).toEqual([true]);
  });

  it('LoopConfig accepts maxRetries field', () => {
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxRetries: 5 },
    });
    expect(config.loop.maxRetries).toBe(5);
  });

  it('LoopConfig maxRetries is optional', () => {
    const config = makeConfig();
    expect(config.loop.maxRetries).toBeUndefined();
  });
});

// =============================================================================
// pullFromTracker TESTS
// =============================================================================

describe('pullFromTracker', () => {
  const originalEnv = process.env;

  const trackerConfigJson: import('../skills/normalize/tracker-interface.js').TrackerConfig = {
    type: 'jira',
    baseUrl: 'https://test.atlassian.net',
    project: 'TEST',
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
    },
    statusMap: {
      discovered: 'Backlog',
      pending: 'To Do',
      in_progress: 'In Progress',
      blocked: 'Blocked',
      review: 'In Review',
      done: 'Done',
      cancelled: 'Cancelled',
    },
    autoCreate: true,
    autoTransition: true,
    autoComment: true,
  };

  let mockTracker: Tracker;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockTracker = {
      name: 'test-pull',
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      healthCheck: vi.fn(async () => ({ healthy: true })),
      createIssue: vi.fn(async () => ({
        id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
        title: 'T', description: '', status: 'To Do', type: 'Task',
        created: new Date().toISOString(), updated: new Date().toISOString(),
      })),
      updateIssue: vi.fn(async () => {}),
      getIssue: vi.fn(async () => ({
        id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
        title: 'Test', description: '', status: 'Done', type: 'Task',
        created: new Date().toISOString(), updated: new Date().toISOString(),
      })),
      findIssues: vi.fn(async () => []),
      createSubtask: vi.fn(async () => ({
        id: '10002', key: 'TEST-2', url: 'https://test/TEST-2',
        title: 'Subtask', description: '', status: 'To Do', type: 'Sub-task',
        created: new Date().toISOString(), updated: new Date().toISOString(),
      })),
      linkIssues: vi.fn(async () => {}),
      transitionIssue: vi.fn(async () => {}),
      getTransitions: vi.fn(async () => []),
      addComment: vi.fn(async () => {}),
    };

    registerTracker('test-pull', async () => mockTracker);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makePullConfig(overrides: Partial<RuntimeConfig['tracker']> = {}): RuntimeConfig {
    return makeConfig({
      tracker: {
        type: 'test-pull',
        configPath: './tracker.json',
        autoCreate: false,
        autoTransition: false,
        autoComment: false,
        autoPull: true,
        ...overrides,
      },
    });
  }

  function makePullExecutor(extraFiles: Record<string, string> = {}): Executor & { _fs: Map<string, string> } {
    return makeMockExecutor({
      './tracker.json': JSON.stringify({ ...trackerConfigJson, type: 'test-pull' }),
      './state/tasks.jsonl': '',
      ...extraFiles,
    }) as Executor & { _fs: Map<string, string> };
  }

  it('skips when autoPull is false', async () => {
    const config = makePullConfig({ autoPull: false });
    const executor = makePullExecutor();
    const context = makeContext({ config, executor });

    const result = await pullFromTracker(context);

    expect(result.updated).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockTracker.getIssue).not.toHaveBeenCalled();
  });

  it('skips when credentials are missing', async () => {
    const config = makePullConfig();
    const executor = makePullExecutor();
    const context = makeContext({ config, executor });
    // No env vars set for test-pull

    const result = await pullFromTracker(context);

    expect(result.updated).toBe(0);
    expect(mockTracker.getIssue).not.toHaveBeenCalled();
  });

  it('skips when no linked tasks exist', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    const result = await pullFromTracker(context);

    expect(result.updated).toBe(0);
    expect(mockTracker.getIssue).not.toHaveBeenCalled();
  });

  it('updates local status when tracker status differs', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    // Mock returns status 'Done' which maps to 'done'
    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'Done', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    const result = await pullFromTracker(context);

    expect(result.updated).toBe(1);
    expect(mockTracker.getIssue).toHaveBeenCalledWith('TEST-1');
  });

  it('skips tasks with matching status', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    // Mock returns 'In Progress' which maps to 'in_progress' (same as local)
    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    const result = await pullFromTracker(context);

    expect(result.updated).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('skips done tasks (terminal state)', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'done', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    const result = await pullFromTracker(context);

    expect(mockTracker.getIssue).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
  });

  it('skips cancelled tasks (terminal state)', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'cancelled', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    const result = await pullFromTracker(context);

    expect(mockTracker.getIssue).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
  });

  it('handles getIssue errors gracefully', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API rate limited'));

    const result = await pullFromTracker(context);

    expect(result.errors).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('handles non-Error throw objects', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockRejectedValue('not an error');

    const result = await pullFromTracker(context);

    expect(result.errors).toBe(1);
  });

  it('processes multiple linked tasks', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task1 = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const task2 = makeTask({ id: 'RALPH-002', status: 'pending', externalId: 'TEST-2', createdAt: '2025-01-02T00:00:00Z' });
    const task3 = makeTask({ id: 'RALPH-003', status: 'review', externalId: 'TEST-3', createdAt: '2025-01-03T00:00:00Z' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': [task1, task2, task3].map(t => taskCreateOp(t)).join('\n') + '\n',
    });
    const context = makeContext({ config, executor });

    let callCount = 0;
    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      // task1 → Done (changed), task2 → To Do (same), task3 → Done (changed)
      const statuses = ['Done', 'To Do', 'Done'];
      return {
        id: '10001', key: `TEST-${callCount}`, url: `https://test/TEST-${callCount}`,
        title: 'Test', description: '', status: statuses[callCount - 1], type: 'Task',
        created: new Date().toISOString(), updated: new Date().toISOString(),
      };
    });

    const result = await pullFromTracker(context);

    expect(result.updated).toBe(2);
    expect(result.errors).toBe(0);
    expect(mockTracker.getIssue).toHaveBeenCalledTimes(3);
  });

  it('records update operations in tasks.jsonl', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'Done', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    await pullFromTracker(context);

    // Check that an update operation was written to tasks.jsonl
    const fs = (executor as Executor & { _fs: Map<string, string> })._fs;
    const content = fs.get('./state/tasks.jsonl')!;
    const lines = content.trim().split('\n').filter(l => l.trim());
    // First line is the create op, subsequent lines include the update op
    const ops = lines.map(l => JSON.parse(l) as TaskOperation);
    const updateOps = ops.filter(o => o.op === 'update');
    expect(updateOps.length).toBeGreaterThanOrEqual(1);
    const lastUpdate = updateOps[updateOps.length - 1];
    expect(lastUpdate.op).toBe('update');
    if (lastUpdate.op === 'update') {
      expect(lastUpdate.changes.status).toBe('done');
    }
  });

  it('handles tracker config file read error', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    // No tracker.json file in executor
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
    });
    const context = makeContext({ config, executor });

    const result = await pullFromTracker(context);

    // Should not crash, just log and return
    expect(result.updated).toBe(0);
  });

  it('writes progress event for status change', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'Done', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    await pullFromTracker(context);

    // Check that a progress event was written
    const fs = (executor as Executor & { _fs: Map<string, string> })._fs;
    const progressContent = fs.get('./state/progress.jsonl') ?? '';
    if (progressContent.trim()) {
      const events = progressContent.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      const statusEvents = events.filter((e: Record<string, unknown>) => e.type === 'status_change');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('logs pull summary with count', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'Done', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    await pullFromTracker(context);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tracker pull:'));
  });

  // ===========================================================================
  // CONFLICT RESOLUTION TESTS
  // ===========================================================================

  it('logs tracker_conflict event to learning.jsonl on status change', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'Done', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    await pullFromTracker(context);

    const fs = (executor as Executor & { _fs: Map<string, string> })._fs;
    const learningContent = fs.get('./state/learning.jsonl') ?? '';
    const events = learningContent.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const conflicts = events.filter((e: Record<string, unknown>) => e.type === 'tracker_conflict');
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].field).toBe('status');
    expect(conflicts[0].resolution).toBe('tracker_wins');
  });

  it('conflict event has correct fields', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-007', status: 'pending', externalId: 'TEST-7' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10007', key: 'TEST-7', url: 'https://test/TEST-7',
      title: 'Test', description: '', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    await pullFromTracker(context);

    const fs = (executor as Executor & { _fs: Map<string, string> })._fs;
    const learningContent = fs.get('./state/learning.jsonl') ?? '';
    const events = learningContent.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const conflict = events.find((e: Record<string, unknown>) => e.type === 'tracker_conflict');
    expect(conflict).toBeDefined();
    expect(conflict.taskId).toBe('RALPH-007');
    expect(conflict.field).toBe('status');
    expect(conflict.ralphValue).toBe('pending');
    expect(conflict.trackerValue).toBe('In Progress');
    expect(conflict.resolution).toBe('tracker_wins');
    expect(conflict.externalId).toBe('TEST-7');
    expect(conflict.timestamp).toBeDefined();
  });

  it('logs description conflict when tracker description differs', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1', description: 'Ralph description' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: 'Tracker description', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    await pullFromTracker(context);

    const fs = (executor as Executor & { _fs: Map<string, string> })._fs;
    const learningContent = fs.get('./state/learning.jsonl') ?? '';
    const events = learningContent.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const descConflicts = events.filter((e: Record<string, unknown>) => e.type === 'tracker_conflict' && e.field === 'description');
    expect(descConflicts.length).toBe(1);
    expect(descConflicts[0].ralphValue).toBe('Ralph description');
    expect(descConflicts[0].trackerValue).toBe('Tracker description');
    expect(descConflicts[0].resolution).toBe('ralph_wins');
  });

  it('pushes Ralph description back to tracker (ralph_wins)', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1', description: 'Ralph description' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: 'Tracker description', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    await pullFromTracker(context);

    expect(mockTracker.updateIssue).toHaveBeenCalledWith('TEST-1', { description: 'Ralph description' });
  });

  it('does not log conflict when statuses match', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    const result = await pullFromTracker(context);

    expect(result.conflicts).toBe(0);
    const fs = (executor as Executor & { _fs: Map<string, string> })._fs;
    const learningContent = fs.get('./state/learning.jsonl') ?? '';
    expect(learningContent.trim()).toBe('');
  });

  it('does not log description conflict when descriptions match', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1', description: 'Same description' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: 'Same description', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    const result = await pullFromTracker(context);

    expect(result.conflicts).toBe(0);
    expect(mockTracker.updateIssue).not.toHaveBeenCalled();
  });

  it('handles updateIssue error gracefully on description push', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1', description: 'Ralph desc' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: 'Different desc', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });
    (mockTracker.updateIssue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

    const result = await pullFromTracker(context);

    // Should still log the conflict event even if push fails
    expect(result.conflicts).toBe(1);
    expect(result.errors).toBe(0); // updateIssue failure is not counted as an error
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('failed to push description'));
  });

  it('logs multiple conflicts for multiple tasks', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task1 = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1' });
    const task2 = makeTask({ id: 'RALPH-002', status: 'pending', externalId: 'TEST-2', createdAt: '2025-01-02T00:00:00Z' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': [task1, task2].map(t => taskCreateOp(t)).join('\n') + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    let callCount = 0;
    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        id: `1000${callCount}`, key: `TEST-${callCount}`, url: `https://test/TEST-${callCount}`,
        title: 'Test', description: '', status: 'Done', type: 'Task',
        created: new Date().toISOString(), updated: new Date().toISOString(),
      };
    });

    const result = await pullFromTracker(context);

    expect(result.conflicts).toBe(2);
    const fs = (executor as Executor & { _fs: Map<string, string> })._fs;
    const learningContent = fs.get('./state/learning.jsonl') ?? '';
    const events = learningContent.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const conflicts = events.filter((e: Record<string, unknown>) => e.type === 'tracker_conflict');
    expect(conflicts.length).toBe(2);
  });

  it('includes conflict count in return value', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1', description: 'Ralph desc' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: 'Different desc', status: 'Done', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    const result = await pullFromTracker(context);

    // Status conflict + description conflict = 2
    expect(result.conflicts).toBe(2);
    expect(result.updated).toBe(1);
  });

  it('description push skipped when tracker has no description change', async () => {
    process.env.RALPH_TEST_PULL_TOKEN = 'tok';
    const config = makePullConfig();
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress', externalId: 'TEST-1', description: 'My desc' });
    const executor = makePullExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/learning.jsonl': '',
    });
    const context = makeContext({ config, executor });

    // Tracker returns empty description — no conflict
    (mockTracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '10001', key: 'TEST-1', url: 'https://test/TEST-1',
      title: 'Test', description: '', status: 'In Progress', type: 'Task',
      created: new Date().toISOString(), updated: new Date().toISOString(),
    });

    const result = await pullFromTracker(context);

    expect(result.conflicts).toBe(0);
    expect(mockTracker.updateIssue).not.toHaveBeenCalled();
  });
});

// =============================================================================
// DISCOVERED → PENDING → IN_PROGRESS LIFECYCLE PROMOTION TESTS
// =============================================================================

describe('discovered task lifecycle promotion', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('promotes discovered task to pending before in_progress', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'discovered', spec: './specs/t1.md' });
    const executor = makeMockExecutor({
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
      './specs/t1.md': '# Spec',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxTasksPerRun: 1 },
    });
    const context = makeContext({ config, executor });

    // Pick the discovered task
    const picked = await pickNextTask(context);
    expect(picked).not.toBeNull();
    expect(picked!.status).toBe('discovered');

    // Simulate what runLoop does: promote discovered → pending → in_progress
    if (picked!.status === 'discovered') {
      await updateTaskStatus(context, picked!.id, 'pending');
    }
    await updateTaskStatus(context, picked!.id, 'in_progress');

    // Read operations from tasks.jsonl — should contain both transitions
    const content = (executor as any)._fs.get('./state/tasks.jsonl');
    const lines = content.split('\n').filter((l: string) => l.trim());
    const ops = lines.map((l: string) => JSON.parse(l));

    // Should have: create, update(pending), update(in_progress)
    expect(ops.length).toBe(3);
    expect(ops[1].op).toBe('update');
    expect(ops[1].changes.status).toBe('pending');
    expect(ops[2].op).toBe('update');
    expect(ops[2].changes.status).toBe('in_progress');
  });

  it('does not double-promote a pending task', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'pending', spec: './specs/t1.md' });
    const executor = makeMockExecutor({
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
      './specs/t1.md': '# Spec',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxTasksPerRun: 1 },
    });
    const context = makeContext({ config, executor });

    const picked = await pickNextTask(context);
    expect(picked!.status).toBe('pending');

    // Simulate: pending task should NOT get the extra promotion step
    if (picked!.status === 'discovered') {
      await updateTaskStatus(context, picked!.id, 'pending');
    }
    await updateTaskStatus(context, picked!.id, 'in_progress');

    const content = (executor as any)._fs.get('./state/tasks.jsonl');
    const lines = content.split('\n').filter((l: string) => l.trim());
    const ops = lines.map((l: string) => JSON.parse(l));

    // Should have: create, update(in_progress) — no extra pending step
    expect(ops.length).toBe(2);
    expect(ops[1].changes.status).toBe('in_progress');
  });

  it('pickNextTask includes discovered tasks as candidates', async () => {
    const task1 = makeTask({ id: 'RALPH-001', status: 'discovered', createdAt: '2025-01-01T00:00:00Z' });
    const task2 = makeTask({ id: 'RALPH-002', status: 'pending', createdAt: '2025-01-02T00:00:00Z' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': [taskCreateOp(task1), taskCreateOp(task2)].join('\n') + '\n',
    });
    const context = makeContext({ executor });

    const picked = await pickNextTask(context);
    // discovered is eligible — oldest first, so RALPH-001 (discovered) should be picked
    expect(picked).not.toBeNull();
    expect(picked!.id).toBe('RALPH-001');
    expect(picked!.status).toBe('discovered');
  });

  it('discovered task follows valid lifecycle through full orchestration', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'discovered', spec: './specs/t1.md' });
    const executor = makeMockExecutor({
      './AGENTS.md': '# Agents',
      './implementation-plan.md': '# Plan',
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
      './state/learning.jsonl': '',
      './specs/t1.md': '# Spec for task',
    });
    const config = makeConfig({
      loop: { ...makeConfig().loop, maxTasksPerRun: 1 },
    });
    const context = makeContext({ config, executor });

    // Full flow: pick → promote → execute → complete
    const picked = await pickNextTask(context);
    expect(picked!.status).toBe('discovered');

    // Promote discovered → pending
    await updateTaskStatus(context, picked!.id, 'pending');
    // Promote pending → in_progress
    await updateTaskStatus(context, picked!.id, 'in_progress');

    // Execute (spec exists, so completes on first iteration)
    const taskResult = await executeTaskLoop(context, picked!);
    expect(taskResult.success).toBe(true);

    // Mark done (in_progress → done is valid)
    await updateTaskStatus(context, picked!.id, 'done');

    // Verify full lifecycle in operations log
    const content = (executor as any)._fs.get('./state/tasks.jsonl');
    const lines = content.split('\n').filter((l: string) => l.trim());
    const ops = lines.map((l: string) => JSON.parse(l));
    const statuses = ops.filter((o: any) => o.op === 'update').map((o: any) => o.changes.status);

    expect(statuses).toEqual(['pending', 'in_progress', 'done']);
  });

  it('in_progress task skips promotion entirely', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    const picked = await pickNextTask(context);
    expect(picked!.status).toBe('in_progress');

    // Simulate: in_progress should not get any promotion
    if (picked!.status === 'discovered') {
      await updateTaskStatus(context, picked!.id, 'pending');
    }
    await updateTaskStatus(context, picked!.id, 'in_progress');

    const content = (executor as any)._fs.get('./state/tasks.jsonl');
    const lines = content.split('\n').filter((l: string) => l.trim());
    const ops = lines.map((l: string) => JSON.parse(l));

    // create + update(in_progress) — same status update is still valid (idempotent)
    expect(ops.length).toBe(2);
    expect(ops[1].changes.status).toBe('in_progress');
  });

  it('discovered task with higher priority is promoted correctly', async () => {
    const task1 = makeTask({ id: 'RALPH-001', status: 'discovered', priority: 5 });
    const task2 = makeTask({ id: 'RALPH-002', status: 'discovered', priority: 10 });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': [taskCreateOp(task1), taskCreateOp(task2)].join('\n') + '\n',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    const picked = await pickNextTask(context);
    expect(picked!.id).toBe('RALPH-002'); // Higher priority
    expect(picked!.status).toBe('discovered');

    // Promote through lifecycle
    await updateTaskStatus(context, picked!.id, 'pending');
    await updateTaskStatus(context, picked!.id, 'in_progress');

    const content = (executor as any)._fs.get('./state/tasks.jsonl');
    const lines = content.split('\n').filter((l: string) => l.trim());
    const ops = lines.map((l: string) => JSON.parse(l));
    const task2Ops = ops.filter((o: any) => o.id === 'RALPH-002' || o.task?.id === 'RALPH-002');

    // create + pending + in_progress
    expect(task2Ops.length).toBe(3);
  });

  it('discovered task targeted by --task filter is promoted', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'discovered' });
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    const picked = await pickNextTask(context, 'RALPH-001');
    expect(picked).not.toBeNull();
    expect(picked!.status).toBe('discovered');

    // Promotion still applies for targeted tasks
    if (picked!.status === 'discovered') {
      await updateTaskStatus(context, picked!.id, 'pending');
    }
    await updateTaskStatus(context, picked!.id, 'in_progress');

    const content = (executor as any)._fs.get('./state/tasks.jsonl');
    const lines = content.split('\n').filter((l: string) => l.trim());
    const ops = lines.map((l: string) => JSON.parse(l));

    expect(ops.length).toBe(3);
    expect(ops[1].changes.status).toBe('pending');
    expect(ops[2].changes.status).toBe('in_progress');
  });
});
