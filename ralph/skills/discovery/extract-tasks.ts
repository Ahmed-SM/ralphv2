/**
 * Extract Tasks Skill
 *
 * Extracts structured tasks from parsed markdown.
 * Implements the task-discovery agent logic.
 */

import type { Task, TaskType, TaskStatus, TaskOperation, SourceInfo } from '../../types/index.js';
import type { ParsedMarkdown, TaskListInfo, TaskItemInfo, LinkInfo } from './parse-markdown.js';

export interface ExtractionResult {
  tasks: Task[];
  operations: TaskOperation[];
  stats: ExtractionStats;
}

export interface ExtractionStats {
  totalFound: number;
  tasksCreated: number;
  tasksSkipped: number;
  epicsFound: number;
  subtasksFound: number;
}

export interface ExtractionContext {
  existingTasks: Map<string, Task>;
  nextId: number;
  timestamp: string;
}

/**
 * Extract tasks from parsed markdown
 */
export function extractTasks(
  parsed: ParsedMarkdown,
  context: ExtractionContext
): ExtractionResult {
  const tasks: Task[] = [];
  const operations: TaskOperation[] = [];
  const stats: ExtractionStats = {
    totalFound: 0,
    tasksCreated: 0,
    tasksSkipped: 0,
    epicsFound: 0,
    subtasksFound: 0,
  };

  let currentId = context.nextId;

  // Process each task list
  for (const taskList of parsed.metadata.taskLists) {
    const parentHeading = taskList.parentHeading;

    // Check if this is a phase/epic heading
    const epicInfo = parseEpicHeading(parentHeading);
    let epicTask: Task | undefined;

    if (epicInfo) {
      stats.epicsFound++;

      // Check if epic already exists
      const existingEpic = findExistingTask(context.existingTasks, epicInfo.title, 'epic');

      if (!existingEpic) {
        epicTask = createTask({
          id: `RALPH-${String(currentId).padStart(3, '0')}`,
          type: 'epic',
          title: epicInfo.title,
          status: epicInfo.status,
          source: {
            type: 'spec',
            path: parsed.path,
            line: taskList.line,
            timestamp: context.timestamp,
          },
          timestamp: context.timestamp,
        });

        tasks.push(epicTask);
        operations.push({
          op: 'create',
          task: epicTask,
          timestamp: context.timestamp,
        });

        currentId++;
        stats.tasksCreated++;
      } else {
        epicTask = existingEpic;
        stats.tasksSkipped++;
      }
    }

    // Process task items
    for (const item of taskList.items) {
      stats.totalFound++;

      const result = processTaskItem(
        item,
        parsed,
        context,
        currentId,
        epicTask?.id
      );

      if (result.created) {
        tasks.push(result.task);
        operations.push({
          op: 'create',
          task: result.task,
          timestamp: context.timestamp,
        });
        currentId = result.nextId;
        stats.tasksCreated++;

        // Process subtasks
        if (item.children.length > 0) {
          for (const child of item.children) {
            stats.totalFound++;
            stats.subtasksFound++;

            const subtaskResult = processTaskItem(
              child,
              parsed,
              context,
              currentId,
              result.task.id
            );

            if (subtaskResult.created) {
              // Mark as subtask
              subtaskResult.task.type = 'subtask';
              tasks.push(subtaskResult.task);
              operations.push({
                op: 'create',
                task: subtaskResult.task,
                timestamp: context.timestamp,
              });
              currentId = subtaskResult.nextId;
              stats.tasksCreated++;
            } else {
              stats.tasksSkipped++;
            }
          }
        }
      } else {
        stats.tasksSkipped++;
      }
    }
  }

  return { tasks, operations, stats };
}

interface TaskItemResult {
  task: Task;
  created: boolean;
  nextId: number;
}

/**
 * Process a single task item
 */
