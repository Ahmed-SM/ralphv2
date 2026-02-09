/**
 * Git Watcher CLI
 *
 * Command-line interface for watching git activity.
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { watchGitActivity, printWatchSummary } from './index.js';

const execAsync = promisify(exec);

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  const dryRun = args.includes('--dry-run');
  const help = args.includes('--help') || args.includes('-h');
  const since = args.find(a => a.startsWith('--since='))?.split('=')[1];
  const maxCommits = parseInt(
    args.find(a => a.startsWith('--max='))?.split('=')[1] || '100',
    10
  );
  const noAnomalies = args.includes('--no-anomalies');

  if (help) {
    console.log(`
Git Watcher CLI

Usage: npx tsx skills/track/cli.ts [options]

Options:
  --dry-run           Don't make changes, just show what would happen
  --since=DATE        Only process commits since date (e.g., "2024-01-01")
  --max=N             Maximum commits to process (default: 100)
  --no-anomalies      Skip anomaly detection
  --help, -h          Show this help

Examples:
  npx tsx skills/track/cli.ts
  npx tsx skills/track/cli.ts --dry-run
  npx tsx skills/track/cli.ts --since="1 week ago"
  npx tsx skills/track/cli.ts --max=50
`);
    return;
  }

  const workDir = process.cwd();

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    RALPH GIT WATCHER                       ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  if (dryRun) {
    console.log('Mode: DRY RUN (no changes will be made)\n');
  }

  try {
    // Create context
    const context = {
      execCommand: async (command: string): Promise<string> => {
        try {
          const { stdout } = await execAsync(command, { cwd: workDir });
          return stdout;
        } catch (error: unknown) {
          const execError = error as { stdout?: string; stderr?: string };
          // Git commands may exit non-zero but still have useful output
          if (execError.stdout) {
            return execError.stdout;
          }
          throw error;
        }
      },
      readFile: (path: string) =>
        readFile(resolve(workDir, path.replace(/^\.\//, '')), 'utf-8'),
      writeFile: (path: string, content: string) =>
        writeFile(resolve(workDir, path.replace(/^\.\//, '')), content),
      tasksPath: './state/tasks.jsonl',
      progressPath: './state/progress.jsonl',
    };

    // Run watcher
    const result = await watchGitActivity(context, {
      dryRun,
      since,
      maxCommits,
      detectAnomalies: !noAnomalies,
    });

    // Print summary
    printWatchSummary(result);

    // Exit with appropriate code
    if (result.anomalies.some(a => a.severity === 'high')) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Watcher failed:', error);
    process.exit(1);
  }
}

main();
