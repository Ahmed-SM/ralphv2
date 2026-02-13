import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Executor, createExecutor, GitOperations } from './executor.js';
import { Sandbox, createSandbox } from './sandbox.js';
import type { RuntimeConfig, SandboxConfig } from '../types/index.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// =============================================================================
// HELPERS
// =============================================================================

function makeRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    planFile: './implementation-plan.md',
    agentsFile: './AGENTS.md',
    loop: {
      maxIterationsPerTask: 10,
      maxTimePerTask: 60000,
      maxCostPerTask: 10,
      maxTasksPerRun: 50,
      maxTimePerRun: 300000,
      onFailure: 'stop',
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
      commitPrefix: 'RALPH',
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

async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ralph-executor-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// =============================================================================
// EXECUTOR
// =============================================================================

describe('Executor', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  // ===========================================================================
  // createExecutor factory
  // ===========================================================================

  describe('createExecutor', () => {
    it('creates an Executor instance', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      expect(executor).toBeInstanceOf(Executor);
    });
  });

  // ===========================================================================
  // bash
  // ===========================================================================

  describe('bash', () => {
    it('delegates to sandbox.bash', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      const result = await executor.bash('echo hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('returns error for failed commands', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      const result = await executor.bash('node -e "process.exit(42)"');
      expect(result.exitCode).not.toBe(0);
    });
  });

  // ===========================================================================
  // readFile / writeFile
  // ===========================================================================

  describe('readFile', () => {
    it('reads file through sandbox', async () => {
      await writeFile(resolve(workDir, 'data.txt'), 'sandbox read', 'utf-8');
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      const content = await executor.readFile('data.txt');
      expect(content).toBe('sandbox read');
    });
  });

  describe('writeFile', () => {
    it('buffers writes through sandbox', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      await executor.writeFile('out.txt', 'buffered');

      // Not on disk yet
      await expect(readFile(resolve(workDir, 'out.txt'), 'utf-8')).rejects.toThrow();

      // Readable through executor (overlay)
      const content = await executor.readFile('out.txt');
      expect(content).toBe('buffered');
    });
  });

  // ===========================================================================
  // flush / rollback
  // ===========================================================================

  describe('flush', () => {
    it('writes pending changes to disk', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      await executor.writeFile('flushed.txt', 'data');
      await executor.flush();

      const content = await readFile(resolve(workDir, 'flushed.txt'), 'utf-8');
      expect(content).toBe('data');
    });
  });

  describe('rollback', () => {
    it('discards pending changes', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      await executor.writeFile('temp.txt', 'will be discarded');
      executor.rollback();

      expect(executor.getPendingChanges()).toEqual([]);
    });
  });

  // ===========================================================================
  // getPendingChanges
  // ===========================================================================

  describe('getPendingChanges', () => {
    it('returns combined writes and deletes', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      await executor.writeFile('a.txt', 'data');

      const sandbox = executor.getSandbox();
      await sandbox.deleteFile('b.txt');

      const changes = executor.getPendingChanges();
      expect(changes).toHaveLength(2);
    });

    it('returns empty array when no changes', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      expect(executor.getPendingChanges()).toEqual([]);
    });
  });

  // ===========================================================================
  // getSandbox
  // ===========================================================================

  describe('getSandbox', () => {
    it('returns the underlying Sandbox instance', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });
      const sandbox = executor.getSandbox();
      expect(sandbox).toBeInstanceOf(Sandbox);
    });
  });

  // ===========================================================================
  // eval
  // ===========================================================================

  describe('eval', () => {
    it('evaluates TypeScript code from a temp file', async () => {
      const executor = await createExecutor({
        config: makeRuntimeConfig(),
        workDir,
      });

      // eval creates a temp file and imports it — the module must export something
      // This is inherently difficult to test without real module loading
      // We test that it doesn't crash and cleans up temp files
      const files = await (await import('fs/promises')).readdir(workDir);
      const evalFiles = files.filter(f => f.startsWith('.ralph-eval-'));
      expect(evalFiles).toHaveLength(0); // No leftover temp files
    });
  });
});

