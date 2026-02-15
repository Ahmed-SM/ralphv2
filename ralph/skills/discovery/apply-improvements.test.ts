import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeBranchName,
  makeCommitMessage,
  applyContentToFile,
  applySingleProposal,
  applyImprovements,
  markProposalsApplied,
  updateProposalStatuses,
  type ApplyContext,
  type ApplyResult,
} from './apply-improvements.js';
import type { ImprovementProposal } from './improve-agents.js';

// =============================================================================
// FACTORIES
// =============================================================================

function makeProposal(overrides: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: 'IMPROVE-001',
    target: 'AGENTS.md',
    section: 'Estimation Guidance',
    type: 'update_estimate',
    title: 'Add estimation multiplier guidance',
    description: 'Estimates are systematically underestimating',
    content: '## Estimation Guidance\n\nApply a 1.5x multiplier to estimates.',
    rationale: 'Improve estimation accuracy',
    evidence: ['Task A took 2x', 'Task B took 1.5x'],
    confidence: 0.85,
    priority: 'high',
    status: 'pending',
    createdAt: '2024-01-15T00:00:00Z',
    ...overrides,
  };
}

function makeApplyContext(overrides: Partial<ApplyContext> = {}): ApplyContext {
  return {
    readFile: vi.fn(async () => '# AGENTS.md\n\nExisting content.\n'),
    writeFile: vi.fn(async () => {}),
    gitBranch: vi.fn(async () => 'ralph/learn-2024-01-15'),
    gitCheckout: vi.fn(async () => {}),
    gitAdd: vi.fn(async () => {}),
    gitCommit: vi.fn(async () => 'abc123'),
    gitCurrentBranch: vi.fn(async () => 'main'),
    ...overrides,
  };
}

// =============================================================================
// makeBranchName
// =============================================================================

describe('makeBranchName', () => {
  it('generates branch name from ISO timestamp', () => {
    const branch = makeBranchName('2024-01-15T10:30:00.000Z');
    expect(branch).toBe('ralph/learn-2024-01-15-10-30-00-000');
  });

  it('sanitizes colons and dots', () => {
    const branch = makeBranchName('2024-12-31T23:59:59.999Z');
    expect(branch).toMatch(/^ralph\/learn-/);
    expect(branch).not.toContain(':');
    expect(branch).not.toContain('.');
  });

  it('starts with ralph/learn- prefix', () => {
    const branch = makeBranchName('2024-01-01T00:00:00Z');
    expect(branch.startsWith('ralph/learn-')).toBe(true);
  });

  it('removes trailing Z', () => {
    const branch = makeBranchName('2024-01-01T00:00:00Z');
    expect(branch.endsWith('Z')).toBe(false);
  });
});

// =============================================================================
// makeCommitMessage
// =============================================================================

describe('makeCommitMessage', () => {
  it('formats commit message with RALPH-LEARN prefix', () => {
    const proposal = makeProposal({ title: 'Add estimation multiplier' });
    expect(makeCommitMessage(proposal)).toBe('RALPH-LEARN: Add estimation multiplier');
  });

  it('preserves exact title text', () => {
    const proposal = makeProposal({ title: 'Flag "payments" as high-risk area' });
    expect(makeCommitMessage(proposal)).toBe('RALPH-LEARN: Flag "payments" as high-risk area');
  });
});

// =============================================================================
// applyContentToFile
// =============================================================================

