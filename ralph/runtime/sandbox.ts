/**
 * Sandbox Configuration
 *
 * Provides sandboxed execution environment for Ralph agents.
 * Simulates just-bash OverlayFS behavior with file change tracking.
 */

import { readFile, writeFile, mkdir, rm, stat } from 'fs/promises';
import { resolve, dirname, relative } from 'path';
import { createHash } from 'crypto';
import type { BashResult, SandboxConfig } from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface SandboxState {
  /** Base directory for sandbox operations */
  workDir: string;
  /** Configuration */
  config: SandboxConfig;
  /** Pending file changes (not yet flushed) */
  pendingWrites: Map<string, string>;
  /** Files that have been deleted */
  pendingDeletes: Set<string>;
  /** File read cache */
  readCache: Map<string, { content: string; mtime: number }>;
  /** Execution history */
  executionLog: ExecutionEntry[];
  /** Resource usage tracking */
  resources: ResourceUsage;
}

export interface ExecutionEntry {
  type: 'bash' | 'read' | 'write' | 'delete' | 'eval';
  command?: string;
  path?: string;
  exitCode?: number;
  duration: number;
  timestamp: string;
}

export interface ResourceUsage {
  bashCommands: number;
  fileReads: number;
  fileWrites: number;
  totalDuration: number;
  bytesRead: number;
  bytesWritten: number;
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  before?: string;
  after?: string;
  hash?: string;
}

// =============================================================================
// SANDBOX CLASS
// =============================================================================

export class Sandbox {
  private state: SandboxState;

  constructor(workDir: string, config: SandboxConfig) {
    this.state = {
      workDir: resolve(workDir),
      config,
      pendingWrites: new Map(),
      pendingDeletes: new Set(),
      readCache: new Map(),
      executionLog: [],
      resources: {
        bashCommands: 0,
        fileReads: 0,
        fileWrites: 0,
        totalDuration: 0,
        bytesRead: 0,
        bytesWritten: 0,
      },
    };
  }

  // ===========================================================================
  // FILE OPERATIONS
  // ===========================================================================

  /**
   * Read a file from the sandbox
   * Returns pending write content if available, otherwise reads from disk
   */
  async readFile(filePath: string): Promise<string> {
    const startTime = Date.now();
    const fullPath = this.resolvePath(filePath);

    // Check if file was deleted in sandbox
    if (this.state.pendingDeletes.has(fullPath)) {
      throw new Error(`ENOENT: File deleted in sandbox: ${filePath}`);
    }

    // Check pending writes first (overlay behavior)
    if (this.state.pendingWrites.has(fullPath)) {
      const content = this.state.pendingWrites.get(fullPath)!;
      this.logExecution('read', { path: filePath, duration: Date.now() - startTime });
      return content;
    }

    // Check cache if enabled
    if (this.state.config.cacheReads) {
      const cached = this.state.readCache.get(fullPath);
      if (cached) {
        try {
          const fileStat = await stat(fullPath);
          if (fileStat.mtimeMs === cached.mtime) {
            this.logExecution('read', { path: filePath, duration: Date.now() - startTime });
            return cached.content;
          }
        } catch {
          // File may not exist, continue to read
        }
      }
    }

    // Read from disk
    try {
      const content = await readFile(fullPath, 'utf-8');

      // Update cache
      if (this.state.config.cacheReads) {
        const fileStat = await stat(fullPath);
        this.state.readCache.set(fullPath, {
          content,
          mtime: fileStat.mtimeMs,
        });
      }

      this.state.resources.fileReads++;
      this.state.resources.bytesRead += content.length;
      this.logExecution('read', { path: filePath, duration: Date.now() - startTime });

      return content;
    } catch (error) {
      throw new Error(`Failed to read file: ${filePath}: ${error}`);
    }
  }

