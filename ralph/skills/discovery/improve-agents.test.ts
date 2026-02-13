import { describe, it, expect, vi } from 'vitest';
import {
  generateImprovements,
  saveProposals,
  loadPendingProposals,
  printProposals,
  type ImprovementProposal,
  type ImprovementResult,
} from './improve-agents.js';
import type { DetectedPattern, PatternType } from './detect-patterns.js';
import type { AggregateMetrics } from '../track/record-metrics.js';
import type { TaskType } from '../../types/index.js';

// =============================================================================
// FACTORIES
// =============================================================================

function makePattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  return {
    type: 'estimation_drift',
    confidence: 0.85,
    description: 'Test pattern',
    data: { avgRatio: 1.5, direction: 'underestimating' },
    evidence: ['Task A took 2x', 'Task B took 1.5x'],
    suggestion: 'Apply 1.5x multiplier',
    timestamp: '2024-01-15T00:00:00Z',
    ...overrides,
  };
}

function makeAggregate(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    period: '2024-01',
    tasksCompleted: 10,
    tasksCreated: 12,
    tasksFailed: 1,
    avgDurationDays: 2,
    medianDurationDays: 1.5,
    totalDurationDays: 20,
    avgIterations: 3,
    totalCommits: 30,
    totalFilesChanged: 50,
    avgEstimateRatio: 1.0,
    estimateAccuracy: 80,
    totalBlockers: 2,
    totalBugs: 1,
    byType: {} as Record<TaskType, number>,
    byAggregate: {},
    byComplexity: {},
    ...overrides,
  };
}

// =============================================================================
// generateImprovements — basic behavior
// =============================================================================

describe('generateImprovements', () => {
  it('returns empty proposals for empty patterns', () => {
    const result = generateImprovements([]);
    expect(result.proposals).toHaveLength(0);
    expect(result.summary.totalProposals).toBe(0);
    expect(result.summary.highPriority).toBe(0);
  });

  it('generates a proposal for each recognized pattern', () => {
    const patterns = [
      makePattern({ type: 'estimation_drift' }),
      makePattern({ type: 'bug_hotspot', data: { aggregate: 'parser', bugCount: 5 } }),
      makePattern({ type: 'blocking_chain', data: { blockers: [{ id: 'RALPH-001', count: 3 }] } }),
    ];
    const result = generateImprovements(patterns);
    expect(result.proposals).toHaveLength(3);
  });

  it('assigns sequential IDs to proposals', () => {
    const patterns = [
      makePattern({ type: 'estimation_drift' }),
      makePattern({ type: 'bug_hotspot', data: { aggregate: 'parser', bugCount: 5 } }),
    ];
    const result = generateImprovements(patterns);
    expect(result.proposals[0].id).toBe('IMPROVE-001');
    expect(result.proposals[1].id).toBe('IMPROVE-002');
  });

  it('skips unrecognized pattern types', () => {
    const patterns = [
      makePattern({ type: 'task_clustering' as PatternType }),
    ];
    const result = generateImprovements(patterns);
    expect(result.proposals).toHaveLength(0);
  });

  it('all proposals start with status pending', () => {
    const patterns = [
      makePattern({ type: 'estimation_drift' }),
      makePattern({ type: 'blocking_chain', data: { blockers: [] } }),
    ];
    const result = generateImprovements(patterns);
    for (const p of result.proposals) {
      expect(p.status).toBe('pending');
    }
  });
});

// =============================================================================
// generateImprovements — estimation_drift pattern
// =============================================================================

describe('generateImprovements — estimation_drift', () => {
  it('targets AGENTS.md Estimation Guidance section', () => {
    const result = generateImprovements([makePattern({ type: 'estimation_drift' })]);
    const p = result.proposals[0];
    expect(p.target).toBe('AGENTS.md');
    expect(p.section).toBe('Estimation Guidance');
    expect(p.type).toBe('update_estimate');
  });

  it('sets high priority when confidence > 0.8', () => {
    const result = generateImprovements([makePattern({ type: 'estimation_drift', confidence: 0.9 })]);
    expect(result.proposals[0].priority).toBe('high');
  });

  it('sets medium priority when confidence <= 0.8', () => {
    const result = generateImprovements([makePattern({ type: 'estimation_drift', confidence: 0.75 })]);
    expect(result.proposals[0].priority).toBe('medium');
  });

  it('includes multiplier in content', () => {
    const result = generateImprovements([makePattern({
      type: 'estimation_drift',
      data: { avgRatio: 2.3, direction: 'underestimating' },
    })]);
    expect(result.proposals[0].content).toContain('2.3x');
    expect(result.proposals[0].content).toContain('underestimating');
  });

  it('uses suggestion as rationale', () => {
    const result = generateImprovements([makePattern({
      type: 'estimation_drift',
      suggestion: 'Custom suggestion',
    })]);
    expect(result.proposals[0].rationale).toBe('Custom suggestion');
  });

  it('falls back to default rationale when no suggestion', () => {
    const result = generateImprovements([makePattern({
      type: 'estimation_drift',
      suggestion: undefined,
    })]);
    expect(result.proposals[0].rationale).toBe('Improve estimation accuracy');
  });
});

