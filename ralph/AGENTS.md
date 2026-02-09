# AGENTS.md — Ralph Agentic Delivery OS

> This file is the master index. All agents read this first.

## Identity

Ralph is a self-evolving agentic delivery system. It reads markdown, extracts tasks, syncs with trackers, watches git, and learns over time.

Ralph governs itself using this file.

## Core Philosophy

1. **Markdown is the source of truth** — specs, plans, and agent instructions are markdown
2. **Index-based context** — read indices, lookup only what's needed, keep context low
3. **Filesystem is state** — everything persists as files, git is memory
4. **One task at a time** — pick one task, loop until complete, then next
5. **Self-hosting** — Ralph's own development follows Ralph's rules
6. **Human on the loop** — autonomous execution, human observes and intervenes on anomalies

## Current Focus

See: [implementation-plan.md](./implementation-plan.md)

## Agent Index

| Agent | Purpose | Instructions |
|-------|---------|--------------|
| task-discovery | Extract tasks from markdown specs | [agents/task-discovery.md](./agents/task-discovery.md) |
| tracker-sync | Create/update issues in trackers | [agents/tracker-sync.md](./agents/tracker-sync.md) |
| git-watcher | Track commits, update task status | [agents/git-watcher.md](./agents/git-watcher.md) |
| learner | Record patterns, improve system | [agents/learner.md](./agents/learner.md) |

## Spec Index

| Spec | Defines |
|------|---------|
| [specs/task-schema.md](./specs/task-schema.md) | Task structure and lifecycle |
| [specs/tracker-integration.md](./specs/tracker-integration.md) | How trackers are abstracted |
| [specs/learning-system.md](./specs/learning-system.md) | How Ralph learns and improves |
| [specs/loop-mechanics.md](./specs/loop-mechanics.md) | The Ralph-loop execution model |

## Integration Index

| Tracker | Status | Config |
|---------|--------|--------|
| Jira | Primary | [integrations/jira/AGENTS.md](./integrations/jira/AGENTS.md) |
| GitHub Issues | Planned | [integrations/github-issues/AGENTS.md](./integrations/github-issues/AGENTS.md) |
| Linear | Planned | [integrations/linear/AGENTS.md](./integrations/linear/AGENTS.md) |

## State Files

| File | Purpose |
|------|---------|
| [state/tasks.jsonl](./state/tasks.jsonl) | Discovered tasks (append-only) |
| [state/progress.jsonl](./state/progress.jsonl) | Execution history |
| [state/learning.jsonl](./state/learning.jsonl) | Accumulated patterns |

## Execution Model

```
loop:
    1. Read this file (AGENTS.md)
    2. Read implementation-plan.md → get current phase
    3. Read cited specs (only what's needed)
    4. Pick ONE unfinished task from state/tasks.jsonl
    5. Execute task:
       a. Load agent instructions (agents/*.md)
       b. Run via just-bash sandbox
       c. Observe results in filesystem
       d. If not complete → iterate
       e. If complete → commit to git
    6. Update tracker (if configured)
    7. Append to state/learning.jsonl
    8. Next task
```

## Conventions

### Task References
Tasks are referenced as `RALPH-{number}` (e.g., `RALPH-001`).

### Commit Messages
```
RALPH-{id}: {action} {subject}

{optional body}
```

### File Naming
- Specs: `kebab-case.md`
- Skills: `kebab-case.ts`
- State: `*.jsonl` (append-only logs)

## Self-Improvement

Ralph may propose changes to this file via:
1. Create branch `ralph/improve-agents-md`
2. Edit with proposed changes
3. Human reviews and merges

---

*Last updated by: human*
*Next update by: Ralph (after Phase 5)*
