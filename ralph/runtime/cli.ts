/**
 * CLI — Command parsing and dispatch for Ralph
 *
 * Extracted from runtime/index.ts for testability and to provide
 * a proper CLI entry point (package.json bin → dist/cli.js).
 */

import { resolve } from 'path';
import type { RuntimeConfig, TrackerRuntimeConfig } from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export type CliCommand = 'run' | 'discover' | 'sync' | 'status' | 'learn' | 'help';

export interface ParsedArgs {
  command: CliCommand;
  configPath: string;
  dryRun: boolean;
  taskFilter: string | undefined;
}

export interface CliDeps {
  /** Read a file from disk */
  readFile: (path: string, encoding: 'utf-8') => Promise<string>;
  /** Write a file to disk (undefined = dry-run / read-only) */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** Current working directory */
  cwd: string;
  /** Console output */
  log: (message: string) => void;
  /** Console error */
  error: (message: string) => void;
  /** Dynamic import (for lazy-loading modules) */
  importModule: (specifier: string) => Promise<unknown>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const DEFAULT_CONFIG_PATH = './ralph.config.json';

export const HELP_TEXT = `
Ralph - Agentic Delivery OS

Usage: ralph [command] [options]

Commands:
  run         Run the main Ralph loop (default)
  discover    Extract tasks from markdown
  sync        Sync tasks with tracker
  status      Show current task status
  learn       Analyze and propose improvements
  help        Show this help

Options:
  --config=<path>   Path to config file (default: ralph.config.json)
  --dry-run         Don't make changes, just show what would happen
  --task=<id>       Process only the specified task

Examples:
  ralph                    # Run full loop
  ralph run --dry-run      # Preview what would happen
  ralph discover           # Extract tasks only
  ralph status             # Show task status
  ralph sync               # Sync with Jira only
  ralph learn              # Run learning analysis
`;

export const BANNER = [
  '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557',
  '\u2551                         RALPH                              \u2551',
  '\u2551              Agentic Delivery OS v0.1.0                     \u2551',
  '\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d',
].join('\n');

const VALID_COMMANDS = new Set<CliCommand>(['run', 'discover', 'sync', 'status', 'learn', 'help']);

// =============================================================================
// PARSING
// =============================================================================

/**
 * Parse CLI arguments into structured form.
 *
 * @param argv - process.argv.slice(2)
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const command = resolveCommand(argv[0]);
  const dryRun = argv.includes('--dry-run');

  const configArg = argv.find(a => a.startsWith('--config='));
  const configPath = configArg?.split('=')[1] || DEFAULT_CONFIG_PATH;

  const taskArg = argv.find(a => a.startsWith('--task='));
  const taskFilter = taskArg?.split('=')[1];

  return { command, configPath, dryRun, taskFilter };
}

/**
 * Resolve a raw command string to a CliCommand.
 * Returns 'run' for undefined/empty, 'help' for --help/-h.
 * Throws for unknown commands.
 */
export function resolveCommand(raw: string | undefined): CliCommand {
  if (raw === undefined || raw === '') return 'run';
  if (raw === '--help' || raw === '-h') return 'help';
  // Skip flags that aren't commands
  if (raw.startsWith('--')) return 'run';
  if (VALID_COMMANDS.has(raw as CliCommand)) return raw as CliCommand;
  throw new Error(`Unknown command: ${raw}`);
}

// =============================================================================
// CONFIG
// =============================================================================

/**
 * Load and parse ralph.config.json from disk.
 */
export async function loadConfig(
  configPath: string,
  readFileFn: (path: string, encoding: 'utf-8') => Promise<string>,
): Promise<RuntimeConfig> {
  const content = await readFileFn(configPath, 'utf-8');
  return JSON.parse(content) as RuntimeConfig;
}

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

/**
 * Run the main Ralph loop.
 */
export async function runMain(args: ParsedArgs, deps: CliDeps): Promise<number> {
  for (const line of BANNER.split('\n')) deps.log(line);
  deps.log('');

  const workDir = resolve(deps.cwd);
  deps.log(`Working directory: ${workDir}`);
  deps.log(`Config: ${args.configPath}`);
  if (args.dryRun) deps.log('Mode: DRY RUN (no git commits, no tracker sync)');
  if (args.taskFilter) deps.log(`Task filter: ${args.taskFilter}`);
  deps.log('');

  const config = await loadConfig(resolve(workDir, args.configPath), deps.readFile);

  // Apply CLI overrides
  if (args.dryRun) config.loop.dryRun = true;
  if (args.taskFilter) {
    config.loop.taskFilter = args.taskFilter;
    config.loop.maxTasksPerRun = 1;
  }

  const { runLoop } = await deps.importModule('./loop.js') as { runLoop: (config: RuntimeConfig, workDir: string) => Promise<{ tasksFailed: number; tasksCompleted: number }> };
  const result = await runLoop(config, workDir);

  return (result.tasksFailed > 0 && result.tasksCompleted === 0) ? 1 : 0;
}

/**
 * Run task discovery from markdown.
 */
export async function runDiscover(args: ParsedArgs, deps: CliDeps): Promise<number> {
  deps.log('Running task discovery...\n');

  const workDir = resolve(deps.cwd);
  const config = await loadConfig(resolve(workDir, args.configPath), deps.readFile);

  const { discoverTasks, printDiscoverySummary } = await deps.importModule('../skills/discovery/index.js') as {
    discoverTasks: (opts: unknown) => Promise<unknown>;
    printDiscoverySummary: (result: unknown) => void;
  };

  const result = await discoverTasks({
    planPath: config.planFile,
    readFile: (path: string) => deps.readFile(resolve(workDir, path), 'utf-8'),
    writeFile: args.dryRun ? undefined : deps.writeFile
      ? (path: string, content: string) => deps.writeFile!(resolve(workDir, path), content)
      : undefined,
    tasksPath: './state/tasks.jsonl',
    dryRun: args.dryRun,
  });

  printDiscoverySummary(result);
  return 0;
}

/**
 * Show current task status.
 */
export async function runStatus(deps: CliDeps): Promise<number> {
  const workDir = resolve(deps.cwd);
  const tasksPath = resolve(workDir, 'state/tasks.jsonl');

  let content: string;
  try {
    content = await deps.readFile(tasksPath, 'utf-8');
  } catch {
    deps.log('No tasks found. Run "ralph discover" first.');
    return 0;
  }

  const lines = content.trim().split('\n').filter(l => l.trim());
  const tasks = replayTaskOps(lines);

  // Count by status
  const byStatus: Record<string, number> = {};
  for (const task of tasks.values()) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
  }

