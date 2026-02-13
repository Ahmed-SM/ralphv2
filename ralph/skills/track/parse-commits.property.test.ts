/**
 * Property-based tests for parse-commits.ts
 *
 * Verifies invariants of git log parsing, task ID extraction,
 * action inference, and branch parsing.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseGitLog,
  parseSimpleGitLog,
  extractTaskIds,
  extractTaskRefs,
  inferAction,
  parseCommits,
  parseBranches,
  extractTaskFromBranch,
  buildGitLogCommand,
} from './parse-commits.js';

// =============================================================================
// ARBITRARIES
// =============================================================================

const shaArb = fc.stringMatching(/^[a-f0-9]{40}$/);
const shortShaArb = (sha: string) => sha.slice(0, 7);

const authorArb = fc.stringMatching(new RegExp('^[a-zA-Z ]{1,30}$')).map(s => s.trim() || 'Author');

const emailArb = fc.tuple(
  fc.stringMatching(/^[a-z]{1,10}$/),
  fc.constantFrom('example.com', 'test.org', 'dev.io')
).map(([user, domain]) => `${user || 'user'}@${domain}`);

const dateArb = fc.integer({ min: 1577836800000, max: 1893456000000 })
  .map(ms => new Date(ms).toISOString());

const subjectArb = fc.stringMatching(new RegExp('^[a-zA-Z0-9 _.:-]{1,80}$')).map(s => s.trim() || 'commit message');

/** Build a full git log entry string for a single commit */
function buildCommitEntry(sha: string, author: string, email: string, date: string, subject: string, body = ''): string {
  const lines = [
    `commit ${sha}`,
    `Author: ${author} <${email}>`,
    `Date:   ${date}`,
    '',
    `    ${subject}`,
  ];
  if (body) {
    lines.push(`    ${body}`);
  }
  return lines.join('\n');
}

const commitEntryArb = fc.record({
  sha: shaArb,
  author: authorArb,
  email: emailArb,
  date: dateArb,
  subject: subjectArb,
}).map(({ sha, author, email, date, subject }) =>
  ({ raw: buildCommitEntry(sha, author, email, date, subject), sha, author, email, date, subject })
);

// =============================================================================
// PROPERTIES
// =============================================================================

