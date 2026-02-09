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
} from '../types/index.js';
import { createExecutor, Executor, GitOperations } from './executor.js';

export interface LoopContext {
  config: RuntimeConfig;
  executor: Executor;
  git: GitOperations;
  workDir: string;
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

  const executor = await createExecutor({ config, workDir });
  const git = new GitOperations(workDir);

  const context: LoopContext = {
    config,
    executor,
    git,
    workDir,
  };

  const result: LoopResult = {
    tasksProcessed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalIterations: 0,
    duration: 0,
  };

  console.log('Ralph loop starting...');
  console.log(`Plan file: ${config.planFile}`);

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
    const task = await pickNextTask(context);
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

      // Commit changes
      if (config.git.autoCommit) {
        await executor.flush();
        await git.add('.');
        await git.commit(`${config.git.commitPrefix}${task.id}: ${task.title}`);
      }
    } else {
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

    // 7. Sync to tracker (if configured)
    // TODO: Implement tracker sync
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
 */
async function pickNextTask(context: LoopContext): Promise<Task | null> {
  const tasksLog = await readJsonl<TaskOperation>(
    context.executor,
    './state/tasks.jsonl'
  );

  // Derive current state
  const tasks = deriveTaskState(tasksLog);

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
function deriveTaskState(log: TaskOperation[]): Map<string, Task> {
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
function isBlocked(task: Task, allTasks: Map<string, Task>): boolean {
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
async function executeTaskLoop(
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
 * This is where the actual agent work happens.
 * TODO: Integrate with LLM for intelligent execution
 */
async function executeIteration(
  context: LoopContext,
  task: Task,
  iteration: number
): Promise<IterationResult> {
  // For now, return a placeholder
  // In full implementation, this would:
  // 1. Load relevant agent instructions
  // 2. Read task spec
  // 3. Execute agent logic
  // 4. Return result

  // Placeholder: Check if task has spec and spec file exists
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

  // For discovered tasks without specs, mark as needing work
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
async function updateTaskStatus(
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
async function recordTaskCompletion(
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
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Read JSONL file
 */
async function readJsonl<T>(executor: Executor, path: string): Promise<T[]> {
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
async function appendJsonl(
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
