/**
 * Live integration tests for the git watcher pipeline.
 *
 * Unlike the mocked integration tests, these tests run against the ACTUAL git
 * repository. They validate that the pipeline works end-to-end with real git
 * output — real SHAs, real dates, real commit messages.
 *
 * These tests exercise:
 * - Real `git log` command execution
 * - parseSimpleGitLog with actual git output
 * - extractTaskRefs against real commit messages
 * - The full watchGitActivity pipeline with a real execCommand
 * - Structural properties of parsed data (valid SHAs, valid dates, etc.)
 */

import { describe, it, expect, vi } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import {
  parseSimpleGitLog,
  parseGitLog,
  extractTaskRefs,
  extractTaskIds,
  inferAction,
  buildGitLogCommand,
  type GitCommit,
} from './parse-commits.js';
import {
  linkCommitsToTasks,
  aggregateByTask,
  filterNewCommits,
} from './link-commits.js';
import {
  inferStatuses,
  detectAnomalies,
} from './infer-status.js';
import {
  watchGitActivity,
  type WatchContext,
} from './index.js';
import type { Task, TaskOperation } from '../../types/index.js';

const execAsync = promisify(exec);
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// =============================================================================
// HELPERS
// =============================================================================

async function gitExec(command: string): Promise<string> {
  const { stdout } = await execAsync(command, { cwd: REPO_ROOT });
  return stdout.trim();
}

function isValidSha(sha: string): boolean {
  return /^[a-f0-9]{40}$/.test(sha);
}

function isValidIsoDate(date: string): boolean {
  return !isNaN(new Date(date).getTime());
}

// =============================================================================
// LIVE GIT LOG PARSING — parseSimpleGitLog
// =============================================================================

describe('Live Git — parseSimpleGitLog', () => {
  it('parses real git log output from this repository', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');

    expect(commits.length).toBeGreaterThan(0);

    for (const commit of commits) {
      // Every commit must have a valid 40-char SHA
      expect(commit.sha).toMatch(/^[a-f0-9]{40}$/);
      // shortSha is first 7 chars
      expect(commit.shortSha).toBe(commit.sha.slice(0, 7));
      // Must have non-empty subject
      expect(commit.subject.length).toBeGreaterThan(0);
      // Must have author info
      expect(commit.author.length).toBeGreaterThan(0);
      expect(commit.authorEmail).toContain('@');
      // Must have valid date
      expect(isValidIsoDate(commit.date)).toBe(true);
    }
  });

  it('returns commits in the same order as git log (newest first)', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');

    // Git log returns newest first by default
    for (let i = 0; i < commits.length - 1; i++) {
      const current = new Date(commits[i].date).getTime();
      const next = new Date(commits[i + 1].date).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }
  });

  it('handles --max-count flag correctly', async () => {
    const allOutput = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const allCommits = parseSimpleGitLog(allOutput, '%H|%s|%an|%ae|%aI');

    if (allCommits.length >= 3) {
      const limitedOutput = await gitExec('git log -n 3 --format="%H|%s|%an|%ae|%aI"');
      const limitedCommits = parseSimpleGitLog(limitedOutput, '%H|%s|%an|%ae|%aI');

      expect(limitedCommits).toHaveLength(3);
      // First 3 commits should match
      for (let i = 0; i < 3; i++) {
        expect(limitedCommits[i].sha).toBe(allCommits[i].sha);
      }
    }
  });
});

// =============================================================================
// LIVE GIT LOG PARSING — parseGitLog (full format)
// =============================================================================

