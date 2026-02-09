# Task Schema Specification

> Defines the structure and lifecycle of tasks in Ralph.

## Task Structure

```typescript
interface Task {
  // Identity
  id: string;              // e.g., "RALPH-001"
  externalId?: string;     // e.g., "PA-123" (Jira key)

  // Classification
  type: TaskType;
  aggregate?: string;      // Domain aggregate (e.g., "Order", "User")
  domain?: string;         // Bounded context

  // Content
  title: string;
  description: string;
  spec?: string;           // Path to source spec (e.g., "./specs/task-schema.md")
  source?: SourceInfo;     // Where this task was discovered

  // Hierarchy
  parent?: string;         // Parent task ID
  subtasks?: string[];     // Child task IDs
  blocks?: string[];       // Tasks this blocks
  blockedBy?: string[];    // Tasks blocking this

  // State
  status: TaskStatus;
  assignee?: string;       // Agent or human

  // Tracking
  createdAt: string;       // ISO timestamp
  updatedAt: string;
  completedAt?: string;

  // Learning
  estimate?: number;       // Estimated effort (arbitrary units)
  actual?: number;         // Actual effort
  complexity?: Complexity;
  tags?: string[];
}
```

## Task Types

```typescript
type TaskType =
  | 'epic'        // Large initiative
  | 'feature'     // User-facing capability
  | 'task'        // Implementation work
  | 'subtask'     // Granular step
  | 'bug'         // Defect fix
  | 'refactor'    // Technical improvement
  | 'docs'        // Documentation
  | 'test'        // Test coverage
  | 'spike'       // Research/investigation
```

## Task Status

```typescript
type TaskStatus =
  | 'discovered'   // Extracted from spec, not yet validated
  | 'pending'      // Ready to work
  | 'in_progress'  // Being worked on
  | 'blocked'      // Waiting on dependency
  | 'review'       // Needs human review
  | 'done'         // Completed
  | 'cancelled'    // Abandoned
```

## Lifecycle

```
discovered → pending → in_progress → done
                ↓           ↓
             blocked     review
                ↓           ↓
             pending      done/cancelled
```

## Source Info

```typescript
interface SourceInfo {
  type: 'spec' | 'commit' | 'pr' | 'manual' | 'inferred';
  path?: string;      // File path
  line?: number;      // Line number
  sha?: string;       // Git commit
  timestamp: string;
}
```

## Storage Format

Tasks are stored in `state/tasks.jsonl` as append-only log:

```jsonl
{"op":"create","task":{"id":"RALPH-001",...},"timestamp":"..."}
{"op":"update","id":"RALPH-001","changes":{"status":"in_progress"},"timestamp":"..."}
{"op":"update","id":"RALPH-001","changes":{"status":"done"},"timestamp":"..."}
```

### Operations

| Op | Purpose |
|----|---------|
| `create` | New task discovered |
| `update` | Task modified |
| `link` | External ID assigned (e.g., Jira) |
| `relate` | Dependency added |

## Deriving Current State

To get current state, replay the log:

```typescript
function deriveState(log: TaskOp[]): Map<string, Task> {
  const tasks = new Map();
  for (const op of log) {
    switch (op.op) {
      case 'create':
        tasks.set(op.task.id, op.task);
        break;
      case 'update':
        const task = tasks.get(op.id);
        Object.assign(task, op.changes);
        task.updatedAt = op.timestamp;
        break;
      // ... etc
    }
  }
  return tasks;
}
```

## ID Generation

```
RALPH-{sequential number, zero-padded to 3 digits}
```

Examples: `RALPH-001`, `RALPH-042`, `RALPH-100`

## Validation Rules

1. `id` must be unique
2. `parent` must exist if specified
3. `blockedBy` tasks must exist
4. `status` transitions must follow lifecycle
5. `completedAt` required when `status` is `done`

## Example Task

```json
{
  "id": "RALPH-001",
  "type": "task",
  "title": "Write task schema specification",
  "description": "Define the structure and lifecycle of tasks in Ralph",
  "spec": "./specs/task-schema.md",
  "source": {
    "type": "spec",
    "path": "./implementation-plan.md",
    "line": 15
  },
  "status": "done",
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T12:00:00Z",
  "completedAt": "2024-01-15T12:00:00Z",
  "tags": ["phase-1", "foundation"]
}
```

---

*Referenced by: [AGENTS.md](../AGENTS.md), [agents/task-discovery.md](../agents/task-discovery.md)*
