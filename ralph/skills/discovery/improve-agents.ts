/**
 * Improve Agents Skill
 *
 * Generates improvement proposals for AGENTS.md and other documentation
 * based on detected patterns and execution history.
 */

import type { DetectedPattern, PatternType } from './detect-patterns.js';
import type { AggregateMetrics } from '../track/record-metrics.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ImprovementProposal {
  id: string;
  target: string;           // File to modify
  section?: string;         // Section within file
  type: ImprovementType;
  title: string;
  description: string;
  content: string;          // Proposed content/change
  rationale: string;
  evidence: string[];
  confidence: number;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
}

export type ImprovementType =
  | 'add_section'
  | 'update_section'
  | 'add_convention'
  | 'add_warning'
  | 'update_estimate'
  | 'add_pattern'
  | 'refine_instructions';

export interface ImprovementResult {
  proposals: ImprovementProposal[];
  summary: ImprovementSummary;
}

export interface ImprovementSummary {
  totalProposals: number;
  highPriority: number;
  byTarget: Record<string, number>;
  byType: Record<ImprovementType, number>;
}

// =============================================================================
// PROPOSAL GENERATION
// =============================================================================

/**
 * Generate improvement proposals from patterns
 */
export function generateImprovements(
  patterns: DetectedPattern[],
  metrics?: AggregateMetrics
): ImprovementResult {
  const proposals: ImprovementProposal[] = [];
  let proposalId = 1;

  for (const pattern of patterns) {
    const proposal = patternToProposal(pattern, proposalId++);
    if (proposal) {
      proposals.push(proposal);
    }
  }

  // Add metrics-based proposals
  if (metrics) {
    const metricsProposals = metricsToProposals(metrics, proposalId);
    proposals.push(...metricsProposals);
  }

  // Build summary
  const summary = buildSummary(proposals);

  return { proposals, summary };
}

/**
 * Convert a pattern to an improvement proposal
 */
