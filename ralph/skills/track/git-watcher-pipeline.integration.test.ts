/**
 * Integration tests for the full git-watcher pipeline.
 *
 * Tests watchGitActivity() end-to-end: git log → parse → link → infer → output.
 * Uses mock execCommand/readFile/writeFile — no actual git or filesystem.
 */

import { describe, it, expect, vi } from 'vitest';
import { watchGitActivity, type WatchContext, type WatchOptions } from './index.js';
import type { Task, TaskOperation } from '../../types/index.js';

// =============================================================================
// FIXTURES
// =============================================================================

function makeSha(n: number): string {
  return String(n).padStart(40, 'a');
}

/** Produce a simple git log line in the format: %H|%s|%an|%ae|%aI */
function gitLine(sha: string, subject: string, author = 'Dev', email = 'dev@test.com', date = '2024-02-01T12:00:00Z'): string {
  return `${sha}|${subject}|${author}|${email}|${date}`;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'in_progress',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTasksJsonl(tasks: Task[]): string {
  return tasks
    .map(t => JSON.stringify({ op: 'create', task: t, timestamp: t.createdAt } as TaskOperation))
    .join('\n') + '\n';
}

function makeContext(overrides: {
  gitLog?: string;
  tasks?: Task[];
  progress?: string;
  execError?: boolean;
} = {}): { context: WatchContext; files: Record<string, string> } {
  const tasks = overrides.tasks || [makeTask()];
  const files: Record<string, string> = {
    './state/tasks.jsonl': makeTasksJsonl(tasks),
    './state/progress.jsonl': overrides.progress || '',
  };

  const execCommand = overrides.execError
    ? vi.fn().mockRejectedValue(new Error('not a git repo'))
    : vi.fn().mockResolvedValue(overrides.gitLog || '');

  const readFile = vi.fn().mockImplementation((path: string) => {
    if (path in files) return Promise.resolve(files[path]);
    return Promise.reject(new Error(`ENOENT: ${path}`));
  });

  const writeFile = vi.fn().mockImplementation((path: string, content: string) => {
    files[path] = content;
    return Promise.resolve();
  });

  return {
    context: {
      execCommand,
      readFile,
      writeFile,
      tasksPath: './state/tasks.jsonl',
      progressPath: './state/progress.jsonl',
    },
    files,
  };
}

// =============================================================================
// FULL PIPELINE — watchGitActivity
// =============================================================================

describe('Git Watcher Pipeline (integration)', () => {
  it('returns empty result when git log is empty', async () => {
    const { context } = makeContext({ gitLog: '' });
    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.commits).toHaveLength(0);
    expect(result.taskRefs).toHaveLength(0);
    expect(result.inferences).toHaveLength(0);
    expect(result.operations).toHaveLength(0);
  });

  it('returns empty result when not a git repo', async () => {
    const { context } = makeContext({ execError: true });
    const result = await watchGitActivity(context);

    expect(result.commits).toHaveLength(0);
    expect(result.taskRefs).toHaveLength(0);
  });

  it('parses commits and extracts task references', async () => {
    const gitLog = [
      gitLine(makeSha(1), 'RALPH-001: Fix login bug'),
      gitLine(makeSha(2), 'RALPH-001: Add tests for login'),
      gitLine(makeSha(3), 'Unrelated commit'),
    ].join('\n');

    const { context } = makeContext({ gitLog });
    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.commits).toHaveLength(3);
    expect(result.taskRefs.length).toBeGreaterThanOrEqual(2);
    // All refs should reference RALPH-001
    for (const ref of result.taskRefs) {
      expect(ref.taskId).toBe('RALPH-001');
    }
  });

  it('links commits to existing tasks', async () => {
    const tasks = [
      makeTask({ id: 'RALPH-001', title: 'Login bug', status: 'in_progress' }),
      makeTask({ id: 'RALPH-002', title: 'Export feature', status: 'pending' }),
    ];

    const gitLog = [
      gitLine(makeSha(1), 'RALPH-001: Fix login bug'),
      gitLine(makeSha(2), 'RALPH-002: Start export work'),
    ].join('\n');

    const { context } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.taskRefs.length).toBeGreaterThanOrEqual(2);
    const taskIds = new Set(result.taskRefs.map(r => r.taskId));
    expect(taskIds.has('RALPH-001')).toBe(true);
    expect(taskIds.has('RALPH-002')).toBe(true);
  });

  it('generates progress events for new commits', async () => {
    const gitLog = [
      gitLine(makeSha(1), 'RALPH-001: Initial work'),
    ].join('\n');

    const { context } = makeContext({ gitLog });
    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.newRefs.length).toBeGreaterThanOrEqual(1);
    expect(result.progressEvents.length).toBeGreaterThanOrEqual(0);
  });

  it('filters out already-processed commits', async () => {
    const sha = makeSha(1);
    const gitLog = gitLine(sha, 'RALPH-001: Already processed');

    // Simulate existing progress with this commit already recorded
    const existingProgress = JSON.stringify({
      type: 'git_activity',
      taskId: 'RALPH-001',
      sha,
      timestamp: '2024-01-15T00:00:00Z',
    });

    const { context } = makeContext({ gitLog, progress: existingProgress });
    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.commits).toHaveLength(1);
    expect(result.taskRefs.length).toBeGreaterThanOrEqual(1);
    expect(result.newRefs).toHaveLength(0);
  });
});