// =============================================================================
// generateImprovements — bug_hotspot pattern
// =============================================================================

describe('generateImprovements — bug_hotspot', () => {
  it('targets AGENTS.md Risk Areas section', () => {
    const result = generateImprovements([makePattern({
      type: 'bug_hotspot',
      data: { aggregate: 'parser', bugCount: 5 },
    })]);
    const p = result.proposals[0];
    expect(p.target).toBe('AGENTS.md');
    expect(p.section).toBe('Risk Areas');
    expect(p.type).toBe('add_warning');
  });

  it('always sets high priority', () => {
    const result = generateImprovements([makePattern({
      type: 'bug_hotspot',
      confidence: 0.5,
      data: { aggregate: 'parser', bugCount: 2 },
    })]);
    expect(result.proposals[0].priority).toBe('high');
  });

  it('includes aggregate name in title and content', () => {
    const result = generateImprovements([makePattern({
      type: 'bug_hotspot',
      data: { aggregate: 'tracker-sync', bugCount: 8 },
    })]);
    const p = result.proposals[0];
    expect(p.title).toContain('tracker-sync');
    expect(p.content).toContain('tracker-sync');
    expect(p.content).toContain('8');
  });
});

// =============================================================================
// generateImprovements — blocking_chain pattern
// =============================================================================

describe('generateImprovements — blocking_chain', () => {
  it('targets AGENTS.md Task Prioritization section', () => {
    const result = generateImprovements([makePattern({
      type: 'blocking_chain',
      data: { blockers: [{ id: 'RALPH-010', count: 4 }] },
    })]);
    const p = result.proposals[0];
    expect(p.target).toBe('AGENTS.md');
    expect(p.section).toBe('Task Prioritization');
    expect(p.type).toBe('add_convention');
    expect(p.priority).toBe('medium');
  });

  it('lists blockers in content', () => {
    const blockers = [
      { id: 'RALPH-010', count: 4 },
      { id: 'RALPH-020', count: 2 },
    ];
    const result = generateImprovements([makePattern({
      type: 'blocking_chain',
      data: { blockers },
    })]);
    const content = result.proposals[0].content;
    expect(content).toContain('RALPH-010');
    expect(content).toContain('blocks 4 tasks');
    expect(content).toContain('RALPH-020');
  });
});

// =============================================================================
// generateImprovements — iteration_anomaly pattern
// =============================================================================

describe('generateImprovements — iteration_anomaly', () => {
  it('targets agents/task-discovery.md', () => {
    const result = generateImprovements([makePattern({
      type: 'iteration_anomaly',
      data: {
        anomalies: [{ taskId: 'RALPH-005', iterations: 15 }],
        threshold: 8,
      },
    })]);
    const p = result.proposals[0];
    expect(p.target).toBe('agents/task-discovery.md');
    expect(p.section).toBe('Complexity Assessment');
    expect(p.type).toBe('refine_instructions');
  });

  it('includes threshold and anomaly examples in content', () => {
    const result = generateImprovements([makePattern({
      type: 'iteration_anomaly',
      data: {
        anomalies: [
          { taskId: 'RALPH-005', iterations: 15 },
          { taskId: 'RALPH-012', iterations: 20 },
        ],
        threshold: 8,
      },
    })]);
    const content = result.proposals[0].content;
    expect(content).toContain('8');
    expect(content).toContain('RALPH-005');
    expect(content).toContain('15 iterations');
  });

  it('limits examples to 3 anomalies in content', () => {
    const anomalies = Array.from({ length: 5 }, (_, i) => ({
      taskId: `RALPH-${String(i + 1).padStart(3, '0')}`,
      iterations: 10 + i,
    }));
    const result = generateImprovements([makePattern({
      type: 'iteration_anomaly',
      data: { anomalies, threshold: 8 },
    })]);
    const content = result.proposals[0].content;
    expect(content).toContain('RALPH-001');
    expect(content).toContain('RALPH-003');
    expect(content).not.toContain('RALPH-004');
  });
});

