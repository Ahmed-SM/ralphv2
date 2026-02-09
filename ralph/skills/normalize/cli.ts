/**
 * Tracker Sync CLI
 *
 * Command-line interface for syncing tasks with external trackers.
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import {
  createSyncContext,
  syncToTracker,
  syncFromTracker,
  syncBidirectional,
  printSyncSummary,
} from './sync.js';

// Import adapters to register them
import '../../integrations/jira/adapter.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  const command = args.find(a => !a.startsWith('--')) || 'push';
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const help = args.includes('--help') || args.includes('-h');
  const configPath = args.find(a => a.startsWith('--config='))?.split('=')[1]
    || './integrations/jira/config.json';

  if (help) {
    console.log(`
Tracker Sync CLI

Usage: npx tsx skills/normalize/cli.ts [command] [options]

Commands:
  push        Push tasks to tracker (default)
  pull        Pull updates from tracker
  sync        Bidirectional sync

Options:
  --config=PATH    Path to tracker config (default: ./integrations/jira/config.json)
  --dry-run        Don't make changes, just show what would happen
  --force          Force update even if already synced
  --help, -h       Show this help

Environment Variables:
  RALPH_JIRA_EMAIL   Jira account email
  RALPH_JIRA_TOKEN   Jira API token

Examples:
  npx tsx skills/normalize/cli.ts push
  npx tsx skills/normalize/cli.ts push --dry-run
  npx tsx skills/normalize/cli.ts pull
  npx tsx skills/normalize/cli.ts sync --force
`);
    return;
  }

  const workDir = process.cwd();

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    RALPH TRACKER SYNC                      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  if (dryRun) {
    console.log('Mode: DRY RUN (no changes will be made)\n');
  }

  // Check for credentials
  const email = process.env.RALPH_JIRA_EMAIL || process.env.JIRA_EMAIL;
  const token = process.env.RALPH_JIRA_TOKEN || process.env.JIRA_TOKEN;

  if (!email || !token) {
    console.log('⚠️  Jira credentials not configured.\n');
    console.log('To sync with Jira, set these environment variables:');
    console.log('  RALPH_JIRA_EMAIL=your@email.com');
    console.log('  RALPH_JIRA_TOKEN=your-api-token');
    console.log('\nGet an API token from: https://id.atlassian.com/manage-profile/security/api-tokens');
    console.log('\nRunning in preview mode (showing what would be synced)...\n');

    // Show what would be synced
    await previewSync(workDir);
    return;
  }

  try {
    // Load config and check if it exists
    const fullConfigPath = resolve(workDir, configPath);
    let configContent: string;

    try {
      configContent = await readFile(fullConfigPath, 'utf-8');
    } catch {
      console.log(`⚠️  Config not found: ${configPath}`);
      console.log('\nCreate a config file from the example:');
      console.log('  cp integrations/jira/config.example.json integrations/jira/config.json');
      console.log('\nThen edit it with your Jira project details.\n');
      return;
    }

    // Parse config to set dryRun
    const config = JSON.parse(configContent);
    config.dryRun = dryRun;

    // Create context
    const context = await createSyncContext({
      configPath: fullConfigPath,
      tasksPath: './state/tasks.jsonl',
      readFile: (path) => readFile(resolve(workDir, path.replace(/^\.\//, '')), 'utf-8'),
      writeFile: (path, content) => writeFile(resolve(workDir, path.replace(/^\.\//, '')), content),
    });

    // Override dryRun in context config
    context.config.dryRun = dryRun;

    // Execute command
    switch (command) {
      case 'push': {
        const result = await syncToTracker(context, { force });
        printSyncSummary(result, 'push');
        break;
      }

      case 'pull': {
        const result = await syncFromTracker(context, { force });
        printSyncSummary(result, 'pull');
        break;
      }

      case 'sync': {
        const { push, pull } = await syncBidirectional(context, { force });
        printSyncSummary(pull, 'pull');
        printSyncSummary(push, 'push');
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

/**
 * Preview what would be synced (when no credentials)
 */
async function previewSync(workDir: string): Promise<void> {
  const tasksPath = resolve(workDir, 'state/tasks.jsonl');

  try {
    const content = await readFile(tasksPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    // Count tasks by status
    const tasks = new Map<string, { id: string; title: string; status: string; externalId?: string }>();

    for (const line of lines) {
      const op = JSON.parse(line);

      if (op.op === 'create') {
        tasks.set(op.task.id, {
          id: op.task.id,
          title: op.task.title,
          status: op.task.status,
        });
      } else if (op.op === 'link') {
        const task = tasks.get(op.id);
        if (task) {
          task.externalId = op.externalId;
        }
      } else if (op.op === 'update') {
        const task = tasks.get(op.id);
        if (task && op.changes.status) {
          task.status = op.changes.status;
        }
      }
    }

    // Group by sync status
    const toCreate = Array.from(tasks.values()).filter(t => !t.externalId);
    const alreadySynced = Array.from(tasks.values()).filter(t => t.externalId);

    console.log('Tasks to create in tracker:');
    if (toCreate.length === 0) {
      console.log('  (none)');
    } else {
      for (const task of toCreate.slice(0, 10)) {
        console.log(`  - ${task.id}: ${task.title.slice(0, 50)}...`);
      }
      if (toCreate.length > 10) {
        console.log(`  ... and ${toCreate.length - 10} more`);
      }
    }

    console.log(`\nAlready synced: ${alreadySynced.length} tasks`);
    console.log(`To create: ${toCreate.length} tasks`);
  } catch {
    console.log('No tasks found. Run task discovery first:');
    console.log('  npm run discover');
  }
}

main();