function processTaskItem(
  item: TaskItemInfo,
  parsed: ParsedMarkdown,
  context: ExtractionContext,
  currentId: number,
  parentId?: string
): TaskItemResult {
  // Check if task already exists
  const existing = findExistingTask(context.existingTasks, item.text, undefined);

  if (existing) {
    return {
      task: existing,
      created: false,
      nextId: currentId,
    };
  }

  // Extract spec reference from links
  const specLink = item.links.find(link =>
    link.url.includes('specs/') ||
    link.url.endsWith('.md')
  );

  // Infer task type
  const type = inferTaskType(item.text, !!parentId);

  // Determine status
  const status: TaskStatus = item.checked ? 'done' : 'discovered';

  const task = createTask({
    id: `RALPH-${String(currentId).padStart(3, '0')}`,
    type,
    title: item.text,
    status,
    spec: specLink?.url,
    parent: parentId,
    source: {
      type: 'spec',
      path: parsed.path,
      line: item.line,
      timestamp: context.timestamp,
    },
    timestamp: context.timestamp,
  });

  return {
    task,
    created: true,
    nextId: currentId + 1,
  };
}

interface CreateTaskParams {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  spec?: string;
  parent?: string;
  source: SourceInfo;
  timestamp: string;
}

/**
 * Create a task object
 */
function createTask(params: CreateTaskParams): Task {
  return {
    id: params.id,
    type: params.type,
    title: params.title,
    description: '', // Will be enriched by citation resolver
    spec: params.spec,
    source: params.source,
    parent: params.parent,
    status: params.status,
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
    completedAt: params.status === 'done' ? params.timestamp : undefined,
  };
}

interface EpicInfo {
  title: string;
  status: TaskStatus;
}

/**
 * Parse epic/phase heading
 */
function parseEpicHeading(heading?: string): EpicInfo | null {
  if (!heading) return null;

  // Match patterns like "Phase 1: Foundation" or "Phase 1: Foundation ✅ COMPLETE"
  const phaseMatch = heading.match(/^(Phase\s+\d+[:\s]+.+?)(?:\s*[✅⏳🔄].*)?$/i);

  if (phaseMatch) {
    const title = phaseMatch[1].trim();
    const isComplete = heading.includes('✅') || heading.toLowerCase().includes('complete');
    const isInProgress = heading.includes('🔄') || heading.toLowerCase().includes('progress') || heading.includes('CURRENT');

    let status: TaskStatus = 'discovered';
    if (isComplete) {
      status = 'done';
    } else if (isInProgress) {
      status = 'in_progress';
    }

    return { title, status };
  }

  return null;
}

/**
 * Infer task type from text
 */
function inferTaskType(text: string, hasParent: boolean): TaskType {
  const lower = text.toLowerCase();

  if (hasParent) {
    return 'subtask';
  }

  if (lower.includes('fix') || lower.includes('bug') || lower.includes('broken')) {
    return 'bug';
  }

  if (lower.includes('refactor') || lower.includes('clean')) {
    return 'refactor';
  }

  if (lower.includes('test') || lower.includes('spec')) {
    return 'test';
  }

  if (lower.includes('doc') || lower.includes('readme')) {
    return 'docs';
  }

  if (lower.includes('investigate') || lower.includes('spike') || lower.includes('research')) {
    return 'spike';
  }

  if (lower.includes('implement') || lower.includes('create') || lower.includes('add')) {
    return 'feature';
  }

  return 'task';
}

/**
 * Find existing task by title
 */
function findExistingTask(
  tasks: Map<string, Task>,
  title: string,
  type?: TaskType
): Task | undefined {
  const normalizedTitle = normalizeTitle(title);

  for (const task of tasks.values()) {
    if (normalizeTitle(task.title) === normalizedTitle) {
      if (!type || task.type === type) {
        return task;
      }
    }
  }

  return undefined;
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate task ID
 */
export function generateTaskId(sequence: number): string {
  return `RALPH-${String(sequence).padStart(3, '0')}`;
}

/**
 * Parse task ID to get sequence number
 */
export function parseTaskId(id: string): number {
  const match = id.match(/^RALPH-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Get next task ID from existing tasks
 */
export function getNextTaskId(tasks: Map<string, Task>): number {
  let maxId = 0;

  for (const task of tasks.values()) {
    const id = parseTaskId(task.id);
    if (id > maxId) {
      maxId = id;
    }
  }

  return maxId + 1;
}
