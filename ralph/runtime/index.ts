/**
 * Ralph - Agentic Delivery OS
 *
 * Entry point for the Ralph runtime.
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { RuntimeConfig } from '../types/index.js';
import { runLoop } from './loop.js';

// Export modules for programmatic use
export { runLoop, type LoopContext, type LoopResult, pickNextTask, executeTaskLoop, executeIteration, updateTaskStatus, recordTaskCompletion, readJsonl, appendJsonl } from './loop.js';
export { createExecutor, Executor, GitOperations } from './executor.js';
export { createSandbox, Sandbox, printSandboxStatus, type FileChange } from './sandbox.js';

const DEFAULT_CONFIG_PATH = './ralph.config.json';

async function loadConfig(configPath: string): Promise<RuntimeConfig> {
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content) as RuntimeConfig;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configPath = args.find(a => a.startsWith('--config='))?.split('=')[1]
    || DEFAULT_CONFIG_PATH;

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                         RALPH                              ║');
  console.log('║              Agentic Delivery OS v0.1.0                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  try {
    const workDir = resolve(process.cwd());
    console.log(`Working directory: ${workDir}`);
    console.log(`Config: ${configPath}`);
    console.log();

    const config = await loadConfig(resolve(workDir, configPath));

    const result = await runLoop(config, workDir);

    // Exit with appropriate code
    if (result.tasksFailed > 0 && result.tasksCompleted === 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Ralph failed:', error);
    process.exit(1);
  }
}

// CLI commands
const command = process.argv[2];

async function runDiscover(): Promise<void> {
  const args = process.argv.slice(3);
  const dryRun = args.includes('--dry-run');

  console.log('Running task discovery...\n');

  // Dynamically import to avoid circular dependencies
  const { discoverTasks, printDiscoverySummary } = await import('../skills/discovery/index.js');
  const { readFile, writeFile } = await import('fs/promises');
  const { resolve } = await import('path');

  const workDir = resolve(process.cwd());
  const config = await loadConfig(resolve(workDir, DEFAULT_CONFIG_PATH));

  const result = await discoverTasks({
    planPath: config.planFile,
    readFile: (path: string) => readFile(resolve(workDir, path), 'utf-8'),
    writeFile: dryRun ? undefined : (path: string, content: string) => writeFile(resolve(workDir, path), content),
    tasksPath: './state/tasks.jsonl',
    dryRun,
  });

  printDiscoverySummary(result);
}

async function runStatus(): Promise<void> {
  const { readFile } = await import('fs/promises');
  const { resolve } = await import('path');

  const workDir = resolve(process.cwd());
  const tasksPath = resolve(workDir, 'state/tasks.jsonl');

  try {
    const content = await readFile(tasksPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    const tasks = new Map<string, { id: string; title: string; status: string; type: string }>();

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
      }
    }

    // Count by status
    const byStatus: Record<string, number> = {};
    for (const task of tasks.values()) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    }

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                     RALPH STATUS                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    console.log(`Total tasks: ${tasks.size}\n`);
    console.log('By status:');
    for (const [status, count] of Object.entries(byStatus).sort()) {
      const icon = status === 'done' ? '✅' : status === 'in_progress' ? '🔄' : '⏳';
      console.log(`  ${icon} ${status}: ${count}`);
    }

    // Show in-progress tasks
    const inProgress = Array.from(tasks.values()).filter(t => t.status === 'in_progress');
    if (inProgress.length > 0) {
      console.log('\nIn Progress:');
      for (const task of inProgress) {
        console.log(`  🔄 ${task.id}: ${task.title}`);
      }
    }

    console.log();
  } catch (error) {
    console.log('No tasks found. Run "ralph discover" first.');
  }
}

switch (command) {
  case 'run':
  case undefined:
    main();
    break;

  case 'discover':
    runDiscover().catch(err => {
      console.error('Discovery failed:', err);
      process.exit(1);
    });
    break;

  case 'sync':
    console.log('Tracker sync mode');
    console.log('Use: npm run sync');
    break;

  case 'status':
    runStatus().catch(err => {
      console.error('Status failed:', err);
      process.exit(1);
    });
    break;

  case 'learn':
    console.log('Learning mode');
    console.log('Use: npm run learn');
    break;

  case 'help':
  case '--help':
  case '-h':
    console.log(`
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
`);
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "ralph help" for usage');
    process.exit(1);
}