describe('applyContentToFile', () => {
  it('creates file when content is null', () => {
    const proposal = makeProposal({ content: '## New Section\n\nNew content.' });
    const result = applyContentToFile(null, proposal);
    expect(result).toBe('## New Section\n\nNew content.\n');
  });

  it('appends to end when no section specified', () => {
    const proposal = makeProposal({ section: undefined, content: '## Added\n\nContent.' });
    const result = applyContentToFile('# Title\n\nExisting.\n', proposal);
    expect(result).toContain('# Title');
    expect(result).toContain('## Added');
    expect(result.indexOf('# Title')).toBeLessThan(result.indexOf('## Added'));
  });

  it('appends to end when section not found in file', () => {
    const proposal = makeProposal({ section: 'Missing Section', content: '## Missing Section\n\nContent.' });
    const result = applyContentToFile('# Title\n\nExisting.\n', proposal);
    expect(result).toContain('## Missing Section');
    expect(result).toContain('Existing.');
  });

  it('replaces existing section when found', () => {
    const existing = '# Title\n\n## Estimation Guidance\n\nOld guidance here.\n\n## Other\n\nOther section.\n';
    const proposal = makeProposal({ content: '## Estimation Guidance\n\nNew guidance.' });
    const result = applyContentToFile(existing, proposal);
    expect(result).toContain('New guidance.');
    expect(result).not.toContain('Old guidance here.');
    expect(result).toContain('## Other');
  });

  it('preserves content before and after replaced section', () => {
    const existing = '# Title\n\nPreamble.\n\n## Estimation Guidance\n\nOld.\n\n## Other\n\nKept.\n';
    const proposal = makeProposal({ content: '## Estimation Guidance\n\nUpdated.' });
    const result = applyContentToFile(existing, proposal);
    expect(result).toContain('Preamble.');
    expect(result).toContain('Kept.');
  });

  it('handles file without trailing newline', () => {
    const proposal = makeProposal({ section: undefined, content: '## New' });
    const result = applyContentToFile('# Title', proposal);
    expect(result).toContain('# Title');
    expect(result).toContain('## New');
  });

  it('handles empty existing content', () => {
    const proposal = makeProposal({ section: undefined, content: '## Added' });
    const result = applyContentToFile('', proposal);
    expect(result).toContain('## Added');
  });

  it('handles section at end of file with no trailing content', () => {
    const existing = '# Title\n\n## Estimation Guidance\n\nOld content.\n';
    const proposal = makeProposal({ content: '## Estimation Guidance\n\nReplaced.' });
    const result = applyContentToFile(existing, proposal);
    expect(result).toContain('Replaced.');
    expect(result).not.toContain('Old content.');
  });
});

// =============================================================================
// applySingleProposal
// =============================================================================

describe('applySingleProposal', () => {
  it('reads target file, writes modified content, stages, and commits', async () => {
    const ctx = makeApplyContext();
    const proposal = makeProposal();

    const result = await applySingleProposal(ctx, proposal);

    expect(ctx.readFile).toHaveBeenCalledWith('AGENTS.md');
    expect(ctx.writeFile).toHaveBeenCalledWith('AGENTS.md', expect.any(String));
    expect(ctx.gitAdd).toHaveBeenCalledWith('AGENTS.md');
    expect(ctx.gitCommit).toHaveBeenCalledWith('RALPH-LEARN: Add estimation multiplier guidance');
    expect(result.id).toBe('IMPROVE-001');
    expect(result.target).toBe('AGENTS.md');
    expect(result.commit).toBe('abc123');
    expect(result.timestamp).toBeTruthy();
  });

  it('handles missing target file (creates new)', async () => {
    const ctx = makeApplyContext({
      readFile: vi.fn(async () => { throw new Error('ENOENT'); }),
    });
    const proposal = makeProposal({ content: '## New\n\nCreated.' });

    const result = await applySingleProposal(ctx, proposal);

    expect(result.id).toBe('IMPROVE-001');
    const writeCall = (ctx.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall[1]).toContain('Created.');
  });

  it('handles commit failure gracefully (no changes detected)', async () => {
    const ctx = makeApplyContext({
      gitCommit: vi.fn(async () => { throw new Error('nothing to commit'); }),
    });

    const result = await applySingleProposal(ctx, makeProposal());

    expect(result.commit).toBeUndefined();
  });

  it('propagates write errors', async () => {
    const ctx = makeApplyContext({
      writeFile: vi.fn(async () => { throw new Error('Permission denied'); }),
    });

    await expect(applySingleProposal(ctx, makeProposal())).rejects.toThrow('Permission denied');
  });

  it('uses correct commit message format', async () => {
    const ctx = makeApplyContext();
    const proposal = makeProposal({ title: 'Flag src/payments as risky' });

    await applySingleProposal(ctx, proposal);

    expect(ctx.gitCommit).toHaveBeenCalledWith('RALPH-LEARN: Flag src/payments as risky');
  });
});