// =============================================================================
// generateImprovements — bottleneck pattern
// =============================================================================

describe('generateImprovements — bottleneck', () => {
  it('targets AGENTS.md Known Bottlenecks section', () => {
    const result = generateImprovements([makePattern({
      type: 'bottleneck',
      data: { slowestType: 'refactor', ratio: 3.2, avgDuration: 5.0 },
    })]);
    const p = result.proposals[0];
    expect(p.target).toBe('AGENTS.md');
    expect(p.section).toBe('Known Bottlenecks');
    expect(p.type).toBe('add_pattern');
  });

  it('includes type name and ratio in content', () => {
    const result = generateImprovements([makePattern({
      type: 'bottleneck',
      data: { slowestType: 'refactor', ratio: 3.2, avgDuration: 5.0 },
    })]);
    const content = result.proposals[0].content;
    expect(content).toContain('refactor');
    expect(content).toContain('3.2x');
    expect(content).toContain('5.0');
  });
});

// =============================================================================
// generateImprovements — velocity_trend pattern
// =============================================================================

describe('generateImprovements — velocity_trend', () => {
  it('targets AGENTS.md Velocity Notes section', () => {
    const result = generateImprovements([makePattern({
      type: 'velocity_trend',
      data: { direction: 'increasing', change: 0.25, recentAvg: 8.5 },
    })]);
    const p = result.proposals[0];
    expect(p.target).toBe('AGENTS.md');
    expect(p.section).toBe('Velocity Notes');
    expect(p.type).toBe('add_section');
    expect(p.priority).toBe('low');
  });

  it('includes direction and change in title', () => {
    const result = generateImprovements([makePattern({
      type: 'velocity_trend',
      data: { direction: 'decreasing', change: -0.15, recentAvg: 4.0 },
    })]);
    expect(result.proposals[0].title).toContain('decreasing');
  });

  it('adapts messaging for increasing vs decreasing trends', () => {
    const increasing = generateImprovements([makePattern({
      type: 'velocity_trend',
      data: { direction: 'increasing', change: 0.2, recentAvg: 8.0 },
    })]);
    expect(increasing.proposals[0].content).toContain('Positive trend');

    const decreasing = generateImprovements([makePattern({
      type: 'velocity_trend',
      data: { direction: 'decreasing', change: -0.3, recentAvg: 3.0 },
    })]);
    expect(decreasing.proposals[0].content).toContain('Declining trend');
  });
});

// =============================================================================
// generateImprovements — metrics-based proposals
// =============================================================================

describe('generateImprovements — metrics-based proposals', () => {
  it('proposes warning when estimateAccuracy < 50', () => {
    const metrics = makeAggregate({ estimateAccuracy: 30, avgEstimateRatio: 2.5 });
    const result = generateImprovements([], metrics);
    expect(result.proposals.length).toBeGreaterThanOrEqual(1);
    const p = result.proposals.find(p => p.title.includes('estimation accuracy'));
    expect(p).toBeDefined();
    expect(p!.priority).toBe('high');
    expect(p!.confidence).toBe(0.9);
    expect(p!.content).toContain('30%');
    expect(p!.content).toContain('2.5x');
  });

  it('does not propose estimation warning when accuracy >= 50', () => {
    const metrics = makeAggregate({ estimateAccuracy: 75 });
    const result = generateImprovements([], metrics);
    const p = result.proposals.find(p => p.title.includes('estimation accuracy'));
    expect(p).toBeUndefined();
  });

  it('proposes convention when blocker rate > 30%', () => {
    const metrics = makeAggregate({ totalBlockers: 5, tasksCompleted: 10 });
    const result = generateImprovements([], metrics);
    const p = result.proposals.find(p => p.title.includes('blocker rate'));
    expect(p).toBeDefined();
    expect(p!.priority).toBe('medium');
  });

  it('does not propose blocker convention when rate <= 30%', () => {
    const metrics = makeAggregate({ totalBlockers: 2, tasksCompleted: 10 });
    const result = generateImprovements([], metrics);
    const p = result.proposals.find(p => p.title.includes('blocker rate'));
    expect(p).toBeUndefined();
  });

  it('combines pattern and metrics proposals', () => {
    const patterns = [makePattern({ type: 'estimation_drift' })];
    const metrics = makeAggregate({ estimateAccuracy: 20 });
    const result = generateImprovements(patterns, metrics);
    expect(result.proposals.length).toBeGreaterThanOrEqual(2);
    // Pattern proposal gets ID 1, metrics gets ID 2
    expect(result.proposals[0].id).toBe('IMPROVE-001');
    expect(result.proposals[1].id).toBe('IMPROVE-002');
  });

  it('continues ID numbering from pattern proposals', () => {
    const patterns = [
      makePattern({ type: 'estimation_drift' }),
      makePattern({ type: 'bug_hotspot', data: { aggregate: 'x', bugCount: 3 } }),
      makePattern({ type: 'blocking_chain', data: { blockers: [] } }),
    ];
    const metrics = makeAggregate({ estimateAccuracy: 10 });
    const result = generateImprovements(patterns, metrics);
    const ids = result.proposals.map(p => p.id);
    // 3 pattern proposals + at least 1 metrics proposal
    expect(ids).toContain('IMPROVE-001');
    expect(ids).toContain('IMPROVE-002');
    expect(ids).toContain('IMPROVE-003');
    expect(ids).toContain('IMPROVE-004');
  });
});

