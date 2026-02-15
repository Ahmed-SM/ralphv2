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

export type CliCommand = 'run' | 'discover' | 'sync' | 'status' | 'learn' | 'dashboard' | 'help';

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
  dashboard   Show learning summary report
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
  ralph dashboard          # Show learning summary
`;

export const BANNER = [
  '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557',
  '\u2551                         RALPH                              \u2551',
  '\u2551              Agentic Delivery OS v0.1.0                     \u2551',
  '\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d',
].join('\n');

const VALID_COMMANDS = new Set<CliCommand>(['run', 'discover', 'sync', 'status', 'learn', 'dashboard', 'help']);

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
// LEARN
// =============================================================================

/**
 * Run learning analysis: metrics, pattern detection, and improvement proposals.
 *
 * Supports subcommands via --task:
 *   ralph learn                  → full analysis (metrics + patterns + improvements)
 *   ralph learn --dry-run        → analysis without writing proposals
 *
 * Delegates to skills/discovery and skills/track modules for the heavy lifting.
 */
export async function runLearn(args: ParsedArgs, deps: CliDeps): Promise<number> {
  deps.log('Running learning analysis...\n');

  const workDir = resolve(deps.cwd);
  const config = await loadConfig(resolve(workDir, args.configPath), deps.readFile);

  if (!config.learning.enabled) {
    deps.log('Learning is disabled in config (learning.enabled = false).');
    return 0;
  }

  if (args.dryRun) deps.log('Mode: DRY RUN (no changes will be written)\n');

  const minConfidence = config.learning.minConfidence ?? 0.7;

  // Load modules
  const recordMetricsMod = await deps.importModule('../skills/track/record-metrics.js') as {
    recordTaskMetrics: (task: unknown) => unknown;
    computeAggregateMetrics: (metrics: unknown[], period: string) => unknown;
    getCurrentPeriod: (granularity?: string) => string;
    printMetricsSummary: (aggregate: unknown) => void;
  };

  const detectPatternsMod = await deps.importModule('../skills/discovery/detect-patterns.js') as {
    detectPatterns: (context: unknown) => { patterns: unknown[]; summary: unknown };
    printPatterns: (result: unknown) => void;
  };

  const improveAgentsMod = await deps.importModule('../skills/discovery/improve-agents.js') as {
    generateImprovements: (patterns: unknown[], aggregate?: unknown) => { proposals: unknown[]; summary: unknown };
    saveProposals: (readFile: unknown, writeFile: unknown, path: string, proposals: unknown[]) => Promise<void>;
    loadPendingProposals: (readFile: unknown, path: string) => Promise<Array<{
      id: string; title: string; target: string; section?: string;
      priority: string; confidence: number; description: string;
    }>>;
    printProposals: (result: unknown) => void;
  };

  // Build file I/O functions scoped to working directory
  const readFileFn = (path: string) =>
    deps.readFile(resolve(workDir, path.replace(/^\.\//, '')), 'utf-8');
  const writeFileFn = deps.writeFile
    ? (path: string, content: string) => deps.writeFile!(resolve(workDir, path.replace(/^\.\//, '')), content)
    : async (_path: string, _content: string) => {};

  const tasksPath = './state/tasks.jsonl';
  const learningPath = './state/learning.jsonl';

  // Step 1: Load tasks
  const tasks = await loadTasksForLearning(readFileFn, tasksPath);
  const completedTasks = Array.from(tasks.values()).filter(
    (t: { status: string }) => t.status === 'done'
  );

  if (completedTasks.length === 0) {
    deps.log('No completed tasks found for analysis.');
    deps.log('Run tasks through the Ralph loop first, then analyze.');
    return 0;
  }

  // Step 2: Compute metrics
  const taskMetrics = completedTasks.map(t => recordMetricsMod.recordTaskMetrics(t));
  const period = recordMetricsMod.getCurrentPeriod();
  const aggregate = recordMetricsMod.computeAggregateMetrics(taskMetrics, period);

  deps.log(`Tasks analyzed: ${taskMetrics.length}`);
  deps.log('');
  recordMetricsMod.printMetricsSummary(aggregate);

  // Step 3: Detect patterns
  const detectionContext = {
    tasks,
    metrics: taskMetrics,
    aggregates: [aggregate],
    minConfidence,
    minSamples: 3,
  };

  const patternResult = detectPatternsMod.detectPatterns(detectionContext);
  detectPatternsMod.printPatterns(patternResult);

  // Step 4: Generate improvements
  const improvementResult = improveAgentsMod.generateImprovements(
    patternResult.patterns,
    aggregate
  );
  improveAgentsMod.printProposals(improvementResult);

  // Step 5: Save proposals (unless dry-run)
  if (!args.dryRun && improvementResult.proposals.length > 0) {
    await improveAgentsMod.saveProposals(
      readFileFn,
      writeFileFn,
      learningPath,
      improvementResult.proposals
    );
    deps.log(`\nSaved ${improvementResult.proposals.length} proposal(s) to ${learningPath}`);
  }

  // Step 6: Show pending proposals
  const pending = await improveAgentsMod.loadPendingProposals(readFileFn, learningPath);
  if (pending.length > 0) {
    deps.log(`\nPending proposals: ${pending.length}`);
    for (const p of pending) {
      deps.log(`  [${p.id}] ${p.title} (${p.target}${p.section ? ' > ' + p.section : ''}) — ${(p.confidence * 100).toFixed(0)}% confidence`);
    }
  }

  // Summary
  deps.log('\n--- LEARNING SUMMARY ---');
  deps.log(`  Tasks analyzed:    ${taskMetrics.length}`);
  deps.log(`  Patterns detected: ${patternResult.patterns.length}`);
  deps.log(`  Proposals created: ${improvementResult.proposals.length}`);
  deps.log(`  Pending proposals: ${pending.length}`);
  deps.log('--- END ---\n');

  return 0;
}

/**
 * Load tasks from tasks.jsonl via operation replay, returning a Map<string, Task>.
 * Uses the provided readFile function scoped to the working directory.
 */
async function loadTasksForLearning(
  readFile: (path: string) => Promise<string>,
  tasksPath: string,
): Promise<Map<string, Record<string, unknown>>> {
  const tasks = new Map<string, Record<string, unknown>>();

  try {
    const content = await readFile(tasksPath);
    if (!content.trim()) return tasks;

    const lines = content.trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const op = JSON.parse(line);

      switch (op.op) {
        case 'create':
          tasks.set(op.task.id, { ...op.task });
          break;
        case 'update': {
          const task = tasks.get(op.id);
          if (task) Object.assign(task, op.changes);
          break;
        }
        case 'link': {
          const task = tasks.get(op.id);
          if (task) {
            task.externalId = op.externalId;
            task.externalUrl = op.externalUrl;
          }
          break;
        }
      }
    }
  } catch {
    // File doesn't exist yet — fine
  }

  return tasks;
}

// =============================================================================
// DASHBOARD
// =============================================================================

/**
 * Dashboard data aggregated from learning.jsonl, tasks.jsonl, and progress.jsonl.
 */
export interface DashboardData {
  period: string;
  tasksCompleted: number;
  tasksFailed: number;
  avgIterations: number;
  estimationAccuracy: number;
  patterns: Array<{ pattern: string; description: string }>;
  improvementsApplied: number;
  improvementsPending: number;
  improvementsRejected: number;
  anomalies: Array<{ taskId?: string; description: string; severity: string }>;
}

/**
 * Build dashboard data from raw JSONL lines.
 *
 * Pure function — no I/O, fully testable.
 */
export function buildDashboardData(
  learningLines: string[],
  taskLines: string[],
  progressLines: string[],
  daysWindow: number = 30,
): DashboardData {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysWindow);
  const cutoffIso = cutoff.toISOString();

  // Parse learning events
  const patterns: Array<{ pattern: string; description: string }> = [];
  let improvementsApplied = 0;
  let improvementsPending = 0;
  let improvementsRejected = 0;
  const anomalies: Array<{ taskId?: string; description: string; severity: string }> = [];

  for (const line of learningLines) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }

    const ts = event.timestamp as string | undefined;
    if (ts && ts < cutoffIso) continue;

    switch (event.type) {
      case 'pattern_detected': {
        const data = event.data as Record<string, unknown> | undefined;
        let desc = String(event.pattern);
        if (data) {
          // Build a human-readable description from pattern data
          const parts: string[] = [];
          if (data.area) parts.push(String(data.area));
          if (data.factor) parts.push(`${Number(data.factor).toFixed(1)}x multiplier`);
          if (data.count) parts.push(`${data.count} occurrences`);
          if (data.coverage !== undefined) parts.push(`${(Number(data.coverage) * 100).toFixed(0)}% coverage`);
          if (data.avgFilesPerTask) parts.push(`${Number(data.avgFilesPerTask).toFixed(1)} files/task`);
          if (parts.length > 0) desc += ': ' + parts.join(', ');
        }
        patterns.push({ pattern: String(event.pattern), description: desc });
        break;
      }
      case 'improvement_proposed': {
        const status = event.status as string;
        if (status === 'applied') improvementsApplied++;
        else if (status === 'pending') improvementsPending++;
        else if (status === 'rejected') improvementsRejected++;
        break;
      }
      case 'improvement_applied': {
        improvementsApplied++;
        break;
      }
      case 'anomaly_detected': {
        const ctx = event.context as Record<string, unknown> | undefined;
        const taskId = ctx?.taskId as string | undefined;
        const severity = (event.severity as string) || 'medium';
        anomalies.push({
          taskId,
          description: String(event.anomaly || 'Unknown anomaly'),
          severity,
        });
        break;
      }
    }
  }

  // Parse tasks for completion metrics
  const tasks = new Map<string, Record<string, unknown>>();
  for (const line of taskLines) {
    if (!line.trim()) continue;
    let op: Record<string, unknown>;
    try { op = JSON.parse(line); } catch { continue; }
    if (op.op === 'create') {
      const task = op.task as Record<string, unknown>;
      tasks.set(task.id as string, { ...task });
    } else if (op.op === 'update') {
      const task = tasks.get(op.id as string);
      if (task) Object.assign(task, op.changes as Record<string, unknown>);
    }
  }

  let tasksCompleted = 0;
  let tasksFailed = 0;
  for (const task of tasks.values()) {
    const completedAt = task.completedAt as string | undefined;
    if (completedAt && completedAt < cutoffIso) continue;
    if (task.status === 'done') tasksCompleted++;
    if (task.status === 'cancelled' || task.status === 'blocked') tasksFailed++;
  }

  // Parse progress for iteration counts
  const taskIterations = new Map<string, number>();
  for (const line of progressLines) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'iteration') {
      const ts = event.timestamp as string | undefined;
      if (ts && ts < cutoffIso) continue;
      const taskId = event.taskId as string;
      if (taskId) {
        taskIterations.set(taskId, (taskIterations.get(taskId) || 0) + 1);
      }
    }
  }

  const iterationCounts = Array.from(taskIterations.values());
  const avgIterations = iterationCounts.length > 0
    ? iterationCounts.reduce((a, b) => a + b, 0) / iterationCounts.length
    : 0;

  // Estimation accuracy from completed tasks with estimates
  let accurateCount = 0;
  let estimatedCount = 0;
  for (const task of tasks.values()) {
    if (task.status !== 'done') continue;
    const estimate = task.estimate as number | undefined;
    const actual = task.actual as number | undefined;
    if (estimate !== undefined && actual !== undefined && estimate > 0) {
      estimatedCount++;
      const ratio = actual / estimate;
      if (ratio >= 0.8 && ratio <= 1.2) accurateCount++;
    }
  }
  const estimationAccuracy = estimatedCount > 0
    ? (accurateCount / estimatedCount) * 100
    : 0;

  // Period label
  const now = new Date();
  const period = `Last ${daysWindow} days (${now.toISOString().slice(0, 10)})`;

  return {
    period,
    tasksCompleted,
    tasksFailed,
    avgIterations,
    estimationAccuracy,
    patterns,
    improvementsApplied,
    improvementsPending,
    improvementsRejected,
    anomalies,
  };
}

/**
 * Format dashboard data as a human-readable report.
 *
 * Pure function — no I/O, fully testable.
 */
export function formatDashboard(data: DashboardData): string[] {
  const lines: string[] = [];

  lines.push('');
  lines.push('\u2554' + '\u2550'.repeat(59) + '\u2557');
  lines.push('\u2551                   LEARNING DASHBOARD                       \u2551');
  lines.push('\u255a' + '\u2550'.repeat(59) + '\u255d');
  lines.push('');
  lines.push(`Period: ${data.period}`);
  lines.push('');

  // Task Metrics
  lines.push('### Task Metrics');
  lines.push(`  Tasks completed:     ${data.tasksCompleted}`);
  lines.push(`  Tasks failed:        ${data.tasksFailed}`);
  if (data.avgIterations > 0) {
    lines.push(`  Average iterations:  ${data.avgIterations.toFixed(1)}`);
  }
  if (data.estimationAccuracy > 0) {
    lines.push(`  Estimation accuracy: ${data.estimationAccuracy.toFixed(0)}%`);
  }
  lines.push('');

  // Patterns Detected
  lines.push('### Patterns Detected');
  if (data.patterns.length === 0) {
    lines.push('  No patterns detected.');
  } else {
    for (const p of data.patterns) {
      lines.push(`  - ${p.description}`);
    }
  }
  lines.push('');

  // Improvements
  lines.push('### Improvements');
  const totalImprovements = data.improvementsApplied + data.improvementsPending + data.improvementsRejected;
  if (totalImprovements === 0) {
    lines.push('  No improvements proposed.');
  } else {
    lines.push(`  Applied:  ${data.improvementsApplied}`);
    lines.push(`  Pending:  ${data.improvementsPending}`);
    lines.push(`  Rejected: ${data.improvementsRejected}`);
  }
  lines.push('');

  // Anomalies
  lines.push('### Anomalies');
  if (data.anomalies.length === 0) {
    lines.push('  No anomalies detected.');
  } else {
    for (const a of data.anomalies) {
      const prefix = a.taskId ? `${a.taskId}: ` : '';
      const sev = a.severity === 'high' ? '[HIGH] ' : a.severity === 'medium' ? '[MED] ' : '';
      lines.push(`  - ${sev}${prefix}${a.description}`);
    }
  }
  lines.push('');

  return lines;
}

/**
 * Run the dashboard command — reads state files and displays learning summary.
 *
 * Implements the Metrics Dashboard from specs/learning-system.md.
 */
export async function runDashboard(args: ParsedArgs, deps: CliDeps): Promise<number> {
  deps.log('Loading learning dashboard...\n');

  const workDir = resolve(deps.cwd);

  // Read state files (all optional — missing files produce empty data)
  const learningPath = resolve(workDir, 'state/learning.jsonl');
  const tasksPath = resolve(workDir, 'state/tasks.jsonl');
  const progressPath = resolve(workDir, 'state/progress.jsonl');

  const readSafe = async (path: string): Promise<string[]> => {
    try {
      const content = await deps.readFile(path, 'utf-8');
      return content.trim() ? content.trim().split('\n') : [];
    } catch {
      return [];
    }
  };

  const [learningLines, taskLines, progressLines] = await Promise.all([
    readSafe(learningPath),
    readSafe(tasksPath),
    readSafe(progressPath),
  ]);

  const data = buildDashboardData(learningLines, taskLines, progressLines);
  const output = formatDashboard(data);

  for (const line of output) {
    deps.log(line);
  }

  return 0;
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
      return runLearn(args, deps);

    case 'dashboard':
      return runDashboard(args, deps);

    case 'help':
      deps.log(HELP_TEXT);
      return 0;
  }
}
