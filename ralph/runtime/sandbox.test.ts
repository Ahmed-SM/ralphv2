import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Sandbox, createSandbox, printSandboxStatus } from './sandbox.js';
import type { SandboxConfig } from '../types/index.js';
import { writeFile, mkdir, rm, readFile, stat } from 'fs/promises';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// =============================================================================
// HELPERS
// =============================================================================

function makeConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    timeout: 5000,
    maxCommands: 10,
    cacheReads: false,
    ...overrides,
  };
}

/** Create a unique temp dir for each test */
async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ralph-sandbox-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// =============================================================================
// SANDBOX CONSTRUCTOR & STATE
// =============================================================================

describe('Sandbox', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  describe('initialization', () => {
    it('starts with empty pending changes', () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      const pending = sandbox.getPendingChanges();
      expect(pending.writes).toEqual([]);
      expect(pending.deletes).toEqual([]);
    });

    it('starts with zero resource usage', () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      const usage = sandbox.getResourceUsage();
      expect(usage.bashCommands).toBe(0);
      expect(usage.fileReads).toBe(0);
      expect(usage.fileWrites).toBe(0);
      expect(usage.bytesRead).toBe(0);
      expect(usage.bytesWritten).toBe(0);
      expect(usage.totalDuration).toBe(0);
    });

    it('starts with empty execution log', () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      expect(sandbox.getExecutionLog()).toEqual([]);
    });
  });

  // ===========================================================================
  // FILE OPERATIONS — writeFile
  // ===========================================================================

  describe('writeFile', () => {
    it('buffers writes without writing to disk', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('test.txt', 'hello');

      // File should NOT exist on disk
      await expect(stat(resolve(workDir, 'test.txt'))).rejects.toThrow();
      // But should be in pending writes
      const pending = sandbox.getPendingChanges();
      expect(pending.writes).toContain('test.txt');
    });

    it('tracks bytes written in resource usage', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('test.txt', 'hello');
      expect(sandbox.getResourceUsage().fileWrites).toBe(1);
      expect(sandbox.getResourceUsage().bytesWritten).toBe(5);
    });

    it('logs write in execution log', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('test.txt', 'hello');
      const log = sandbox.getExecutionLog();
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe('write');
      expect(log[0].path).toBe('test.txt');
    });

    it('undeletes a file that was previously deleted', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('test.txt');
      expect(sandbox.getPendingChanges().deletes).toContain('test.txt');

      await sandbox.writeFile('test.txt', 'restored');
      expect(sandbox.getPendingChanges().deletes).not.toContain('test.txt');
      expect(sandbox.getPendingChanges().writes).toContain('test.txt');
    });

    it('rejects writes to disallowed paths', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({
        deniedPaths: ['secret'],
      }));
      await expect(sandbox.writeFile('secret/key.txt', 'x')).rejects.toThrow('Write not allowed');
    });

    it('rejects writes outside allowed paths when allowedPaths is set', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({
        allowedPaths: ['src'],
      }));
      await expect(sandbox.writeFile('other/file.txt', 'x')).rejects.toThrow('Write not allowed');
    });

    it('allows writes within allowed paths', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({
        allowedPaths: ['.'],
      }));
      await expect(sandbox.writeFile('file.txt', 'x')).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // FILE OPERATIONS — readFile
  // ===========================================================================

  describe('readFile', () => {
    it('reads a file from disk', async () => {
      await writeFile(resolve(workDir, 'existing.txt'), 'disk content', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      const content = await sandbox.readFile('existing.txt');
      expect(content).toBe('disk content');
    });

    it('returns pending write content over disk content (overlay)', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'original', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'overlaid');
      const content = await sandbox.readFile('file.txt');
      expect(content).toBe('overlaid');
    });

    it('throws for deleted files', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'content', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('file.txt');
      await expect(sandbox.readFile('file.txt')).rejects.toThrow('File deleted in sandbox');
    });

    it('throws for non-existent files', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await expect(sandbox.readFile('no-such-file.txt')).rejects.toThrow('Failed to read file');
    });

    it('tracks read resource usage for disk reads', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'hello', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.readFile('file.txt');
      expect(sandbox.getResourceUsage().fileReads).toBe(1);
      expect(sandbox.getResourceUsage().bytesRead).toBe(5);
    });

    it('uses cache when cacheReads is enabled and file unchanged', async () => {
      const filePath = resolve(workDir, 'cached.txt');
      await writeFile(filePath, 'cached content', 'utf-8');

      const sandbox = new Sandbox(workDir, makeConfig({ cacheReads: true }));

      // First read populates cache
      const content1 = await sandbox.readFile('cached.txt');
      expect(content1).toBe('cached content');

      // Second read should use cache (fileReads stays at 1 since cache is served)
      const content2 = await sandbox.readFile('cached.txt');
      expect(content2).toBe('cached content');
    });

    it('logs read in execution log', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'data', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.readFile('file.txt');
      const log = sandbox.getExecutionLog();
      expect(log.some(e => e.type === 'read' && e.path === 'file.txt')).toBe(true);
    });
  });

  // ===========================================================================
  // FILE OPERATIONS — deleteFile
  // ===========================================================================

  describe('deleteFile', () => {
    it('marks file as deleted without touching disk', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'data', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('file.txt');

      // File still on disk
      const content = await readFile(resolve(workDir, 'file.txt'), 'utf-8');
      expect(content).toBe('data');

      // But marked as deleted in sandbox
      expect(sandbox.getPendingChanges().deletes).toContain('file.txt');
    });

    it('removes pending write for same file', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'content');
      expect(sandbox.getPendingChanges().writes).toContain('file.txt');

      await sandbox.deleteFile('file.txt');
      expect(sandbox.getPendingChanges().writes).not.toContain('file.txt');
      expect(sandbox.getPendingChanges().deletes).toContain('file.txt');
    });

    it('rejects delete of disallowed paths', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({
        deniedPaths: ['protected'],
      }));
      await expect(sandbox.deleteFile('protected/file.txt')).rejects.toThrow('Delete not allowed');
    });

    it('logs delete in execution log', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('file.txt');
      const log = sandbox.getExecutionLog();
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe('delete');
    });
  });

  // ===========================================================================
  // FILE OPERATIONS — exists
  // ===========================================================================

  describe('exists', () => {
    it('returns true for file on disk', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'data', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      expect(await sandbox.exists('file.txt')).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      expect(await sandbox.exists('nope.txt')).toBe(false);
    });

    it('returns true for pending write (even if not on disk)', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('new.txt', 'content');
      expect(await sandbox.exists('new.txt')).toBe(true);
    });

    it('returns false for deleted file (even if on disk)', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'data', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('file.txt');
      expect(await sandbox.exists('file.txt')).toBe(false);
    });
  });

  // ===========================================================================
  // BASH EXECUTION
  // ===========================================================================

  describe('bash', () => {
    it('executes a simple command', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      const result = await sandbox.bash('echo hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('tracks bash command count', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.bash('echo 1');
      await sandbox.bash('echo 2');
      expect(sandbox.getResourceUsage().bashCommands).toBe(2);
    });

    it('rejects denied commands', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({
        deniedCommands: ['rm -rf'],
      }));
      const result = await sandbox.bash('rm -rf /');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('Command not allowed');
    });

    it('rejects commands not in allowedCommands when set', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({
        allowedCommands: ['echo', 'cat'],
      }));
      const result = await sandbox.bash('ls');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('Command not allowed');
    });

    it('allows commands in allowedCommands', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({
        allowedCommands: ['echo'],
      }));
      const result = await sandbox.bash('echo ok');
      expect(result.exitCode).toBe(0);
    });

    it('returns error result when command limit exceeded', async () => {
      const sandbox = new Sandbox(workDir, makeConfig({ maxCommands: 1 }));
      await sandbox.bash('echo first');
      const result = await sandbox.bash('echo second');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Command limit exceeded');
    });

    it('captures stderr for failed commands', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      const result = await sandbox.bash('node -e "process.exit(1)"');
      expect(result.exitCode).not.toBe(0);
    });

    it('logs bash execution', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.bash('echo test');
      const log = sandbox.getExecutionLog();
      expect(log.some(e => e.type === 'bash' && e.command === 'echo test')).toBe(true);
    });

    it('sets RALPH_SANDBOX env var', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      const result = await sandbox.bash('node -e "console.log(process.env.RALPH_SANDBOX)"');
      expect(result.stdout.trim()).toBe('true');
    });
  });

  // ===========================================================================
  // SANDBOX CONTROL — flush
  // ===========================================================================

  describe('flush', () => {
    it('writes pending files to disk', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('output.txt', 'flushed content');
      const changes = await sandbox.flush();

      const content = await readFile(resolve(workDir, 'output.txt'), 'utf-8');
      expect(content).toBe('flushed content');
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('created');
      expect(changes[0].path).toBe('output.txt');
    });

    it('reports modified type for existing files', async () => {
      await writeFile(resolve(workDir, 'file.txt'), 'old', 'utf-8');
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'new');
      const changes = await sandbox.flush();

      expect(changes[0].type).toBe('modified');
      expect(changes[0].before).toBe('old');
      expect(changes[0].after).toBe('new');
    });

    it('deletes files marked for deletion', async () => {
      const filePath = resolve(workDir, 'doomed.txt');
      await writeFile(filePath, 'bye', 'utf-8');

      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('doomed.txt');
      const changes = await sandbox.flush();

      await expect(stat(filePath)).rejects.toThrow();
      expect(changes.some(c => c.type === 'deleted')).toBe(true);
    });

    it('clears pending changes after flush', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('a.txt', 'a');
      await sandbox.deleteFile('b.txt');
      await sandbox.flush();

      const pending = sandbox.getPendingChanges();
      expect(pending.writes).toEqual([]);
      expect(pending.deletes).toEqual([]);
    });

    it('creates nested directories when flushing', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('deep/nested/dir/file.txt', 'data');
      await sandbox.flush();

      const content = await readFile(resolve(workDir, 'deep/nested/dir/file.txt'), 'utf-8');
      expect(content).toBe('data');
    });

    it('includes content hash in changes', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'content');
      const changes = await sandbox.flush();
      expect(changes[0].hash).toBeDefined();
      expect(changes[0].hash).toHaveLength(12);
    });
  });

  // ===========================================================================
  // SANDBOX CONTROL — rollback
  // ===========================================================================

  describe('rollback', () => {
    it('discards all pending writes', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'content');
      sandbox.rollback();
      expect(sandbox.getPendingChanges().writes).toEqual([]);
    });

    it('discards all pending deletes', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('file.txt');
      sandbox.rollback();
      expect(sandbox.getPendingChanges().deletes).toEqual([]);
    });

    it('does not affect disk', async () => {
      const filePath = resolve(workDir, 'safe.txt');
      await writeFile(filePath, 'safe', 'utf-8');

      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.deleteFile('safe.txt');
      sandbox.rollback();

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('safe');
    });
  });

  // ===========================================================================
  // SANDBOX CONTROL — reset
  // ===========================================================================

  describe('reset', () => {
    it('clears pending writes and deletes', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'x');
      await sandbox.deleteFile('other.txt');
      sandbox.reset();

      const pending = sandbox.getPendingChanges();
      expect(pending.writes).toEqual([]);
      expect(pending.deletes).toEqual([]);
    });

    it('clears execution log', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'x');
      sandbox.reset();
      expect(sandbox.getExecutionLog()).toEqual([]);
    });

    it('resets resource usage counters', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'x');
      sandbox.reset();

      const usage = sandbox.getResourceUsage();
      expect(usage.fileWrites).toBe(0);
      expect(usage.bytesWritten).toBe(0);
    });
  });

  // ===========================================================================
  // getPendingChanges
  // ===========================================================================

  describe('getPendingChanges', () => {
    it('returns relative paths', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('src/app.ts', 'code');
      await sandbox.deleteFile('old/file.txt');

      const pending = sandbox.getPendingChanges();
      // Paths should be relative to workDir, not absolute
      for (const p of [...pending.writes, ...pending.deletes]) {
        expect(p).not.toMatch(/^[A-Z]:/);
        expect(p).not.toMatch(/^\//);
      }
    });
  });

  // ===========================================================================
  // getResourceUsage
  // ===========================================================================

  describe('getResourceUsage', () => {
    it('returns a copy (mutation-safe)', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      const usage1 = sandbox.getResourceUsage();
      usage1.fileWrites = 999;

      const usage2 = sandbox.getResourceUsage();
      expect(usage2.fileWrites).toBe(0);
    });
  });

  // ===========================================================================
  // getExecutionLog
  // ===========================================================================

  describe('getExecutionLog', () => {
    it('returns a copy (mutation-safe)', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'x');
      const log1 = sandbox.getExecutionLog();
      log1.pop();

      const log2 = sandbox.getExecutionLog();
      expect(log2).toHaveLength(1);
    });

    it('entries have timestamps', async () => {
      const sandbox = new Sandbox(workDir, makeConfig());
      await sandbox.writeFile('file.txt', 'x');
      const log = sandbox.getExecutionLog();
      expect(log[0].timestamp).toBeDefined();
      expect(() => new Date(log[0].timestamp)).not.toThrow();
    });
  });
});

