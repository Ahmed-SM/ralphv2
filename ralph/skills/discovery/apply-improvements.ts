/**
 * Apply Improvements Skill
 *
 * Applies pending improvement proposals to target files.
 * Follows the learning-system spec pipeline:
 *   1. Create branch: ralph/learn-{timestamp}
 *   2. Apply change to target file
 *   3. Commit with message: RALPH-LEARN: {description}
 *   4. Log ImprovementAppliedEvent
 *
 * When autoApplyImprovements is disabled (default), proposals remain pending
 * for human review. When enabled, proposals are applied automatically.
 */

import type { ImprovementProposal } from './improve-agents.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ApplyContext {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  gitBranch: (name: string) => Promise<string>;
  gitCheckout: (ref: string) => Promise<void>;
  gitAdd: (files: string | string[]) => Promise<void>;
  gitCommit: (message: string) => Promise<string>;
  gitCurrentBranch: () => Promise<string>;
}

export interface ApplyResult {
  applied: AppliedProposal[];
  skipped: SkippedProposal[];
  errors: ApplyError[];
}

export interface AppliedProposal {
  id: string;
  target: string;
  branch: string;
  commit?: string;
  timestamp: string;
}

export interface SkippedProposal {
  id: string;
  reason: string;
}

export interface ApplyError {
  id: string;
  error: string;
}

// =============================================================================
// BRANCH NAME
// =============================================================================

/**
 * Generate a branch name for an improvement application.
 * Format: ralph/learn-{timestamp}
 */
export function makeBranchName(timestamp: string): string {
  // Sanitize ISO timestamp for use in branch name
  const sanitized = timestamp
    .replace(/[:.]/g, '-')
    .replace(/T/, '-')
    .replace(/Z$/, '');
  return `ralph/learn-${sanitized}`;
}

// =============================================================================
// COMMIT MESSAGE
// =============================================================================

/**
 * Generate a commit message for an applied improvement.
 * Format: RALPH-LEARN: {title}
 */
export function makeCommitMessage(proposal: ImprovementProposal): string {
  return `RALPH-LEARN: ${proposal.title}`;
}

// =============================================================================
// FILE APPLICATION
// =============================================================================

/**
 * Apply a proposal's content to its target file.
 *
 * Strategy:
 *   - If the target file has a matching `## {section}` heading, replace that section
 *   - If the file exists but no matching section, append the content at the end
 *   - If the file doesn't exist, create it with the content
 */