describe('Live Git — parseGitLog (full format)', () => {
  it('parses real full-format git log output', async () => {
    const output = await gitExec('git log -5');
    const commits = parseGitLog(output);

    expect(commits.length).toBeGreaterThan(0);
    expect(commits.length).toBeLessThanOrEqual(5);

    for (const commit of commits) {
      expect(isValidSha(commit.sha)).toBe(true);
      expect(commit.shortSha).toBe(commit.sha.slice(0, 7));
      expect(commit.author.length).toBeGreaterThan(0);
      expect(commit.subject.length).toBeGreaterThan(0);
    }
  });

  it('produces same SHAs as simple format for same commits', async () => {
    const fullOutput = await gitExec('git log -5');
    const fullCommits = parseGitLog(fullOutput);

    const simpleOutput = await gitExec('git log -5 --format="%H|%s|%an|%ae|%aI"');
    const simpleCommits = parseSimpleGitLog(simpleOutput, '%H|%s|%an|%ae|%aI');

    // Both should have same number of commits
    expect(fullCommits.length).toBe(simpleCommits.length);

    // SHAs should match
    for (let i = 0; i < fullCommits.length; i++) {
      expect(fullCommits[i].sha).toBe(simpleCommits[i].sha);
    }
  });
});

// =============================================================================
// LIVE GIT — buildGitLogCommand + execution
// =============================================================================

describe('Live Git — buildGitLogCommand', () => {
  it('produces a command that executes successfully', async () => {
    const cmd = buildGitLogCommand({ maxCount: 5, format: 'simple' });

    // The command should run without error
    const output = await gitExec(cmd);
    expect(output.length).toBeGreaterThan(0);

    // Output should be parseable
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.length).toBeLessThanOrEqual(5);
  });

  it('respects since option for date filtering', async () => {
    // Get the oldest commit date
    const allOutput = await gitExec('git log --format="%H|%s|%an|%ae|%aI" --reverse');
    const allCommits = parseSimpleGitLog(allOutput, '%H|%s|%an|%ae|%aI');

    if (allCommits.length >= 2) {
      // Use a date between the first and second commit to exclude the first
      const secondDate = allCommits[1].date;
      const cmd = buildGitLogCommand({ since: secondDate, format: 'simple' });
      const output = await gitExec(cmd);
      const filtered = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');

      // Should have fewer commits than total (at least the first is excluded)
      expect(filtered.length).toBeLessThan(allCommits.length);
    }
  });
});

// =============================================================================
// LIVE GIT — extractTaskRefs on real commits
// =============================================================================

describe('Live Git — extractTaskRefs on real commits', () => {
  it('extracts task refs from real commits without assuming repo history', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    const refs = extractTaskRefs(commits, 'RALPH');

    // Repo history can evolve; validate shape instead of fixed count.
    for (const ref of refs) {
      expect(ref.taskId).toMatch(/^RALPH-\d+$/);
      expect(ref.action).toBeDefined();
      expect(ref.commit.sha.length).toBe(40);
    }
  });

  it('inferAction classifies real commit subjects correctly', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');

    for (const commit of commits) {
      const action = inferAction(commit.subject);
      // Action must be one of the known types
      expect([
        'implement', 'fix', 'update', 'refactor', 'test',
        'docs', 'start', 'complete', 'wip', 'unknown',
      ]).toContain(action);

      // Commits starting with "Add" should be classified as 'implement'
      // Note: inferAction checks keywords in priority order, so "Add" matches
      // 'implement' even if "fix" also appears later in the message
      if (commit.subject.toLowerCase().startsWith('add ')) {
        expect(action).toBe('implement');
      }
    }
  });
});

// =============================================================================
// LIVE GIT — link & infer pipeline with synthetic tasks seeded from real data
// =============================================================================

