/**
 * Parse Commits Skill
 *
 * Parses git commits to extract task references and metadata.
 */

import type { Task, TaskStatus } from '../../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
  files?: string[];
}

export interface CommitTaskRef {
  taskId: string;
  action?: CommitAction;
  commit: GitCommit;
}

export type CommitAction =
  | 'implement'
  | 'fix'
  | 'update'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'start'
  | 'complete'
  | 'wip'
  | 'unknown';

export interface ParseResult {
  commits: GitCommit[];
  taskRefs: CommitTaskRef[];
  untaggedCommits: GitCommit[];
}

// =============================================================================
// COMMIT PARSING
// =============================================================================

/**
 * Parse git log output into structured commits
 */
export function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];

  // Split by commit delimiter
  const entries = output.split(/(?=commit [a-f0-9]{40})/);

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const commit = parseCommitEntry(entry);
    if (commit) {
      commits.push(commit);
    }
  }

  return commits;
}

/**
 * Parse a single commit entry
 */
function parseCommitEntry(entry: string): GitCommit | null {
  const lines = entry.trim().split('\n');

  // Extract SHA
  const shaMatch = lines[0]?.match(/^commit ([a-f0-9]{40})/);
  if (!shaMatch) return null;

  const sha = shaMatch[1];
  const shortSha = sha.slice(0, 7);

  // Find author and date
  let author = '';
  let authorEmail = '';
  let date = '';
  let messageStart = 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('Author:')) {
      const authorMatch = line.match(/Author:\s*(.+?)\s*<(.+?)>/);
      if (authorMatch) {
        author = authorMatch[1].trim();
        authorEmail = authorMatch[2];
      }
    } else if (line.startsWith('Date:')) {
      date = line.replace('Date:', '').trim();
    } else if (line === '') {
      messageStart = i + 1;
      break;
    }
  }

  // Extract message
  const messageLines = lines.slice(messageStart).map(l => l.replace(/^\s{4}/, ''));
  const message = messageLines.join('\n').trim();
  const subject = messageLines[0] || '';
  const body = messageLines.slice(1).join('\n').trim();

  return {
    sha,
    shortSha,
    message,
    subject,
    body,
    author,
    authorEmail,
    date,
  };
}

/**
 * Parse simplified git log format (from --format)
 */
export function parseSimpleGitLog(output: string, format: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const lines = output.trim().split('\n');

  // Common format: "%H|%s|%an|%ae|%aI"
  for (const line of lines) {
    if (!line.trim()) continue;

    const parts = line.split('|');
    if (parts.length < 4) continue;

    const [sha, subject, author, authorEmail, date] = parts;

    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      message: subject,
      subject,
      body: '',
      author,
      authorEmail,
      date: date || new Date().toISOString(),
    });
  }

  return commits;
}

// =============================================================================
// TASK REFERENCE EXTRACTION
// =============================================================================

/**
 * Extract task references from commits
 */
export function extractTaskRefs(commits: GitCommit[], taskPrefix = 'RALPH'): CommitTaskRef[] {
  const refs: CommitTaskRef[] = [];

  for (const commit of commits) {
    const taskIds = extractTaskIds(commit.subject + ' ' + commit.body, taskPrefix);
    const action = inferAction(commit.subject);

    for (const taskId of taskIds) {
      refs.push({
        taskId,
        action,
        commit,
      });
    }
  }

  return refs;
}

/**
 * Extract task IDs from text
 */
export function extractTaskIds(text: string, prefix = 'RALPH'): string[] {
  const pattern = new RegExp(`${prefix}-(\\d+)`, 'gi');
  const matches = text.matchAll(pattern);
  const ids = new Set<string>();

  for (const match of matches) {
    ids.add(`${prefix}-${match[1].padStart(3, '0')}`);
  }

  return Array.from(ids);
}

/**
 * Infer action from commit message
 */