function patternToProposal(
  pattern: DetectedPattern,
  id: number
): ImprovementProposal | null {
  const proposalId = `IMPROVE-${String(id).padStart(3, '0')}`;
  const timestamp = new Date().toISOString();

  switch (pattern.type) {
    case 'estimation_drift':
      return {
        id: proposalId,
        target: 'AGENTS.md',
        section: 'Estimation Guidance',
        type: 'update_estimate',
        title: 'Add estimation multiplier guidance',
        description: pattern.description,
        content: generateEstimationContent(pattern),
        rationale: pattern.suggestion || 'Improve estimation accuracy',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: pattern.confidence > 0.8 ? 'high' : 'medium',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'bug_hotspot':
      return {
        id: proposalId,
        target: 'AGENTS.md',
        section: 'Risk Areas',
        type: 'add_warning',
        title: `Flag "${pattern.data.aggregate}" as high-risk area`,
        description: pattern.description,
        content: generateRiskAreaContent(pattern),
        rationale: pattern.suggestion || 'Increase code review focus',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: 'high',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'blocking_chain':
      return {
        id: proposalId,
        target: 'AGENTS.md',
        section: 'Task Prioritization',
        type: 'add_convention',
        title: 'Add blocking task prioritization rule',
        description: pattern.description,
        content: generateBlockingContent(pattern),
        rationale: pattern.suggestion || 'Unblock downstream work faster',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: 'medium',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'iteration_anomaly':
      return {
        id: proposalId,
        target: 'agents/task-discovery.md',
        section: 'Complexity Assessment',
        type: 'refine_instructions',
        title: 'Improve complexity detection for high-iteration tasks',
        description: pattern.description,
        content: generateIterationContent(pattern),
        rationale: pattern.suggestion || 'Better predict difficult tasks',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: 'medium',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'bottleneck':
      return {
        id: proposalId,
        target: 'AGENTS.md',
        section: 'Known Bottlenecks',
        type: 'add_pattern',
        title: `Document "${pattern.data.slowestType}" bottleneck`,
        description: pattern.description,
        content: generateBottleneckContent(pattern),
        rationale: pattern.suggestion || 'Set expectations for slow task types',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: 'medium',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'velocity_trend':
      return {
        id: proposalId,
        target: 'AGENTS.md',
        section: 'Velocity Notes',
        type: 'add_section',
        title: `Record velocity ${pattern.data.direction} trend`,
        description: pattern.description,
        content: generateVelocityContent(pattern),
        rationale: pattern.suggestion || 'Track velocity for planning',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: 'low',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'spec_drift':
      return {
        id: proposalId,
        target: `specs/${(pattern.data.area as string || 'system-context').toLowerCase().replace(/\s+/g, '-')}.md`,
        section: 'Observed Drift',
        type: 'update_section',
        title: `Update spec for "${pattern.data.area}" — high failure rate indicates spec/reality mismatch`,
        description: pattern.description,
        content: generateSpecDriftContent(pattern),
        rationale: pattern.suggestion || 'Align specs with codebase reality',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: pattern.confidence > 0.7 ? 'high' : 'medium',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'plan_drift':
      return {
        id: proposalId,
        target: 'implementation-plan.md',
        section: pattern.data.area as string || 'Scope Updates',
        type: 'update_section',
        title: `Update plan for "${pattern.data.area}" — scope underestimation detected`,
        description: pattern.description,
        content: generatePlanDriftContent(pattern),
        rationale: pattern.suggestion || 'Reflect actual scope in plan',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: 'medium',
        status: 'pending',
        createdAt: timestamp,
      };

    case 'knowledge_staleness':
      return {
        id: proposalId,
        target: 'specs/system-context.md',
        section: 'Coverage Gaps',
        type: 'add_section',
        title: 'Add spec coverage for uncategorized development areas',
        description: pattern.description,
        content: generateKnowledgeStalenessContent(pattern),
        rationale: pattern.suggestion || 'Improve spec coverage for active areas',
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        priority: pattern.confidence > 0.7 ? 'high' : 'medium',
        status: 'pending',
        createdAt: timestamp,
      };

    default:
      return null;
  }
}

/**
 * Generate proposals from aggregate metrics
 */
function metricsToProposals(
  metrics: AggregateMetrics,
  startId: number
): ImprovementProposal[] {
  const proposals: ImprovementProposal[] = [];
  const timestamp = new Date().toISOString();
  let id = startId;

  // Low estimate accuracy
  if (metrics.estimateAccuracy < 50) {
    proposals.push({
      id: `IMPROVE-${String(id++).padStart(3, '0')}`,
      target: 'AGENTS.md',
      section: 'Estimation',
      type: 'add_warning',
      title: 'Warning: Low estimation accuracy',
      description: `Only ${metrics.estimateAccuracy.toFixed(0)}% of estimates are within 20% of actual`,
      content: `## Estimation Warning

Current estimation accuracy is ${metrics.estimateAccuracy.toFixed(0)}%.

Consider:
- Breaking tasks into smaller pieces
- Adding spike tasks for unknowns
- Applying a ${metrics.avgEstimateRatio.toFixed(1)}x multiplier

*Generated from ${metrics.period} metrics*`,
      rationale: 'Improve planning reliability',
      evidence: [`Period: ${metrics.period}`, `Accuracy: ${metrics.estimateAccuracy}%`],
      confidence: 0.9,
      priority: 'high',
      status: 'pending',
      createdAt: timestamp,
    });
  }

  // High blocker count
  if (metrics.totalBlockers > metrics.tasksCompleted * 0.3) {
    proposals.push({
      id: `IMPROVE-${String(id++).padStart(3, '0')}`,
      target: 'AGENTS.md',
      section: 'Dependencies',
      type: 'add_convention',
      title: 'High blocker rate detected',
      description: `${metrics.totalBlockers} blockers for ${metrics.tasksCompleted} tasks`,
      content: `## Dependency Management

High blocker rate detected (${((metrics.totalBlockers / metrics.tasksCompleted) * 100).toFixed(0)}%).

Recommendations:
- Identify blocking tasks early in planning
- Consider parallel work streams
- Break circular dependencies

*Generated from ${metrics.period} metrics*`,
      rationale: 'Reduce blocking dependencies',
      evidence: [`Blockers: ${metrics.totalBlockers}`, `Tasks: ${metrics.tasksCompleted}`],
      confidence: 0.75,
      priority: 'medium',
      status: 'pending',
      createdAt: timestamp,
    });
  }

  return proposals;
}

// =============================================================================
// CONTENT GENERATORS
// =============================================================================

function generateEstimationContent(pattern: DetectedPattern): string {
  const ratio = pattern.data.avgRatio as number;
  const direction = pattern.data.direction as string;

  return `## Estimation Guidance

Based on ${pattern.evidence.length} completed tasks, estimates are systematically ${direction}.

**Recommended multiplier: ${ratio.toFixed(1)}x**

When estimating:
- Apply this multiplier to initial estimates
- Review after 10 more tasks

Evidence: ${pattern.evidence.join(', ')}
Detected: ${pattern.timestamp}

*This section was auto-generated by Ralph's learning system*`;
}

function generateRiskAreaContent(pattern: DetectedPattern): string {
  const aggregate = pattern.data.aggregate as string;
  const bugCount = pattern.data.bugCount as number;

  return `## Risk Areas

### ${aggregate}

**Bug count: ${bugCount}**

This area has a high density of bugs. When working here:
- Increase code review scrutiny
- Add extra test coverage
- Consider refactoring

Evidence: ${pattern.evidence.join(', ')}
Detected: ${pattern.timestamp}

*This section was auto-generated by Ralph's learning system*`;
}

function generateBlockingContent(pattern: DetectedPattern): string {
  const blockers = pattern.data.blockers as Array<{ id: string; count: number }>;

  return `## Task Prioritization

### Blocking Tasks

These tasks are blocking multiple others and should be prioritized:

${blockers.map(b => `- ${b.id}: blocks ${b.count} tasks`).join('\n')}

**Rule**: When a task blocks 2+ others, prioritize it in the current sprint.

Detected: ${pattern.timestamp}

*This section was auto-generated by Ralph's learning system*`;
}

function generateIterationContent(pattern: DetectedPattern): string {
  const anomalies = pattern.data.anomalies as Array<{ taskId: string; iterations: number }>;
  const threshold = pattern.data.threshold as number;

  return `## High-Iteration Task Signals

Tasks exceeding ${threshold.toFixed(0)} iterations may indicate:
- Unclear requirements
- Missing dependencies
- Technical complexity

Recent examples:
${anomalies.slice(0, 3).map(a => `- ${a.taskId}: ${a.iterations} iterations`).join('\n')}

Consider adding a "spike" task for investigation before implementation.

*This section was auto-generated by Ralph's learning system*`;
}

function generateBottleneckContent(pattern: DetectedPattern): string {
  const slowestType = pattern.data.slowestType as string;
  const ratio = pattern.data.ratio as number;
  const avgDuration = pattern.data.avgDuration as number;

  return `## Known Bottlenecks

### ${slowestType} Tasks

These tasks take ${ratio.toFixed(1)}x longer than average (${avgDuration.toFixed(1)} days).

Recommendations:
- Allow extra time in planning
- Consider breaking into subtasks
- Identify common blockers

*This section was auto-generated by Ralph's learning system*`;
}

function generateVelocityContent(pattern: DetectedPattern): string {
  const direction = pattern.data.direction as string;
  const change = pattern.data.change as number;
  const recentAvg = pattern.data.recentAvg as number;

  return `## Velocity Trends

Current velocity: ${recentAvg.toFixed(1)} tasks/period (${direction} ${(Math.abs(change) * 100).toFixed(0)}%)

${direction === 'increasing'
    ? 'Positive trend - document what\'s working well.'
    : 'Declining trend - investigate potential causes.'}

Tracked: ${pattern.timestamp}

*This section was auto-generated by Ralph's learning system*`;
}

function generateSpecDriftContent(pattern: DetectedPattern): string {
  const area = pattern.data.area as string;
  const failureRate = pattern.data.failureRate as number;
  const failedCount = pattern.data.failedCount as number;
  const totalCount = pattern.data.totalCount as number;

  return `## Observed Drift

### ${area}

**Failure rate: ${(failureRate * 100).toFixed(0)}% (${failedCount}/${totalCount} tasks)**

This area has a high failure rate, suggesting the spec does not accurately reflect the current codebase state.

Recommended actions:
- Review the spec assumptions for "${area}"
- Verify referenced APIs, file paths, and interfaces still exist
- Update the spec to match current codebase behavior
- Add integration tests to prevent future drift

Evidence: ${pattern.evidence.join(', ')}
Detected: ${pattern.timestamp}

*This section was auto-generated by Ralph's drift detection system*`;
}

function generatePlanDriftContent(pattern: DetectedPattern): string {
  const area = pattern.data.area as string;
  const spawnedCount = pattern.data.spawnedCount as number;
  const plannedCount = pattern.data.plannedCount as number;
  const parentCount = pattern.data.parentCount as number;

  return `## Scope Updates

### ${area}

**${spawnedCount} unplanned subtasks from ${parentCount} parent tasks (${plannedCount} originally planned)**

The implementation plan underestimated the scope of work in this area. Subtasks were spawned during execution that were not anticipated in the original plan.

Recommended actions:
- Review and update task breakdown for "${area}"
- Add discovered subtasks to the plan for tracking
- Consider adding a buffer for future similar areas

Evidence: ${pattern.evidence.join(', ')}
Detected: ${pattern.timestamp}

*This section was auto-generated by Ralph's drift detection system*`;
}

function generateKnowledgeStalenessContent(pattern: DetectedPattern): string {
  const unknownRatio = pattern.data.unknownRatio as number;
  const unknownFiles = pattern.data.unknownFiles as number;
  const unknownTasks = pattern.data.unknownTasks as number;

  return `## Coverage Gaps

**${(unknownRatio * 100).toFixed(0)}% of file changes (${unknownFiles} files across ${unknownTasks} tasks) are in uncategorized areas.**

Active development is happening in areas not covered by current specs. This reduces Ralph's ability to detect patterns and propose improvements.

Recommended actions:
- Identify the uncategorized areas from recent task metrics
- Create or update spec files to cover these areas
- Assign aggregate/domain labels to existing tasks in these areas

Evidence: ${pattern.evidence.join(', ')}
Detected: ${pattern.timestamp}

*This section was auto-generated by Ralph's drift detection system*`;
}

// =============================================================================
// HELPERS
// =============================================================================

function buildSummary(proposals: ImprovementProposal[]): ImprovementSummary {
  const byTarget: Record<string, number> = {};
  const byType: Record<ImprovementType, number> = {} as Record<ImprovementType, number>;

  for (const proposal of proposals) {
    byTarget[proposal.target] = (byTarget[proposal.target] || 0) + 1;
    byType[proposal.type] = (byType[proposal.type] || 0) + 1;
  }

  return {
    totalProposals: proposals.length,
    highPriority: proposals.filter(p => p.priority === 'high').length,
    byTarget,
    byType,
  };
}

// =============================================================================
// PERSISTENCE
// =============================================================================

/**
 * Save improvement proposals to learning.jsonl
 */
export async function saveProposals(
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<void>,
  path: string,
  proposals: ImprovementProposal[]
): Promise<void> {
  let content = '';
  try {
    content = await readFile(path);
  } catch {
    // File doesn't exist
  }

  const events = proposals.map(p => ({
    eventType: 'improvement_proposed',
    ...p,
  }));

  const newLines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(path, content + newLines);
}

/**
 * Load pending proposals
 */
export async function loadPendingProposals(
  readFile: (path: string) => Promise<string>,
  path: string
): Promise<ImprovementProposal[]> {
  try {
    const content = await readFile(path);
    if (!content.trim()) return [];

    return content
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .filter(e => e.eventType === 'improvement_proposed' && e.status === 'pending')
      .map(e => ({
        id: e.id,
        target: e.target,
        section: e.section,
        type: e.type,
        title: e.title,
        description: e.description,
        content: e.content,
        rationale: e.rationale,
        evidence: e.evidence,
        confidence: e.confidence,
        priority: e.priority,
        status: e.status,
        createdAt: e.createdAt,
      } as ImprovementProposal));
  } catch {
    return [];
  }
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Print improvement proposals
 */
export function printProposals(result: ImprovementResult): void {
  console.log('\nImprovement Proposals');
  console.log('─'.repeat(40));

  if (result.proposals.length === 0) {
    console.log('  No improvements proposed');
    return;
  }

  console.log(`\n${result.proposals.length} proposals generated:\n`);

  // Group by priority
  const high = result.proposals.filter(p => p.priority === 'high');
  const medium = result.proposals.filter(p => p.priority === 'medium');
  const low = result.proposals.filter(p => p.priority === 'low');

  if (high.length > 0) {
    console.log('HIGH PRIORITY:');
    for (const p of high) {
      console.log(`  [${p.id}] ${p.title}`);
      console.log(`    Target: ${p.target}${p.section ? ` > ${p.section}` : ''}`);
      console.log(`    ${p.description}`);
      console.log();
    }
  }

  if (medium.length > 0) {
    console.log('MEDIUM PRIORITY:');
    for (const p of medium) {
      console.log(`  [${p.id}] ${p.title}`);
      console.log(`    Target: ${p.target}`);
      console.log();
    }
  }

  if (low.length > 0) {
    console.log('LOW PRIORITY:');
    for (const p of low) {
      console.log(`  [${p.id}] ${p.title}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  Total: ${result.summary.totalProposals}`);
  console.log(`  High priority: ${result.summary.highPriority}`);
}
