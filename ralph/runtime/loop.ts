/**
 * Loop - The Ralph-loop execution engine
 *
 * Implements the core loop:
 * 0. Watch git activity (detect external commits)
 * 1. Read index (AGENTS.md, implementation-plan.md)
 * 2. Pick one task
 * 3. Execute until complete
 * 4. Commit to git
 * 5. Sync to tracker
 * 6. Record learning
 * 7. Repeat
 */

import type {
  Task,
  TaskOperation,
  RuntimeConfig,
  IterationResult,
  ProgressEvent,
  LearningEvent,
  PatternDetectedEvent,
  TrackerConflictEvent,
  LLMProvider,
  LLMUsage,
  LLMConfig,
  LoopHooks,
  RalphPolicy,
} from '../types/index.js';
import { createExecutor, Executor, GitOperations } from './executor.js';
import type {
  TrackerConfig,
  AuthConfig,
} from '../skills/normalize/tracker-interface.js';
import { createTracker, mapStatusToRalph } from '../skills/normalize/tracker-interface.js';
import { executeLLMIteration, loadTaskContext, createDefaultLLMProvider } from './llm.js';
import { detectPatterns, type DetectionContext } from '../skills/discovery/detect-patterns.js';
import { watchGitActivity, type WatchContext, type WatchOptions, type WatchResult } from '../skills/track/index.js';
import { generateImprovements, saveProposals, loadPendingProposals } from '../skills/discovery/improve-agents.js';
import { applyImprovements, markProposalsApplied, updateProposalStatuses, type ApplyContext } from '../skills/discovery/apply-improvements.js';
import { recordTaskMetrics, computeAggregateMetrics, appendMetricEvent, loadTaskMetrics, getCurrentPeriod, type TaskMetrics } from '../skills/track/record-metrics.js';
import { validateOperation, type ValidationResult } from '../skills/discovery/validate-task.js';
import { checkCompletion, createCompletionContext } from './completion.js';
import { dispatchNotification, notifyAnomaly, notifyTaskComplete, notifyLimitReached, type NotificationDeps } from './notifications.js';
import { loadPolicy, defaultPolicy, runRequiredChecks, allChecksPassed, type CheckResult } from './policy.js';

export interface LoopContext {
  config: RuntimeConfig;
  executor: Executor;
  git: GitOperations;
  workDir: string;
  llmProvider?: LLMProvider;
  hooks?: LoopHooks;
  policy?: RalphPolicy;
}

export interface LoopResult {
  tasksProcessed: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalIterations: number;
  duration: number;
  totalCost: number;
}

export interface RunKpiInput {
  tasksProcessed: number;
  tasksCompleted: number;
  taskDurationsMs: number[];
  rollbackCount: number;
  escapedDefects: number;
  humanInterventions: number;
  maxTimePerTaskMs: number;
}

export interface RunKpis {
  successRate: number;
  avgCycleTimeMs: number;
  escapedDefects: number;
  rollbackRate: number;
  humanInterventions: number;
  tasksProcessed: number;
  maxTimePerTaskMs: number;
}

export interface InductionInvariantReport {
  passed: boolean;
  enforced: boolean;
  violations: string[];
  mode: RalphPolicy['mode'];
  kpis: RunKpis;
}

// =============================================================================
// COST TRACKING
// =============================================================================

/** Default cost rates (USD per token) — conservative estimates */
const DEFAULT_COST_PER_INPUT_TOKEN = 0.000003;   // $3 / 1M tokens
const DEFAULT_COST_PER_OUTPUT_TOKEN = 0.000015;   // $15 / 1M tokens

/**
 * Estimate the cost of an LLM call from usage data.
 *
 * Uses configurable per-token rates from LLMConfig, falling back to
 * conservative defaults. Returns 0 when usage data is unavailable.
 */
export function estimateCost(
  usage: LLMUsage | undefined,
  llmConfig?: LLMConfig,
): number {
  if (!usage) return 0;

  const inputRate = llmConfig?.costPerInputToken ?? DEFAULT_COST_PER_INPUT_TOKEN;
  const outputRate = llmConfig?.costPerOutputToken ?? DEFAULT_COST_PER_OUTPUT_TOKEN;

  return usage.inputTokens * inputRate + usage.outputTokens * outputRate;
}

// =============================================================================
// INDUCTION INVARIANT CONTRACT (PHASE 44)
// =============================================================================

/**
 * Compute run-level KPIs used by the induction invariant contract.
 *
 * KPI set (per Phase 44):
 * - success rate
 * - average cycle time
 * - escaped defects
 * - rollback rate
 * - human interventions
 */
export function computeRunKpis(input: RunKpiInput): RunKpis {
  const {
    tasksProcessed,
    tasksCompleted,
    taskDurationsMs,
    rollbackCount,
    escapedDefects,
    humanInterventions,
    maxTimePerTaskMs,
  } = input;

  const avgCycleTimeMs = taskDurationsMs.length > 0
    ? taskDurationsMs.reduce((sum, d) => sum + d, 0) / taskDurationsMs.length
    : 0;

  const denominator = tasksProcessed > 0 ? tasksProcessed : 1;

  return {
    successRate: tasksCompleted / denominator,
    avgCycleTimeMs,
    escapedDefects,
    rollbackRate: rollbackCount / denominator,
    humanInterventions,
    tasksProcessed,
    maxTimePerTaskMs,
  };
}

/**
 * Validate the system-level induction invariant.
 *
 * Enforcement applies in delivery mode:
 * - successRate >= 0.80
 * - avgCycleTimeMs <= maxTimePerTaskMs
 * - escapedDefects = 0
 * - rollbackRate <= 0.30
 * - humanInterventions <= max(1, ceil(tasksProcessed * 0.20))
 */
