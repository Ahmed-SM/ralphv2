import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Executor } from './executor.js';
import { runPolicyChecksBeforeCommit, type LoopContext } from './loop.js';
import { GitOperations } from './executor.js';
import { createSandbox, Sandbox } from './sandbox.js';
import type { RalphPolicy, RuntimeConfig, Task, PolicyViolation } from '../types/index.js';
import { defaultPolicy } from './policy.js';

// =============================================================================
// HELPERS
// =============================================================================

function makePolicy(overrides: Partial<RalphPolicy> = {}): RalphPolicy {
  return {
    version: 1,
    mode: 'delivery',
    files: {
      allowRead: ['.'],
      allowWrite: ['src', 'tests', 'state'],
      denyRead: ['.env', '.git/objects'],
      denyWrite: ['.git', 'node_modules', 'dist'],
    },
    commands: {
      allow: ['npm test', 'npm run build', 'git status', 'git diff', 'echo'],
      deny: ['rm -rf /', 'sudo', 'curl | sh'],
    },
    approval: {
      requiredFor: ['destructive_ops', 'dependency_changes', 'production_impacting_edits'],
      requireReason: true,
    },
    checks: {
      required: ['test', 'build'],
      rollbackOnFail: true,
    },
    ...overrides,
  };
}

function makeCorePolicy(overrides: Partial<RalphPolicy> = {}): RalphPolicy {
  return {
    ...makePolicy(),
    mode: 'core',
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
      autoCommit: true,
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

function makeMockExecutor(policy?: RalphPolicy): Executor {
  const sandbox = {
    readFile: vi.fn().mockResolvedValue('content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    bash: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    flush: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn(),
    deleteFile: vi.fn(),
    getPendingChanges: vi.fn().mockReturnValue({ writes: [], deletes: [] }),
  } as unknown as Sandbox;

  return new Executor(
    { config: makeConfig(), workDir: '/test', policy },
    sandbox
  );
}

function makeMockGit(): GitOperations {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue('committed'),
    status: vi.fn().mockResolvedValue(''),
    log: vi.fn().mockResolvedValue(''),
    diff: vi.fn().mockResolvedValue(''),
    branch: vi.fn().mockResolvedValue('main'),
    checkout: vi.fn().mockResolvedValue(undefined),
    diffStats: vi.fn().mockResolvedValue({ filesChanged: 0, linesChanged: 0 }),
  } as unknown as GitOperations;
}

function makeContext(overrides: Partial<LoopContext> = {}): LoopContext {
  return {
    config: makeConfig(),
    executor: makeMockExecutor(),
    git: makeMockGit(),
    workDir: '/test',
    ...overrides,
  };
}

// =============================================================================
// EXECUTOR POLICY ENFORCEMENT
// =============================================================================

describe('Executor policy enforcement', () => {
  // ===========================================================================
  // bash
  // ===========================================================================

  describe('bash — command policy', () => {
    it('blocks denied commands', async () => {
      const executor = makeMockExecutor(makePolicy());
      const result = await executor.bash('sudo rm -rf /');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('Policy violation');
      expect(result.stderr).toContain('command denied');
    });

    it('allows allowlisted commands in delivery mode', async () => {
      const executor = makeMockExecutor(makePolicy());
      const result = await executor.bash('npm test');
      expect(result.exitCode).toBe(0);
    });

    it('blocks non-allowlisted commands in delivery mode', async () => {
      const executor = makeMockExecutor(makePolicy());
      const result = await executor.bash('python script.py');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('Policy violation');
    });

    it('allows non-allowlisted commands in core mode', async () => {
      const executor = makeMockExecutor(makeCorePolicy());
      const result = await executor.bash('python script.py');
      expect(result.exitCode).toBe(0);
    });

    it('still blocks denied commands in core mode', async () => {
      const executor = makeMockExecutor(makeCorePolicy());
      const result = await executor.bash('sudo anything');
      expect(result.exitCode).toBe(126);
    });

    it('records violations for denied commands', async () => {
      const executor = makeMockExecutor(makePolicy());
      await executor.bash('sudo rm -rf /');
      expect(executor.violations).toHaveLength(1);
      expect(executor.violations[0].type).toBe('command_denied');
    });

    it('logs approval-required commands without blocking', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const policy = makePolicy({
        commands: { allow: ['npm install lodash'], deny: [] },
      });
      const executor = makeMockExecutor(policy);
      await executor.bash('npm install lodash');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('requires approval')
      );
      consoleSpy.mockRestore();
    });

    it('passes through to sandbox when no policy is set', async () => {
      const executor = makeMockExecutor();
      const result = await executor.bash('anything');
      expect(result.exitCode).toBe(0);
    });
  });

  // ===========================================================================
  // readFile
  // ===========================================================================

  describe('readFile — file read policy', () => {
    it('blocks denied file reads', async () => {
      const executor = makeMockExecutor(makePolicy());
      await expect(executor.readFile('.env')).rejects.toThrow('Policy violation');
    });

    it('blocks .git/objects reads', async () => {
      const executor = makeMockExecutor(makePolicy());
      await expect(executor.readFile('.git/objects/abc123')).rejects.toThrow('Policy violation');
    });

    it('allows allowlisted reads in delivery mode', async () => {
      const executor = makeMockExecutor(makePolicy());
      const content = await executor.readFile('src/foo.ts');
      expect(content).toBe('content');
    });

    it('records violations for denied reads', async () => {
      const executor = makeMockExecutor(makePolicy());
      await executor.readFile('.env').catch(() => {});
      expect(executor.violations).toHaveLength(1);
      expect(executor.violations[0].type).toBe('file_read_denied');
    });

    it('passes through when no policy is set', async () => {
      const executor = makeMockExecutor();
      const content = await executor.readFile('.env');
      expect(content).toBe('content');
    });
  });

  // ===========================================================================
  // writeFile
  // ===========================================================================

  describe('writeFile — file write policy', () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    it('blocks writes to denied paths', async () => {
      const executor = makeMockExecutor(makePolicy());
      await expect(executor.writeFile('node_modules/foo.js', 'data')).rejects.toThrow('Policy violation');
    });

    it('blocks writes to .git directory', async () => {
      const executor = makeMockExecutor(makePolicy());
      await expect(executor.writeFile('.git/config', 'data')).rejects.toThrow('Policy violation');
    });

    it('allows writes to allowlisted paths in delivery mode', async () => {
      const executor = makeMockExecutor(makePolicy());
      await executor.writeFile('src/foo.ts', 'data');
      // No error thrown
    });

    it('blocks writes to non-allowlisted paths in delivery mode', async () => {
      const executor = makeMockExecutor(makePolicy());
      await expect(executor.writeFile('config/app.yaml', 'data')).rejects.toThrow('Policy violation');
    });

    it('blocks Ralph self-modification writes in delivery mode without explicit approval', async () => {
      const executor = makeMockExecutor(makePolicy({
        files: {
          allowRead: ['.'],
          allowWrite: ['.'],
          denyRead: ['.env', '.git/objects'],
          denyWrite: ['.git', 'node_modules', 'dist'],
        },
      }));
      await expect(executor.writeFile('runtime/loop.ts', 'data')).rejects.toThrow('self-modification blocked');
    });

    it('allows Ralph self-modification writes in delivery mode with explicit approval', async () => {
      vi.stubEnv('RALPH_APPROVE_SELF_MODIFY', 'true');
      const executor = makeMockExecutor(makePolicy({
        files: {
          allowRead: ['.'],
          allowWrite: ['.'],
          denyRead: ['.env', '.git/objects'],
          denyWrite: ['.git', 'node_modules', 'dist'],
        },
      }));
      await expect(executor.writeFile('runtime/loop.ts', 'data')).resolves.toBeUndefined();
    });

    it('allows writes to non-allowlisted paths in core mode', async () => {
      const executor = makeMockExecutor(makeCorePolicy());
      await executor.writeFile('config/app.yaml', 'data');
      // No error thrown
    });

    it('still blocks denied writes in core mode', async () => {
      const executor = makeMockExecutor(makeCorePolicy());
      await expect(executor.writeFile('node_modules/foo.js', 'data')).rejects.toThrow('Policy violation');
    });

    it('records violations for denied writes', async () => {
      const executor = makeMockExecutor(makePolicy());
      await executor.writeFile('node_modules/foo.js', 'data').catch(() => {});
      expect(executor.violations).toHaveLength(1);
      expect(executor.violations[0].type).toBe('file_write_denied');
    });

    it('passes through when no policy is set', async () => {
      const executor = makeMockExecutor();
      await executor.writeFile('node_modules/foo.js', 'data');
      // No error thrown
    });
  });

  // ===========================================================================
  // policy setter
  // ===========================================================================

  describe('policy getter/setter', () => {
    it('can set policy after construction', async () => {
      const executor = makeMockExecutor();
      expect(executor.policy).toBeUndefined();

      executor.policy = makePolicy();
      expect(executor.policy).toBeDefined();
      expect(executor.policy!.mode).toBe('delivery');
    });

    it('can clear policy by setting undefined', async () => {
      const executor = makeMockExecutor(makePolicy());
      executor.policy = undefined;
      // Now no enforcement
      const content = await executor.readFile('.env');
      expect(content).toBe('content');
    });

    it('enforces new policy after setter', async () => {
      const executor = makeMockExecutor();
      await executor.readFile('.env'); // OK without policy

      executor.policy = makePolicy();
      await expect(executor.readFile('.env')).rejects.toThrow('Policy violation');
    });
  });

  // ===========================================================================
  // violations accumulation
  // ===========================================================================

  describe('violations', () => {
    it('accumulates multiple violations', async () => {
      const executor = makeMockExecutor(makePolicy());
      await executor.readFile('.env').catch(() => {});
      await executor.writeFile('node_modules/x', 'y').catch(() => {});
      await executor.bash('sudo rm');
      expect(executor.violations).toHaveLength(3);
    });

    it('starts with empty violations', () => {
      const executor = makeMockExecutor(makePolicy());
      expect(executor.violations).toEqual([]);
    });
  });
});