describe('parseGitLog — property-based', () => {

  it('returns empty array for empty input', () => {
    expect(parseGitLog('')).toHaveLength(0);
  });

  it('never crashes on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parseGitLog(input);
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('parses N commits from N concatenated entries', () => {
    fc.assert(
      fc.property(
        fc.array(commitEntryArb, { minLength: 1, maxLength: 5 }),
        (entries) => {
          const log = entries.map(e => e.raw).join('\n\n');
          const commits = parseGitLog(log);
          expect(commits.length).toBe(entries.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHA is always a 40-char hex string', () => {
    fc.assert(
      fc.property(
        fc.array(commitEntryArb, { minLength: 1, maxLength: 3 }),
        (entries) => {
          const log = entries.map(e => e.raw).join('\n\n');
          const commits = parseGitLog(log);
          for (const c of commits) {
            expect(c.sha).toMatch(/^[a-f0-9]{40}$/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('shortSha is always the first 7 chars of sha', () => {
    fc.assert(
      fc.property(
        fc.array(commitEntryArb, { minLength: 1, maxLength: 3 }),
        (entries) => {
          const log = entries.map(e => e.raw).join('\n\n');
          const commits = parseGitLog(log);
          for (const c of commits) {
            expect(c.shortSha).toBe(c.sha.slice(0, 7));
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('subject is extracted from the commit message', () => {
    fc.assert(
      fc.property(
        commitEntryArb,
        (entry) => {
          const commits = parseGitLog(entry.raw);
          expect(commits.length).toBe(1);
          expect(commits[0].subject).toBe(entry.subject);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('parseSimpleGitLog — property-based', () => {

  it('parses pipe-delimited format correctly', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            sha: shaArb,
            subject: subjectArb.filter(s => !s.includes('|')),
            author: authorArb.filter(s => !s.includes('|')),
            email: emailArb,
            date: dateArb,
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (entries) => {
          const lines = entries.map(e => `${e.sha}|${e.subject}|${e.author}|${e.email}|${e.date}`);
          const output = lines.join('\n');
          const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
          expect(commits.length).toBe(entries.length);
          for (let i = 0; i < entries.length; i++) {
            expect(commits[i].sha).toBe(entries[i].sha);
            expect(commits[i].subject).toBe(entries[i].subject);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('skips lines with fewer than 4 pipe-separated fields', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,20}$/),
        (text) => {
          // Only 2 fields, should be skipped
          const output = `${text}|${text}`;
          const commits = parseSimpleGitLog(output, '%H|%s|%an|%ae|%aI');
          expect(commits).toHaveLength(0);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('extractTaskIds — property-based', () => {

  it('finds all RALPH-N references in text', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 9999 }), { minLength: 1, maxLength: 5 }),
        (nums) => {
          const uniqueNums = [...new Set(nums)];
          const text = uniqueNums.map(n => `RALPH-${n}`).join(' and ');
          const ids = extractTaskIds(text);
          // Should find at least unique IDs (after normalization to 3-digit padding)
          const expectedIds = new Set(uniqueNums.map(n => `RALPH-${String(n).padStart(3, '0')}`));
          expect(ids.length).toBe(expectedIds.size);
          for (const id of ids) {
            expect(expectedIds.has(id)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('returns empty array when no task IDs present', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(new RegExp('^[a-z ]{0,100}$')),
        (text) => {
          const ids = extractTaskIds(text);
          expect(ids).toHaveLength(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('normalizes IDs with zero-padding to 3 digits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        (n) => {
          const ids = extractTaskIds(`RALPH-${n}`);
          expect(ids).toHaveLength(1);
          expect(ids[0]).toBe(`RALPH-${String(n).padStart(3, '0')}`);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('deduplicates repeated IDs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 2, max: 5 }),
        (n, repeats) => {
          const text = Array(repeats).fill(`RALPH-${n}`).join(' ');
          const ids = extractTaskIds(text);
          expect(ids).toHaveLength(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('case-insensitive extraction', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.constantFrom('RALPH', 'ralph', 'Ralph', 'rAlPh'),
        (n, prefix) => {
          const ids = extractTaskIds(`${prefix}-${n}`, 'RALPH');
          expect(ids).toHaveLength(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('works with custom prefixes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.constantFrom('PROJ', 'TEAM', 'APP', 'TASK'),
        (n, prefix) => {
          const ids = extractTaskIds(`${prefix}-${n}`, prefix);
          expect(ids).toHaveLength(1);
          expect(ids[0]).toBe(`${prefix}-${String(n).padStart(3, '0')}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('inferAction — property-based', () => {

  it('always returns a valid CommitAction', () => {
    const validActions = ['implement', 'fix', 'update', 'refactor', 'test', 'docs', 'start', 'complete', 'wip', 'unknown'];
    fc.assert(
      fc.property(fc.string(), (subject) => {
        const action = inferAction(subject);
        expect(validActions).toContain(action);
      }),
      { numRuns: 500 }
    );
  });

  it('keyword mapping: specific words map to expected actions', () => {
    const mapping: Array<[string, string]> = [
      ['implement', 'implement'], ['add', 'implement'], ['create', 'implement'],
      ['fix', 'fix'], ['bug', 'fix'], ['resolve', 'fix'],
      ['update', 'update'], ['change', 'update'], ['modify', 'update'],
      ['refactor', 'refactor'], ['clean', 'refactor'],
      ['test', 'test'], ['spec', 'test'],
      ['doc', 'docs'], ['readme', 'docs'], ['comment', 'docs'],
      ['start', 'start'], ['begin', 'start'],
      ['complete', 'complete'], ['finish', 'complete'], ['done', 'complete'],
      ['wip', 'wip'], ['work in progress', 'wip'],
    ];

    for (const [keyword, expected] of mapping) {
      expect(inferAction(keyword)).toBe(expected);
    }
  });

  it('returns unknown for strings without action keywords', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('xyz123', 'foobar', 'hello world', '12345', 'miscellaneous'),
        (subject) => {
          expect(inferAction(subject)).toBe('unknown');
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('parseCommits — property-based', () => {

  it('untaggedCommits + referencedCommits covers all commits', () => {
    fc.assert(
      fc.property(
        fc.array(commitEntryArb, { minLength: 1, maxLength: 3 }),
        (entries) => {
          const log = entries.map(e => e.raw).join('\n\n');
          const result = parseCommits(log);

          const referencedShas = new Set(result.taskRefs.map(r => r.commit.sha));
          const untaggedShas = new Set(result.untaggedCommits.map(c => c.sha));

          // Every commit is either referenced or untagged
          for (const c of result.commits) {
            expect(referencedShas.has(c.sha) || untaggedShas.has(c.sha)).toBe(true);
          }

          // No overlap
          for (const sha of referencedShas) {
            expect(untaggedShas.has(sha)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('commits with RALPH-NNN in subject produce taskRefs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        shaArb,
        (n, sha) => {
          const entry = buildCommitEntry(sha, 'Dev', 'dev@test.com', '2025-01-01', `RALPH-${n}: fix something`);
          const result = parseCommits(entry);
          expect(result.taskRefs.length).toBeGreaterThanOrEqual(1);
          expect(result.taskRefs[0].taskId).toBe(`RALPH-${String(n).padStart(3, '0')}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('parseBranches — property-based', () => {

  it('detects remote branches', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('origin/', 'remotes/origin/'),
        fc.stringMatching(new RegExp('^[a-z/\\-]{1,20}$')),
        (prefix, name) => {
          const branchName = `${prefix}${name.trim() || 'branch'}`;
          const output = `${branchName}|2025-01-01`;
          const branches = parseBranches(output);
          expect(branches[0].remote).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('detects local branches', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(new RegExp('^[a-z\\-]{1,20}$'))
          .filter(s => !s.startsWith('origin/') && !s.startsWith('remotes/')),
        (name) => {
          const branchName = name.trim() || 'main';
          const output = `${branchName}|2025-01-01`;
          const branches = parseBranches(output);
          expect(branches[0].remote).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('extractTaskFromBranch — property-based', () => {

  it('extracts task ID from ralph/NNN pattern', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.constantFrom('', '-feature', '-bugfix', '-refactor'),
        (n, suffix) => {
          const result = extractTaskFromBranch(`ralph/${n}${suffix}`);
          expect(result).toBe(`RALPH-${String(n).padStart(3, '0')}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('extracts task ID from ralph-NNN pattern', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        (n) => {
          const result = extractTaskFromBranch(`ralph-${n}`);
          expect(result).toBe(`RALPH-${String(n).padStart(3, '0')}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('extracts task ID from feature/NNN pattern', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        (n) => {
          const result = extractTaskFromBranch(`feature/${n}`);
          expect(result).toBe(`RALPH-${String(n).padStart(3, '0')}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns null for branches without task references', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('main', 'master', 'develop', 'staging', 'production', 'hotfix/urgent'),
        (branchName) => {
          const result = extractTaskFromBranch(branchName);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('buildGitLogCommand — property-based', () => {

  it('always starts with "git log"', () => {
    fc.assert(
      fc.property(
        fc.record({
          since: fc.option(fc.constant('2025-01-01'), { nil: undefined }),
          until: fc.option(fc.constant('2025-12-31'), { nil: undefined }),
          maxCount: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
          format: fc.option(fc.constantFrom('full' as const, 'simple' as const), { nil: undefined }),
          branch: fc.option(fc.constant('main'), { nil: undefined }),
        }),
        (options) => {
          const cmd = buildGitLogCommand(options);
          expect(cmd.startsWith('git log')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('includes --since when since is specified', () => {
    const cmd = buildGitLogCommand({ since: '2025-01-01' });
    expect(cmd).toContain('--since=');
  });

  it('includes -n when maxCount is specified', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        (n) => {
          const cmd = buildGitLogCommand({ maxCount: n });
          expect(cmd).toContain(`-n ${n}`);
        }
      ),
      { numRuns: 50 }
    );
  });
});