// =============================================================================
// buildSummary (via generateImprovements)
// =============================================================================

describe('generateImprovements — summary', () => {
  it('counts proposals by target', () => {
    const patterns = [
      makePattern({ type: 'estimation_drift' }),  // AGENTS.md
      makePattern({ type: 'bug_hotspot', data: { aggregate: 'x', bugCount: 3 } }),  // AGENTS.md
      makePattern({ type: 'iteration_anomaly', data: { anomalies: [], threshold: 5 } }),  // agents/task-discovery.md
    ];
    const result = generateImprovements(patterns);
    expect(result.summary.byTarget['AGENTS.md']).toBe(2);
    expect(result.summary.byTarget['agents/task-discovery.md']).toBe(1);
  });

  it('counts proposals by type', () => {
    const patterns = [
      makePattern({ type: 'estimation_drift' }),
      makePattern({ type: 'bug_hotspot', data: { aggregate: 'x', bugCount: 3 } }),
    ];
    const result = generateImprovements(patterns);
    expect(result.summary.byType['update_estimate']).toBe(1);
    expect(result.summary.byType['add_warning']).toBe(1);
  });

  it('counts high priority proposals', () => {
    const patterns = [
      makePattern({ type: 'estimation_drift', confidence: 0.9 }),  // high
      makePattern({ type: 'bug_hotspot', data: { aggregate: 'x', bugCount: 3 } }),  // always high
      makePattern({ type: 'blocking_chain', data: { blockers: [] } }),  // medium
    ];
    const result = generateImprovements(patterns);
    expect(result.summary.highPriority).toBe(2);
  });
});

// =============================================================================
// saveProposals
// =============================================================================