export function applyContentToFile(
  existingContent: string | null,
  proposal: ImprovementProposal
): string {
  const content = proposal.content;

  // File doesn't exist — create with content
  if (existingContent === null) {
    return content + '\n';
  }

  // No section specified — append at end
  if (!proposal.section) {
    const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
    return existingContent + separator + content + '\n';
  }

  // Try to find and replace the section
  const sectionPattern = new RegExp(
    `(^|\\n)(## ${escapeRegExp(proposal.section)}\\b[^\\n]*\\n)([\\s\\S]*?)(?=\\n## |$)`,
  );
  const match = existingContent.match(sectionPattern);

  if (match) {
    // Replace existing section content
    const before = existingContent.slice(0, match.index! + (match[1] ? match[1].length : 0));
    const after = existingContent.slice(match.index! + (match[1] ? match[1].length : 0) + match[2].length + match[3].length);
    return before + content + '\n' + after;
  }

  // Section not found — append at end
  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
  return existingContent + separator + content + '\n';
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// SINGLE PROPOSAL APPLICATION
// =============================================================================

/**
 * Apply a single improvement proposal.
 *
 * Steps:
 *   1. Read target file (or null if missing)
 *   2. Apply content to file
 *   3. Write modified file
 *   4. Stage and commit
 *
 * Returns an AppliedProposal on success, or throws on failure.
 */
export async function applySingleProposal(
  ctx: ApplyContext,
  proposal: ImprovementProposal
): Promise<AppliedProposal> {
  const timestamp = new Date().toISOString();

  // 1. Read existing file
  let existingContent: string | null;
  try {
    existingContent = await ctx.readFile(proposal.target);
  } catch {
    existingContent = null;
  }

  // 2. Apply content
  const newContent = applyContentToFile(existingContent, proposal);

  // 3. Write file
  await ctx.writeFile(proposal.target, newContent);

  // 4. Stage and commit
  await ctx.gitAdd(proposal.target);
  const commitMessage = makeCommitMessage(proposal);
  let commit: string | undefined;
  try {
    commit = await ctx.gitCommit(commitMessage);
  } catch {
    // Commit may fail if no changes detected (content identical)
    commit = undefined;
  }

  return {
    id: proposal.id,
    target: proposal.target,
    branch: '', // Filled in by caller
    commit,
    timestamp,
  };
}

// =============================================================================
// BATCH APPLICATION
// =============================================================================

/**
 * Apply all pending improvement proposals.
 *
 * Pipeline per the learning-system spec:
 *   1. Save current branch
 *   2. Create branch: ralph/learn-{timestamp}
 *   3. Apply each proposal (write file, commit)
 *   4. Return to original branch
 *   5. Return results
 *
 * Each proposal gets its own commit on the branch.
 * If all proposals fail, the branch is still created (but empty).
 */
export async function applyImprovements(
  ctx: ApplyContext,
  proposals: ImprovementProposal[]
): Promise<ApplyResult> {
  const result: ApplyResult = {
    applied: [],
    skipped: [],
    errors: [],
  };

  if (proposals.length === 0) {
    return result;
  }

  // Filter to only pending proposals
  const pending = proposals.filter(p => p.status === 'pending');
  const nonPending = proposals.filter(p => p.status !== 'pending');

  for (const p of nonPending) {
    result.skipped.push({ id: p.id, reason: `status is '${p.status}', not 'pending'` });
  }

  if (pending.length === 0) {
    return result;
  }

  const timestamp = new Date().toISOString();
  const branchName = makeBranchName(timestamp);

  // Save current branch
  let originalBranch: string;
  try {
    originalBranch = await ctx.gitCurrentBranch();
  } catch {
    originalBranch = 'main';
  }

  // Create and checkout the learn branch
  try {
    await ctx.gitBranch(branchName);
  } catch (error) {
    // Branch creation failed — all proposals error
    const msg = error instanceof Error ? error.message : 'Branch creation failed';
    for (const p of pending) {
      result.errors.push({ id: p.id, error: msg });
    }
    return result;
  }

  // Apply each proposal
  for (const proposal of pending) {
    try {
      const applied = await applySingleProposal(ctx, proposal);
      applied.branch = branchName;
      result.applied.push(applied);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push({ id: proposal.id, error: msg });
    }
  }

  // Return to original branch
  try {
    await ctx.gitCheckout(originalBranch);
  } catch {
    // Best effort — log but don't fail
  }

  return result;
}

// =============================================================================
// STATUS UPDATES
// =============================================================================

/**
 * Mark proposals as applied in learning.jsonl by appending status-update events.
 */
export async function markProposalsApplied(
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<void>,
  learningPath: string,
  appliedResults: AppliedProposal[]
): Promise<void> {
  if (appliedResults.length === 0) return;

  let content = '';
  try {
    content = await readFile(learningPath);
  } catch {
    // File doesn't exist
  }

  const events = appliedResults.map(r => JSON.stringify({
    eventType: 'improvement_applied',
    type: 'improvement_applied',
    id: r.id,
    branch: r.branch,
    commit: r.commit,
    timestamp: r.timestamp,
  }));

  const newLines = events.join('\n') + '\n';
  await writeFile(learningPath, content + newLines);
}

/**
 * Update proposal status in learning.jsonl (mark as 'applied').
 *
 * Reads all lines, finds matching improvement_proposed events,
 * and updates their status field.
 */
export async function updateProposalStatuses(
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<void>,
  learningPath: string,
  appliedIds: string[]
): Promise<void> {
  if (appliedIds.length === 0) return;

  const idSet = new Set(appliedIds);

  let content: string;
  try {
    content = await readFile(learningPath);
  } catch {
    return; // Nothing to update
  }

  const lines = content.split('\n');
  const updatedLines = lines.map(line => {
    if (!line.trim()) return line;
    try {
      const event = JSON.parse(line);
      if (event.eventType === 'improvement_proposed' && idSet.has(event.id)) {
        event.status = 'applied';
        return JSON.stringify(event);
      }
    } catch {
      // Not JSON, keep as-is
    }
    return line;
  });

  await writeFile(learningPath, updatedLines.join('\n'));
}
