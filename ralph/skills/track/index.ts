/**
 * Track Module
 *
 * Git tracking and activity monitoring for Ralph tasks.
 */

export * from './parse-commits.js';
export * from './link-commits.js';
export * from './infer-status.js';
export * from './record-metrics.js';

import type { Task, TaskOperation } from '../../types/index.js';
import {
  parseGitLog,
  parseSimpleGitLog,
  extractTaskRefs,
  parseBranches,
  buildGitLogCommand,
  type GitCommit,
  type CommitTaskRef,
  type GitBranch,
} from './parse-commits.js';
import {
  linkCommitsToTasks,
  generateLinkOperations,
  generateProgressEvents,
  aggregateByTask,
  filterNewCommits,
  loadProgressEvents,
  appendProgressEvents,
  type ProgressEvent,
} from './link-commits.js';
import {
  inferStatuses,
  generateInferenceOperations,
  detectAnomalies,
  printInferences,
  printAnomalies,
  type StatusInference,
  type StatusAnomaly,
} from './infer-status.js';

// =============================================================================
// WATCHER
// =============================================================================

export interface WatchOptions {
  /** Task ID prefix */
  taskPrefix?: string;
  /** Minimum confidence for status inference */
  minConfidence?: number;
  /** Check for anomalies */
  detectAnomalies?: boolean;
  /** Dry run mode */
  dryRun?: boolean;
  /** Only process commits since this date */
  since?: string;
  /** Maximum commits to process */
  maxCommits?: number;
}

export interface WatchResult {
  commits: GitCommit[];
  taskRefs: CommitTaskRef[];
  newRefs: CommitTaskRef[];
  inferences: StatusInference[];
  anomalies: StatusAnomaly[];
  operations: TaskOperation[];
  progressEvents: ProgressEvent[];
}

export interface WatchContext {
  execCommand: (command: string) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  tasksPath: string;
  progressPath: string;
}

/**
 * Watch git activity and update tasks
 */
export async function watchGitActivity(
  context: WatchContext,
  options: WatchOptions = {}
): Promise<WatchResult> {
  const {
    taskPrefix = 'RALPH',
    minConfidence = 0.7,
    detectAnomalies: checkAnomalies = true,
    dryRun = false,
    since,
    maxCommits = 100,
  } = options;

  console.log('Watching git activity...');

  // Load existing progress to avoid re-processing
  const existingProgress = await loadProgressEvents(context.readFile, context.progressPath);
  console.log(`  Existing progress events: ${existingProgress.length}`);

  // Get git log
  const gitLogCmd = buildGitLogCommand({
    since,
    maxCount: maxCommits,
    format: 'simple',
  });

  let gitOutput: string;
  try {
    gitOutput = await context.execCommand(gitLogCmd);
  } catch (error) {
    console.log('  No git history found or not a git repository');
    return {
      commits: [],
      taskRefs: [],
      newRefs: [],
      inferences: [],
      anomalies: [],
      operations: [],
      progressEvents: [],
    };
  }

  // Parse commits
  const commits = parseSimpleGitLog(gitOutput, '%H|%s|%an|%ae|%aI');
  console.log(`  Found ${commits.length} commits`);

  // Extract task references
  const taskRefs = extractTaskRefs(commits, taskPrefix);
  console.log(`  Task references: ${taskRefs.length}`);

  // Filter out already processed
  const newRefs = filterNewCommits(taskRefs, existingProgress);
  console.log(`  New references: ${newRefs.length}`);

  // Load tasks
  const tasks = await loadTasks(context);
  console.log(`  Loaded ${tasks.size} tasks`);

  // Link commits to tasks
  const linkResults = linkCommitsToTasks(newRefs, tasks);

  // Aggregate by task
  const summaries = aggregateByTask(taskRefs, tasks);

  // Infer status changes
  const inferences = inferStatuses(tasks, summaries, { minConfidence });

  // Detect anomalies
  const anomalies = checkAnomalies ? detectAnomalies(tasks, summaries) : [];

  // Generate operations
  const operations = [
    ...generateLinkOperations(linkResults, tasks),
    ...generateInferenceOperations(inferences, minConfidence),
  ];

  // Generate progress events
  const progressEvents = generateProgressEvents(linkResults);

  // Apply changes (if not dry run)
  if (!dryRun && (operations.length > 0 || progressEvents.length > 0)) {
    // Append task operations
    if (operations.length > 0) {
      await appendTaskOperations(context, operations);
      console.log(`  Applied ${operations.length} task updates`);
    }

    // Append progress events
    if (progressEvents.length > 0) {
      await appendProgressEvents(
        context.readFile,
        context.writeFile,
        context.progressPath,
        progressEvents
      );
      console.log(`  Recorded ${progressEvents.length} progress events`);
    }
  } else if (dryRun) {
    console.log(`  [DRY RUN] Would apply ${operations.length} updates`);
  }

  return {
    commits,
    taskRefs,
    newRefs,
    inferences,
    anomalies,
    operations,
    progressEvents,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

async function loadTasks(context: WatchContext): Promise<Map<string, Task>> {
  const tasks = new Map<string, Task>();

  try {
    const content = await context.readFile(context.tasksPath);
    if (!content.trim()) return tasks;

    const lines = content.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      const op = JSON.parse(line) as TaskOperation;

      switch (op.op) {
        case 'create':
          tasks.set(op.task.id, { ...op.task });
          break;

        case 'update': {
          const task = tasks.get(op.id);
          if (task) {
            Object.assign(task, op.changes);
          }
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
    // File doesn't exist
  }

  return tasks;
}

async function appendTaskOperations(
  context: WatchContext,
  operations: TaskOperation[]
): Promise<void> {
  if (operations.length === 0) return;

  let content = '';
  try {
    content = await context.readFile(context.tasksPath);
  } catch {
    // File doesn't exist
  }

  const newLines = operations.map(op => JSON.stringify(op)).join('\n') + '\n';
  await context.writeFile(context.tasksPath, content + newLines);
}

// =============================================================================
// REPORTING
// =============================================================================

export function printWatchSummary(result: WatchResult): void {
  console.log('\n═══════════════════════════════════════════');
  console.log('  GIT WATCHER SUMMARY');
  console.log('═══════════════════════════════════════════\n');

  console.log('Activity:');
  console.log(`  Commits scanned:     ${result.commits.length}`);
  console.log(`  Task references:     ${result.taskRefs.length}`);
  console.log(`  New references:      ${result.newRefs.length}`);

  console.log('\nChanges:');
  console.log(`  Status inferences:   ${result.inferences.length}`);
  console.log(`  Task updates:        ${result.operations.length}`);
  console.log(`  Progress events:     ${result.progressEvents.length}`);

  if (result.anomalies.length > 0) {
    console.log(`\nAnomalies:             ${result.anomalies.length}`);
  }

  // Print details
  if (result.inferences.length > 0) {
    printInferences(result.inferences);
  }

  if (result.anomalies.length > 0) {
    printAnomalies(result.anomalies);
  }

  console.log('\n═══════════════════════════════════════════\n');
}
