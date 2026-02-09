# Learner Agent

> Detects patterns from execution history and proposes system improvements.

## Responsibility

Analyze `progress.jsonl` and `learning.jsonl`. Detect patterns. Propose improvements to Ralph's own documentation and configuration. This is how Ralph evolves.

## Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| Progress log | `./state/progress.jsonl` | Execution history |
| Learning log | `./state/learning.jsonl` | Accumulated patterns |
| Tasks | `./state/tasks.jsonl` | Task outcomes |
| AGENTS.md | `./AGENTS.md` | Current instructions |

## Output

1. Pattern events in `learning.jsonl`
2. Improvement proposals in `learning.jsonl`
3. (If auto-apply) Updated documentation
4. (If auto-apply) Git commits on `ralph/learn-*` branches

## Process

### Step 1: Load History

```typescript
const progress = await readJsonl('./state/progress.jsonl');
const learning = await readJsonl('./state/learning.jsonl');
const tasks = deriveTaskState('./state/tasks.jsonl');
```

### Step 2: Compute Metrics

```typescript
const metrics = {
  // Task metrics
  tasksCompleted: countByStatus(tasks, 'done'),
  avgIterations: average(progress.filter(isTaskComplete).map(p => p.iterations)),
  estimationAccuracy: computeEstimationAccuracy(tasks),

  // Time metrics
  avgTimePerTask: average(taskDurations),
  timeByType: groupBy(tasks, 'type', duration),

  // Quality metrics
  bugsPerArea: groupBy(tasks.filter(t => t.type === 'bug'), 'aggregate'),
  testCoverage: computeCoverage(progress),

  // Agent metrics
  failureRate: countFailures(progress) / progress.length,
  escalationRate: countEscalations(progress) / progress.length
};
```

### Step 3: Detect Patterns

Run pattern detectors:

```typescript
const patterns = [
  detectEstimationDrift(tasks),
  detectTaskClustering(tasks),
  detectBlockingChains(tasks),
  detectBugHotspots(tasks),
  detectTestGaps(progress),
  detectHighChurn(progress),
  detectIterationAnomalies(progress),
  detectFailureModes(progress)
].filter(p => p.confidence > 0.7);
```

### Step 4: Log Patterns

```typescript
for (const pattern of patterns) {
  appendToLog('learning.jsonl', {
    type: 'pattern_detected',
    pattern: pattern.type,
    confidence: pattern.confidence,
    data: pattern.data,
    evidence: pattern.evidence,
    timestamp: now()
  });
}
```

### Step 5: Generate Improvements

For high-confidence patterns:

```typescript
const improvements = patterns
  .filter(p => p.confidence > 0.8)
  .map(p => generateImprovement(p));
```

#### Improvement Types

| Pattern | Improvement |
|---------|-------------|
| estimation_drift | Add multiplier to AGENTS.md |
| task_clustering | Add suggested related tasks |
| failure_mode | Update agent instructions |
| bug_hotspot | Add to risk areas in AGENTS.md |
| test_gap | Create test task |

### Step 6: Propose Improvements

```typescript
for (const improvement of improvements) {
  appendToLog('learning.jsonl', {
    type: 'improvement_proposed',
    target: improvement.target,
    section: improvement.section,
    change: improvement.description,
    diff: improvement.diff,
    rationale: improvement.rationale,
    evidence: improvement.evidence,
    status: 'pending',
    timestamp: now()
  });
}
```

### Step 7: Apply (If Configured)

If `autoApplyImprovements: true`:

```typescript
// Create branch
await git.checkout('-b', `ralph/learn-${Date.now()}`);

// Apply changes
for (const improvement of approvedImprovements) {
  await applyImprovement(improvement);
}

// Commit
await git.add('.');
await git.commit(`RALPH-LEARN: ${improvement.description}`);

// Log
appendToLog('learning.jsonl', {
  type: 'improvement_applied',
  id: improvement.id,
  branch: branchName,
  timestamp: now()
});
```

## Pattern Detectors

### Estimation Drift

```typescript
function detectEstimationDrift(tasks: Task[]): Pattern | null {
  const completed = tasks.filter(t => t.status === 'done' && t.estimate && t.actual);
  if (completed.length < 5) return null;

  const ratios = completed.map(t => t.actual / t.estimate);
  const avgRatio = average(ratios);

  if (avgRatio > 1.5 || avgRatio < 0.7) {
    return {
      type: 'estimation_drift',
      confidence: Math.min(completed.length / 10, 1),
      data: { multiplier: avgRatio },
      evidence: completed.map(t => t.id)
    };
  }
  return null;
}
```

### Bug Hotspots

```typescript
function detectBugHotspots(tasks: Task[]): Pattern | null {
  const bugs = tasks.filter(t => t.type === 'bug');
  const byArea = groupBy(bugs, 'aggregate');

  const hotspots = Object.entries(byArea)
    .filter(([, bugs]) => bugs.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  if (hotspots.length > 0) {
    return {
      type: 'bug_hotspot',
      confidence: Math.min(hotspots[0][1].length / 5, 1),
      data: { areas: hotspots.map(([area, bugs]) => ({ area, count: bugs.length })) },
      evidence: hotspots.flatMap(([, bugs]) => bugs.map(b => b.id))
    };
  }
  return null;
}
```

### Failure Modes

```typescript
function detectFailureModes(progress: ProgressEvent[]): Pattern | null {
  const failures = progress.filter(p => p.type === 'task_failed');
  const byReason = groupBy(failures, 'reason');

  const recurring = Object.entries(byReason)
    .filter(([, events]) => events.length >= 2);

  if (recurring.length > 0) {
    return {
      type: 'failure_mode',
      confidence: 0.8,
      data: { modes: recurring.map(([reason, events]) => ({ reason, count: events.length })) },
      evidence: recurring.flatMap(([, events]) => events.map(e => e.taskId))
    };
  }
  return null;
}
```

## Improvement Templates

### AGENTS.md: Add Estimation Multiplier

```markdown
## Estimation Guidance

Based on historical data, apply a {multiplier}x multiplier to initial estimates.

Evidence: {taskIds}
Detected: {date}
```

### agents/*.md: Fix Failure Mode

```markdown
## Known Issues

### {failure_mode}

When encountering {condition}, use {workaround}.

Evidence: {taskIds}
```

## Human Review

When `autoApplyImprovements: false`:

1. Improvements logged as `status: 'pending'`
2. Human reviews `learning.jsonl`
3. Human approves: `{"op":"approve","id":"..."}`
4. Learner applies on next run

## Metrics

| Metric | Description |
|--------|-------------|
| patterns_detected | New patterns found |
| improvements_proposed | Improvements generated |
| improvements_applied | Changes made |
| improvements_rejected | Human rejected |

## Configuration

```json
{
  "learner": {
    "enabled": true,
    "minConfidence": 0.7,
    "autoApplyImprovements": false,
    "runInterval": "daily",
    "retentionDays": 90
  }
}
```

## Escalation

Escalate to human when:
- Major documentation change proposed
- Pattern suggests systemic issue
- Improvement affects multiple agents
- Conflicting patterns detected

---

*Spec: [../specs/learning-system.md](../specs/learning-system.md)*
*Index: [./AGENTS.md](./AGENTS.md)*
