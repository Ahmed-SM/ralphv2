/**
 * Task Discovery Module
 *
 * Main entry point for task discovery.
 * Orchestrates parsing, extraction, and citation resolution.
 */

import type { Task, TaskOperation } from '../../types/index.js';
import { parseMarkdown, parseMarkdownFile, flattenTaskItems, type ParsedMarkdown } from './parse-markdown.js';
import { extractTasks, getNextTaskId, type ExtractionResult, type ExtractionContext } from './extract-tasks.js';
import { resolveCitations, type ResolutionContext } from './resolve-citations.js';

export { parseMarkdown, parseMarkdownFile, flattenTaskItems } from './parse-markdown.js';
export { extractTasks, generateTaskId, parseTaskId, getNextTaskId } from './extract-tasks.js';
export { resolveCitation, resolveCitations, getSpecReferences } from './resolve-citations.js';
export * from './detect-patterns.js';
export * from './improve-agents.js';

export interface DiscoveryOptions {
  /** Path to the implementation plan or spec file */
  planPath: string;
  /** Function to read files */
  readFile: (path: string) => Promise<string>;
  /** Function to write files */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** Path to tasks.jsonl */
  tasksPath?: string;
  /** Resolve spec citations */
  resolveSpecs?: boolean;
  /** Dry run - don't write to files */
  dryRun?: boolean;
}

export interface DiscoveryResult {
  /** All discovered tasks */
  tasks: Task[];
  /** Operations to append to tasks.jsonl */
  operations: TaskOperation[];
  /** Parsed markdown */
  parsed: ParsedMarkdown;
  /** Statistics */
  stats: {
    totalFound: number;
    tasksCreated: number;
    tasksSkipped: number;
    epicsFound: number;
    subtasksFound: number;
    specsResolved: number;
  };
}

/**
 * Run full task discovery pipeline
 */
export async function discoverTasks(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const {
    planPath,
    readFile,
    writeFile,
    tasksPath = './state/tasks.jsonl',
    resolveSpecs = true,
    dryRun = false,
  } = options;

  console.log(`Discovering tasks from: ${planPath}`);

  // Step 1: Parse markdown
  const content = await readFile(planPath);
  const parsed = await parseMarkdown(content, planPath);

  console.log(`  Found ${parsed.metadata.taskLists.length} task lists`);
  console.log(`  Found ${parsed.metadata.headings.length} headings`);

  // Step 2: Load existing tasks
  const existingTasks = await loadExistingTasks(tasksPath, readFile);
  console.log(`  Existing tasks: ${existingTasks.size}`);

  // Step 3: Extract tasks
  const context: ExtractionContext = {
    existingTasks,
    nextId: getNextTaskId(existingTasks),
    timestamp: new Date().toISOString(),
  };

  const extraction = extractTasks(parsed, context);

  console.log(`  Tasks found: ${extraction.stats.totalFound}`);
  console.log(`  Tasks created: ${extraction.stats.tasksCreated}`);
  console.log(`  Tasks skipped: ${extraction.stats.tasksSkipped}`);

  // Step 4: Resolve citations (optional)
  let specsResolved = 0;
  let enrichedTasks = extraction.tasks;

  if (resolveSpecs && extraction.tasks.length > 0) {
    const resolutionContext: ResolutionContext = {
      readFile,
      basePath: planPath,
    };

    const resolutions = await resolveCitations(extraction.tasks, resolutionContext);
    specsResolved = resolutions.filter(r => r.enriched).length;
    enrichedTasks = resolutions.map(r => r.task);

    console.log(`  Specs resolved: ${specsResolved}`);
  }

  // Step 5: Write to tasks.jsonl (if not dry run)
  if (!dryRun && writeFile && extraction.operations.length > 0) {
    const newLines = extraction.operations
      .map(op => JSON.stringify(op))
      .join('\n') + '\n';

    // Read existing content and append
    let existingContent = '';
    try {
      existingContent = await readFile(tasksPath);
    } catch {
      // File doesn't exist, start fresh
    }

    await writeFile(tasksPath, existingContent + newLines);
    console.log(`  Written ${extraction.operations.length} operations to ${tasksPath}`);
  }

  return {
    tasks: enrichedTasks,
    operations: extraction.operations,
    parsed,
    stats: {
      ...extraction.stats,
      specsResolved,
    },
  };
}

/**
 * Load existing tasks from tasks.jsonl
 */
async function loadExistingTasks(
  path: string,
  readFile: (path: string) => Promise<string>
): Promise<Map<string, Task>> {
  const tasks = new Map<string, Task>();

  try {
    const content = await readFile(path);
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
    // File doesn't exist or is invalid
  }

  return tasks;
}

/**
 * Print discovery summary
 */
export function printDiscoverySummary(result: DiscoveryResult): void {
  console.log('\n═══════════════════════════════════════════');
  console.log('  TASK DISCOVERY SUMMARY');
  console.log('═══════════════════════════════════════════\n');

  console.log(`Source: ${result.parsed.path}`);
  console.log(`Title: ${result.parsed.metadata.title || '(untitled)'}\n`);

  console.log('Statistics:');
  console.log(`  Total found:    ${result.stats.totalFound}`);
  console.log(`  Created:        ${result.stats.tasksCreated}`);
  console.log(`  Skipped:        ${result.stats.tasksSkipped}`);
  console.log(`  Epics:          ${result.stats.epicsFound}`);
  console.log(`  Subtasks:       ${result.stats.subtasksFound}`);
  console.log(`  Specs resolved: ${result.stats.specsResolved}`);

  if (result.tasks.length > 0) {
    console.log('\nDiscovered Tasks:');

    // Group by parent
    const roots = result.tasks.filter(t => !t.parent);
    const byParent = new Map<string, Task[]>();

    for (const task of result.tasks) {
      if (task.parent) {
        const children = byParent.get(task.parent) || [];
        children.push(task);
        byParent.set(task.parent, children);
      }
    }

    for (const task of roots) {
      const status = task.status === 'done' ? '✅' : task.status === 'in_progress' ? '🔄' : '⏳';
      const type = task.type.toUpperCase().padEnd(8);
      console.log(`  ${status} ${task.id} [${type}] ${task.title}`);

      const children = byParent.get(task.id) || [];
      for (const child of children) {
        const childStatus = child.status === 'done' ? '✅' : '⏳';
        console.log(`     ${childStatus} ${child.id} ${child.title}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════\n');
}
