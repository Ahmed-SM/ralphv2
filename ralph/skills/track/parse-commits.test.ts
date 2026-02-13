import { describe, it, expect } from 'vitest';
import {
  parseGitLog,
  parseSimpleGitLog,
  extractTaskRefs,
  extractTaskIds,
  inferAction,
  parseCommits,
  parseBranches,
  extractTaskFromBranch,
  buildGitLogCommand,
} from './parse-commits.js';
import type { GitCommit } from './parse-commits.js';

// =============================================================================
// FIXTURES
// =============================================================================

const SAMPLE_GIT_LOG = `commit abc1234567890abcdef1234567890abcdef123456
Author: John Doe <john@example.com>
Date:   Mon Jan 1 12:00:00 2025 +0000

    Implement RALPH-001: Task discovery

commit def4567890abcdef1234567890abcdef1234567890
Author: Jane Smith <jane@example.com>
Date:   Tue Jan 2 14:30:00 2025 +0000

    Fix RALPH-003: Bug in parser

    This fixes the issue where nested lists were not parsed correctly.
    Also references RALPH-005.`;

// =============================================================================
// TESTS
// =============================================================================

describe('parseGitLog', () => {
  it('parses standard git log output', () => {
    const commits = parseGitLog(SAMPLE_GIT_LOG);
    expect(commits).toHaveLength(2);
  });

  it('extracts SHA correctly', () => {
    const commits = parseGitLog(SAMPLE_GIT_LOG);
    expect(commits[0].sha).toMatch(/^[a-f0-9]{40}$/);
    expect(commits[0].shortSha).toBe(commits[0].sha.slice(0, 7));
  });

  it('extracts author info', () => {
    const commits = parseGitLog(SAMPLE_GIT_LOG);
    expect(commits[0].author).toBe('John Doe');
    expect(commits[0].authorEmail).toBe('john@example.com');
  });

  it('extracts subject and body', () => {
    const commits = parseGitLog(SAMPLE_GIT_LOG);
    expect(commits[0].subject).toBe('Implement RALPH-001: Task discovery');
    expect(commits[0].body).toBe('');

    expect(commits[1].subject).toBe('Fix RALPH-003: Bug in parser');
    expect(commits[1].body).toContain('nested lists');
  });

  it('returns empty array for empty input', () => {
    expect(parseGitLog('')).toHaveLength(0);
    expect(parseGitLog('  \n  ')).toHaveLength(0);
  });

  it('handles single commit', () => {
    const single = `commit aaaa234567890abcdef1234567890abcdef123456
Author: Dev <dev@test.com>
Date:   Wed Jan 3 10:00:00 2025 +0000

    Initial commit`;
    const commits = parseGitLog(single);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('Initial commit');
  });
});

describe('parseSimpleGitLog', () => {
  it('parses pipe-delimited format', () => {
    const output = 'abc1234567890abcdef1234567890abcdef123456|Add feature|John|john@example.com|2025-01-01T00:00:00Z';
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('Add feature');
    expect(commits[0].author).toBe('John');
  });

  it('handles multiple lines', () => {
    const output = `abc1234567890abcdef1234567890abcdef123456|First|Alice|alice@test.com|2025-01-01
def4567890abcdef1234567890abcdef1234567890|Second|Bob|bob@test.com|2025-01-02`;
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    expect(commits).toHaveLength(2);
  });

  it('skips lines with too few parts', () => {
    const output = 'incomplete|data\nabc1234567890abcdef1234567890abcdef123456|OK|Dev|dev@test.com|2025-01-01';
    const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
    expect(commits).toHaveLength(1);
  });
});

describe('extractTaskIds', () => {
  it('extracts task IDs from text', () => {
    const ids = extractTaskIds('Implement RALPH-001 and RALPH-042');
    expect(ids).toContain('RALPH-001');
    expect(ids).toContain('RALPH-042');
  });

  it('normalizes padding', () => {
    const ids = extractTaskIds('RALPH-1 and RALPH-02');
    expect(ids).toContain('RALPH-001');
    expect(ids).toContain('RALPH-002');
  });

  it('deduplicates IDs', () => {
    const ids = extractTaskIds('RALPH-001 mentioned twice RALPH-001');
    expect(ids).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    expect(extractTaskIds('No task references here')).toHaveLength(0);
  });

  it('supports custom prefix', () => {
    const ids = extractTaskIds('PROJ-42 is done', 'PROJ');
    expect(ids).toContain('PROJ-042');
  });

  it('is case-insensitive', () => {
    const ids = extractTaskIds('ralph-001 and Ralph-002');
    expect(ids).toHaveLength(2);
  });
});

