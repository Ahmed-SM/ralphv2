# Loop Mechanics Specification

> Defines the Ralph-loop execution model.

## Core Principle

Ralph operates in a **single-task loop**: pick one task, iterate until complete, then next. This is the "Ralph Wiggum loop" — simple, persistent, effective.

## The Loop

```
┌─────────────────────────────────────────────────────────┐
│                     RALPH LOOP                          │
│                                                         │
│  ┌─────────────┐                                        │
│  │ Read Index  │ ← AGENTS.md, implementation-plan.md    │
│  └──────┬──────┘                                        │
│         ↓                                               │
│  ┌─────────────┐                                        │
│  │ Pick Task   │ ← One task from tasks.jsonl            │
│  └──────┬──────┘                                        │
│         ↓                                               │
│  ┌─────────────────────────────────────────────┐        │
│  │              TASK LOOP                       │       │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │        │
│  │  │ Execute │→ │ Observe │→ │ Complete?   │  │        │
│  │  └─────────┘  └─────────┘  └──────┬──────┘  │        │
│  │       ↑                       no  │  yes    │        │
│  │       └───────────────────────────┘   │     │        │
│  └───────────────────────────────────────┼─────┘        │
│         ↓                                │              │
│  ┌─────────────┐                        ↓               │
│  │ Commit      │ ← Git commit with task ID              │
│  └──────┬──────┘                                        │
│         ↓                                               │
│  ┌─────────────┐                                        │
│  │ Sync        │ ← Update tracker                       │
│  └──────┬──────┘                                        │
│         ↓                                               │
│  ┌─────────────┐                                        │
│  │ Learn       │ ← Record to learning.jsonl             │
│  └──────┬──────┘                                        │
│         ↓                                               │
│      (next task)                                        │
└─────────────────────────────────────────────────────────┘
```

## Execution Environment

Ralph executes in a **just-bash sandbox**:

```typescript
interface Sandbox {
  // Virtual filesystem (OverlayFS)
  fs: VirtualFS;

  // Sandboxed bash execution
  bash(command: string): Promise<BashResult>;

  // TypeScript interpreter
  eval(code: string): Promise<any>;

  // Git operations (real, not sandboxed)
  git: GitOperations;
}
```

### Why Sandbox?

1. **Safety** — Can't damage host system
2. **Reproducibility** — Same environment every run
3. **Rollback** — Discard failed attempts
4. **Observation** — See exactly what changed

## Task Selection

### Priority Order

1. **Blocked tasks** are skipped
2. **In-progress tasks** resume first
3. **Highest priority** pending task
4. **Oldest** if same priority

### Selection Algorithm

```typescript
function pickTask(tasks: Task[]): Task | null {
  const candidates = tasks
    .filter((t) => t.status === "pending" || t.status === "in_progress")
    .filter((t) => !isBlocked(t))
    .sort((a, b) => {
      // In-progress first
      if (a.status === "in_progress") return -1;
      if (b.status === "in_progress") return 1;
      // Then by priority (if exists)
      if (a.priority !== b.priority) return b.priority - a.priority;
      // Then by creation time
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

  return candidates[0] ?? null;
}
```

## Task Execution

### Iteration Lifecycle

```typescript
interface Iteration {
  number: number;

  // Input
  taskState: TaskState;
  filesystemState: FilesystemSnapshot;

  // Execution
  actions: Action[];

  // Output
  result: IterationResult;
  filesystemDelta: FileChange[];
}
```

### Actions

Ralph can take these actions:

| Action  | Description           |
| ------- | --------------------- |
| `read`  | Read file content     |
| `write` | Write/modify file     |
| `bash`  | Execute shell command |
| `git`   | Git operation         |
| `eval`  | Run TypeScript        |

### Iteration Result

```typescript
type IterationResult =
  | { status: "continue"; reason: string }
  | { status: "complete"; artifacts: string[] }
  | { status: "blocked"; blocker: string }
  | { status: "failed"; error: string };
```

## Completion Detection

A task is complete when:

### 1. Explicit Completion

Agent declares done:

```typescript
return { status: "complete", artifacts: ["path/to/output.ts"] };
```

### 2. Test Passing

If task has associated tests:

```bash
npm test -- --grep "RALPH-001"
# Exit 0 = complete
```

### 3. Artifact Exists

If task specifies expected output:

```json
{
  "completion": {
    "type": "file_exists",
    "path": "./specs/task-schema.md"
  }
}
```

### 4. Validation Function

Custom validation:

```typescript
{
  "completion": {
    "type": "validate",
    "script": "./skills/validate-task-001.ts"
  }
}
```

## Loop Termination

### Per-Task Limits

| Limit          | Default | Configurable |
| -------------- | ------- | ------------ |
| Max iterations | 10      | Yes          |
| Max time       | 30 min  | Yes          |
| Max cost       | $5      | Yes          |

### Global Limits

| Limit             | Default | Configurable |
| ----------------- | ------- | ------------ |
| Max tasks per run | 50      | Yes          |
| Max total time    | 4 hours | Yes          |
| Max total cost    | $50     | Yes          |

### On Limit Reached

1. Log failure to progress.jsonl
2. Mark task as `blocked` with reason
3. Notify human (if configured)
4. Move to next task

## State Persistence

### Between Iterations

State persists in filesystem:

- Work in progress files
- Temporary artifacts
- Execution logs

### Between Tasks

State commits to git:

- Completed artifacts
- Updated tasks.jsonl
- Learning data

### Between Runs

Full state in git:

- All of the above
- Can resume from any commit

## Rollback

If iteration fails:

1. Discard filesystem changes (OverlayFS)
2. Log failure
3. Retry with adjusted approach

If task fails after max iterations:

1. Rollback to last good commit
2. Mark task as `blocked`
3. Preserve failure logs for learning

## Concurrency

### Default: Sequential

One task at a time. Simple, predictable, debuggable.

### Future: Parallel

Multiple independent tasks in parallel:

- Only if no dependencies
- Separate sandboxes
- Merge results

## Configuration

```json
{
  "loop": {
    "maxIterationsPerTask": 10,
    "maxTimePerTask": 1800,
    "maxCostPerTask": 5,
    "maxTasksPerRun": 50,
    "maxTimePerRun": 14400,
    "maxCostPerRun": 50,
    "onFailure": "continue",
    "parallelism": 1
  }
}
```

## Observability

### Real-time

- Current task
- Current iteration
- Recent actions
- Resource usage

### Logs

- progress.jsonl: Execution history
- learning.jsonl: Patterns and metrics

### Hooks

```typescript
interface LoopHooks {
  onTaskStart?(task: Task): void;
  onIterationStart?(task: Task, iteration: number): void;
  onAction?(action: Action): void;
  onIterationEnd?(task: Task, iteration: number, result: IterationResult): void;
  onTaskEnd?(task: Task, success: boolean): void;
  onAnomaly?(anomaly: Anomaly): void;
}
```

---

_Referenced by: [AGENTS.md](../AGENTS.md), [runtime/loop.ts](../runtime/loop.ts)_
