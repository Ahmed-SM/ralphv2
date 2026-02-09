/**
 * Learning CLI
 *
 * Command-line interface for Ralph's learning system.
 * Analyzes execution history, detects patterns, and generates improvements.
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { Task, TaskOperation } from '../../types/index.js';
import {
  recordTaskMetrics,
  computeAggregateMetrics,
  loadTaskMetrics,
  loadMetricEvents,
  appendMetricEvent,
  getCurrentPeriod,
  printMetricsSummary,
  type TaskMetrics,
  type AggregateMetrics,
  type MetricEvent,
} from '../track/record-metrics.js';
import {
  detectPatterns,
  printPatterns,
  type DetectionContext,
  type PatternDetectionResult,
} from './detect-patterns.js';
import {
  generateImprovements,
  saveProposals,
  loadPendingProposals,
  printProposals,
  type ImprovementResult,
} from './improve-agents.js';

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  const help = args.includes('--help') || args.includes('-h');
  const command = args.find(a => !a.startsWith('-')) || 'analyze';
  const dryRun = args.includes('--dry-run');
  const minConfidence = parseFloat(
    args.find(a => a.startsWith('--min-confidence='))?.split('=')[1] || '0.6'
  );
  const period = args.find(a => a.startsWith('--period='))?.split('=')[1];

  if (help) {
    console.log(`
Learning CLI

Usage: npx tsx skills/discovery/learn-cli.ts [command] [options]

Commands:
  analyze         Run full analysis (metrics + patterns + improvements)
  metrics         Record and display execution metrics
  patterns        Detect patterns in execution history
  improve         Generate improvement proposals
  proposals       View pending improvement proposals

Options:
  --dry-run              Don't write changes
  --min-confidence=N     Minimum pattern confidence (default: 0.6)
  --period=YYYY-MM       Analyze specific period
  --help, -h             Show this help

Examples:
  npx tsx skills/discovery/learn-cli.ts
  npx tsx skills/discovery/learn-cli.ts analyze
  npx tsx skills/discovery/learn-cli.ts metrics --period=2024-01
  npx tsx skills/discovery/learn-cli.ts patterns --min-confidence=0.8
  npx tsx skills/discovery/learn-cli.ts improve --dry-run
`);
    return;
  }

  const workDir = process.cwd();

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                   RALPH LEARNING SYSTEM                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  if (dryRun) {
    console.log('Mode: DRY RUN (no changes will be made)\n');
  }

  try {
    // Create context
    const context = {
      readFile: (path: string) =>
        readFile(resolve(workDir, path.replace(/^\.\//, '')), 'utf-8'),
      writeFile: (path: string, content: string) =>
        writeFile(resolve(workDir, path.replace(/^\.\//, '')), content),
      tasksPath: './state/tasks.jsonl',
      progressPath: './state/progress.jsonl',
      learningPath: './state/learning.jsonl',
    };

    switch (command) {
      case 'metrics':
        await runMetrics(context, { period, dryRun });
        break;

      case 'patterns':
        await runPatterns(context, { minConfidence });
        break;

      case 'improve':
        await runImprove(context, { minConfidence, dryRun });
        break;

      case 'proposals':
        await runProposals(context);
        break;

      case 'analyze':
      default:
        await runFullAnalysis(context, { minConfidence, dryRun, period });
        break;
    }
  } catch (error) {
    console.error('Learning analysis failed:', error);
    process.exit(1);
  }
}

// =============================================================================
// COMMANDS
// =============================================================================

interface LearningContext {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  tasksPath: string;
  progressPath: string;
  learningPath: string;
}

/**
 * Run full analysis pipeline
 */
