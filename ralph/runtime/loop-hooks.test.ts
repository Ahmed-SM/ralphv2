import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invokeHook,
  executeTaskLoop,
  executeIteration,
  type LoopContext,
} from './loop.js';
import type { Executor } from './executor.js';
import { GitOperations } from './executor.js';
import type {
  Task,
  RuntimeConfig,
  LoopHooks,
  AnomalyDetectedEvent,
  IterationResult,
  Action,
} from '../types/index.js';

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
    diffStats: vi.fn(async () => ({ filesChanged: 0, linesChanged: 0 })),
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

function makeHooks(overrides: Partial<LoopHooks> = {}): LoopHooks {
  return {
    onTaskStart: vi.fn(),
    onIterationStart: vi.fn(),
    onAction: vi.fn(),
    onIterationEnd: vi.fn(),
    onTaskEnd: vi.fn(),
    onAnomaly: vi.fn(),
    ...overrides,
  };
}

// =============================================================================
// invokeHook TESTS
// =============================================================================

describe('invokeHook', () => {
  it('calls the named hook with correct arguments', () => {
    const hooks = makeHooks();
    const task = makeTask();
    invokeHook(hooks, 'onTaskStart', task);
    expect(hooks.onTaskStart).toHaveBeenCalledWith(task);
  });

  it('does nothing when hooks is undefined', () => {
    // Should not throw
    invokeHook(undefined, 'onTaskStart', makeTask());
  });

  it('does nothing when the specific hook is undefined', () => {
    const hooks: LoopHooks = {};
    // Should not throw
    invokeHook(hooks, 'onTaskStart', makeTask());
  });

  it('does nothing when the specific hook is not a function', () => {
    const hooks = { onTaskStart: 'not a function' } as unknown as LoopHooks;
    // Should not throw
    invokeHook(hooks, 'onTaskStart', makeTask());
  });

  it('catches and logs hook errors without throwing', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hooks = makeHooks({
      onTaskStart: vi.fn(() => { throw new Error('hook boom'); }),
    });

    // Should not throw
    invokeHook(hooks, 'onTaskStart', makeTask());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Hook onTaskStart failed: hook boom')
    );
    consoleSpy.mockRestore();
  });

  it('catches non-Error thrown values', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hooks = makeHooks({
      onTaskEnd: vi.fn(() => { throw 'string error'; }),
    });

    invokeHook(hooks, 'onTaskEnd', makeTask(), true);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown hook error')
    );
    consoleSpy.mockRestore();
  });

  it('passes iteration number to onIterationStart', () => {
    const hooks = makeHooks();
    const task = makeTask();
    invokeHook(hooks, 'onIterationStart', task, 3);
    expect(hooks.onIterationStart).toHaveBeenCalledWith(task, 3);
  });

  it('passes result to onIterationEnd', () => {
    const hooks = makeHooks();
    const task = makeTask();
    const result: IterationResult = { status: 'complete', artifacts: ['file.ts'] };
    invokeHook(hooks, 'onIterationEnd', task, 1, result);
    expect(hooks.onIterationEnd).toHaveBeenCalledWith(task, 1, result);
  });

  it('passes success boolean to onTaskEnd', () => {
    const hooks = makeHooks();
    const task = makeTask();
    invokeHook(hooks, 'onTaskEnd', task, false);
    expect(hooks.onTaskEnd).toHaveBeenCalledWith(task, false);
  });

  it('passes anomaly event to onAnomaly', () => {
    const hooks = makeHooks();
    const anomaly: AnomalyDetectedEvent = {
      type: 'anomaly_detected',
      anomaly: 'High iteration count',
      severity: 'high',
      context: { pattern: 'iteration_anomaly' },
      timestamp: '2025-01-01T00:00:00Z',
    };
    invokeHook(hooks, 'onAnomaly', anomaly);
    expect(hooks.onAnomaly).toHaveBeenCalledWith(anomaly);
  });

  it('passes action to onAction', () => {
    const hooks = makeHooks();
    const action: Action = {
      type: 'write',
      target: 'file.ts',
      duration: 100,
      timestamp: '2025-01-01T00:00:00Z',
    };
    invokeHook(hooks, 'onAction', action);
    expect(hooks.onAction).toHaveBeenCalledWith(action);
  });
});