// =============================================================================
// applyImprovements
// =============================================================================

describe('applyImprovements', () => {
  it('returns empty result for empty proposals', async () => {
    const ctx = makeApplyContext();
    const result = await applyImprovements(ctx, []);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('skips non-pending proposals', async () => {
    const ctx = makeApplyContext();
    const approved = makeProposal({ id: 'A', status: 'approved' });
    const applied = makeProposal({ id: 'B', status: 'applied' });
    const rejected = makeProposal({ id: 'C', status: 'rejected' });

    const result = await applyImprovements(ctx, [approved, applied, rejected]);

    expect(result.skipped).toHaveLength(3);
    expect(result.skipped[0].reason).toContain("'approved'");
    expect(result.skipped[1].reason).toContain("'applied'");
    expect(result.skipped[2].reason).toContain("'rejected'");
    expect(result.applied).toHaveLength(0);
  });

  it('saves current branch before creating learn branch', async () => {
    const ctx = makeApplyContext();
    const proposal = makeProposal();

    await applyImprovements(ctx, [proposal]);

    expect(ctx.gitCurrentBranch).toHaveBeenCalled();
    expect(ctx.gitBranch).toHaveBeenCalledWith(expect.stringMatching(/^ralph\/learn-/));
  });

  it('returns to original branch after applying', async () => {
    const ctx = makeApplyContext({
      gitCurrentBranch: vi.fn(async () => 'feature/xyz'),
    });

    await applyImprovements(ctx, [makeProposal()]);

    expect(ctx.gitCheckout).toHaveBeenCalledWith('feature/xyz');
  });

  it('applies multiple proposals with separate commits', async () => {
    const ctx = makeApplyContext();
    const p1 = makeProposal({ id: 'IMPROVE-001', title: 'First' });
    const p2 = makeProposal({ id: 'IMPROVE-002', title: 'Second', target: 'agents/learner.md' });

    const result = await applyImprovements(ctx, [p1, p2]);

    expect(result.applied).toHaveLength(2);
    expect(ctx.gitCommit).toHaveBeenCalledTimes(2);
    expect(ctx.gitCommit).toHaveBeenCalledWith('RALPH-LEARN: First');
    expect(ctx.gitCommit).toHaveBeenCalledWith('RALPH-LEARN: Second');
  });

  it('sets branch name on all applied proposals', async () => {
    const ctx = makeApplyContext();
    const result = await applyImprovements(ctx, [makeProposal()]);

    expect(result.applied[0].branch).toMatch(/^ralph\/learn-/);
  });

  it('errors all proposals when branch creation fails', async () => {
    const ctx = makeApplyContext({
      gitBranch: vi.fn(async () => { throw new Error('branch exists'); }),
    });

    const result = await applyImprovements(ctx, [
      makeProposal({ id: 'A' }),
      makeProposal({ id: 'B' }),
    ]);

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].error).toBe('branch exists');
    expect(result.applied).toHaveLength(0);
  });

  it('continues applying remaining proposals when one fails', async () => {
    let callCount = 0;
    const ctx = makeApplyContext({
      readFile: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('cannot read');
        return '# File\n';
      }),
      writeFile: vi.fn(async () => {
        // The first call writes to a file that couldn't be read (new file)
        // Actually readFile throwing means null content, so writeFile is called
        // Let's make the first writeFile throw instead
      }),
    });

    // Simpler approach: first writeFile throws, second succeeds
    let writeCount = 0;
    ctx.writeFile = vi.fn(async () => {
      writeCount++;
      if (writeCount === 1) throw new Error('disk full');
    });

    const result = await applyImprovements(ctx, [
      makeProposal({ id: 'FAIL' }),
      makeProposal({ id: 'OK' }),
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('FAIL');
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].id).toBe('OK');
  });

  it('handles gitCurrentBranch failure with default', async () => {
    const ctx = makeApplyContext({
      gitCurrentBranch: vi.fn(async () => { throw new Error('no branch'); }),
    });

    const result = await applyImprovements(ctx, [makeProposal()]);

    expect(result.applied).toHaveLength(1);
    // Should try to checkout 'main' as default
    expect(ctx.gitCheckout).toHaveBeenCalledWith('main');
  });

  it('handles checkout-back failure gracefully', async () => {
    const ctx = makeApplyContext({
      gitCheckout: vi.fn(async () => { throw new Error('checkout failed'); }),
    });

    // Should not throw
    const result = await applyImprovements(ctx, [makeProposal()]);
    expect(result.applied).toHaveLength(1);
  });

  it('mixes skipped and applied proposals', async () => {
    const ctx = makeApplyContext();
    const pending = makeProposal({ id: 'P', status: 'pending' });
    const applied = makeProposal({ id: 'A', status: 'applied' });

    const result = await applyImprovements(ctx, [pending, applied]);

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].id).toBe('P');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe('A');
  });
});