async function runFullAnalysis(
  context: LearningContext,
  options: { minConfidence: number; dryRun: boolean; period?: string }
): Promise<void> {
  console.log('Running full learning analysis...\n');

  // Step 1: Compute metrics
  const { taskMetrics, aggregates } = await computeMetricsFromTasks(context, options.period);

  if (taskMetrics.length === 0) {
    console.log('No completed tasks found for analysis.');
    return;
  }

  // Step 2: Detect patterns
  const tasks = await loadTasks(context);
  const detectionContext: DetectionContext = {
    tasks,
    metrics: taskMetrics,
    aggregates,
    minConfidence: options.minConfidence,
    minSamples: 3,
  };

  const patternResult = detectPatterns(detectionContext);
  printPatterns(patternResult);

  // Step 3: Generate improvements
  const latestAggregate = aggregates.length > 0 ? aggregates[aggregates.length - 1] : undefined;
  const improvementResult = generateImprovements(patternResult.patterns, latestAggregate);
  printProposals(improvementResult);

  // Step 4: Save results
  if (!options.dryRun && improvementResult.proposals.length > 0) {
    await saveProposals(
      context.readFile,
      context.writeFile,
      context.learningPath,
      improvementResult.proposals
    );
    console.log(`\nSaved ${improvementResult.proposals.length} proposals to ${context.learningPath}`);
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════');
  console.log('  LEARNING ANALYSIS COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Tasks analyzed:     ${taskMetrics.length}`);
  console.log(`  Patterns detected:  ${patternResult.patterns.length}`);
  console.log(`  Proposals created:  ${improvementResult.proposals.length}`);
  console.log('═══════════════════════════════════════════\n');
}

/**
 * Compute and display metrics
 */
async function runMetrics(
  context: LearningContext,
  options: { period?: string; dryRun: boolean }
): Promise<void> {
  console.log('Computing execution metrics...\n');

  const { taskMetrics, aggregates } = await computeMetricsFromTasks(context, options.period);

  if (taskMetrics.length === 0) {
    console.log('No completed tasks found.');
    return;
  }

  // Print metrics for each period
  for (const aggregate of aggregates) {
    printMetricsSummary(aggregate);
  }

  // Save metrics events
  if (!options.dryRun) {
    const timestamp = new Date().toISOString();

    // Save task metrics
    for (const metric of taskMetrics) {
      const event: MetricEvent = {
        type: 'task_metric',
        timestamp,
        data: metric,
      };
      await appendMetricEvent(
        context.readFile,
        context.writeFile,
        context.learningPath,
        event
      );
    }

    // Save aggregate metrics
    for (const aggregate of aggregates) {
      const event: MetricEvent = {
        type: 'aggregate_metric',
        timestamp,
        data: aggregate,
      };
      await appendMetricEvent(
        context.readFile,
        context.writeFile,
        context.learningPath,
        event
      );
    }

    console.log(`\nSaved metrics to ${context.learningPath}`);
  }
}

/**
 * Detect and display patterns
 */
async function runPatterns(
  context: LearningContext,
  options: { minConfidence: number }
): Promise<void> {
  console.log('Detecting patterns in execution history...\n');

  // Load existing metrics from learning.jsonl
  const existingMetrics = await loadTaskMetrics(context.readFile, context.learningPath);

  if (existingMetrics.length === 0) {
    // Fall back to computing from tasks
    const { taskMetrics, aggregates } = await computeMetricsFromTasks(context);

    if (taskMetrics.length === 0) {
      console.log('No metrics available for pattern detection.');
      console.log('Run "metrics" command first to record execution metrics.');
      return;
    }

    const tasks = await loadTasks(context);
    const detectionContext: DetectionContext = {
      tasks,
      metrics: taskMetrics,
      aggregates,
      minConfidence: options.minConfidence,
    };

    const result = detectPatterns(detectionContext);
    printPatterns(result);
    return;
  }

  // Use existing metrics
  const events = await loadMetricEvents(context.readFile, context.learningPath);
  const aggregates = events
    .filter(e => e.type === 'aggregate_metric')
    .map(e => e.data as AggregateMetrics);

  const tasks = await loadTasks(context);
  const detectionContext: DetectionContext = {
    tasks,
    metrics: existingMetrics,
    aggregates,
    minConfidence: options.minConfidence,
  };

  const result = detectPatterns(detectionContext);
  printPatterns(result);
}

/**
 * Generate improvement proposals
 */
async function runImprove(
  context: LearningContext,
  options: { minConfidence: number; dryRun: boolean }
): Promise<void> {
  console.log('Generating improvement proposals...\n');

  // First detect patterns
  const existingMetrics = await loadTaskMetrics(context.readFile, context.learningPath);
  const { taskMetrics, aggregates } = existingMetrics.length > 0
    ? { taskMetrics: existingMetrics, aggregates: [] as AggregateMetrics[] }
    : await computeMetricsFromTasks(context);

  if (taskMetrics.length === 0) {
    console.log('No metrics available for improvement generation.');
    return;
  }

  const tasks = await loadTasks(context);
  const detectionContext: DetectionContext = {
    tasks,
    metrics: taskMetrics,
    aggregates,
    minConfidence: options.minConfidence,
  };

  const patternResult = detectPatterns(detectionContext);

  // Generate improvements
  const latestAggregate = aggregates.length > 0 ? aggregates[aggregates.length - 1] : undefined;
  const result = generateImprovements(patternResult.patterns, latestAggregate);
  printProposals(result);

  // Save proposals
  if (!options.dryRun && result.proposals.length > 0) {
    await saveProposals(
      context.readFile,
      context.writeFile,
      context.learningPath,
      result.proposals
    );
    console.log(`\nSaved ${result.proposals.length} proposals to ${context.learningPath}`);
  }
}

/**
 * View pending proposals
 */
async function runProposals(context: LearningContext): Promise<void> {
  console.log('Loading pending improvement proposals...\n');

  const proposals = await loadPendingProposals(context.readFile, context.learningPath);

  if (proposals.length === 0) {
    console.log('No pending proposals found.');
    return;
  }

  console.log(`Found ${proposals.length} pending proposals:\n`);

  for (const proposal of proposals) {
    console.log(`[${proposal.id}] ${proposal.title}`);
    console.log(`  Target: ${proposal.target}${proposal.section ? ` > ${proposal.section}` : ''}`);
    console.log(`  Priority: ${proposal.priority.toUpperCase()}`);
    console.log(`  Confidence: ${(proposal.confidence * 100).toFixed(0)}%`);
    console.log(`  ${proposal.description}`);
    console.log();
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Load tasks from tasks.jsonl
 */
async function loadTasks(context: LearningContext): Promise<Map<string, Task>> {
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

/**
 * Compute metrics from completed tasks
 */
async function computeMetricsFromTasks(
  context: LearningContext,
  period?: string
): Promise<{ taskMetrics: TaskMetrics[]; aggregates: AggregateMetrics[] }> {
  const tasks = await loadTasks(context);

  // Filter to completed tasks
  const completedTasks = Array.from(tasks.values()).filter(t => t.status === 'done');

  if (completedTasks.length === 0) {
    return { taskMetrics: [], aggregates: [] };
  }

  // Record metrics for each task
  const taskMetrics: TaskMetrics[] = completedTasks.map(task => recordTaskMetrics(task));

  // Group by period
  const targetPeriod = period || getCurrentPeriod();
  const aggregate = computeAggregateMetrics(taskMetrics, targetPeriod);

  return { taskMetrics, aggregates: [aggregate] };
}

main();