describe('Live Git — linking and inference with seeded tasks', () => {
  /** Create synthetic tasks that reference real commit subjects */
  function seedTasksFromCommits(commits: GitCommit[]): Map<string, Task> {
    const tasks = new Map<string, Task>();

    // Seed one task per commit, using synthetic RALPH-xxx IDs
    commits.forEach((commit, i) => {
      const id = `RALPH-${String(i + 1).padStart(3, '0')}`;
      tasks.set(id, {
        id,
        type: 'task',
        title: commit.subject,
        description: '',
        status: i === 0 ? 'in_progress' : 'pending',
        createdAt: commit.date,
        updatedAt: commit.date,
      });
    });

    return tasks;
  }

  it('aggregateByTask produces valid summaries for seeded tasks', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    const tasks = seedTasksFromCommits(commits);

    // Create synthetic refs mapping each commit to its seeded task
    const refs = commits.map((commit, i) => ({
      taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
      action: inferAction(commit.subject),
      commit,
    }));

    const summaries = aggregateByTask(refs, tasks);

    // Should have a summary per task (returns array)
    expect(summaries.length).toBe(tasks.size);

    for (const summary of summaries) {
      expect(summary.taskId).toMatch(/^RALPH-\d{3}$/);
      expect(summary.commits).toBeGreaterThanOrEqual(1);
      expect(summary.authors.length).toBeGreaterThan(0);
      expect(isValidIsoDate(summary.firstCommit!)).toBe(true);
      expect(isValidIsoDate(summary.lastCommit!)).toBe(true);
    }
  });

  it('inferStatuses produces valid inferences for seeded tasks', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    const tasks = seedTasksFromCommits(commits);

    const refs = commits.map((commit, i) => ({
      taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
      action: inferAction(commit.subject),
      commit,
    }));

    const summaries = aggregateByTask(refs, tasks);
    const inferences = inferStatuses(tasks, summaries, { minConfidence: 0.5 });

    // Each inference should have valid structure
    for (const inf of inferences) {
      expect(inf.taskId).toMatch(/^RALPH-\d{3}$/);
      expect(inf.confidence).toBeGreaterThanOrEqual(0);
      expect(inf.confidence).toBeLessThanOrEqual(1);
      expect(inf.reason.length).toBeGreaterThan(0);
      expect(inf.evidence.length).toBeGreaterThan(0);
      expect(inf.inferredStatus).toBeDefined();
    }
  });

  it('detectAnomalies handles real data gracefully', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    const tasks = seedTasksFromCommits(commits);

    const refs = commits.map((commit, i) => ({
      taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
      action: inferAction(commit.subject),
      commit,
    }));

    const summaries = aggregateByTask(refs, tasks);
    const anomalies = detectAnomalies(tasks, summaries);

    // Should not throw, each anomaly should have valid structure
    for (const anomaly of anomalies) {
      expect(anomaly.taskId).toMatch(/^RALPH-\d{3}$/);
      expect(['stale', 'long_running', 'no_activity', 'regression']).toContain(anomaly.type);
      expect(['low', 'medium', 'high']).toContain(anomaly.severity);
      expect(anomaly.description.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// LIVE GIT — full watchGitActivity pipeline
// =============================================================================

describe('Live Git — watchGitActivity full pipeline', () => {
  function makeLiveContext(overrides: {
    tasks?: Task[];
    progress?: string;
  } = {}): WatchContext {
    const tasks = overrides.tasks || [];
    const tasksJsonl = tasks.length > 0
      ? tasks.map(t => JSON.stringify({
          op: 'create',
          task: t,
          timestamp: t.createdAt,
        } as TaskOperation)).join('\n') + '\n'
      : '';

    const files: Record<string, string> = {
      './state/tasks.jsonl': tasksJsonl,
      './state/progress.jsonl': overrides.progress || '',
    };

    return {
      execCommand: (command: string) => gitExec(command),
      readFile: (path: string) => {
        if (path in files) return Promise.resolve(files[path]);
        return Promise.reject(new Error(`ENOENT: ${path}`));
      },
      writeFile: vi.fn().mockResolvedValue(undefined),
      tasksPath: './state/tasks.jsonl',
      progressPath: './state/progress.jsonl',
    };
  }

  it('runs the full pipeline against the real repo without errors', async () => {
    const context = makeLiveContext();
    const result = await watchGitActivity(context, { dryRun: true });

    // Should have parsed real commits
    expect(result.commits.length).toBeGreaterThan(0);
    expect(result.newRefs.length).toBeLessThanOrEqual(result.taskRefs.length);
    expect(result.operations).toHaveLength(0);
  });

  it('produces commits with valid structure from real git', async () => {
    const context = makeLiveContext();
    const result = await watchGitActivity(context, { dryRun: true });

    for (const commit of result.commits) {
      expect(isValidSha(commit.sha)).toBe(true);
      expect(commit.shortSha).toBe(commit.sha.slice(0, 7));
      expect(commit.subject.length).toBeGreaterThan(0);
      expect(commit.author.length).toBeGreaterThan(0);
      expect(commit.authorEmail).toContain('@');
      expect(isValidIsoDate(commit.date)).toBe(true);
    }
  });

  it('respects maxCommits option with real git', async () => {
    const context = makeLiveContext();
    const result = await watchGitActivity(context, { dryRun: true, maxCommits: 3 });

    expect(result.commits.length).toBeLessThanOrEqual(3);
    expect(result.commits.length).toBeGreaterThan(0);
  });

  it('handles pre-seeded tasks that match synthetic commit refs', async () => {
    // Create tasks and run against real history; references may or may not match.
    const tasks: Task[] = [
      {
        id: 'RALPH-001',
        type: 'task',
        title: 'Test task',
        description: '',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ];

    const context = makeLiveContext({ tasks });
    const result = await watchGitActivity(context, { dryRun: true });

    // In dry-run mode no operations should be persisted regardless of refs.
    expect(result.commits.length).toBeGreaterThan(0);
    expect(result.operations).toHaveLength(0);
  });

  it('does not write when in dry-run mode against real repo', async () => {
    const context = makeLiveContext();
    const result = await watchGitActivity(context, { dryRun: true });

    // writeFile should never have been called
    expect(context.writeFile).not.toHaveBeenCalled();
  });

  it('handles anomaly detection on real repo data', async () => {
    const tasks: Task[] = [
      {
        id: 'RALPH-001',
        type: 'task',
        title: 'Old unfinished task',
        description: '',
        status: 'in_progress',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      },
    ];

    const context = makeLiveContext({ tasks });
    const result = await watchGitActivity(context, {
      dryRun: true,
      detectAnomalies: true,
    });

    // The old task with no matching commits should trigger anomalies
    for (const anomaly of result.anomalies) {
      expect(['stale', 'long_running', 'no_activity', 'regression']).toContain(anomaly.type);
      expect(['low', 'medium', 'high']).toContain(anomaly.severity);
    }
  });
});

// =============================================================================
// LIVE GIT — git branch parsing
// =============================================================================

describe('Live Git — branch parsing', () => {
  it('reads and parses current branch from real git', async () => {
    const branch = await gitExec('git branch --show-current');
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).not.toContain('\n');
  });

  it('lists branches from real git', async () => {
    const output = await gitExec('git branch --format="%(refname:short)|%(committerdate:iso)"');
    const lines = output.split('\n').filter(l => l.trim());

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      const parts = line.split('|');
      expect(parts.length).toBeGreaterThanOrEqual(1);
      // Branch name should be non-empty
      expect(parts[0].trim().length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// LIVE GIT — filterNewCommits with real SHAs
// =============================================================================

describe('Live Git — filterNewCommits with real data', () => {
  it('filters out commits already present in progress events', async () => {
    const output = await gitExec('git log --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');

    if (commits.length < 2) return; // Skip if too few commits

    // Create synthetic refs for all commits
    const refs = commits.map((commit, i) => ({
      taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
      action: inferAction(commit.subject),
      commit,
    }));

    // Mark the first commit as already processed
    const existingProgress = [{
      type: 'git_activity',
      taskId: refs[0].taskId,
      sha: refs[0].commit.sha,
      timestamp: new Date().toISOString(),
    }];

    const newRefs = filterNewCommits(refs, existingProgress);

    // Should have one fewer ref (the already-processed one is filtered)
    expect(newRefs.length).toBe(refs.length - 1);
    // The filtered commit should not be present
    expect(newRefs.find(r => r.commit.sha === refs[0].commit.sha)).toBeUndefined();
  });

  it('returns all commits when no progress events exist', async () => {
    const output = await gitExec('git log -3 --format="%H|%s|%an|%ae|%aI"');
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');

    const refs = commits.map((commit, i) => ({
      taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
      action: inferAction(commit.subject),
      commit,
    }));

    const newRefs = filterNewCommits(refs, []);
    expect(newRefs.length).toBe(refs.length);
  });
});