// =============================================================================
// executeTaskLoop hook integration TESTS
// =============================================================================

describe('executeTaskLoop hooks', () => {
  it('fires onIterationStart before each iteration', async () => {
    const hooks = makeHooks();
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec content',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ hooks, executor });

    await executeTaskLoop(context, task);

    expect(hooks.onIterationStart).toHaveBeenCalledWith(task, 1);
  });

  it('fires onIterationEnd after each iteration with result', async () => {
    const hooks = makeHooks();
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec content',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ hooks, executor });

    await executeTaskLoop(context, task);

    expect(hooks.onIterationEnd).toHaveBeenCalledWith(
      task,
      1,
      expect.objectContaining({ status: 'complete' })
    );
  });

  it('fires onIterationStart and onIterationEnd for each iteration in multi-iteration task', async () => {
    const hooks = makeHooks();
    let callCount = 0;
    const task = makeTask({ status: 'discovered' });
    const executor = makeMockExecutor({
      './state/progress.jsonl': '',
    });
    const config = makeConfig({
      loop: {
        ...makeConfig().loop,
        maxIterationsPerTask: 3,
      },
    });
    const context = makeContext({ hooks, executor, config });

    await executeTaskLoop(context, task);

    expect(hooks.onIterationStart).toHaveBeenCalledTimes(3);
    expect(hooks.onIterationEnd).toHaveBeenCalledTimes(3);
    expect(hooks.onIterationStart).toHaveBeenCalledWith(task, 1);
    expect(hooks.onIterationStart).toHaveBeenCalledWith(task, 2);
    expect(hooks.onIterationStart).toHaveBeenCalledWith(task, 3);
  });

  it('does not crash when hooks is undefined', async () => {
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ executor });

    // Should not throw
    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);
  });

  it('does not crash when hooks is empty object', async () => {
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ hooks: {}, executor });

    const result = await executeTaskLoop(context, task);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// executeIteration hook integration TESTS
// =============================================================================

describe('executeIteration hooks', () => {
  it('fires onAction for each LLM action when llmProvider is set', async () => {
    const hooks = makeHooks();
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec',
    });

    // Mock LLM provider that returns a tool call
    const mockProvider = {
      chat: vi.fn(async () => ({
        content: 'Done',
        toolCalls: [
          { name: 'task_complete', arguments: { reason: 'all done' } },
        ],
        finishReason: 'tool_calls' as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      })),
    };

    const context = makeContext({
      hooks,
      executor,
      llmProvider: mockProvider,
    });

    await executeIteration(context, task, 1);

    expect(hooks.onAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eval', target: 'task_complete' })
    );
  });

  it('does not fire onAction when no llmProvider is set (heuristic path)', async () => {
    const hooks = makeHooks();
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec content',
    });
    const context = makeContext({ hooks, executor });

    await executeIteration(context, task, 1);

    expect(hooks.onAction).not.toHaveBeenCalled();
  });

  it('does not fire onAction when LLM returns no tool calls', async () => {
    const hooks = makeHooks();
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec',
    });

    const mockProvider = {
      chat: vi.fn(async () => ({
        content: 'Thinking...',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { inputTokens: 50, outputTokens: 20 },
      })),
    };

    const context = makeContext({
      hooks,
      executor,
      llmProvider: mockProvider,
    });

    await executeIteration(context, task, 1);

    expect(hooks.onAction).not.toHaveBeenCalled();
  });

  it('fires onAction for multiple tool calls', async () => {
    const hooks = makeHooks();
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec',
    });

    const mockProvider = {
      chat: vi.fn(async () => ({
        content: '',
        toolCalls: [
          { name: 'read_file', arguments: { path: 'foo.ts' } },
          { name: 'write_file', arguments: { path: 'bar.ts', content: 'x' } },
          { name: 'task_complete', arguments: { reason: 'done' } },
        ],
        finishReason: 'tool_calls' as const,
        usage: { inputTokens: 200, outputTokens: 100 },
      })),
    };

    const context = makeContext({
      hooks,
      executor,
      llmProvider: mockProvider,
    });

    await executeIteration(context, task, 1);

    expect(hooks.onAction).toHaveBeenCalledTimes(3);
  });

  it('still returns result when onAction hook throws', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hooks = makeHooks({
      onAction: vi.fn(() => { throw new Error('action hook fail'); }),
    });
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec',
    });

    const mockProvider = {
      chat: vi.fn(async () => ({
        content: 'Done',
        toolCalls: [
          { name: 'task_complete', arguments: { reason: 'done' } },
        ],
        finishReason: 'tool_calls' as const,
      })),
    };

    const context = makeContext({
      hooks,
      executor,
      llmProvider: mockProvider,
    });

    const result = await executeIteration(context, task, 1);

    // Hook error shouldn't prevent result
    expect(result.status).toBe('complete');
    consoleSpy.mockRestore();
  });
});

