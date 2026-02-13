import { describe, it, expect } from 'vitest';
import {
  linkCommitsToTasks,
  inferStatusChange,
  generateLinkOperations,
  generateProgressEvents,
  aggregateByTask,
  findInactiveTasks,
  findOrphanRefs,
  isCommitProcessed,
  filterNewCommits,
} from './link-commits.js';
import type { Task } from '../../types/index.js';
import type { CommitTaskRef, GitCommit, CommitAction } from './parse-commits.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'discovered',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCommit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    sha: 'abc123'.padEnd(40, '0'),
    shortSha: 'abc1234',
    message: 'Test commit',
    subject: 'Test commit',
    body: '',
    author: 'Dev',
    authorEmail: 'dev@test.com',
    date: '2025-01-15T12:00:00Z',
    ...overrides,
  };
}

function makeRef(taskId: string, action?: CommitAction, commit?: Partial<GitCommit>): CommitTaskRef {
  return {
    taskId,
    action,
    commit: makeCommit(commit),
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('linkCommitsToTasks', () => {
  it('links refs to existing tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask());
    const refs = [makeRef('RALPH-001', 'implement')];

    const results = linkCommitsToTasks(refs, tasks);
    expect(results).toHaveLength(1);
    expect(results[0].taskId).toBe('RALPH-001');
    expect(results[0].activities).toHaveLength(1);
  });

  it('skips refs for non-existent tasks', () => {
    const tasks = new Map<string, Task>();
    const refs = [makeRef('RALPH-999', 'implement')];

    const results = linkCommitsToTasks(refs, tasks);
    expect(results).toHaveLength(0);
  });

  it('groups multiple refs by task', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask());
    const refs = [
      makeRef('RALPH-001', 'implement', { sha: 'aaa'.padEnd(40, '0') }),
      makeRef('RALPH-001', 'fix', { sha: 'bbb'.padEnd(40, '0') }),
    ];

    const results = linkCommitsToTasks(refs, tasks);
    expect(results).toHaveLength(1);
    expect(results[0].activities).toHaveLength(2);
  });
});

describe('inferStatusChange', () => {
  it('moves discovered task to in_progress on commit', () => {
    const task = makeTask({ status: 'discovered' });
    const activities = [{ taskId: 'RALPH-001', type: 'commit' as const, message: 'Work', timestamp: '2025-01-15' }];

    const change = inferStatusChange(task, activities);
    expect(change).toBeDefined();
    expect(change!.from).toBe('discovered');
    expect(change!.to).toBe('in_progress');
  });

  it('moves pending task to in_progress on commit', () => {
    const task = makeTask({ status: 'pending' });
    const activities = [{ taskId: 'RALPH-001', type: 'commit' as const, message: 'Work', timestamp: '2025-01-15' }];

    const change = inferStatusChange(task, activities);
    expect(change!.to).toBe('in_progress');
  });

  it('moves in_progress to done on complete action', () => {
    const task = makeTask({ status: 'in_progress' });
    const activities = [{
      taskId: 'RALPH-001',
      type: 'commit' as const,
      message: 'Done',
      timestamp: '2025-01-15',
      action: 'complete' as CommitAction,
    }];

    const change = inferStatusChange(task, activities);
    expect(change!.to).toBe('done');
  });

  it('returns undefined for no activities', () => {
    const task = makeTask({ status: 'in_progress' });
    expect(inferStatusChange(task, [])).toBeUndefined();
  });

  it('returns undefined for in_progress with non-complete actions', () => {
    const task = makeTask({ status: 'in_progress' });
    const activities = [{
      taskId: 'RALPH-001',
      type: 'commit' as const,
      message: 'More work',
      timestamp: '2025-01-15',
      action: 'implement' as CommitAction,
    }];

    expect(inferStatusChange(task, activities)).toBeUndefined();
  });
});

describe('generateLinkOperations', () => {
  it('generates update operations for status changes', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ status: 'discovered' }));

    const refs = [makeRef('RALPH-001', 'implement')];
    const results = linkCommitsToTasks(refs, tasks);

    // Manually add status change
    results[0].statusChange = { from: 'discovered', to: 'in_progress', reason: 'Work detected' };

    const ops = generateLinkOperations(results, tasks);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('update');
    expect((ops[0] as any).changes.status).toBe('in_progress');
  });
});