  /**
   * Write a file to the sandbox
   * Changes are buffered until flush() is called
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const startTime = Date.now();
    const fullPath = this.resolvePath(filePath);

    // Check allowed paths
    if (!this.isPathAllowed(fullPath)) {
      throw new Error(`Write not allowed to path: ${filePath}`);
    }

    // Store in pending writes (overlay)
    this.state.pendingWrites.set(fullPath, content);
    this.state.pendingDeletes.delete(fullPath); // Undelete if was deleted

    this.state.resources.fileWrites++;
    this.state.resources.bytesWritten += content.length;
    this.logExecution('write', { path: filePath, duration: Date.now() - startTime });
  }

  /**
   * Delete a file in the sandbox
   */
  async deleteFile(filePath: string): Promise<void> {
    const startTime = Date.now();
    const fullPath = this.resolvePath(filePath);

    if (!this.isPathAllowed(fullPath)) {
      throw new Error(`Delete not allowed for path: ${filePath}`);
    }

    this.state.pendingDeletes.add(fullPath);
    this.state.pendingWrites.delete(fullPath);
    this.logExecution('delete', { path: filePath, duration: Date.now() - startTime });
  }

  /**
   * Check if a file exists in the sandbox
   */
  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);

    // Deleted in sandbox
    if (this.state.pendingDeletes.has(fullPath)) {
      return false;
    }

    // Pending write
    if (this.state.pendingWrites.has(fullPath)) {
      return true;
    }

    // Check disk
    try {
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // BASH EXECUTION
  // ===========================================================================

  /**
   * Execute a bash command in the sandbox
   */
  async bash(command: string): Promise<BashResult> {
    const startTime = Date.now();

    // Check if command is allowed
    if (!this.isCommandAllowed(command)) {
      return {
        stdout: '',
        stderr: `Command not allowed: ${command}`,
        exitCode: 126,
      };
    }

    // Check resource limits
    const maxCommands = this.state.config.maxCommands ?? 100;
    if (this.state.resources.bashCommands >= maxCommands) {
      return {
        stdout: '',
        stderr: 'Command limit exceeded',
        exitCode: 1,
      };
    }

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(command, {
        cwd: this.state.workDir,
        timeout: this.state.config.timeout,
        env: this.getSandboxEnv(),
      });

      const duration = Date.now() - startTime;
      this.state.resources.bashCommands++;
      this.state.resources.totalDuration += duration;
      this.logExecution('bash', { command, duration, exitCode: 0 });

      return {
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
        signal?: string;
      };

      const duration = Date.now() - startTime;
      const exitCode = execError.code || 1;

      this.state.resources.bashCommands++;
      this.state.resources.totalDuration += duration;
      this.logExecution('bash', { command, duration, exitCode });

      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || String(error),
        exitCode,
      };
    }
  }

  // ===========================================================================
  // SANDBOX CONTROL
  // ===========================================================================

  /**
   * Flush all pending changes to disk
   * Call this before git operations
   */
  async flush(): Promise<FileChange[]> {
    const changes: FileChange[] = [];

    // Process writes
    for (const [fullPath, content] of this.state.pendingWrites) {
      let before: string | undefined;
      let changeType: 'created' | 'modified' = 'created';

      try {
        before = await readFile(fullPath, 'utf-8');
        changeType = 'modified';
      } catch {
        // File doesn't exist, will be created
      }

      // Ensure directory exists
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');

      changes.push({
        path: relative(this.state.workDir, fullPath),
        type: changeType,
        before,
        after: content,
        hash: this.hashContent(content),
      });
    }

    // Process deletes
    for (const fullPath of this.state.pendingDeletes) {
      let before: string | undefined;
      try {
        before = await readFile(fullPath, 'utf-8');
        await rm(fullPath);
        changes.push({
          path: relative(this.state.workDir, fullPath),
          type: 'deleted',
          before,
        });
      } catch {
        // File doesn't exist, nothing to delete
      }
    }

    // Clear pending changes
    this.state.pendingWrites.clear();
    this.state.pendingDeletes.clear();

    return changes;
  }

  /**
   * Rollback all pending changes (discard without writing)
   */
  rollback(): void {
    this.state.pendingWrites.clear();
    this.state.pendingDeletes.clear();
    console.log('Sandbox rolled back - all pending changes discarded');
  }

  /**
   * Get list of pending changes
   */
  getPendingChanges(): { writes: string[]; deletes: string[] } {
    return {
      writes: Array.from(this.state.pendingWrites.keys()).map(p =>
        relative(this.state.workDir, p)
      ),
      deletes: Array.from(this.state.pendingDeletes).map(p =>
        relative(this.state.workDir, p)
      ),
    };
  }

  /**
   * Get resource usage statistics
   */
  getResourceUsage(): ResourceUsage {
    return { ...this.state.resources };
  }

  /**
   * Get execution log
   */
  getExecutionLog(): ExecutionEntry[] {
    return [...this.state.executionLog];
  }

  /**
   * Clear caches and reset state (but keep config)
   */
  reset(): void {
    this.state.pendingWrites.clear();
    this.state.pendingDeletes.clear();
    this.state.readCache.clear();
    this.state.executionLog = [];
    this.state.resources = {
      bashCommands: 0,
      fileReads: 0,
      fileWrites: 0,
      totalDuration: 0,
      bytesRead: 0,
      bytesWritten: 0,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private resolvePath(filePath: string): string {
    if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:/)) {
      return resolve(filePath);
    }
    return resolve(this.state.workDir, filePath);
  }

  private isPathAllowed(fullPath: string): boolean {
    const { allowedPaths, deniedPaths } = this.state.config;

    // Check denied paths first
    if (deniedPaths) {
      for (const denied of deniedPaths) {
        const deniedFull = this.resolvePath(denied);
        if (fullPath.startsWith(deniedFull)) {
          return false;
        }
      }
    }

    // Check allowed paths
    if (allowedPaths && allowedPaths.length > 0) {
      for (const allowed of allowedPaths) {
        const allowedFull = this.resolvePath(allowed);
        if (fullPath.startsWith(allowedFull)) {
          return true;
        }
      }
      return false;
    }

    // Default: allow if within workDir
    return fullPath.startsWith(this.state.workDir);
  }

  private isCommandAllowed(command: string): boolean {
    const { allowedCommands, deniedCommands } = this.state.config;

    // Check denied commands
    if (deniedCommands) {
      for (const denied of deniedCommands) {
        if (command.includes(denied)) {
          return false;
        }
      }
    }

    // Check allowed commands
    if (allowedCommands && allowedCommands.length > 0) {
      for (const allowed of allowedCommands) {
        if (command.startsWith(allowed) || command.includes(allowed)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  private getSandboxEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      RALPH_SANDBOX: 'true',
      RALPH_WORKDIR: this.state.workDir,
    };
  }

  private logExecution(
    type: ExecutionEntry['type'],
    details: Partial<ExecutionEntry>
  ): void {
    this.state.executionLog.push({
      type,
      ...details,
      duration: details.duration || 0,
      timestamp: new Date().toISOString(),
    });
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 12);
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new sandbox instance
 */
export function createSandbox(workDir: string, config?: Partial<SandboxConfig>): Sandbox {
  const defaultConfig: SandboxConfig = {
    timeout: 30000,
    maxCommands: 100,
    allowedPaths: ['.'],
    deniedPaths: ['node_modules', '.git/objects'],
    cacheReads: true,
  };

  return new Sandbox(workDir, { ...defaultConfig, ...config });
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Print sandbox status
 */
export function printSandboxStatus(sandbox: Sandbox): void {
  const usage = sandbox.getResourceUsage();
  const pending = sandbox.getPendingChanges();

  console.log('\nSandbox Status:');
  console.log('─'.repeat(40));
  console.log(`  Commands executed:   ${usage.bashCommands}`);
  console.log(`  Files read:          ${usage.fileReads}`);
  console.log(`  Files written:       ${usage.fileWrites}`);
  console.log(`  Bytes read:          ${formatBytes(usage.bytesRead)}`);
  console.log(`  Bytes written:       ${formatBytes(usage.bytesWritten)}`);
  console.log(`  Total duration:      ${usage.totalDuration}ms`);
  console.log();
  console.log('Pending Changes:');
  console.log(`  Writes:              ${pending.writes.length}`);
  console.log(`  Deletes:             ${pending.deletes.length}`);

  if (pending.writes.length > 0) {
    console.log('\n  Pending writes:');
    for (const path of pending.writes.slice(0, 10)) {
      console.log(`    + ${path}`);
    }
    if (pending.writes.length > 10) {
      console.log(`    ... and ${pending.writes.length - 10} more`);
    }
  }

  if (pending.deletes.length > 0) {
    console.log('\n  Pending deletes:');
    for (const path of pending.deletes.slice(0, 10)) {
      console.log(`    - ${path}`);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