export function validateInductionInvariant(
  kpis: RunKpis,
  mode: RalphPolicy['mode'] = 'delivery',
): InductionInvariantReport {
  // Core mode: record KPIs but do not enforce the delivery induction gate.
  if (mode === 'core') {
    return {
      passed: true,
      enforced: false,
      violations: [],
      mode,
      kpis,
    };
  }

  if (kpis.tasksProcessed === 0) {
    return {
      passed: true,
      enforced: true,
      violations: [],
      mode,
      kpis,
    };
  }

  const violations: string[] = [];

  if (kpis.successRate < 0.8) {
    violations.push(`success_rate_below_threshold:${kpis.successRate.toFixed(3)}<0.800`);
  }
  if (kpis.avgCycleTimeMs > kpis.maxTimePerTaskMs) {
    violations.push(`cycle_time_exceeds_limit:${Math.round(kpis.avgCycleTimeMs)}>${kpis.maxTimePerTaskMs}`);
  }
  if (kpis.escapedDefects > 0) {
    violations.push(`escaped_defects_nonzero:${kpis.escapedDefects}`);
  }
  if (kpis.rollbackRate > 0.3) {
    violations.push(`rollback_rate_above_threshold:${kpis.rollbackRate.toFixed(3)}>0.300`);
  }

  const maxInterventions = Math.max(1, Math.ceil(kpis.tasksProcessed * 0.2));
  if (kpis.humanInterventions > maxInterventions) {
    violations.push(`human_interventions_above_threshold:${kpis.humanInterventions}>${maxInterventions}`);
  }

  return {
    passed: violations.length === 0,
    enforced: true,
    violations,
    mode,
    kpis,
  };
}

// =============================================================================
// POLICY CHECKS
// =============================================================================

/**
 * Run required policy checks (test, build, lint, typecheck) before committing.
 *
 * If all checks pass, flushes the sandbox and commits.
 * If any check fails and rollbackOnFail is set, rolls back the sandbox.
 *
 * Returns true if checks passed (or no checks required), false if failed.
 */
export async function runPolicyChecksBeforeCommit(
  context: LoopContext,
  task: Task,
  dryRun: boolean,
): Promise<boolean> {
  const { config, executor, git, policy } = context;

  // If no policy or no required checks, just commit
  if (!policy || policy.checks.required.length === 0) {
    if (config.git.autoCommit && !dryRun) {
      await executor.flush();
      await git.add('.');
      await git.commit(`${config.git.commitPrefix}${task.id}: ${task.title}`);
    } else if (config.git.autoCommit && dryRun) {
      console.log(`  [DRY RUN] Would commit: ${config.git.commitPrefix}${task.id}: ${task.title}`);
    }
    return true;
  }

  // Build the commands map from config
  const commands: Record<string, string> = {};
  const rawCommands = (config as unknown as Record<string, unknown>).commands as Record<string, string> | undefined;
  if (rawCommands) {
    Object.assign(commands, rawCommands);
  }
  // Also check sandbox commands (the config might have test/build commands elsewhere)
  if (!commands.test) commands.test = 'npm test';
  if (!commands.build) commands.build = 'npm run build';
  if (!commands.lint) commands.lint = 'npm run lint';
  if (!commands.typecheck) commands.typecheck = 'npm run typecheck';

  // Flush first so checks run against the actual file state
  await executor.flush();

  console.log(`  Policy: running ${policy.checks.required.length} required checks...`);
  const checkResults = await runRequiredChecks(policy, commands, executor);

  // Log individual check results
  for (const cr of checkResults) {
    const status = cr.passed ? 'PASS' : 'FAIL';
    console.log(`  Policy: [${status}] ${cr.check} (${cr.duration}ms)`);
  }

  if (allChecksPassed(checkResults)) {
    // All checks passed — commit
    if (config.git.autoCommit && !dryRun) {
      await git.add('.');
      await git.commit(`${config.git.commitPrefix}${task.id}: ${task.title}`);
    } else if (config.git.autoCommit && dryRun) {
      console.log(`  [DRY RUN] Would commit: ${config.git.commitPrefix}${task.id}: ${task.title}`);
    }
    return true;
  }

  // Checks failed
  console.log(`  Policy: required checks failed`);

  if (policy.checks.rollbackOnFail) {
    executor.rollback();
    console.log(`  Policy: sandbox rolled back due to failed checks`);
  }

  // Log a policy_violation progress event
  await appendJsonl(executor, './state/progress.jsonl', {
    type: 'policy_violation',
    taskId: task.id,
    violationType: 'checks_failed',
    target: checkResults.filter(cr => !cr.passed).map(cr => cr.check).join(', '),
    rule: 'required checks must pass before commit',
    timestamp: new Date().toISOString(),
  } as ProgressEvent);

  return false;
}

// =============================================================================
// HOOK INVOCATION
// =============================================================================

/**
 * Safely invoke a loop hook. Hook errors are logged but never crash the loop.
 */
export function invokeHook<K extends keyof LoopHooks>(
  hooks: LoopHooks | undefined,
  name: K,
  ...args: Parameters<NonNullable<LoopHooks[K]>>
): void {
  if (!hooks || typeof hooks[name] !== 'function') return;
  try {
    (hooks[name] as (...a: unknown[]) => void)(...args);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown hook error';
    console.log(`  Hook ${name} failed: ${msg}`);
  }
}

/**
 * Run the main Ralph loop
 */