describe('generateProgressEvents', () => {
  it('creates events for activities', () => {
    const results = [{
      taskId: 'RALPH-001',
      activities: [{
        taskId: 'RALPH-001',
        type: 'commit' as const,
        sha: 'abc',
        message: 'Work',
        timestamp: '2025-01-15',
      }],
    }];

    const events = generateProgressEvents(results);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('git_activity');
  });

  it('includes status change events', () => {
    const results = [{
      taskId: 'RALPH-001',
      activities: [],
      statusChange: { from: 'discovered' as const, to: 'in_progress' as const, reason: 'Work detected' },
    }];

    const events = generateProgressEvents(results);
    expect(events.some(e => e.type === 'status_change')).toBe(true);
  });
});

describe('aggregateByTask', () => {
  it('aggregates refs by task', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask());

    const refs = [
      makeRef('RALPH-001', 'implement', { sha: 'aaa'.padEnd(40, '0'), date: '2025-01-10', author: 'Alice' }),
      makeRef('RALPH-001', 'fix', { sha: 'bbb'.padEnd(40, '0'), date: '2025-01-15', author: 'Bob' }),
    ];

    const summaries = aggregateByTask(refs, tasks);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].commits).toBe(2);
    expect(summaries[0].authors).toContain('Alice');
    expect(summaries[0].authors).toContain('Bob');
    expect(summaries[0].firstCommit).toBe('2025-01-10');
    expect(summaries[0].lastCommit).toBe('2025-01-15');
    expect(summaries[0].actions).toContain('implement');
    expect(summaries[0].actions).toContain('fix');
  });

  it('tracks files changed', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask());

    const refs = [
      makeRef('RALPH-001', 'implement', {
        sha: 'aaa'.padEnd(40, '0'),
        files: ['src/a.ts', 'src/b.ts'],
      }),
      makeRef('RALPH-001', 'fix', {
        sha: 'bbb'.padEnd(40, '0'),
        files: ['src/a.ts', 'src/c.ts'],
      }),
    ];

    const summaries = aggregateByTask(refs, tasks);
    expect(summaries[0].filesChanged.size).toBe(3);
  });
});

describe('findInactiveTasks', () => {
  it('finds tasks with no git activity', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask({ id: 'RALPH-001', status: 'in_progress' }));
    tasks.set('RALPH-002', makeTask({ id: 'RALPH-002', status: 'discovered' }));
    tasks.set('RALPH-003', makeTask({ id: 'RALPH-003', status: 'done' }));

    const refs = [makeRef('RALPH-001')];

    const inactive = findInactiveTasks(tasks, refs);
    expect(inactive).toHaveLength(1);
    expect(inactive[0].id).toBe('RALPH-002');
  });
});

describe('findOrphanRefs', () => {
  it('finds refs without matching tasks', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-001', makeTask());

    const refs = [
      makeRef('RALPH-001'),
      makeRef('RALPH-999'),
    ];

    const orphans = findOrphanRefs(refs, tasks);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].taskId).toBe('RALPH-999');
  });
});

describe('isCommitProcessed', () => {
  it('returns true for processed SHA', () => {
    const events = [
      { type: 'git_activity', sha: 'abc123', timestamp: '2025-01-01' },
    ];
    expect(isCommitProcessed('abc123', events)).toBe(true);
  });

  it('returns false for unprocessed SHA', () => {
    const events = [
      { type: 'git_activity', sha: 'abc123', timestamp: '2025-01-01' },
    ];
    expect(isCommitProcessed('def456', events)).toBe(false);
  });
});

describe('filterNewCommits', () => {
  it('filters out already processed commits', () => {
    const refs = [
      makeRef('RALPH-001', 'implement', { sha: 'aaa'.padEnd(40, '0') }),
      makeRef('RALPH-002', 'fix', { sha: 'bbb'.padEnd(40, '0') }),
    ];
    const events = [
      { type: 'git_activity', sha: 'aaa'.padEnd(40, '0'), timestamp: '2025-01-01' },
    ];

    const newRefs = filterNewCommits(refs, events);
    expect(newRefs).toHaveLength(1);
    expect(newRefs[0].taskId).toBe('RALPH-002');
  });
});
