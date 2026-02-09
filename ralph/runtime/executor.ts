/**
 * Executor - Wraps just-bash for sandboxed execution
 *
 * This module provides the execution environment for Ralph agents.
 * It integrates with just-bash for sandboxed bash and TypeScript execution.
 */

import type { Sandbox as SandboxInterface, BashResult, RuntimeConfig } from '../types/index.js';
import { createSandbox, Sandbox as SandboxImpl } from './sandbox.js';

export interface ExecutorOptions {
  config: RuntimeConfig;
  workDir: string;
}

/**
 * Create a sandboxed executor
 *
 * Uses just-bash OverlayFS for isolated filesystem operations.
 * Real git operations escape the sandbox.
 */
export async function createExecutor(options: ExecutorOptions): Promise<Executor> {
  const sandbox = createSandbox(options.workDir, options.config.sandbox);
  return new Executor(options, sandbox);
}

export class Executor implements SandboxInterface {
  private options: ExecutorOptions;
  private sandbox: SandboxImpl;

  constructor(options: ExecutorOptions, sandbox: SandboxImpl) {
    this.options = options;
    this.sandbox = sandbox;
  }

  /**
   * Execute a bash command in the sandbox
   */
  async bash(command: string): Promise<BashResult> {
    return this.sandbox.bash(command);
  }

  /**
   * Evaluate TypeScript code
   */
  async eval(code: string): Promise<unknown> {
    // TODO: Use just-bash TypeScript interpreter
    // For now, use dynamic import

    const { writeFile, unlink } = await import('fs/promises');
    const { randomUUID } = await import('crypto');
    const path = await import('path');

    const tempFile = path.join(this.options.workDir, `.ralph-eval-${randomUUID()}.ts`);

    try {
      await writeFile(tempFile, code);
      const result = await import(tempFile);
      return result.default || result;
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  }

  /**
   * Read a file from the sandbox filesystem
   */
  async readFile(filePath: string): Promise<string> {
    return this.sandbox.readFile(filePath);
  }

  /**
   * Write a file to the sandbox filesystem
   *
   * Changes are buffered until flush() is called.
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    return this.sandbox.writeFile(filePath, content);
  }

  /**
   * Flush pending changes to the real filesystem
   *
   * Call this before git operations.
   */
  async flush(): Promise<void> {
    await this.sandbox.flush();
  }

  /**
   * Discard pending changes (rollback)
   */
  rollback(): void {
    this.sandbox.rollback();
  }

  /**
   * Get list of pending changes
   */
  getPendingChanges(): string[] {
    const changes = this.sandbox.getPendingChanges();
    return [...changes.writes, ...changes.deletes];
  }

  /**
   * Get the underlying sandbox for advanced operations
   */
  getSandbox(): SandboxImpl {
    return this.sandbox;
  }
}

/**
 * Git operations (escape sandbox)
 */
export class GitOperations {
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  private async exec(command: string): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(command, { cwd: this.workDir });
    return stdout.trim();
  }

  async status(): Promise<string> {
    return this.exec('git status --porcelain');
  }

  async add(files: string | string[]): Promise<void> {
    const fileList = Array.isArray(files) ? files.join(' ') : files;
    await this.exec(`git add ${fileList}`);
  }

  async commit(message: string): Promise<string> {
    return this.exec(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  }

  async log(options: { count?: number; format?: string } = {}): Promise<string> {
    const count = options.count || 10;
    const format = options.format || '%H|%s|%an|%aI';
    return this.exec(`git log -${count} --format="${format}"`);
  }

  async diff(options: { staged?: boolean } = {}): Promise<string> {
    const stagedFlag = options.staged ? '--staged' : '';
    return this.exec(`git diff ${stagedFlag}`);
  }

  async branch(name?: string): Promise<string> {
    if (name) {
      return this.exec(`git checkout -b ${name}`);
    }
    return this.exec('git branch --show-current');
  }

  async checkout(ref: string): Promise<void> {
    await this.exec(`git checkout ${ref}`);
  }
}