export async function runLoop(config: RuntimeConfig, workDir: string): Promise<LoopResult> {
  const startTime = Date.now();
  const dryRun = config.loop.dryRun ?? false;
  const taskFilter = config.loop.taskFilter;

  // Load policy from disk (falls back to permissive default)
  let policy: RalphPolicy | undefined;
  if (config.policyFile) {
    const { readFile } = await import('fs/promises');
    policy = await loadPolicy(config.policyFile, (p, enc) => readFile(p, enc)) ?? undefined;
    if (policy) {
      console.log(`Policy loaded: mode=${policy.mode}, checks=${policy.checks.required.join(',') || 'none'}`);
    } else {
      console.log(`Policy file ${config.policyFile} not found or invalid, using default policy`);
      policy = defaultPolicy();
    }
  }

  const executor = await createExecutor({ config, workDir, policy });
  const git = new GitOperations(workDir);

  // Initialize LLM provider if configured
  const llmProvider = await createDefaultLLMProvider(config.llm) ?? undefined;

  const context: LoopContext = {
    config,
    executor,
    git,
    workDir,
    llmProvider,
    policy,
  };

  const result: LoopResult = {
    tasksProcessed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalIterations: 0,
    duration: 0,
    totalCost: 0,
  };
  const taskDurationsMs: number[] = [];
  let rollbackCount = 0;
  let escapedDefects = 0;
  let humanInterventions = 0;

  if (dryRun) {
    console.log('[DRY RUN] Ralph loop starting (no git commits, no tracker sync)...');
  } else {
    console.log('Ralph loop starting...');
  }
  console.log(`Plan file: ${config.planFile}`);
  if (taskFilter) {
    console.log(`Task filter: ${taskFilter}`);
  }

  // Main loop
  while (result.tasksProcessed < config.loop.maxTasksPerRun) {
    // Check time limit
    if (Date.now() - startTime > config.loop.maxTimePerRun) {
      console.log('Time limit reached, stopping loop');
      await notifyLimitReached('maxTimePerRun', `${((Date.now() - startTime) / 1000).toFixed(0)}s`, config.notifications).catch(() => {});
      break;
    }

    // Check run cost limit
    if (result.totalCost >= config.loop.maxCostPerRun) {
      console.log(`Run cost limit reached ($${result.totalCost.toFixed(4)} >= $${config.loop.maxCostPerRun}), stopping loop`);
      await notifyLimitReached('maxCostPerRun', `$${result.totalCost.toFixed(4)}`, config.notifications).catch(() => {});
      break;
    }

    // 0. Run git watcher to detect external activity
    await runGitWatcher(context);

    // 0.5. Pull external tracker status updates
    if (!dryRun) {
      const pullResult = await pullFromTracker(context);
      humanInterventions += pullResult.conflicts;
    } else {
      if (config.tracker.autoPull) {
        console.log('  [DRY RUN] Would pull tracker status updates');
      }
    }

    // 1. Read indices
    const agents = await executor.readFile(config.agentsFile);
    const plan = await executor.readFile(config.planFile);

    console.log(`Read AGENTS.md (${agents.length} bytes)`);
    console.log(`Read implementation-plan.md (${plan.length} bytes)`);

    // 2. Pick next task
    const task = await pickNextTask(context, taskFilter);
    if (!task) {
      console.log('No more tasks to process');
      break;
    }

    console.log(`\nProcessing task: ${task.id} - ${task.title}`);
    result.tasksProcessed++;

    // Hook: onTaskStart
    invokeHook(context.hooks, 'onTaskStart', task);

    // 3. Mark task in progress (promote discovered → pending first per spec lifecycle)
    if (task.status === 'discovered') {
      await updateTaskStatus(context, task.id, 'pending');
    }
    await updateTaskStatus(context, task.id, 'in_progress');

    // 4. Execute task loop
    const taskStartTime = Date.now();
    const taskResult = await executeTaskLoop(context, task, result.totalCost);
    result.totalIterations += taskResult.iterations;
    result.totalCost += taskResult.cost;

    // 5. Handle result
    let taskSuccess = taskResult.success;

    if (taskResult.success) {
      // Run policy checks and commit (checks may rollback on failure)
      const checksOk = await runPolicyChecksBeforeCommit(context, task, dryRun);

      if (checksOk) {
        await updateTaskStatus(context, task.id, 'done');
        result.tasksCompleted++;
      } else {
        // Policy checks failed — treat as task failure
        escapedDefects++;
        taskSuccess = false;
        console.log(`  Task ${task.id} succeeded but policy checks failed`);
      }
    }

    if (!taskSuccess && !taskResult.success) {
      // Rollback sandbox to discard failed task's pending changes
      executor.rollback();
      rollbackCount++;
      console.log(`  Sandbox rolled back for failed task ${task.id}`);

      if (config.loop.onFailure === 'retry') {
        // Retry mode: re-attempt the task up to maxRetries times
        const maxRetries = config.loop.maxRetries ?? 1;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          console.log(`  Retrying task ${task.id} (attempt ${attempt}/${maxRetries})`);

          const retryResult = await executeTaskLoop(context, task, result.totalCost);
          result.totalIterations += retryResult.iterations;
          result.totalCost += retryResult.cost;

          if (retryResult.success) {
            const retryChecksOk = await runPolicyChecksBeforeCommit(context, task, dryRun);

            if (retryChecksOk) {
              await updateTaskStatus(context, task.id, 'done');
              result.tasksCompleted++;
              taskSuccess = true;
            } else {
              escapedDefects++;
              console.log(`  Retry attempt ${attempt} succeeded but policy checks failed`);
              // Continue to next retry attempt
            }

            if (taskSuccess) break;
          } else {
            // Rollback between retry attempts
            executor.rollback();
            rollbackCount++;
            console.log(`  Retry attempt ${attempt} failed: ${retryResult.reason}`);
          }
        }
      }

      if (!taskSuccess) {
        await updateTaskStatus(context, task.id, 'blocked', taskResult.reason || 'policy checks failed');
        result.tasksFailed++;

        if (config.loop.onFailure === 'stop') {
          console.log('Task failed, stopping loop');
          break;
        }
      }
    } else if (!taskSuccess) {
      // Policy checks failed on initial success (no retry for check failures from task success)
      await updateTaskStatus(context, task.id, 'blocked', 'policy checks failed');
      result.tasksFailed++;

      if (config.loop.onFailure === 'stop') {
        console.log('Task failed (policy checks), stopping loop');
        break;
      }
    }

    taskDurationsMs.push(Date.now() - taskStartTime);

    // Hook: onTaskEnd
    invokeHook(context.hooks, 'onTaskEnd', task, taskSuccess);

    // Notify on task completion/failure (if configured)
    await notifyTaskComplete(task, taskSuccess, config.notifications).catch(() => {});

    // 6. Record learning and run analysis
    if (config.learning.enabled) {
      await recordTaskCompletion(context, task, taskResult);
      await runLearningAnalysis(context, task, taskResult);
    }

    // 7. Sync to tracker (skip in dry-run mode)
    if (!dryRun) {
      await syncTaskToTracker(context, task, taskSuccess);
    } else {
      console.log(`  [DRY RUN] Would sync task ${task.id} to tracker`);
    }
  }

  result.duration = Date.now() - startTime;

  // Phase 44 invariant validation (delivery mode gate)
  const runKpis = computeRunKpis({
    tasksProcessed: result.tasksProcessed,
    tasksCompleted: result.tasksCompleted,
    taskDurationsMs,
    rollbackCount,
    escapedDefects,
    humanInterventions,
    maxTimePerTaskMs: config.loop.maxTimePerTask,
  });
  const mode = policy?.mode ?? 'core';
  const invariant = validateInductionInvariant(runKpis, mode);

  if (invariant.passed) {
    await appendJsonl(executor, './state/progress.jsonl', {
      type: 'induction_invariant_validated',
      mode: invariant.mode,
      enforced: invariant.enforced,
      kpis: invariant.kpis,
      timestamp: new Date().toISOString(),
    } as ProgressEvent);
  } else {
    await appendJsonl(executor, './state/progress.jsonl', {
      type: 'induction_invariant_violation',
      mode: invariant.mode,
      violations: invariant.violations,
      kpis: invariant.kpis,
      timestamp: new Date().toISOString(),
    } as ProgressEvent);

    const anomalyEvent = {
      type: 'anomaly_detected',
      anomaly: 'induction_invariant_violation',
      severity: 'high',
      context: {
        mode: invariant.mode,
        violations: invariant.violations,
        kpis: invariant.kpis,
      },
      timestamp: new Date().toISOString(),
    };
    await appendJsonl(executor, './state/learning.jsonl', anomalyEvent);
    invokeHook(context.hooks, 'onAnomaly', anomalyEvent);
    await notifyAnomaly(anomalyEvent, config.notifications).catch(() => {});
  }

  console.log('\nRalph loop complete:');
  console.log(`  Tasks processed: ${result.tasksProcessed}`);
  console.log(`  Tasks completed: ${result.tasksCompleted}`);
  console.log(`  Tasks failed: ${result.tasksFailed}`);
  console.log(`  Total iterations: ${result.totalIterations}`);
  console.log(`  Total cost: $${result.totalCost.toFixed(4)}`);
  console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
  console.log(`  Invariant (${invariant.mode}${invariant.enforced ? ', enforced' : ', advisory'}): ${invariant.passed ? 'PASS' : 'FAIL'}`);
  if (!invariant.passed) {
    for (const violation of invariant.violations) {
      console.log(`    - ${violation}`);
    }
  }

  return result;
}

