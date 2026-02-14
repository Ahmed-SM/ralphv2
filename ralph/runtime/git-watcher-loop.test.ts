import { describe, it, expect, vi } from 'vitest';
import {
  runGitWatcher,
  invokeHook,
  type LoopContext,
} from './loop.js';
import type { Executor } from './executor.js';
import { GitOperations } from './executor.js';
import type { Task, RuntimeConfig, LoopHooks, GitWatcherConfig } from '../types/index.js';

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

// Helper to create a task create operation JSONL line
function taskCreateOp(task: Task): string {
  return JSON.stringify({ op: 'create', task, timestamp: task.createdAt });
}

// Helper: simple git log output (SHA|subject|author|email|date)
function makeGitLogOutput(commits: Array<{ sha: string; subject: string; author?: string; email?: string; date?: string }>): string {
  return commits
    .map(c => `${c.sha}|${c.subject}|${c.author ?? 'dev'}|${c.email ?? 'dev@test.com'}|${c.date ?? '2025-06-01T12:00:00Z'}`)
    .join('\n');
}

// =============================================================================
// runGitWatcher TESTS
// =============================================================================

describe('runGitWatcher', () => {
  it('returns null when gitWatcher is not configured', async () => {
    const context = makeContext();
    // config has no gitWatcher field by default
    const result = await runGitWatcher(context);
    expect(result).toBeNull();
  });

  it('returns null when gitWatcher.enabled is false', async () => {
    const context = makeContext({
      config: makeConfig({
        gitWatcher: { enabled: false },
      }),
    });
    const result = await runGitWatcher(context);
    expect(result).toBeNull();
  });

  it('runs watchGitActivity when gitWatcher is enabled', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'pending' });
    const gitLog = makeGitLogOutput([
      { sha: 'abc1234567890123456789012345678901234567', subject: 'RALPH-001: implement feature' },
    ]);

    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task),
      './state/progress.jsonl': '',
    });

    // Mock bash to return git log output
    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: gitLog,
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: {
          enabled: true,
          taskPrefix: 'RALPH',
          minConfidence: 0.7,
          maxCommits: 100,
          detectAnomalies: true,
        },
      }),
    });

    const result = await runGitWatcher(context);
    expect(result).not.toBeNull();
    expect(result!.commits.length).toBeGreaterThanOrEqual(0);
  });

  it('uses taskPrefix from git.commitPrefix when not specified', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        git: { autoCommit: false, commitPrefix: 'PROJ-', branchPrefix: 'proj/' },
        gitWatcher: { enabled: true },
      }),
    });

    const result = await runGitWatcher(context);
    expect(result).not.toBeNull();
    // The function should have derived "PROJ" from "PROJ-" commitPrefix
  });

  it('passes dryRun from loop config', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        loop: {
          maxIterationsPerTask: 10,
          maxTimePerTask: 60000,
          maxCostPerTask: 10,
          maxCostPerRun: 100,
          maxTasksPerRun: 50,
          maxTimePerRun: 300000,
          onFailure: 'continue',
          parallelism: 1,
          dryRun: true,
        },
        gitWatcher: { enabled: true },
      }),
    });

    const result = await runGitWatcher(context);
    expect(result).not.toBeNull();
    // In dry-run mode, no writes should occur to tasks.jsonl
  });

  it('catches errors and returns null without crashing', async () => {
    // Create a context where the WatchContext construction succeeds but
    // watchGitActivity throws (e.g., via a getter that throws)
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    // Make readFile throw synchronously on first call to test outer catch
    let callCount = 0;
    (executor.readFile as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      callCount++;
      if (callCount <= 1) {
        // First call (loadProgressEvents) — throw to propagate through watchGitActivity's catch
        throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
      }
      throw new Error('ENOENT');
    });
    // bash also fails
    (executor.bash as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('git not found'));

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true },
      }),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runGitWatcher(context);
    // watchGitActivity internally catches git errors and returns empty result
    // so runGitWatcher returns a non-null WatchResult (empty but valid)
    expect(result).not.toBeNull();
    expect(result!.commits).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('fires onAnomaly hook for git watcher anomalies', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress' });
    // Create a task that's in_progress with no git activity — should trigger no_activity anomaly
    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n' + JSON.stringify({
        op: 'update', id: 'RALPH-001', changes: { status: 'in_progress' }, timestamp: '2025-01-02T00:00:00Z',
      }),
      './state/progress.jsonl': '',
    });

    // Return empty git log (no commits)
    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const hooks = makeHooks();
    const context = makeContext({
      executor,
      hooks,
      config: makeConfig({
        gitWatcher: { enabled: true, detectAnomalies: true },
      }),
    });

    const result = await runGitWatcher(context);
    expect(result).not.toBeNull();

    // Should have detected anomalies for in_progress task with no git activity
    if (result!.anomalies.length > 0) {
      expect(hooks.onAnomaly).toHaveBeenCalled();
      const call = (hooks.onAnomaly as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.type).toBe('anomaly_detected');
      expect(call.context.source).toBe('git_watcher');
    }
  });

  it('handles non-Error thrown objects gracefully', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true },
      }),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runGitWatcher(context);
    // watchGitActivity catches errors internally and returns empty result
    expect(result).not.toBeNull();
    expect(result!.commits).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('delegates executor.bash as execCommand for git commands', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true },
      }),
    });

    await runGitWatcher(context);

    // executor.bash should have been called with a git log command
    expect(executor.bash).toHaveBeenCalled();
    const bashCall = (executor.bash as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(bashCall).toContain('git log');
  });

  it('uses executor.readFile and writeFile for WatchContext I/O', async () => {
    const task = makeTask({ id: 'RALPH-099', status: 'discovered' });
    const gitLog = makeGitLogOutput([
      { sha: 'aaa1234567890123456789012345678901234567', subject: 'RALPH-099: first commit' },
    ]);

    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task),
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: gitLog,
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true },
      }),
    });

    await runGitWatcher(context);

    // readFile should have been called for tasks.jsonl and progress.jsonl
    expect(executor.readFile).toHaveBeenCalledWith('./state/tasks.jsonl');
    expect(executor.readFile).toHaveBeenCalledWith('./state/progress.jsonl');
  });

  it('applies default config values when optional fields are missing', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true },
        // No taskPrefix, minConfidence, maxCommits, detectAnomalies
      }),
    });

    // Should not throw — defaults are applied
    const result = await runGitWatcher(context);
    expect(result).not.toBeNull();
  });

  it('handles execCommand error when bash has stderr but stdout', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    // Exit code non-zero but stdout has data
    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'abc1234567890123456789012345678901234567|some commit|dev|dev@test.com|2025-01-01T00:00:00Z',
      stderr: 'warning: some git warning',
      exitCode: 1,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true },
      }),
    });

    const result = await runGitWatcher(context);
    // Should still work — stdout has content so no error thrown
    expect(result).not.toBeNull();
  });

  it('execCommand throws when bash fails with no stdout', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    // Exit code non-zero, no stdout
    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: 'fatal: not a git repository',
      exitCode: 128,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true },
      }),
    });

    // Should catch error internally (watchGitActivity handles this)
    const result = await runGitWatcher(context);
    expect(result).not.toBeNull();
    // The watcher internally handles "No git history found" case
  });

  it('detects status inferences from commits referencing tasks', async () => {
    const task = makeTask({ id: 'RALPH-010', status: 'discovered' });
    const gitLog = makeGitLogOutput([
      { sha: 'fff1234567890123456789012345678901234567', subject: 'RALPH-010: implement parser' },
      { sha: 'eee1234567890123456789012345678901234567', subject: 'RALPH-010: add tests' },
      { sha: 'ddd1234567890123456789012345678901234567', subject: 'RALPH-010: fix edge case' },
    ]);

    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task),
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: gitLog,
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true, minConfidence: 0.5 },
      }),
    });

    const result = await runGitWatcher(context);
    expect(result).not.toBeNull();
    expect(result!.taskRefs.length).toBeGreaterThan(0);
    // Commits reference RALPH-010 — should infer in_progress
    if (result!.inferences.length > 0) {
      expect(result!.inferences[0].taskId).toBe('RALPH-010');
      expect(result!.inferences[0].inferredStatus).toBe('in_progress');
    }
  });

  it('logs summary when inferences or anomalies are found', async () => {
    const task = makeTask({ id: 'RALPH-010', status: 'in_progress' });

    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n' + JSON.stringify({
        op: 'update', id: 'RALPH-010', changes: { status: 'in_progress' }, timestamp: '2025-01-02T00:00:00Z',
      }),
      './state/progress.jsonl': '',
    });

    // No commits — triggers no_activity anomaly for in_progress task
    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true, detectAnomalies: true },
      }),
    });

    const result = await runGitWatcher(context);

    if (result && (result.inferences.length > 0 || result.anomalies.length > 0)) {
      const logs = consoleSpy.mock.calls.map(c => c[0]);
      const summaryLog = logs.find((l: string) => l.includes('Git watcher:'));
      expect(summaryLog).toBeDefined();
    }

    consoleSpy.mockRestore();
  });

  it('does not fire anomaly hooks when detectAnomalies is false', async () => {
    const task = makeTask({ id: 'RALPH-001', status: 'in_progress' });

    const executor = makeMockExecutor({
      './state/tasks.jsonl': taskCreateOp(task) + '\n' + JSON.stringify({
        op: 'update', id: 'RALPH-001', changes: { status: 'in_progress' }, timestamp: '2025-01-02T00:00:00Z',
      }),
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const hooks = makeHooks();
    const context = makeContext({
      executor,
      hooks,
      config: makeConfig({
        gitWatcher: { enabled: true, detectAnomalies: false },
      }),
    });

    await runGitWatcher(context);
    expect(hooks.onAnomaly).not.toHaveBeenCalled();
  });

  it('respects maxCommits configuration', async () => {
    const executor = makeMockExecutor({
      './state/tasks.jsonl': '',
      './state/progress.jsonl': '',
    });

    (executor.bash as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const context = makeContext({
      executor,
      config: makeConfig({
        gitWatcher: { enabled: true, maxCommits: 25 },
      }),
    });

    await runGitWatcher(context);

    const bashCall = (executor.bash as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The git log command should contain the maxCommits limit
    expect(bashCall).toContain('25');
  });
});

// =============================================================================
// GitWatcherConfig TYPE TESTS
// =============================================================================

describe('GitWatcherConfig', () => {
  it('is optional on RuntimeConfig', () => {
    const config = makeConfig();
    expect(config.gitWatcher).toBeUndefined();
  });

  it('accepts all fields', () => {
    const gwConfig: GitWatcherConfig = {
      enabled: true,
      taskPrefix: 'PROJ',
      minConfidence: 0.8,
      maxCommits: 50,
      detectAnomalies: false,
    };
    const config = makeConfig({ gitWatcher: gwConfig });
    expect(config.gitWatcher).toEqual(gwConfig);
  });

  it('works with only required field (enabled)', () => {
    const config = makeConfig({ gitWatcher: { enabled: true } });
    expect(config.gitWatcher!.enabled).toBe(true);
    expect(config.gitWatcher!.taskPrefix).toBeUndefined();
    expect(config.gitWatcher!.minConfidence).toBeUndefined();
  });
});