// =============================================================================
// POLICY CHECKS BEFORE COMMIT
// =============================================================================

describe('runPolicyChecksBeforeCommit', () => {
  let mockGit: GitOperations;

  beforeEach(() => {
    mockGit = makeMockGit();
  });

  it('commits directly when no policy', async () => {
    const context = makeContext({ git: mockGit });
    const task = makeTask();
    const result = await runPolicyChecksBeforeCommit(context, task, false);

    expect(result).toBe(true);
    expect(mockGit.add).toHaveBeenCalledWith('.');
    expect(mockGit.commit).toHaveBeenCalledWith('RALPH-RALPH-001: Test task');
  });

  it('commits directly when policy has no required checks', async () => {
    const policy = makePolicy({ checks: { required: [], rollbackOnFail: false } });
    const context = makeContext({ git: mockGit, policy });
    const task = makeTask();
    const result = await runPolicyChecksBeforeCommit(context, task, false);

    expect(result).toBe(true);
    expect(mockGit.commit).toHaveBeenCalled();
  });

  it('runs required checks and commits on pass', async () => {
    const executor = makeMockExecutor();
    // Mock bash to return passing for all checks
    (executor as unknown as { sandbox: { bash: ReturnType<typeof vi.fn> } }).sandbox.bash = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });

    const policy = makePolicy({
      checks: { required: ['test'], rollbackOnFail: true },
    });
    const context = makeContext({ executor, git: mockGit, policy });
    const task = makeTask();
    const result = await runPolicyChecksBeforeCommit(context, task, false);

    expect(result).toBe(true);
    expect(mockGit.commit).toHaveBeenCalled();
  });

  it('fails and rolls back when checks fail', async () => {
    const executor = makeMockExecutor();
    // Mock bash to fail checks
    (executor as unknown as { sandbox: { bash: ReturnType<typeof vi.fn> } }).sandbox.bash = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'test failed' });

    const policy = makePolicy({
      checks: { required: ['test'], rollbackOnFail: true },
    });
    const context = makeContext({ executor, git: mockGit, policy });
    const task = makeTask();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runPolicyChecksBeforeCommit(context, task, false);

    expect(result).toBe(false);
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('rolled back'));
    consoleSpy.mockRestore();
  });

  it('does not rollback when rollbackOnFail is false', async () => {
    const executor = makeMockExecutor();
    (executor as unknown as { sandbox: { bash: ReturnType<typeof vi.fn> } }).sandbox.bash = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'test failed' });

    const policy = makePolicy({
      checks: { required: ['test'], rollbackOnFail: false },
    });
    const context = makeContext({ executor, git: mockGit, policy });
    const task = makeTask();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runPolicyChecksBeforeCommit(context, task, false);

    expect(result).toBe(false);
    // No rollback call
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('rolled back'));
    consoleSpy.mockRestore();
  });

  it('flushes before running checks', async () => {
    const executor = makeMockExecutor();
    const flushSpy = vi.spyOn(executor, 'flush');
    (executor as unknown as { sandbox: { bash: ReturnType<typeof vi.fn> } }).sandbox.bash = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });

    const policy = makePolicy({
      checks: { required: ['test'], rollbackOnFail: true },
    });
    const context = makeContext({ executor, git: mockGit, policy });
    const task = makeTask();
    await runPolicyChecksBeforeCommit(context, task, false);

    expect(flushSpy).toHaveBeenCalled();
  });

  it('respects dry-run mode', async () => {
    const context = makeContext({ git: mockGit });
    const task = makeTask();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runPolicyChecksBeforeCommit(context, task, true);

    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
    consoleSpy.mockRestore();
  });

  it('does not commit when autoCommit is false', async () => {
    const config = makeConfig({ git: { autoCommit: false, commitPrefix: 'RALPH-', branchPrefix: 'ralph/' } });
    const context = makeContext({ config, git: mockGit });
    const task = makeTask();
    await runPolicyChecksBeforeCommit(context, task, false);

    expect(mockGit.commit).not.toHaveBeenCalled();
  });

  it('logs policy violation event on check failure', async () => {
    const executor = makeMockExecutor();
    (executor as unknown as { sandbox: { bash: ReturnType<typeof vi.fn> } }).sandbox.bash = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'fail' });

    const policy = makePolicy({
      checks: { required: ['test', 'build'], rollbackOnFail: false },
    });
    const context = makeContext({ executor, git: mockGit, policy });
    const task = makeTask();

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runPolicyChecksBeforeCommit(context, task, false);

    // Verify writeFile was called with a progress event (for policy_violation logging)
    const sandbox = (executor as unknown as { sandbox: { writeFile: ReturnType<typeof vi.fn> } }).sandbox;
    const writeFileCalls = sandbox.writeFile.mock.calls;
    const progressWrites = writeFileCalls.filter(
      (c: [string, string]) => c[0] === './state/progress.jsonl'
    );
    expect(progressWrites.length).toBeGreaterThan(0);
    const lastWrite = progressWrites[progressWrites.length - 1][1] as string;
    expect(lastWrite).toContain('policy_violation');
  });

  it('logs individual check results', async () => {
    const executor = makeMockExecutor();
    (executor as unknown as { sandbox: { bash: ReturnType<typeof vi.fn> } }).sandbox.bash = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' })    // test passes
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'fail' }); // build fails

    const policy = makePolicy({
      checks: { required: ['test', 'build'], rollbackOnFail: false },
    });
    const context = makeContext({ executor, git: mockGit, policy });
    const task = makeTask();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runPolicyChecksBeforeCommit(context, task, false);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[PASS] test'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[FAIL] build'));
    consoleSpy.mockRestore();
  });
});