/**
 * Pick the next task to work on
 *
 * When taskFilter is provided, only that specific task ID is considered.
 */
export async function pickNextTask(context: LoopContext, taskFilter?: string): Promise<Task | null> {
  const tasksLog = await readJsonl<TaskOperation>(
    context.executor,
    './state/tasks.jsonl'
  );

  // Derive current state
  const tasks = deriveTaskState(tasksLog);

  // If a specific task is requested, return it directly (if eligible)
  if (taskFilter) {
    const target = tasks.get(taskFilter);
    if (!target) return null;
    // Allow picking even blocked tasks when explicitly requested
    if (target.status === 'done' || target.status === 'cancelled') return null;
    return target;
  }

  // Filter candidates
  const candidates = Array.from(tasks.values())
    .filter(t => t.status === 'pending' || t.status === 'in_progress' || t.status === 'discovered')
    .filter(t => !isBlocked(t, tasks))
    .sort((a, b) => {
      // In-progress first
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
      // Then by priority (higher number = higher priority)
      const aPriority = a.priority ?? 0;
      const bPriority = b.priority ?? 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      // Then by creation time (oldest first)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  return candidates[0] || null;
}

/**
 * Derive current task state from operation log
 */
export function deriveTaskState(log: TaskOperation[]): Map<string, Task> {
  const tasks = new Map<string, Task>();

  for (const op of log) {
    switch (op.op) {
      case 'create':
        tasks.set(op.task.id, { ...op.task });
        break;

      case 'update': {
        const task = tasks.get(op.id);
        if (task) {
          Object.assign(task, op.changes, { updatedAt: op.timestamp });
        }
        break;
      }

      case 'link': {
        const task = tasks.get(op.id);
        if (task) {
          task.externalId = op.externalId;
          task.externalUrl = op.externalUrl;
          task.updatedAt = op.timestamp;
        }
        break;
      }

      case 'relate': {
        const task = tasks.get(op.id);
        if (task) {
          if (op.relation === 'blocks') {
            task.blocks = task.blocks || [];
            task.blocks.push(op.targetId);
          } else if (op.relation === 'blockedBy') {
            task.blockedBy = task.blockedBy || [];
            task.blockedBy.push(op.targetId);
          } else if (op.relation === 'parent') {
            task.parent = op.targetId;
          } else if (op.relation === 'subtask') {
            task.subtasks = task.subtasks || [];
            task.subtasks.push(op.targetId);
          }
          task.updatedAt = op.timestamp;
        }
        break;
      }
    }
  }

  return tasks;
}

/**
 * Check if a task is blocked
 */
export function isBlocked(task: Task, allTasks: Map<string, Task>): boolean {
  if (!task.blockedBy || task.blockedBy.length === 0) {
    return false;
  }

  return task.blockedBy.some(blockerId => {
    const blocker = allTasks.get(blockerId);
    return blocker && blocker.status !== 'done' && blocker.status !== 'cancelled';
  });
}

/**
 * Execute the inner task loop
 */
export async function executeTaskLoop(
  context: LoopContext,
  task: Task,
  runCostSoFar = 0,
): Promise<{ success: boolean; iterations: number; reason?: string; cost: number }> {
  const { config } = context;
  let iterations = 0;
  let taskCost = 0;
  const startTime = Date.now();

  while (iterations < config.loop.maxIterationsPerTask) {
    // Check time limit
    if (Date.now() - startTime > config.loop.maxTimePerTask) {
      return {
        success: false,
        iterations,
        reason: 'Time limit exceeded',
        cost: taskCost,
      };
    }

    // Check per-task cost limit
    if (taskCost >= config.loop.maxCostPerTask) {
      console.log(`  Cost limit reached for task ($${taskCost.toFixed(4)} >= $${config.loop.maxCostPerTask})`);
      return {
        success: false,
        iterations,
        reason: `Task cost limit exceeded ($${taskCost.toFixed(4)})`,
        cost: taskCost,
      };
    }

    // Check per-run cost limit
    if (runCostSoFar + taskCost >= config.loop.maxCostPerRun) {
      console.log(`  Run cost limit reached ($${(runCostSoFar + taskCost).toFixed(4)} >= $${config.loop.maxCostPerRun})`);
      return {
        success: false,
        iterations,
        reason: `Run cost limit exceeded ($${(runCostSoFar + taskCost).toFixed(4)})`,
        cost: taskCost,
      };
    }

    iterations++;
    console.log(`  Iteration ${iterations}/${config.loop.maxIterationsPerTask}`);

    // Hook: onIterationStart
    invokeHook(context.hooks, 'onIterationStart', task, iterations);

    // Execute iteration
    const result = await executeIteration(context, task, iterations);

    // Track cost from LLM usage
    const iterationCost = estimateCost(result.usage, config.llm);
    taskCost += iterationCost;

    // Log progress (include cost)
    await appendJsonl(context.executor, './state/progress.jsonl', {
      type: 'iteration',
      taskId: task.id,
      iteration: iterations,
      result: result.status,
      cost: iterationCost,
      taskCostSoFar: taskCost,
      timestamp: new Date().toISOString(),
    } as ProgressEvent);

    // Hook: onIterationEnd
    invokeHook(context.hooks, 'onIterationEnd', task, iterations, result);

    // Check result
    if (result.status === 'complete') {
      console.log(`  Task complete: ${result.artifacts?.join(', ')} (cost: $${taskCost.toFixed(4)})`);
      return { success: true, iterations, cost: taskCost };
    }

    if (result.status === 'blocked') {
      console.log(`  Task blocked: ${result.blocker}`);
      return { success: false, iterations, reason: result.blocker, cost: taskCost };
    }

    if (result.status === 'failed') {
      console.log(`  Iteration failed: ${result.error}`);
      // Continue to retry unless max iterations reached
    }

    // Check task-defined completion criteria (test_passing, file_exists, validate)
    if (task.completion) {
      const completionCtx = createCompletionContext(context.executor);
      const completionCheck = await checkCompletion(task, completionCtx);
      if (completionCheck?.complete) {
        console.log(`  Completion criteria met: ${completionCheck.reason} (cost: $${taskCost.toFixed(4)})`);
        return { success: true, iterations, cost: taskCost };
      }
    }

    // Continue to next iteration
    console.log(`  Continuing: ${(result as { reason?: string }).reason || 'work in progress'}`);
  }

  return {
    success: false,
    iterations,
    reason: 'Max iterations reached',
    cost: taskCost,
  };
}

/**
 * Execute a single iteration
 *
 * When an LLM provider is available (context.llmProvider), this delegates
 * to the LLM pipeline which:
 *   1. Loads task spec and agent instructions
 *   2. Builds a prompt
 *   3. Calls the LLM with sandbox tools
 *   4. Executes tool calls and interprets the result
 *
 * When no LLM provider is configured, falls back to the heuristic
 * that checks whether the task's spec file already exists.
 */
export async function executeIteration(
  context: LoopContext,
  task: Task,
  iteration: number
): Promise<IterationResult & { usage?: LLMUsage }> {
  // LLM-powered execution path
  if (context.llmProvider) {
    try {
      const { specContent, agentInstructions } = await loadTaskContext(
        context.executor,
        task,
      );
      const { result, actions, usage } = await executeLLMIteration(
        context.llmProvider,
        context.executor,
        task,
        iteration,
        { specContent, agentInstructions },
      );
      // Hook: onAction for each action executed during this iteration
      for (const action of actions) {
        invokeHook(context.hooks, 'onAction', action);
      }
      return { ...result, usage };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown LLM error';
      console.log(`  LLM iteration failed: ${msg}`);
      return { status: 'failed', error: msg };
    }
  }

  // Fallback: heuristic execution (no LLM configured)
  if (task.spec) {
    try {
      const specContent = await context.executor.readFile(task.spec);
      if (specContent.length > 0) {
        return {
          status: 'complete',
          artifacts: [task.spec],
        };
      }
    } catch {
      // Spec doesn't exist, task needs work
    }
  }

  if (task.status === 'discovered') {
    return {
      status: 'continue',
      reason: 'Task discovered, needs implementation',
    };
  }

  return {
    status: 'continue',
    reason: `Iteration ${iteration} complete, more work needed`,
  };
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  context: LoopContext,
  taskId: string,
  status: Task['status'],
  reason?: string
): Promise<void> {
  const op: TaskOperation = {
    op: 'update',
    id: taskId,
    changes: {
      status,
      ...(status === 'done' ? { completedAt: new Date().toISOString() } : {}),
    },
    source: 'agent',
    timestamp: new Date().toISOString(),
  };

  const validation = await validateAndAppendTaskOp(context.executor, './state/tasks.jsonl', op);
  if (!validation.valid) {
    console.log(`  Warning: Task ${taskId} status update to '${status}' had validation errors (applied anyway for resilience)`);
    // Still append to preserve backwards compatibility — validation is advisory
    // The validateAndAppendTaskOp already appended if valid, so only append if invalid
    await appendJsonl(context.executor, './state/tasks.jsonl', op);
  }

  if (reason) {
    await appendJsonl(context.executor, './state/progress.jsonl', {
      type: 'status_change',
      taskId,
      status,
      reason,
      timestamp: new Date().toISOString(),
    } as ProgressEvent);
  }
}

/**
 * Record task completion for learning
 */
export async function recordTaskCompletion(
  context: LoopContext,
  task: Task,
  result: { success: boolean; iterations: number; reason?: string }
): Promise<void> {
  // Compute git diff stats from the last commit (if available)
  let filesChanged = 0;
  let linesChanged = 0;
  if (result.success) {
    try {
      const stats = await context.git.diffStats();
      filesChanged = stats.filesChanged;
      linesChanged = stats.linesChanged;
    } catch {
      // Git stats are best-effort
    }
  }

  const event: LearningEvent = {
    type: 'task_completed',
    taskId: task.id,
    estimate: task.estimate,
    actual: result.iterations, // Using iterations as effort proxy
    iterations: result.iterations,
    taskType: task.type,
    complexity: task.complexity,
    filesChanged,
    linesChanged,
    success: result.success,
    blockers: result.reason ? [result.reason] : undefined,
    timestamp: new Date().toISOString(),
  };

  await appendJsonl(context.executor, './state/learning.jsonl', event);
}

// =============================================================================
// LEARNING ANALYSIS
// =============================================================================

/**
 * Run learning analysis after task completion.
 *
 * This wires the existing pattern detection and improvement proposal
 * components into the main loop. After each task completes:
 *   1. Record detailed task metrics
 *   2. Load all historical task metrics
 *   3. Run pattern detection
 *   4. Generate improvement proposals from detected patterns
 *   5. Persist pattern events and proposals to learning.jsonl
 *
 * Errors are logged but never crash the loop.
 */
export async function runLearningAnalysis(
  context: LoopContext,
  task: Task,
  result: { success: boolean; iterations: number; reason?: string }
): Promise<void> {
  const { config, executor, git } = context;

  try {
    // 1. Compute and record detailed task metrics
    let filesChanged = 0;
    let linesChanged = 0;
    if (result.success) {
      try {
        const stats = await git.diffStats();
        filesChanged = stats.filesChanged;
        linesChanged = stats.linesChanged;
      } catch {
        // best-effort
      }
    }

    const taskMetric = recordTaskMetrics(task, {
      iterations: result.iterations,
      filesChanged,
      linesChanged,
      blockers: result.reason ? [result.reason] : undefined,
    });

    await appendMetricEvent(
      (p: string) => executor.readFile(p),
      (p: string, c: string) => executor.writeFile(p, c),
      './state/learning.jsonl',
      { type: 'task_metric', timestamp: new Date().toISOString(), data: taskMetric }
    );

    // 2. Load historical metrics for pattern detection
    const allMetrics = await loadTaskMetrics(
      (p: string) => executor.readFile(p),
      './state/learning.jsonl'
    );

    // 3. Derive current task state for context
    const tasksLog = await readJsonl<TaskOperation>(executor, './state/tasks.jsonl');
    const tasks = deriveTaskState(tasksLog);

    // 4. Compute aggregate metrics for the current period
    const period = getCurrentPeriod('month');
    const aggregates = computeAggregateMetrics(allMetrics, period);

    // 5. Run pattern detection
    const detectionContext: DetectionContext = {
      tasks,
      metrics: allMetrics,
      aggregates: [aggregates],
      minConfidence: config.learning.minConfidence,
    };

    const detectionResult = detectPatterns(detectionContext);

    // 6. Log detected patterns to learning.jsonl and fire anomaly hooks
    for (const pattern of detectionResult.patterns) {
      await appendJsonl(executor, './state/learning.jsonl', {
        type: 'pattern_detected',
        pattern: pattern.type,
        confidence: pattern.confidence,
        data: pattern.data,
        evidence: pattern.evidence,
        timestamp: pattern.timestamp,
      } as PatternDetectedEvent);

      // Fire onAnomaly hook for anomaly-type patterns
      if (pattern.type === 'iteration_anomaly' || pattern.type === 'failure_mode') {
        const severity = pattern.confidence >= 0.9 ? 'high'
          : pattern.confidence >= 0.7 ? 'medium'
          : 'low';
        const anomalyEvent = {
          type: 'anomaly_detected' as const,
          anomaly: pattern.description,
          severity,
          context: { pattern: pattern.type, ...pattern.data },
          timestamp: pattern.timestamp,
        };
        invokeHook(context.hooks, 'onAnomaly', anomalyEvent);
        // Notify via configured channel
        await notifyAnomaly(anomalyEvent, config.notifications).catch(() => {});
      }
    }

    // 7. Generate improvement proposals if patterns detected
    if (detectionResult.patterns.length > 0) {
      const improvements = generateImprovements(detectionResult.patterns, aggregates);

      if (improvements.proposals.length > 0) {
        await saveProposals(
          (p: string) => executor.readFile(p),
          (p: string, c: string) => executor.writeFile(p, c),
          './state/learning.jsonl',
          improvements.proposals
        );

        console.log(`  Learning: ${detectionResult.patterns.length} patterns detected, ${improvements.proposals.length} improvements proposed`);
      }
    }

    if (detectionResult.patterns.length === 0) {
      console.log('  Learning: no patterns detected (need more data)');
    }

    // 8. Auto-apply improvements if configured
    if (config.learning.autoApplyImprovements) {
      await autoApplyImprovements(context);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`  Learning analysis failed: ${msg}`);
  }
}

/**
 * Auto-apply pending improvement proposals.
 *
 * Loads all pending proposals from learning.jsonl, applies them to target files
 * on a dedicated branch (ralph/learn-{timestamp}), and logs ImprovementAppliedEvents.
 *
 * Per the learning-system spec:
 *   1. Create branch: ralph/learn-{timestamp}
 *   2. Apply change to target file
 *   3. Commit with message: RALPH-LEARN: {description}
 *   4. Log ImprovementAppliedEvent
 *
 * Errors are logged but never crash the loop.
 */
export async function autoApplyImprovements(
  context: LoopContext,
): Promise<void> {
  const { executor, git } = context;
  const learningPath = './state/learning.jsonl';

  try {
    // Load pending proposals
    const pending = await loadPendingProposals(
      (p: string) => executor.readFile(p),
      learningPath
    );

    if (pending.length === 0) {
      return;
    }

    console.log(`  Learning: auto-applying ${pending.length} pending improvements`);

    // Build ApplyContext from LoopContext
    const applyCtx: ApplyContext = {
      readFile: (p: string) => executor.readFile(p),
      writeFile: (p: string, c: string) => executor.writeFile(p, c),
      gitBranch: (name: string) => git.branch(name),
      gitCheckout: (ref: string) => git.checkout(ref),
      gitAdd: (files: string | string[]) => git.add(files),
      gitCommit: (message: string) => git.commit(message),
      gitCurrentBranch: () => git.branch(),
    };

    // Apply all pending proposals
    const result = await applyImprovements(applyCtx, pending);

    // Log applied events
    if (result.applied.length > 0) {
      await markProposalsApplied(
        (p: string) => executor.readFile(p),
        (p: string, c: string) => executor.writeFile(p, c),
        learningPath,
        result.applied
      );

      // Update proposal statuses to 'applied'
      const appliedIds = result.applied.map(a => a.id);
      await updateProposalStatuses(
        (p: string) => executor.readFile(p),
        (p: string, c: string) => executor.writeFile(p, c),
        learningPath,
        appliedIds
      );

      console.log(`  Learning: applied ${result.applied.length} improvements on branch ${result.applied[0]?.branch || 'unknown'}`);
    }

    if (result.skipped.length > 0) {
      console.log(`  Learning: skipped ${result.skipped.length} proposals`);
    }

    if (result.errors.length > 0) {
      console.log(`  Learning: ${result.errors.length} proposals failed to apply`);
      for (const err of result.errors) {
        console.log(`    ${err.id}: ${err.error}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`  Learning auto-apply failed: ${msg}`);
  }
}

// =============================================================================
// GIT WATCHER
// =============================================================================

/**
 * Run git watcher to detect external git activity and update task status.
 *
 * Bridges the LoopContext to the WatchContext expected by watchGitActivity,
 * using the executor for file I/O and the GitOperations exec for git commands.
 *
 * Called at the start of each loop iteration (before picking a task) so that
 * task selection considers the latest state from external commits.
 *
 * Errors are logged but never crash the loop.
 */
export async function runGitWatcher(
  context: LoopContext,
): Promise<WatchResult | null> {
  const { config, executor } = context;
  const gwConfig = config.gitWatcher;

  if (!gwConfig?.enabled) {
    return null;
  }

  try {
    const watchContext: WatchContext = {
      execCommand: async (command: string): Promise<string> => {
        const result = await executor.bash(command);
        if (result.exitCode !== 0 && !result.stdout) {
          throw new Error(result.stderr || `Command failed with exit code ${result.exitCode}`);
        }
        return result.stdout;
      },
      readFile: (path: string) => executor.readFile(path),
      writeFile: (path: string, content: string) => executor.writeFile(path, content),
      tasksPath: './state/tasks.jsonl',
      progressPath: './state/progress.jsonl',
    };

    const watchOptions: WatchOptions = {
      taskPrefix: gwConfig.taskPrefix ?? config.git.commitPrefix.replace(/-$/, ''),
      minConfidence: gwConfig.minConfidence ?? 0.7,
      detectAnomalies: gwConfig.detectAnomalies ?? true,
      dryRun: config.loop.dryRun ?? false,
      maxCommits: gwConfig.maxCommits ?? 100,
    };

    const result = await watchGitActivity(watchContext, watchOptions);

    if (result.inferences.length > 0 || result.anomalies.length > 0) {
      console.log(`  Git watcher: ${result.inferences.length} status inferences, ${result.anomalies.length} anomalies`);
    }

    // Fire onAnomaly hook and notification for git watcher anomalies
    for (const anomaly of result.anomalies) {
      const anomalyEvent = {
        type: 'anomaly_detected' as const,
        anomaly: anomaly.message,
        severity: anomaly.severity,
        context: { source: 'git_watcher', taskId: anomaly.taskId, anomalyType: anomaly.type, ...anomaly.data },
        timestamp: new Date().toISOString(),
      };
      invokeHook(context.hooks, 'onAnomaly', anomalyEvent);
      await notifyAnomaly(anomalyEvent, context.config.notifications).catch(() => {});
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`  Git watcher failed: ${msg}`);
    return null;
  }
}

// =============================================================================
// TRACKER SYNC
// =============================================================================

/**
 * Get tracker auth from environment variables
 */
export function getTrackerAuth(trackerType: string): AuthConfig | null {
  const prefix = trackerType.toUpperCase().replace(/-/g, '_');

  const token =
    process.env[`RALPH_${prefix}_TOKEN`] || process.env[`${prefix}_TOKEN`];
  const email =
    process.env[`RALPH_${prefix}_EMAIL`] || process.env[`${prefix}_EMAIL`];

  if (!token) return null;

  return {
    type: 'token',
    token,
    email,
  };
}

/**
 * Sync a completed task to the external tracker.
 *
 * Handles three operations based on config flags:
 * - autoCreate: creates a new issue if the task has no externalId
 * - autoTransition: transitions the issue to match the task status
 * - autoComment: adds a completion/failure comment
 *
 * Errors are logged but never crash the loop.
 */
export async function syncTaskToTracker(
  context: LoopContext,
  task: Task,
  success: boolean
): Promise<void> {
  const { config, executor } = context;
  const trackerConfig = config.tracker;

  // Skip if no auto-sync features enabled
  if (
    !trackerConfig.autoCreate &&
    !trackerConfig.autoTransition &&
    !trackerConfig.autoComment
  ) {
    return;
  }

  try {
    // Load tracker configuration
    const trackerConfigContent = await executor.readFile(
      trackerConfig.configPath
    );
    const fullConfig: TrackerConfig = JSON.parse(trackerConfigContent);

    // Get auth from environment
    const auth = getTrackerAuth(trackerConfig.type);
    if (!auth) {
      console.log('  Tracker sync skipped: missing credentials');
      return;
    }

    // Load adapter module to ensure registration
    await loadTrackerAdapter(trackerConfig.type);

    // Create tracker instance
    const tracker = await createTracker(fullConfig, auth);

    if (task.externalId) {
      // Task already linked — update status and/or comment
      if (trackerConfig.autoTransition) {
        const targetStatus = fullConfig.statusMap[task.status];
        if (targetStatus) {
          await tracker.transitionIssue(task.externalId, targetStatus);
          console.log(
            `  Tracker: transitioned ${task.externalId} → ${targetStatus}`
          );
        }
      }

      if (trackerConfig.autoComment) {
        const comment = success
          ? `Task completed successfully by Ralph.`
          : `Task marked as ${task.status} by Ralph.`;
        await tracker.addComment(task.externalId, comment);
        console.log(`  Tracker: commented on ${task.externalId}`);
      }
    } else if (trackerConfig.autoCreate) {
      // Create new issue
      const issue = await tracker.createIssue(task);

      // Record the link
      const linkOp: TaskOperation = {
        op: 'link',
        id: task.id,
        externalId: issue.key,
        externalUrl: issue.url,
        timestamp: new Date().toISOString(),
      };
      await appendJsonl(executor, './state/tasks.jsonl', linkOp);
      console.log(`  Tracker: created ${issue.key} for ${task.id}`);
    }
  } catch (error) {
    // Don't crash the loop for tracker failures
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.log(`  Tracker sync failed for ${task.id}: ${message}`);
  }
}

/**
 * Dynamically load a tracker adapter module to trigger its registerTracker side-effect.
 */
async function loadTrackerAdapter(type: string): Promise<void> {
  const adapterPaths: Record<string, string> = {
    jira: '../integrations/jira/adapter.js',
    'github-issues': '../integrations/github-issues/adapter.js',
    linear: '../integrations/linear/adapter.js',
  };

  const path = adapterPaths[type];
  if (path) {
    await import(path);
  }
}

// =============================================================================
// TRACKER PULL SYNC
// =============================================================================

/**
 * Pull external tracker status updates into Ralph's task state.
 *
 * Per the tracker-integration spec (Tracker → Ralph):
 *   1. Issue status changed externally → Update task status
 *   2. Issue closed externally → Mark task done
 *
 * Runs before task selection so that pickNextTask sees the latest state.
 * Only processes tasks that have an externalId (already linked to tracker).
 *
 * Errors are logged but never crash the loop.
 */
export async function pullFromTracker(
  context: LoopContext,
): Promise<{ updated: number; errors: number; conflicts: number }> {
  const { config, executor } = context;
  const trackerConfig = config.tracker;
  const result = { updated: 0, errors: 0, conflicts: 0 };

  if (!trackerConfig.autoPull) {
    return result;
  }

  try {
    // Load tracker configuration
    const trackerConfigContent = await executor.readFile(trackerConfig.configPath);
    const fullConfig: TrackerConfig = JSON.parse(trackerConfigContent);

    // Get auth from environment
    const auth = getTrackerAuth(trackerConfig.type);
    if (!auth) {
      console.log('  Tracker pull skipped: missing credentials');
      return result;
    }

    // Load adapter module to ensure registration
    await loadTrackerAdapter(trackerConfig.type);

    // Create tracker instance
    const tracker = await createTracker(fullConfig, auth);

    // Derive current task state
    const tasksLog = await readJsonl<TaskOperation>(executor, './state/tasks.jsonl');
    const tasks = deriveTaskState(tasksLog);

    // Find tasks with external links
    const linkedTasks = Array.from(tasks.values()).filter(t => t.externalId);

    if (linkedTasks.length === 0) {
      return result;
    }

    console.log(`  Tracker pull: checking ${linkedTasks.length} linked tasks`);

    for (const task of linkedTasks) {
      // Skip terminal states — no need to poll
      if (task.status === 'done' || task.status === 'cancelled') {
        continue;
      }

      try {
        const issue = await tracker.getIssue(task.externalId!);
        const trackerStatus = mapStatusToRalph(issue.status, fullConfig);

        if (trackerStatus !== task.status) {
          // Log status conflict — tracker wins (human authority)
          const statusConflict: TrackerConflictEvent = {
            type: 'tracker_conflict',
            taskId: task.id,
            field: 'status',
            ralphValue: task.status,
            trackerValue: issue.status,
            resolution: 'tracker_wins',
            externalId: task.externalId!,
            timestamp: new Date().toISOString(),
          };
          await appendJsonl(executor, './state/learning.jsonl', statusConflict);
          result.conflicts++;

          // Apply the status update (tracker wins)
          await updateTaskStatus(context, task.id, trackerStatus, `tracker pull: ${issue.status}`);
          result.updated++;
          console.log(`  Tracker pull: ${task.id} ${task.status} → ${trackerStatus}`);
        }

        // Check for description conflict — ralph wins (spec is source of truth)
        if (issue.description && issue.description !== task.description) {
          const descConflict: TrackerConflictEvent = {
            type: 'tracker_conflict',
            taskId: task.id,
            field: 'description',
            ralphValue: task.description,
            trackerValue: issue.description,
            resolution: 'ralph_wins',
            externalId: task.externalId!,
            timestamp: new Date().toISOString(),
          };
          await appendJsonl(executor, './state/learning.jsonl', descConflict);
          result.conflicts++;

          // Push Ralph's description back to tracker (ralph wins)
          try {
            await tracker.updateIssue(task.externalId!, { description: task.description } as Partial<Task>);
            console.log(`  Tracker pull: pushed description for ${task.id} back to tracker`);
          } catch (pushError) {
            const pushMsg = pushError instanceof Error ? pushError.message : 'Unknown error';
            console.log(`  Tracker pull: failed to push description for ${task.id}: ${pushMsg}`);
          }
        }
      } catch (error) {
        result.errors++;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.log(`  Tracker pull failed for ${task.id}: ${msg}`);
      }
    }

    if (result.updated > 0) {
      console.log(`  Tracker pull: ${result.updated} tasks updated`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`  Tracker pull failed: ${msg}`);
  }

  return result;
}

// =============================================================================
// TASK OPERATION VALIDATION
// =============================================================================

/**
 * Validate and append a task operation to the tasks.jsonl log.
 *
 * Reads the current task state, validates the operation against the 5 rules
 * from specs/task-schema.md, and only appends if valid. Returns the
 * validation result so callers can handle errors.
 *
 * Rules enforced:
 * 1. id must be unique (for create ops)
 * 2. parent must exist if specified
 * 3. blockedBy tasks must exist
 * 4. status transitions must follow lifecycle
 * 5. completedAt required when status is done
 */
export async function validateAndAppendTaskOp(
  executor: Executor,
  path: string,
  op: TaskOperation,
): Promise<ValidationResult> {
  const log = await readJsonl<TaskOperation>(executor, path);
  const currentState = deriveTaskState(log);

  const result = validateOperation(op, currentState);

  if (result.valid) {
    await appendJsonl(executor, path, op);
  } else {
    for (const error of result.errors) {
      console.log(`  Validation: [${error.rule}] ${error.message}`);
    }
  }

  return result;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Read JSONL file
 */
export async function readJsonl<T>(executor: Executor, path: string): Promise<T[]> {
  try {
    const content = await executor.readFile(path);
    if (!content.trim()) return [];

    return content
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

/**
 * Append to JSONL file
 */
export async function appendJsonl(
  executor: Executor,
  path: string,
  data: unknown
): Promise<void> {
  let content = '';
  try {
    content = await executor.readFile(path);
  } catch {
    // File doesn't exist, start fresh
  }

  const newContent = content + JSON.stringify(data) + '\n';
  await executor.writeFile(path, newContent);
}