// =============================================================================
// LoopContext hooks field TESTS
// =============================================================================

describe('LoopContext hooks field', () => {
  it('is optional', () => {
    const context: LoopContext = {
      config: makeConfig(),
      executor: makeMockExecutor(),
      git: makeMockGit(),
      workDir: '/tmp/test',
    };
    expect(context.hooks).toBeUndefined();
  });

  it('accepts a complete hooks object', () => {
    const hooks = makeHooks();
    const context: LoopContext = {
      config: makeConfig(),
      executor: makeMockExecutor(),
      git: makeMockGit(),
      workDir: '/tmp/test',
      hooks,
    };
    expect(context.hooks).toBe(hooks);
  });

  it('accepts a partial hooks object', () => {
    const context: LoopContext = {
      config: makeConfig(),
      executor: makeMockExecutor(),
      git: makeMockGit(),
      workDir: '/tmp/test',
      hooks: { onTaskStart: vi.fn() },
    };
    expect(context.hooks!.onTaskStart).toBeDefined();
    expect(context.hooks!.onTaskEnd).toBeUndefined();
  });
});

// =============================================================================
// Hook error resilience TESTS
// =============================================================================

describe('hook error resilience', () => {
  it('onIterationStart error does not prevent iteration execution', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hooks = makeHooks({
      onIterationStart: vi.fn(() => { throw new Error('start hook fail'); }),
    });
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec content',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ hooks, executor });

    const result = await executeTaskLoop(context, task);

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(1);
    consoleSpy.mockRestore();
  });

  it('onIterationEnd error does not prevent task completion', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hooks = makeHooks({
      onIterationEnd: vi.fn(() => { throw new Error('end hook fail'); }),
    });
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec content',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ hooks, executor });

    const result = await executeTaskLoop(context, task);

    expect(result.success).toBe(true);
    consoleSpy.mockRestore();
  });

  it('all hooks throwing does not crash executeTaskLoop', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hooks = makeHooks({
      onIterationStart: vi.fn(() => { throw new Error('a'); }),
      onIterationEnd: vi.fn(() => { throw new Error('b'); }),
      onAction: vi.fn(() => { throw new Error('c'); }),
    });
    const task = makeTask({ spec: './specs/test.md' });
    const executor = makeMockExecutor({
      './specs/test.md': '# Spec content',
      './state/progress.jsonl': '',
    });
    const context = makeContext({ hooks, executor });

    const result = await executeTaskLoop(context, task);

    expect(result.success).toBe(true);
    consoleSpy.mockRestore();
  });
});

// =============================================================================
// LoopHooks interface TESTS
// =============================================================================

describe('LoopHooks interface', () => {
  it('allows all methods to be optional', () => {
    const hooks: LoopHooks = {};
    expect(hooks).toBeDefined();
  });

  it('allows any subset of hooks', () => {
    const hooks: LoopHooks = {
      onTaskStart: vi.fn(),
      onAnomaly: vi.fn(),
    };
    expect(hooks.onTaskStart).toBeDefined();
    expect(hooks.onAnomaly).toBeDefined();
    expect(hooks.onTaskEnd).toBeUndefined();
  });
});