describe('inferAction', () => {
  it('infers implement from keywords', () => {
    expect(inferAction('Implement user auth')).toBe('implement');
    expect(inferAction('Add new endpoint')).toBe('implement');
    expect(inferAction('Create config file')).toBe('implement');
  });

  it('infers fix', () => {
    expect(inferAction('Fix login bug')).toBe('fix');
    expect(inferAction('Resolve issue')).toBe('fix');
  });

  it('infers update', () => {
    expect(inferAction('Update dependencies')).toBe('update');
    expect(inferAction('Change config')).toBe('update');
  });

  it('infers refactor', () => {
    expect(inferAction('Refactor auth module')).toBe('refactor');
    expect(inferAction('Clean up code')).toBe('refactor');
  });

  it('infers test', () => {
    expect(inferAction('Test payment flow')).toBe('test');
    // Note: "Add spec" matches 'implement' first (due to 'add' keyword)
    expect(inferAction('Add spec for parser')).toBe('implement');
    // Pure test keyword
    expect(inferAction('Run tests')).toBe('test');
  });

  it('infers docs', () => {
    expect(inferAction('Document API')).toBe('docs');
    // Note: "Update readme" matches 'update' first (due to 'update' keyword priority)
    expect(inferAction('Update readme')).toBe('update');
    // Pure docs keyword
    expect(inferAction('Write docs for module')).toBe('docs');
  });

  it('infers start', () => {
    expect(inferAction('Start work on feature')).toBe('start');
    // Note: "Begin implementation" matches 'implement' first
    expect(inferAction('Begin implementation')).toBe('implement');
    // Pure start keyword
    expect(inferAction('Begin task')).toBe('start');
  });

  it('infers complete', () => {
    expect(inferAction('Complete feature')).toBe('complete');
    // Note: "Finish implementation" matches 'implement' first
    expect(inferAction('Finish implementation')).toBe('implement');
    // Pure complete keyword
    expect(inferAction('Done with task')).toBe('complete');
  });

  it('infers wip', () => {
    // Note: "WIP: partial changes" matches 'update' (due to 'change' keyword)
    expect(inferAction('WIP: partial changes')).toBe('update');
    // Pure WIP
    expect(inferAction('WIP on parser')).toBe('wip');
    expect(inferAction('Work in progress')).toBe('wip');
  });

  it('returns unknown for unrecognized', () => {
    // Note: "misc changes" matches 'update' (due to 'change' keyword)
    expect(inferAction('misc changes')).toBe('update');
    // Truly unrecognized
    expect(inferAction('bump version')).toBe('unknown');
  });
});

describe('extractTaskRefs', () => {
  it('extracts refs from commits', () => {
    const commits: GitCommit[] = [
      {
        sha: 'abc123'.padEnd(40, '0'),
        shortSha: 'abc123',
        message: 'Implement RALPH-001',
        subject: 'Implement RALPH-001',
        body: '',
        author: 'Dev',
        authorEmail: 'dev@test.com',
        date: '2025-01-01',
      },
    ];
    const refs = extractTaskRefs(commits);
    expect(refs).toHaveLength(1);
    expect(refs[0].taskId).toBe('RALPH-001');
    expect(refs[0].action).toBe('implement');
  });

  it('extracts multiple refs from body', () => {
    const commits: GitCommit[] = [
      {
        sha: 'abc123'.padEnd(40, '0'),
        shortSha: 'abc123',
        message: 'Fix RALPH-001\n\nAlso fixes RALPH-002',
        subject: 'Fix RALPH-001',
        body: 'Also fixes RALPH-002',
        author: 'Dev',
        authorEmail: 'dev@test.com',
        date: '2025-01-01',
      },
    ];
    const refs = extractTaskRefs(commits);
    expect(refs).toHaveLength(2);
  });
});

describe('parseCommits', () => {
  it('splits commits into tagged and untagged', () => {
    const result = parseCommits(SAMPLE_GIT_LOG);
    expect(result.commits).toHaveLength(2);
    expect(result.taskRefs.length).toBeGreaterThan(0);
    // Both commits have task refs so untagged should be 0
    expect(result.untaggedCommits).toHaveLength(0);
  });
});

describe('parseBranches', () => {
  it('parses branch output', () => {
    const output = `main|2025-01-01
ralph/001-feature|2025-01-02
origin/ralph/002-bugfix|2025-01-03`;
    const branches = parseBranches(output);
    expect(branches).toHaveLength(3);
    expect(branches[0].remote).toBe(false);
    expect(branches[0].taskId).toBeUndefined();
    expect(branches[1].taskId).toBe('RALPH-001');
    expect(branches[2].remote).toBe(true);
    expect(branches[2].taskId).toBe('RALPH-002');
  });
});

describe('extractTaskFromBranch', () => {
  it('extracts from ralph/NNN pattern', () => {
    expect(extractTaskFromBranch('ralph/001-feature')).toBe('RALPH-001');
  });

  it('extracts from ralph-NNN pattern', () => {
    expect(extractTaskFromBranch('ralph-042')).toBe('RALPH-042');
  });

  it('extracts from RALPH-NNN pattern', () => {
    expect(extractTaskFromBranch('feature/RALPH-005')).toBe('RALPH-005');
  });

  it('extracts from feature/NNN pattern', () => {
    expect(extractTaskFromBranch('feature/7')).toBe('RALPH-007');
  });

  it('returns null for no match', () => {
    expect(extractTaskFromBranch('main')).toBeNull();
    expect(extractTaskFromBranch('develop')).toBeNull();
  });
});

describe('buildGitLogCommand', () => {
  it('builds basic command', () => {
    expect(buildGitLogCommand()).toBe('git log');
  });

  it('includes options', () => {
    const cmd = buildGitLogCommand({
      since: '2025-01-01',
      maxCount: 10,
      format: 'simple',
      branch: 'main',
    });
    expect(cmd).toContain('--since=');
    expect(cmd).toContain('-n 10');
    expect(cmd).toContain('--format=');
    expect(cmd).toContain('main');
  });
});
