# Learning System Specification

> Defines how Ralph learns and improves over time.

## Learning Philosophy

Ralph learns by observing patterns in its own execution. Learning is:
1. **Passive** — automatically recorded during execution
2. **Cumulative** — stored in append-only logs
3. **Actionable** — produces concrete improvements
4. **Human-reviewed** — improvements proposed, not forced

## What Ralph Learns

### 1. Task Patterns

| Pattern | Example | Action |
|---------|---------|--------|
| Estimation accuracy | Tasks estimated 2h take 4h | Adjust estimates |
| Task clustering | "API" tasks often spawn "test" tasks | Suggest related tasks |
| Blocking patterns | Auth tasks block many others | Prioritize early |
| Complexity signals | Files with "legacy" take longer | Flag in discovery |

### 2. Codebase Patterns

| Pattern | Example | Action |
|---------|---------|--------|
| Bug hotspots | `src/payments/` has 40% of bugs | Flag for review |
| Test gaps | `utils/` has low coverage | Suggest test tasks |
| Churn areas | `config.ts` changes every sprint | Note instability |
| Coupling | Changes to A require changes to B | Track dependencies |

### 3. Agent Patterns

| Pattern | Example | Action |
|---------|---------|--------|
| Loop iterations | Average 3 iterations per task | Baseline for anomaly |
| Failure modes | Parsing fails on nested lists | Improve parser |
| Success patterns | Smaller tasks complete faster | Recommend splitting |

## Storage

### learning.jsonl

```jsonl
{"type":"task_completed","taskId":"RALPH-001","estimate":2,"actual":4,"iterations":3,"timestamp":"..."}
{"type":"pattern_detected","pattern":"estimation_drift","data":{"factor":2.1},"timestamp":"..."}
{"type":"improvement_proposed","target":"AGENTS.md","change":"Add estimation multiplier","status":"pending","timestamp":"..."}
```

### Event Types

```typescript
type LearningEvent =
  | TaskCompletedEvent
  | PatternDetectedEvent
  | ImprovementProposedEvent
  | ImprovementAppliedEvent
  | AnomalyDetectedEvent
```

### Task Completed Event

```typescript
interface TaskCompletedEvent {
  type: 'task_completed';
  taskId: string;

  // Metrics
  estimate?: number;
  actual: number;
  iterations: number;

  // Context
  taskType: TaskType;
  complexity?: Complexity;
  filesChanged: number;
  linesChanged: number;

  // Outcome
  success: boolean;
  blockers?: string[];

  timestamp: string;
}
```

### Pattern Detected Event

```typescript
interface PatternDetectedEvent {
  type: 'pattern_detected';
  pattern: PatternType;
  confidence: number;      // 0-1

  data: Record<string, any>;
  evidence: string[];      // Task IDs or file paths

  timestamp: string;
}

type PatternType =
  | 'estimation_drift'
  | 'task_clustering'
  | 'blocking_chain'
  | 'complexity_signal'
  | 'bug_hotspot'
  | 'test_gap'
  | 'high_churn'
  | 'coupling'
  | 'iteration_anomaly'
  | 'failure_mode';
```

### Improvement Proposed Event

```typescript
interface ImprovementProposedEvent {
  type: 'improvement_proposed';

  target: string;          // File to modify
  section?: string;        // Section within file
  change: string;          // Description of change
  diff?: string;           // Actual diff if available

  rationale: string;       // Why this improvement
  evidence: string[];      // Supporting data

  status: 'pending' | 'approved' | 'rejected' | 'applied';

  timestamp: string;
}
```

## Pattern Detection

### Minimum Sample Size

Patterns require minimum evidence:

| Pattern | Minimum Samples |
|---------|-----------------|
| estimation_drift | 5 completed tasks |
| task_clustering | 3 occurrences |
| bug_hotspot | 3 bugs in same area |
| high_churn | 5 changes to same file |

### Confidence Calculation

```typescript
function calculateConfidence(samples: number, threshold: number, strength: number): number {
  const sampleConfidence = Math.min(samples / threshold, 1);
  const strengthConfidence = strength;
  return sampleConfidence * strengthConfidence;
}
```

Improvements proposed only when confidence > 0.7.

## Improvement Pipeline

```
Pattern Detected (confidence > 0.7)
        ↓
Improvement Proposed
        ↓
Human Review (or auto-apply if configured)
        ↓
Applied → Update target file
        ↓
Improvement Applied Event logged
```

## Self-Improvement Targets

Ralph can propose improvements to:

| Target | Example Improvement |
|--------|---------------------|
| AGENTS.md | Add new convention based on observed pattern |
| agents/*.md | Refine agent instructions based on failure modes |
| specs/*.md | Clarify ambiguous spec based on parsing errors |
| skills/*.ts | Optimize code based on performance patterns |

## Improvement Application

When applying an improvement:

1. Create branch: `ralph/learn-{timestamp}`
2. Apply change
3. Commit with message: `RALPH-LEARN: {description}`
4. If auto-apply disabled: create PR for human review
5. Log ImprovementAppliedEvent

## Metrics Dashboard

Ralph can generate a learning summary:

```markdown
## Learning Summary (Last 30 days)

### Task Metrics
- Tasks completed: 47
- Average iterations: 2.3
- Estimation accuracy: 78%

### Patterns Detected
- estimation_drift: 1.8x multiplier needed
- bug_hotspot: src/payments/ (5 bugs)
- test_gap: utils/ (32% coverage)

### Improvements Applied
- 3 approved, 1 rejected

### Anomalies
- RALPH-042 took 12 iterations (expected 3)
```

## Privacy & Security

- Learning data stays in repository
- No external telemetry
- Sensitive data (credentials, PII) never logged
- Learning can be disabled via config

## Configuration

```json
{
  "learning": {
    "enabled": true,
    "autoApplyImprovements": false,
    "minConfidence": 0.7,
    "retentionDays": 90
  }
}
```

---

*Referenced by: [AGENTS.md](../AGENTS.md), [agents/learner.md](../agents/learner.md)*
