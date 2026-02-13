/**
 * Loop - The Ralph-loop execution engine
 *
 * Implements the core loop:
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
  LLMProvider,
} from '../types/index.js';
import { createExecutor, Executor, GitOperations } from './executor.js';
import type {
  TrackerConfig,
  AuthConfig,
} from '../skills/normalize/tracker-interface.js';
import { createTracker } from '../skills/normalize/tracker-interface.js';
import { executeLLMIteration, loadTaskContext, createDefaultLLMProvider } from './llm.js';

export interface LoopContext {
  config: RuntimeConfig;
  executor: Executor;
  git: GitOperations;
  workDir: string;
  llmProvider?: LLMProvider;
}

export interface LoopResult {
  tasksProcessed: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalIterations: number;
  duration: number;
}

/**
 * Run the main Ralph loop
 */
export async function runLoop(config: RuntimeConfig, workDir: string): Promise<LoopResult> {
  const startTime = Date.now();
  const dryRun = config.loop.dryRun ?? false;
  const taskFilter = config.loop.taskFilter;

  const executor = await createExecutor({ config, workDir });
  const git = new GitOperations(workDir);

  // Initialize LLM provider if configured
  const llmProvider = await createDefaultLLMProvider(config.llm) ?? undefined;

  const context: LoopContext = {
    config,
    executor,
    git,
    workDir,
    llmProvider,
  };

  const result: LoopResult = {
    tasksProcessed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalIterations: 0,
    duration: 0,
  };

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
      break;
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

    // 3. Mark task in progress
    await updateTaskStatus(context, task.id, 'in_progress');

    // 4. Execute task loop
    const taskResult = await executeTaskLoop(context, task);
    result.totalIterations += taskResult.iterations;

    // 5. Handle result
    if (taskResult.success) {
      await updateTaskStatus(context, task.id, 'done');
      result.tasksCompleted++;

      // Commit changes (skip in dry-run mode)
      if (config.git.autoCommit && !dryRun) {
        await executor.flush();
        await git.add('.');
        await git.commit(`${config.git.commitPrefix}${task.id}: ${task.title}`);
      } else if (config.git.autoCommit && dryRun) {
        console.log(`  [DRY RUN] Would commit: ${config.git.commitPrefix}${task.id}: ${task.title}`);
      }
    } else {
      // Rollback sandbox to discard failed task's pending changes
      executor.rollback();
      console.log(`  Sandbox rolled back for failed task ${task.id}`);

      await updateTaskStatus(context, task.id, 'blocked', taskResult.reason);
      result.tasksFailed++;

      if (config.loop.onFailure === 'stop') {
        console.log('Task failed, stopping loop');
        break;
      }
    }

    // 6. Record learning
    if (config.learning.enabled) {
      await recordTaskCompletion(context, task, taskResult);
    }

    // 7. Sync to tracker (skip in dry-run mode)
    if (!dryRun) {
      await syncTaskToTracker(context, task, taskResult.success);
    } else {
      console.log(`  [DRY RUN] Would sync task ${task.id} to tracker`);
    }
  }

  result.duration = Date.now() - startTime;

  console.log('\nRalph loop complete:');
  console.log(`  Tasks processed: ${result.tasksProcessed}`);
  console.log(`  Tasks completed: ${result.tasksCompleted}`);
  console.log(`  Tasks failed: ${result.tasksFailed}`);
  console.log(`  Total iterations: ${result.totalIterations}`);
  console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);

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
      // Then by creation time
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
  task: Task
): Promise<{ success: boolean; iterations: number; reason?: string }> {
  const { config } = context;
  let iterations = 0;
  const startTime = Date.now();

  while (iterations < config.loop.maxIterationsPerTask) {
    // Check time limit
    if (Date.now() - startTime > config.loop.maxTimePerTask) {
      return {
        success: false,
        iterations,
        reason: 'Time limit exceeded',
      };
    }

    iterations++;
    console.log(`  Iteration ${iterations}/${config.loop.maxIterationsPerTask}`);

    // Execute iteration
    const result = await executeIteration(context, task, iterations);

    // Log progress
    await appendJsonl(context.executor, './state/progress.jsonl', {
      type: 'iteration',
      taskId: task.id,
      iteration: iterations,
      result: result.status,
      timestamp: new Date().toISOString(),
    } as ProgressEvent);

    // Check result
    if (result.status === 'complete') {
      console.log(`  Task complete: ${result.artifacts?.join(', ')}`);
      return { success: true, iterations };
    }

    if (result.status === 'blocked') {
      console.log(`  Task blocked: ${result.blocker}`);
      return { success: false, iterations, reason: result.blocker };
    }

    if (result.status === 'failed') {
      console.log(`  Iteration failed: ${result.error}`);
      // Continue to retry unless max iterations reached
    }

    // Continue to next iteration
    console.log(`  Continuing: ${(result as { reason?: string }).reason || 'work in progress'}`);
  }

  return {
    success: false,
    iterations,
    reason: 'Max iterations reached',
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
): Promise<IterationResult> {
  // LLM-powered execution path
  if (context.llmProvider) {
    try {
      const { specContent, agentInstructions } = await loadTaskContext(
        context.executor,
        task,
      );
      const { result } = await executeLLMIteration(
        context.llmProvider,
        context.executor,
        task,
        iteration,
        { specContent, agentInstructions },
      );
      return result;
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

  await appendJsonl(context.executor, './state/tasks.jsonl', op);

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
  const event: LearningEvent = {
    type: 'task_completed',
    taskId: task.id,
    estimate: task.estimate,
    actual: result.iterations, // Using iterations as effort proxy
    iterations: result.iterations,
    taskType: task.type,
    complexity: task.complexity,
    filesChanged: 0, // TODO: Compute from git
    linesChanged: 0, // TODO: Compute from git
    success: result.success,
    blockers: result.reason ? [result.reason] : undefined,
    timestamp: new Date().toISOString(),
  };

  await appendJsonl(context.executor, './state/learning.jsonl', event);
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