// =============================================================================
// LOOPCONTEXT POLICY FIELD
// =============================================================================

describe('LoopContext policy field', () => {
  it('policy field is optional', () => {
    const context: LoopContext = {
      config: makeConfig(),
      executor: makeMockExecutor(),
      git: makeMockGit(),
      workDir: '/test',
    };
    expect(context.policy).toBeUndefined();
  });

  it('accepts a policy', () => {
    const policy = makePolicy();
    const context: LoopContext = {
      config: makeConfig(),
      executor: makeMockExecutor(),
      git: makeMockGit(),
      workDir: '/test',
      policy,
    };
    expect(context.policy).toBeDefined();
    expect(context.policy!.mode).toBe('delivery');
  });
});

// =============================================================================
// DEFAULT POLICY
// =============================================================================

describe('defaultPolicy integration', () => {
  it('default policy allows all reads', async () => {
    const executor = makeMockExecutor(defaultPolicy());
    const content = await executor.readFile('any/file.ts');
    expect(content).toBe('content');
  });

  it('default policy allows all writes', async () => {
    const executor = makeMockExecutor(defaultPolicy());
    await executor.writeFile('any/file.ts', 'data');
    // No error
  });

  it('default policy blocks denied commands', async () => {
    const executor = makeMockExecutor(defaultPolicy());
    const result = await executor.bash('sudo rm -rf /');
    expect(result.exitCode).toBe(126);
  });

  it('default policy allows general commands', async () => {
    const executor = makeMockExecutor(defaultPolicy());
    const result = await executor.bash('echo hello');
    expect(result.exitCode).toBe(0);
  });
});