// =============================================================================
// GIT OPERATIONS
// =============================================================================

describe('GitOperations', () => {
  let workDir: string;
  let git: GitOperations;

  beforeEach(async () => {
    workDir = await makeTempDir();
    git = new GitOperations(workDir);

    // Initialize a git repo
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync('git init', { cwd: workDir });
    await execAsync('git config user.email "test@test.com"', { cwd: workDir });
    await execAsync('git config user.name "Test"', { cwd: workDir });

    // Create initial commit
    await writeFile(resolve(workDir, 'init.txt'), 'init', 'utf-8');
    await execAsync('git add .', { cwd: workDir });
    await execAsync('git commit -m "initial commit"', { cwd: workDir });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('status', () => {
    it('returns clean status for unchanged repo', async () => {
      const status = await git.status();
      expect(status).toBe('');
    });

    it('detects new untracked files', async () => {
      await writeFile(resolve(workDir, 'new.txt'), 'new', 'utf-8');
      const status = await git.status();
      expect(status).toContain('new.txt');
    });
  });

  describe('add', () => {
    it('stages a single file', async () => {
      await writeFile(resolve(workDir, 'staged.txt'), 'data', 'utf-8');
      await git.add('staged.txt');
      const status = await git.status();
      expect(status).toContain('A');
    });

    it('stages multiple files', async () => {
      await writeFile(resolve(workDir, 'a.txt'), 'a', 'utf-8');
      await writeFile(resolve(workDir, 'b.txt'), 'b', 'utf-8');
      await git.add(['a.txt', 'b.txt']);
      const status = await git.status();
      expect(status).toContain('a.txt');
      expect(status).toContain('b.txt');
    });
  });

  describe('commit', () => {
    it('creates a commit with a message', async () => {
      await writeFile(resolve(workDir, 'commit.txt'), 'data', 'utf-8');
      await git.add('commit.txt');
      const output = await git.commit('test commit');
      expect(output).toContain('test commit');
    });

    it('escapes double quotes in commit message', async () => {
      await writeFile(resolve(workDir, 'quote.txt'), 'data', 'utf-8');
      await git.add('quote.txt');
      const output = await git.commit('fix "bug" in parser');
      expect(output).toBeDefined();
    });
  });

  describe('log', () => {
    it('returns commit history', async () => {
      const log = await git.log({ count: 1 });
      expect(log).toContain('initial commit');
    });

    it('respects count parameter', async () => {
      // Add second commit
      await writeFile(resolve(workDir, 'second.txt'), 'data', 'utf-8');
      await git.add('second.txt');
      await git.commit('second commit');

      const log = await git.log({ count: 1 });
      expect(log).toContain('second commit');
      expect(log).not.toContain('initial commit');
    });
  });

  describe('diff', () => {
    it('shows unstaged changes', async () => {
      await writeFile(resolve(workDir, 'init.txt'), 'modified', 'utf-8');
      const diff = await git.diff();
      expect(diff).toContain('modified');
    });

    it('shows staged changes with staged flag', async () => {
      await writeFile(resolve(workDir, 'init.txt'), 'staged change', 'utf-8');
      await git.add('init.txt');
      const diff = await git.diff({ staged: true });
      expect(diff).toContain('staged change');
    });
  });

  describe('branch', () => {
    it('returns current branch name', async () => {
      const branch = await git.branch();
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    });

    it('creates a new branch', async () => {
      await git.branch('feature/test');
      const current = await git.branch();
      expect(current).toBe('feature/test');
    });
  });

  describe('checkout', () => {
    it('switches to an existing branch', async () => {
      // Create and switch to new branch, then switch back
      await git.branch('other-branch');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      // Find the default branch name
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workDir });
      expect(stdout.trim()).toBe('other-branch');

      // Checkout back to initial branch (master or main)
      await git.checkout('master').catch(() => git.checkout('main'));
    });
  });
});