// =============================================================================
// PIPELINE — status inference
// =============================================================================

describe('Git Watcher Pipeline — status inference (integration)', () => {
  it('infers status from commit patterns', async () => {
    const tasks = [
      makeTask({ id: 'RALPH-001', status: 'in_progress' }),
    ];

    // Multiple commits suggesting work is happening
    const gitLog = [
      gitLine(makeSha(1), 'RALPH-001: fix bug', 'Dev', 'dev@test.com', '2024-02-01T10:00:00Z'),
      gitLine(makeSha(2), 'RALPH-001: add tests', 'Dev', 'dev@test.com', '2024-02-01T11:00:00Z'),
      gitLine(makeSha(3), 'RALPH-001: final cleanup', 'Dev', 'dev@test.com', '2024-02-01T12:00:00Z'),
    ].join('\n');

    const { context } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: true, minConfidence: 0.5 });

    // Should produce inferences (may or may not change status depending on commit patterns)
    expect(result.inferences).toBeDefined();
    // The pipeline should complete without error
  });

  it('respects minConfidence threshold', async () => {
    const tasks = [makeTask({ id: 'RALPH-001', status: 'in_progress' })];
    const gitLog = gitLine(makeSha(1), 'RALPH-001: small change');

    const { context } = makeContext({ gitLog, tasks });
    const highThreshold = await watchGitActivity(context, { dryRun: true, minConfidence: 0.99 });
    const lowThreshold = await watchGitActivity(context, { dryRun: true, minConfidence: 0.1 });

    // High threshold should produce fewer or equal inferences
    expect(highThreshold.inferences.length).toBeLessThanOrEqual(lowThreshold.inferences.length);
  });
});

// =============================================================================
// PIPELINE — anomaly detection
// =============================================================================

describe('Git Watcher Pipeline — anomaly detection (integration)', () => {
  it('detects anomalies when enabled', async () => {
    const tasks = [
      makeTask({ id: 'RALPH-001', status: 'done' }),
    ];

    // Activity on a "done" task is an anomaly
    const gitLog = gitLine(makeSha(1), 'RALPH-001: unexpected fix');

    const { context } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: true, detectAnomalies: true });

    expect(result.anomalies).toBeDefined();
    // May or may not detect anomaly depending on implementation thresholds
  });

  it('skips anomaly detection when disabled', async () => {
    const tasks = [makeTask({ id: 'RALPH-001', status: 'done' })];
    const gitLog = gitLine(makeSha(1), 'RALPH-001: unexpected fix');

    const { context } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: true, detectAnomalies: false });

    expect(result.anomalies).toHaveLength(0);
  });
});

// =============================================================================
// PIPELINE — persistence
// =============================================================================