// =============================================================================
// markProposalsApplied
// =============================================================================

describe('markProposalsApplied', () => {
  it('does nothing for empty applied list', async () => {
    const writeFn = vi.fn(async () => {});
    await markProposalsApplied(vi.fn(), writeFn, './state/learning.jsonl', []);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('appends improvement_applied events to learning.jsonl', async () => {
    const readFn = vi.fn(async () => 'existing\n');
    const writeFn = vi.fn(async () => {});

    await markProposalsApplied(readFn, writeFn, './state/learning.jsonl', [
      { id: 'IMPROVE-001', target: 'AGENTS.md', branch: 'ralph/learn-123', commit: 'abc', timestamp: '2024-01-15T00:00:00Z' },
    ]);

    expect(writeFn).toHaveBeenCalledTimes(1);
    const written = writeFn.mock.calls[0][1];
    expect(written).toContain('existing\n');
    const newLine = written.replace('existing\n', '');
    const event = JSON.parse(newLine.trim());
    expect(event.eventType).toBe('improvement_applied');
    expect(event.type).toBe('improvement_applied');
    expect(event.id).toBe('IMPROVE-001');
    expect(event.branch).toBe('ralph/learn-123');
  });

  it('creates file when it does not exist', async () => {
    const readFn = vi.fn(async () => { throw new Error('ENOENT'); });
    const writeFn = vi.fn(async () => {});

    await markProposalsApplied(readFn, writeFn, './state/learning.jsonl', [
      { id: 'X', target: 'T', branch: 'B', timestamp: 'TS' },
    ]);

    expect(writeFn).toHaveBeenCalledTimes(1);
    const written = writeFn.mock.calls[0][1];
    const event = JSON.parse(written.trim());
    expect(event.id).toBe('X');
  });

  it('writes multiple events for multiple applied proposals', async () => {
    const readFn = vi.fn(async () => '');
    const writeFn = vi.fn(async () => {});

    await markProposalsApplied(readFn, writeFn, 'path', [
      { id: 'A', target: 'T1', branch: 'B', timestamp: 'TS1' },
      { id: 'B', target: 'T2', branch: 'B', commit: 'c2', timestamp: 'TS2' },
    ]);

    const written = writeFn.mock.calls[0][1];
    const lines = written.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('A');
    expect(JSON.parse(lines[1]).id).toBe('B');
  });
});

// =============================================================================
// updateProposalStatuses
// =============================================================================

describe('updateProposalStatuses', () => {
  it('does nothing for empty ID list', async () => {
    const writeFn = vi.fn(async () => {});
    await updateProposalStatuses(vi.fn(), writeFn, 'path', []);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('updates matching proposal status to applied', async () => {
    const original = JSON.stringify({ eventType: 'improvement_proposed', id: 'IMPROVE-001', status: 'pending', title: 'test' });
    const readFn = vi.fn(async () => original + '\n');
    const writeFn = vi.fn(async () => {});

    await updateProposalStatuses(readFn, writeFn, 'path', ['IMPROVE-001']);

    const written = writeFn.mock.calls[0][1];
    const parsed = JSON.parse(written.trim());
    expect(parsed.status).toBe('applied');
    expect(parsed.title).toBe('test');
  });

  it('does not modify non-matching proposals', async () => {
    const line1 = JSON.stringify({ eventType: 'improvement_proposed', id: 'IMPROVE-001', status: 'pending' });
    const line2 = JSON.stringify({ eventType: 'improvement_proposed', id: 'IMPROVE-002', status: 'pending' });
    const readFn = vi.fn(async () => line1 + '\n' + line2 + '\n');
    const writeFn = vi.fn(async () => {});

    await updateProposalStatuses(readFn, writeFn, 'path', ['IMPROVE-001']);

    const written = writeFn.mock.calls[0][1];
    const lines = written.split('\n').filter((l: string) => l.trim());
    expect(JSON.parse(lines[0]).status).toBe('applied');
    expect(JSON.parse(lines[1]).status).toBe('pending');
  });

  it('preserves non-proposal events', async () => {
    const proposal = JSON.stringify({ eventType: 'improvement_proposed', id: 'X', status: 'pending' });
    const metric = JSON.stringify({ type: 'task_metric', data: {} });
    const readFn = vi.fn(async () => proposal + '\n' + metric + '\n');
    const writeFn = vi.fn(async () => {});

    await updateProposalStatuses(readFn, writeFn, 'path', ['X']);

    const written = writeFn.mock.calls[0][1];
    const lines = written.split('\n').filter((l: string) => l.trim());
    expect(JSON.parse(lines[0]).status).toBe('applied');
    expect(JSON.parse(lines[1]).type).toBe('task_metric');
  });

  it('handles missing file gracefully', async () => {
    const readFn = vi.fn(async () => { throw new Error('ENOENT'); });
    const writeFn = vi.fn(async () => {});

    // Should not throw
    await updateProposalStatuses(readFn, writeFn, 'path', ['X']);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('preserves non-JSON lines', async () => {
    const proposal = JSON.stringify({ eventType: 'improvement_proposed', id: 'A', status: 'pending' });
    const readFn = vi.fn(async () => 'not json\n' + proposal + '\n');
    const writeFn = vi.fn(async () => {});

    await updateProposalStatuses(readFn, writeFn, 'path', ['A']);

    const written = writeFn.mock.calls[0][1];
    expect(written).toContain('not json');
  });
});

// =============================================================================
// autoApplyImprovements integration (via loop.ts)
// =============================================================================

describe('autoApplyImprovements (integration)', () => {
  // These tests verify the wiring in loop.ts by importing directly
  let autoApplyImprovements: typeof import('../../runtime/loop.js').autoApplyImprovements;

  beforeEach(async () => {
    const mod = await import('../../runtime/loop.js');
    autoApplyImprovements = mod.autoApplyImprovements;
  });

  function makeMockExecutor() {
    return {
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => {}),
      bash: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
      flush: vi.fn(async () => {}),
      rollback: vi.fn(),
      getPendingChanges: vi.fn(() => []),
      getSandbox: vi.fn(),
    };
  }

  function makeMockGit() {
    return {
      status: vi.fn(async () => ''),
      add: vi.fn(async () => {}),
      commit: vi.fn(async () => 'commitSha'),
      log: vi.fn(async () => ''),
      diff: vi.fn(async () => ''),
      branch: vi.fn(async () => 'main'),
      checkout: vi.fn(async () => {}),
      diffStats: vi.fn(async () => ({ filesChanged: 0, linesChanged: 0 })),
    };
  }

  function makeMockContext(overrides: Record<string, unknown> = {}) {
    return {
      config: {
        planFile: './implementation-plan.md',
        agentsFile: './AGENTS.md',
        stateDir: './state',
        loop: { maxIterationsPerTask: 10, maxTasksPerRun: 50, maxCostPerRun: 50 },
        sandbox: { allowedPaths: ['.'], deniedPaths: [], allowedCommands: ['*'], deniedCommands: [], maxFileSize: 1048576, maxFiles: 1000 },
        tracker: { type: 'jira', autoCreate: false, autoTransition: false, autoComment: false, autoPull: false },
        git: { autoCommit: true, commitPrefix: 'RALPH' },
        learning: { enabled: true, autoApplyImprovements: true, minConfidence: 0.7, retentionDays: 90 },
        notifications: { enabled: false },
      },
      executor: makeMockExecutor(),
      git: makeMockGit(),
      workDir: '/tmp/test',
      ...overrides,
    };
  }

  it('does nothing when no pending proposals exist', async () => {
    const ctx = makeMockContext();
    (ctx.executor.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');

    await autoApplyImprovements(ctx as any);

    expect(ctx.git.branch).not.toHaveBeenCalled();
  });

  it('loads pending proposals from learning.jsonl', async () => {
    const proposal = JSON.stringify({
      eventType: 'improvement_proposed',
      id: 'IMPROVE-001',
      target: 'AGENTS.md',
      title: 'Test',
      content: '## Test\n\nContent.',
      status: 'pending',
      confidence: 0.9,
      priority: 'high',
      createdAt: '2024-01-15T00:00:00Z',
    });
    const ctx = makeMockContext();
    (ctx.executor.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(proposal + '\n');

    await autoApplyImprovements(ctx as any);

    // Should have called git.branch to create learn branch
    expect(ctx.git.branch).toHaveBeenCalledWith(expect.stringMatching(/^ralph\/learn-/));
  });

  it('creates branch, applies proposal, and returns to original branch', async () => {
    const proposal = JSON.stringify({
      eventType: 'improvement_proposed',
      id: 'IMPROVE-001',
      target: 'AGENTS.md',
      title: 'Test improvement',
      content: '## Test\n\nContent.',
      status: 'pending',
      confidence: 0.9,
      priority: 'high',
      createdAt: '2024-01-15T00:00:00Z',
    });
    const ctx = makeMockContext();

    // First readFile call: loadPendingProposals reads learning.jsonl
    // Second readFile call: applySingleProposal reads AGENTS.md
    // Third+: markProposalsApplied and updateProposalStatuses read learning.jsonl
    let readCount = 0;
    (ctx.executor.readFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      readCount++;
      if (readCount === 1) return proposal + '\n'; // loadPendingProposals
      if (readCount === 2) return '# AGENTS.md\n'; // applySingleProposal reads target
      return proposal + '\n'; // markProposalsApplied / updateProposalStatuses
    });

    // git.branch first call: gitCurrentBranch returns current branch
    // git.branch second call: creates new branch
    let branchCallCount = 0;
    (ctx.git.branch as ReturnType<typeof vi.fn>).mockImplementation(async (name?: string) => {
      branchCallCount++;
      if (!name) return 'feature/work';
      return '';
    });

    await autoApplyImprovements(ctx as any);

    // Should commit with RALPH-LEARN prefix
    expect(ctx.git.commit).toHaveBeenCalledWith('RALPH-LEARN: Test improvement');
    // Should return to original branch
    expect(ctx.git.checkout).toHaveBeenCalledWith('feature/work');
  });

  it('handles errors gracefully without crashing', async () => {
    const ctx = makeMockContext();
    (ctx.executor.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk error'));

    // Should not throw
    await autoApplyImprovements(ctx as any);
  });
});
