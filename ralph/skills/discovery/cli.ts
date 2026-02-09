/**
 * Task Discovery CLI
 *
 * Standalone CLI for running task discovery.
 * Can be run with: npx tsx skills/discovery/cli.ts
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { discoverTasks, printDiscoverySummary } from './index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  const planPath = args.find(a => !a.startsWith('--')) || './implementation-plan.md';
  const dryRun = args.includes('--dry-run');
  const noResolve = args.includes('--no-resolve');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
Task Discovery CLI

Usage: npx tsx skills/discovery/cli.ts [plan-path] [options]

Arguments:
  plan-path          Path to implementation plan (default: ./implementation-plan.md)

Options:
  --dry-run          Don't write to tasks.jsonl
  --no-resolve       Skip spec citation resolution
  --help, -h         Show this help

Examples:
  npx tsx skills/discovery/cli.ts
  npx tsx skills/discovery/cli.ts ./my-plan.md --dry-run
  npx tsx skills/discovery/cli.ts ./specs/feature.md --no-resolve
`);
    return;
  }

  const workDir = process.cwd();
  const fullPlanPath = resolve(workDir, planPath);

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                   RALPH TASK DISCOVERY                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  if (dryRun) {
    console.log('Mode: DRY RUN (no files will be modified)\n');
  }

  try {
    const result = await discoverTasks({
      planPath: fullPlanPath,
      readFile: (path) => readFile(resolve(workDir, path.replace(/^\.\//, '')), 'utf-8'),
      writeFile: (path, content) => writeFile(resolve(workDir, path.replace(/^\.\//, '')), content),
      tasksPath: './state/tasks.jsonl',
      resolveSpecs: !noResolve,
      dryRun,
    });

    printDiscoverySummary(result);

    // Output operations as JSON for piping
    if (args.includes('--json')) {
      console.log(JSON.stringify({
        tasks: result.tasks,
        operations: result.operations,
        stats: result.stats,
      }, null, 2));
    }

    // Exit with appropriate code
    process.exit(result.stats.tasksCreated > 0 ? 0 : 0);
  } catch (error) {
    console.error('Discovery failed:', error);
    process.exit(1);
  }
}

main();