describe('saveProposals', () => {
  it('writes proposals as JSONL to file', async () => {
    let written = '';
    const readFile = vi.fn().mockResolvedValue('');
    const writeFile = vi.fn().mockImplementation((_path: string, content: string) => {
      written = content;
      return Promise.resolve();
    });

    const proposals: ImprovementProposal[] = [
      {
        id: 'IMPROVE-001',
        target: 'AGENTS.md',
        section: 'Test',
        type: 'add_section',
        title: 'Test proposal',
        description: 'Test',
        content: 'Test content',
        rationale: 'Because',
        evidence: ['ev1'],
        confidence: 0.8,
        priority: 'medium',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    await saveProposals(readFile, writeFile, './learning.jsonl', proposals);

    expect(writeFile).toHaveBeenCalledOnce();
    const lines = written.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.eventType).toBe('improvement_proposed');
    expect(parsed.id).toBe('IMPROVE-001');
  });

  it('appends to existing file content', async () => {
    const existing = '{"eventType":"old","id":"OLD-001"}\n';
    const readFile = vi.fn().mockResolvedValue(existing);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    const proposals: ImprovementProposal[] = [
      {
        id: 'IMPROVE-001',
        target: 'AGENTS.md',
        type: 'add_section',
        title: 'New',
        description: '',
        content: '',
        rationale: '',
        evidence: [],
        confidence: 0.8,
        priority: 'low',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    await saveProposals(readFile, writeFile, './learning.jsonl', proposals);

    const writtenContent = writeFile.mock.calls[0][1] as string;
    expect(writtenContent.startsWith(existing)).toBe(true);
    const lines = writtenContent.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('handles missing file gracefully', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await saveProposals(readFile, writeFile, './learning.jsonl', [
      {
        id: 'IMPROVE-001',
        target: 'x',
        type: 'add_section',
        title: 'T',
        description: '',
        content: '',
        rationale: '',
        evidence: [],
        confidence: 0.5,
        priority: 'low',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ]);

    expect(writeFile).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// loadPendingProposals
// =============================================================================

describe('loadPendingProposals', () => {
  it('loads only pending improvement_proposed events', async () => {
    const content = [
      JSON.stringify({ eventType: 'improvement_proposed', id: 'IMPROVE-001', status: 'pending', target: 'AGENTS.md', type: 'add_section', title: 'A', description: '', content: '', rationale: '', evidence: [], confidence: 0.8, priority: 'low', createdAt: '2024-01-01T00:00:00Z' }),
      JSON.stringify({ eventType: 'improvement_proposed', id: 'IMPROVE-002', status: 'applied', target: 'AGENTS.md', type: 'add_section', title: 'B', description: '', content: '', rationale: '', evidence: [], confidence: 0.8, priority: 'low', createdAt: '2024-01-01T00:00:00Z' }),
      JSON.stringify({ eventType: 'other_event', id: 'X' }),
    ].join('\n');

    const readFile = vi.fn().mockResolvedValue(content);
    const proposals = await loadPendingProposals(readFile, './learning.jsonl');

    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe('IMPROVE-001');
    expect(proposals[0].status).toBe('pending');
  });

  it('returns empty array for empty file', async () => {
    const readFile = vi.fn().mockResolvedValue('');
    const proposals = await loadPendingProposals(readFile, './learning.jsonl');
    expect(proposals).toHaveLength(0);
  });

  it('returns empty array when file does not exist', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const proposals = await loadPendingProposals(readFile, './learning.jsonl');
    expect(proposals).toHaveLength(0);
  });

  it('skips blank lines in JSONL', async () => {
    const content = '\n' + JSON.stringify({
      eventType: 'improvement_proposed',
      id: 'IMPROVE-001',
      status: 'pending',
      target: 'X',
      type: 'add_section',
      title: 'A',
      description: '',
      content: '',
      rationale: '',
      evidence: [],
      confidence: 0.8,
      priority: 'low',
      createdAt: '2024-01-01T00:00:00Z',
    }) + '\n\n';

    const readFile = vi.fn().mockResolvedValue(content);
    const proposals = await loadPendingProposals(readFile, './x');
    expect(proposals).toHaveLength(1);
  });
});

// =============================================================================
// printProposals (smoke tests — no assertions on console output shape)
// =============================================================================

describe('printProposals', () => {
  it('does not throw for empty proposals', () => {
    const result: ImprovementResult = {
      proposals: [],
      summary: { totalProposals: 0, highPriority: 0, byTarget: {}, byType: {} as any },
    };
    expect(() => printProposals(result)).not.toThrow();
  });

  it('does not throw for mixed-priority proposals', () => {
    const proposals: ImprovementProposal[] = [
      {
        id: 'IMPROVE-001', target: 'AGENTS.md', section: 'S', type: 'add_warning',
        title: 'High', description: 'Desc', content: 'C', rationale: 'R',
        evidence: ['e1'], confidence: 0.9, priority: 'high', status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'IMPROVE-002', target: 'AGENTS.md', type: 'add_convention',
        title: 'Medium', description: 'D', content: 'C', rationale: 'R',
        evidence: [], confidence: 0.7, priority: 'medium', status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'IMPROVE-003', target: 'AGENTS.md', type: 'add_section',
        title: 'Low', description: 'D', content: 'C', rationale: 'R',
        evidence: [], confidence: 0.5, priority: 'low', status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    const result: ImprovementResult = {
      proposals,
      summary: { totalProposals: 3, highPriority: 1, byTarget: { 'AGENTS.md': 3 }, byType: {} as any },
    };
    expect(() => printProposals(result)).not.toThrow();
  });
});

// =============================================================================
// Evidence and createdAt propagation
// =============================================================================

describe('generateImprovements — evidence propagation', () => {
  it('carries pattern evidence into proposal', () => {
    const evidence = ['File X had 5 bugs', 'File Y had 3 bugs'];
    const result = generateImprovements([makePattern({
      type: 'bug_hotspot',
      data: { aggregate: 'z', bugCount: 8 },
      evidence,
    })]);
    expect(result.proposals[0].evidence).toEqual(evidence);
  });

  it('sets createdAt to a valid ISO timestamp', () => {
    const result = generateImprovements([makePattern({ type: 'estimation_drift' })]);
    const ts = result.proposals[0].createdAt;
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('carries pattern confidence into proposal', () => {
    const result = generateImprovements([makePattern({ type: 'estimation_drift', confidence: 0.72 })]);
    expect(result.proposals[0].confidence).toBe(0.72);
  });
});