// =============================================================================
// FACTORY — createSandbox
// =============================================================================

describe('createSandbox', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await (async () => {
      const dir = join(tmpdir(), `ralph-sandbox-test-${randomUUID()}`);
      await mkdir(dir, { recursive: true });
      return dir;
    })();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  it('creates a sandbox with default config', () => {
    const sandbox = createSandbox(workDir);
    expect(sandbox).toBeInstanceOf(Sandbox);
  });

  it('merges provided config with defaults', async () => {
    const sandbox = createSandbox(workDir, { maxCommands: 5 });
    // The sandbox should work with the merged config
    // Running 5 commands should be fine, 6th should fail
    for (let i = 0; i < 5; i++) {
      await sandbox.bash('echo ok');
    }
    const result = await sandbox.bash('echo too many');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Command limit exceeded');
  });

  it('default config denies node_modules and .git/objects', async () => {
    const sandbox = createSandbox(workDir);
    await expect(sandbox.writeFile('node_modules/pkg/index.js', 'x')).rejects.toThrow('Write not allowed');
    await expect(sandbox.writeFile('.git/objects/abc', 'x')).rejects.toThrow('Write not allowed');
  });
});

// =============================================================================
// UTILITIES — printSandboxStatus
// =============================================================================

describe('printSandboxStatus', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await (async () => {
      const dir = join(tmpdir(), `ralph-sandbox-test-${randomUUID()}`);
      await mkdir(dir, { recursive: true });
      return dir;
    })();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  it('prints without errors', async () => {
    const sandbox = createSandbox(workDir);
    await sandbox.writeFile('a.txt', 'hello');
    await sandbox.deleteFile('b.txt');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printSandboxStatus(sandbox);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('prints pending writes and deletes counts', async () => {
    const sandbox = createSandbox(workDir);
    await sandbox.writeFile('a.txt', 'x');
    await sandbox.writeFile('b.txt', 'y');

    const output: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });
    printSandboxStatus(sandbox);
    consoleSpy.mockRestore();

    const joined = output.join('\n');
    expect(joined).toContain('Writes:');
    expect(joined).toContain('2');
  });
});