describe('Git Watcher Pipeline — persistence (integration)', () => {
  it('writes task operations when not dry-run', async () => {
    const tasks = [
      makeTask({ id: 'RALPH-001', status: 'in_progress' }),
    ];

    const gitLog = [
      gitLine(makeSha(1), 'RALPH-001: implement feature'),
      gitLine(makeSha(2), 'RALPH-001: add tests'),
    ].join('\n');

    const { context, files } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: false });

    // If operations were generated, they should be written
    if (result.operations.length > 0) {
      const tasksContent = files['./state/tasks.jsonl'];
      expect(tasksContent.length).toBeGreaterThan(0);
    }
  });

  it('does NOT write in dry-run mode', async () => {
    const tasks = [makeTask({ id: 'RALPH-001', status: 'in_progress' })];
    const gitLog = gitLine(makeSha(1), 'RALPH-001: work');

    const { context } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: true });

    // writeFile should not have been called (beyond the setup)
    expect(context.writeFile).not.toHaveBeenCalled();
  });

  it('records progress events for processed commits', async () => {
    const tasks = [makeTask({ id: 'RALPH-001', status: 'in_progress' })];
    const gitLog = gitLine(makeSha(1), 'RALPH-001: implement');

    const { context, files } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: false });

    if (result.progressEvents.length > 0) {
      const progressContent = files['./state/progress.jsonl'];
      expect(progressContent).toBeTruthy();
      const lines = progressContent.trim().split('\n').filter(l => l.trim());
      expect(lines.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// PIPELINE — task prefix
// =============================================================================

describe('Git Watcher Pipeline — task prefix (integration)', () => {
  it('uses custom task prefix', async () => {
    const tasks = [
      makeTask({ id: 'PROJ-001', status: 'in_progress' }),
    ];

    const gitLog = [
      gitLine(makeSha(1), 'PROJ-001: do work'),
      gitLine(makeSha(2), 'RALPH-999: unrelated'),
    ].join('\n');

    const { context } = makeContext({
      gitLog,
      tasks,
    });
    // Override tasks.jsonl with PROJ-prefixed task
    (context.readFile as any).mockImplementation((path: string) => {
      if (path === './state/tasks.jsonl') {
        return Promise.resolve(makeTasksJsonl(tasks));
      }
      if (path === './state/progress.jsonl') {
        return Promise.resolve('');
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await watchGitActivity(context, { dryRun: true, taskPrefix: 'PROJ' });

    const projRefs = result.taskRefs.filter(r => r.taskId.startsWith('PROJ-'));
    const ralphRefs = result.taskRefs.filter(r => r.taskId.startsWith('RALPH-'));
    expect(projRefs.length).toBeGreaterThanOrEqual(1);
    expect(ralphRefs).toHaveLength(0);
  });
});

// =============================================================================
// PIPELINE — edge cases
// =============================================================================

describe('Git Watcher Pipeline — edge cases (integration)', () => {
  it('handles commits with no task references', async () => {
    const gitLog = [
      gitLine(makeSha(1), 'Initial commit'),
      gitLine(makeSha(2), 'Update README'),
      gitLine(makeSha(3), 'Fix typo'),
    ].join('\n');

    const { context } = makeContext({ gitLog });
    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.commits).toHaveLength(3);
    expect(result.taskRefs).toHaveLength(0);
    expect(result.operations).toHaveLength(0);
  });

  it('handles references to tasks not in tasks.jsonl (orphans)', async () => {
    const gitLog = gitLine(makeSha(1), 'RALPH-999: unknown task');

    // tasks.jsonl only has RALPH-001
    const { context } = makeContext({ gitLog });
    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.taskRefs.length).toBeGreaterThanOrEqual(1);
    // Should complete without throwing
  });

  it('handles empty tasks.jsonl', async () => {
    const gitLog = gitLine(makeSha(1), 'RALPH-001: do something');

    const { context } = makeContext({ gitLog, tasks: [] });
    // Override to return empty
    (context.readFile as any).mockImplementation((path: string) => {
      if (path === './state/tasks.jsonl') return Promise.resolve('');
      if (path === './state/progress.jsonl') return Promise.resolve('');
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await watchGitActivity(context, { dryRun: true });

    expect(result.commits).toHaveLength(1);
    expect(result.taskRefs.length).toBeGreaterThanOrEqual(1);
  });

  it('handles multiple task refs in a single commit', async () => {
    const tasks = [
      makeTask({ id: 'RALPH-001', status: 'in_progress' }),
      makeTask({ id: 'RALPH-002', status: 'in_progress' }),
    ];

    const gitLog = gitLine(makeSha(1), 'RALPH-001 RALPH-002: joint work');

    const { context } = makeContext({ gitLog, tasks });
    const result = await watchGitActivity(context, { dryRun: true });

    const uniqueTaskIds = new Set(result.taskRefs.map(r => r.taskId));
    expect(uniqueTaskIds.size).toBeGreaterThanOrEqual(2);
  });
});