export function inferAction(subject: string): CommitAction {
  const lower = subject.toLowerCase();

  // Check for explicit action prefixes
  if (lower.includes('implement') || lower.includes('add') || lower.includes('create')) {
    return 'implement';
  }
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('resolve')) {
    return 'fix';
  }
  if (lower.includes('update') || lower.includes('change') || lower.includes('modify')) {
    return 'update';
  }
  if (lower.includes('refactor') || lower.includes('clean') || lower.includes('reorganize')) {
    return 'refactor';
  }
  if (lower.includes('test') || lower.includes('spec')) {
    return 'test';
  }
  if (lower.includes('doc') || lower.includes('readme') || lower.includes('comment')) {
    return 'docs';
  }
  if (lower.includes('start') || lower.includes('begin') || lower.includes('init')) {
    return 'start';
  }
  if (lower.includes('complete') || lower.includes('finish') || lower.includes('done')) {
    return 'complete';
  }
  if (lower.includes('wip') || lower.includes('work in progress')) {
    return 'wip';
  }

  return 'unknown';
}

/**
 * Parse commits and extract all task references
 */
export function parseCommits(gitLogOutput: string, taskPrefix = 'RALPH'): ParseResult {
  const commits = parseGitLog(gitLogOutput);
  const taskRefs = extractTaskRefs(commits, taskPrefix);

  // Find commits without task refs
  const referencedShas = new Set(taskRefs.map(r => r.commit.sha));
  const untaggedCommits = commits.filter(c => !referencedShas.has(c.sha));

  return {
    commits,
    taskRefs,
    untaggedCommits,
  };
}

// =============================================================================
// GIT COMMANDS
// =============================================================================

/**
 * Build git log command
 */
export function buildGitLogCommand(options: {
  since?: string;
  until?: string;
  author?: string;
  maxCount?: number;
  format?: 'full' | 'simple';
  branch?: string;
} = {}): string {
  const args = ['git', 'log'];

  if (options.since) {
    args.push(`--since="${options.since}"`);
  }
  if (options.until) {
    args.push(`--until="${options.until}"`);
  }
  if (options.author) {
    args.push(`--author="${options.author}"`);
  }
  if (options.maxCount) {
    args.push(`-n`, String(options.maxCount));
  }
  if (options.format === 'simple') {
    args.push('--format="%H|%s|%an|%ae|%aI"');
  }
  if (options.branch) {
    args.push(options.branch);
  }

  return args.join(' ');
}

/**
 * Build command to get files changed in a commit
 */
export function buildDiffCommand(sha: string): string {
  return `git diff-tree --no-commit-id --name-only -r ${sha}`;
}

/**
 * Build command to get current branch
 */
export function buildBranchCommand(): string {
  return 'git branch --show-current';
}

/**
 * Build command to list branches with task references
 */
export function buildBranchListCommand(prefix = 'ralph'): string {
  return `git branch -a --format="%(refname:short)|%(committerdate:iso)"`;
}

// =============================================================================
// BRANCH PARSING
// =============================================================================

export interface GitBranch {
  name: string;
  remote: boolean;
  taskId?: string;
  lastCommit?: string;
}

/**
 * Parse branch list output
 */
export function parseBranches(output: string, taskPrefix = 'ralph'): GitBranch[] {
  const branches: GitBranch[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    const [name, date] = line.split('|');
    const remote = name.startsWith('origin/') || name.startsWith('remotes/');

    // Extract task ID from branch name (e.g., ralph/001-feature)
    const taskMatch = name.match(new RegExp(`${taskPrefix}/(\\d+)`));
    const taskId = taskMatch ? `RALPH-${taskMatch[1].padStart(3, '0')}` : undefined;

    branches.push({
      name: name.trim(),
      remote,
      taskId,
      lastCommit: date?.trim(),
    });
  }

  return branches;
}

/**
 * Extract task ID from branch name
 */
export function extractTaskFromBranch(branchName: string, prefix = 'ralph'): string | null {
  const patterns = [
    new RegExp(`${prefix}/(\\d+)`),           // ralph/001 or ralph/001-feature
    new RegExp(`${prefix}-(\\d+)`),           // ralph-001
    new RegExp(`RALPH-(\\d+)`, 'i'),          // RALPH-001 anywhere
    new RegExp(`feature/(\\d+)`),             // feature/001
  ];

  for (const pattern of patterns) {
    const match = branchName.match(pattern);
    if (match) {
      return `RALPH-${match[1].padStart(3, '0')}`;
    }
  }

  return null;
}