  deps.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  deps.log('\u2551                     RALPH STATUS                           \u2551');
  deps.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\n');

  deps.log(`Total tasks: ${tasks.size}\n`);
  deps.log('By status:');
  for (const [status, count] of Object.entries(byStatus).sort()) {
    const icon = status === 'done' ? '\u2705' : status === 'in_progress' ? '\uD83D\uDD04' : '\u23F3';
    deps.log(`  ${icon} ${status}: ${count}`);
  }

  // Show in-progress tasks
  const inProgress = Array.from(tasks.values()).filter(t => t.status === 'in_progress');
  if (inProgress.length > 0) {
    deps.log('\nIn Progress:');
    for (const task of inProgress) {
      deps.log(`  \uD83D\uDD04 ${task.id}: ${task.title}`);
    }
  }

  deps.log('');
  return 0;
}

/**
 * Run standalone tracker sync.
 *
 * Loads config, resolves tracker auth from env, creates a SyncContext,
 * and delegates to syncToTracker / syncFromTracker / syncBidirectional.
 *
 * Supports --dry-run (read-only) and --task=<id> (filter to one task).
 */
export async function runSync(args: ParsedArgs, deps: CliDeps): Promise<number> {
  deps.log('Running tracker sync...\n');

  const workDir = resolve(deps.cwd);
  const config = await loadConfig(resolve(workDir, args.configPath), deps.readFile);
  const trackerCfg = config.tracker;

  if (args.dryRun) deps.log('Mode: DRY RUN (no writes)\n');

  // Load full tracker config from configPath
  let fullTrackerConfig: Record<string, unknown>;
  try {
    const raw = await deps.readFile(resolve(workDir, trackerCfg.configPath), 'utf-8');
    fullTrackerConfig = JSON.parse(raw);
  } catch {
    deps.error(`Failed to read tracker config: ${trackerCfg.configPath}`);
    deps.error('Create the tracker config file or update ralph.config.json tracker.configPath');
    return 1;
  }

  // Resolve auth from environment
  const { getTrackerAuth } = await deps.importModule('./loop.js') as {
    getTrackerAuth: (type: string) => { type: string; token: string; email?: string } | null;
  };

  const auth = getTrackerAuth(trackerCfg.type);
  if (!auth) {
    const prefix = trackerCfg.type.toUpperCase().replace(/-/g, '_');
    deps.error(`Missing tracker credentials. Set RALPH_${prefix}_TOKEN (and RALPH_${prefix}_EMAIL for Jira).`);
    return 1;
  }

  // Import sync module and create tracker
  const syncModule = await deps.importModule('../skills/normalize/index.js') as {
    createTracker: (config: unknown, auth: unknown) => Promise<unknown>;
    syncToTracker: (ctx: unknown, opts?: unknown) => Promise<SyncResultShape>;
    syncFromTracker: (ctx: unknown, opts?: unknown) => Promise<SyncResultShape>;
    syncBidirectional: (ctx: unknown, opts?: unknown) => Promise<{ push: SyncResultShape; pull: SyncResultShape }>;
    printSyncSummary: (result: SyncResultShape, direction: string) => void;
  };

  let tracker: unknown;
  try {
    // Load adapter to register factory
    await deps.importModule(`../integrations/${trackerCfg.type}/adapter.js`).catch(() => {});
    tracker = await syncModule.createTracker(fullTrackerConfig, auth);
  } catch (err) {
    deps.error(`Failed to create tracker: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const tasksPath = resolve(workDir, 'state/tasks.jsonl');

  const syncContext = {
    tracker,
    config: fullTrackerConfig,
    readFile: (path: string) => deps.readFile(resolve(workDir, path), 'utf-8'),
    writeFile: args.dryRun
      ? async () => {} // no-op in dry-run
      : deps.writeFile
        ? (path: string, content: string) => deps.writeFile!(resolve(workDir, path), content)
        : async () => {},
    tasksPath,
  };

  const syncOptions: Record<string, unknown> = {};
  if (args.taskFilter) syncOptions.taskIds = [args.taskFilter];
  if (args.dryRun) syncOptions.dryRun = true;

  // Determine direction: push by default, pull if tracker→Ralph is needed
  // For standalone CLI, we do bidirectional sync (pull first, then push)
  try {
    const { push, pull } = await syncModule.syncBidirectional(syncContext, syncOptions);

    deps.log('');
    printSyncResult(deps, pull, 'pull');
    printSyncResult(deps, push, 'push');

    const totalErrors = push.errors.length + pull.errors.length;
    if (totalErrors > 0) {
      deps.log(`\n${totalErrors} error(s) encountered during sync.`);
    }

    deps.log('Sync complete.');
    return totalErrors > 0 ? 1 : 0;
  } catch (err) {
    deps.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

interface SyncResultShape {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ taskId: string; error: string }>;
  duration: number;
}

function printSyncResult(deps: CliDeps, result: SyncResultShape, direction: string): void {
  deps.log(`--- ${direction.toUpperCase()} ---`);
  deps.log(`  Processed: ${result.processed}`);
  deps.log(`  Created:   ${result.created}`);
  deps.log(`  Updated:   ${result.updated}`);
  deps.log(`  Skipped:   ${result.skipped}`);
  deps.log(`  Errors:    ${result.errors.length}`);
  deps.log(`  Duration:  ${(result.duration / 1000).toFixed(1)}s`);

  if (result.errors.length > 0) {
    deps.log('  Errors:');
    for (const err of result.errors) {
      deps.log(`    - ${err.taskId}: ${err.error}`);
    }
  }
  deps.log('');
}

// =============================================================================
// HELPERS
// =============================================================================

interface MinimalTask {
  id: string;
  title: string;
  status: string;
  type: string;
}

/**
 * Replay task operations from JSONL lines into a task map.
 */
export function replayTaskOps(lines: string[]): Map<string, MinimalTask> {
  const tasks = new Map<string, MinimalTask>();

  for (const line of lines) {
    const op = JSON.parse(line);
    if (op.op === 'create') {
      tasks.set(op.task.id, {
        id: op.task.id,
        title: op.task.title,
        status: op.task.status,
        type: op.task.type,
      });
    } else if (op.op === 'update' && tasks.has(op.id)) {
      const task = tasks.get(op.id)!;
      if (op.changes.status) task.status = op.changes.status;
      if (op.changes.title) task.title = op.changes.title;
    }
  }

  return tasks;
}

/**
 * Main CLI dispatch — parse args, run command, return exit code.
 */
export async function dispatch(argv: string[], deps: CliDeps): Promise<number> {
  const args = parseArgs(argv);

  switch (args.command) {
    case 'run':
      return runMain(args, deps);

    case 'discover':
      return runDiscover(args, deps);

    case 'status':
      return runStatus(deps);

    case 'sync':
      return runSync(args, deps);

    case 'learn':
      deps.log('Learning mode');
      deps.log('Use: npm run learn');
      return 0;

    case 'help':
      deps.log(HELP_TEXT);
      return 0;
  }
}
