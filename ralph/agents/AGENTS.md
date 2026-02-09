# Agents Index

> This file indexes all Ralph agents. Each agent has specific responsibilities and instructions.

## Agent Philosophy

Agents are **specialized workers**. Each agent:
1. Has a single responsibility
2. Reads only what it needs (index-based)
3. Produces artifacts (files, state changes)
4. Commits work to git
5. Can be improved by the learner

## Available Agents

| Agent | Responsibility | Instructions |
|-------|----------------|--------------|
| task-discovery | Extract tasks from markdown | [task-discovery.md](./task-discovery.md) |
| tracker-sync | Sync tasks with external trackers | [tracker-sync.md](./tracker-sync.md) |
| git-watcher | Monitor git for task progress | [git-watcher.md](./git-watcher.md) |
| learner | Detect patterns, propose improvements | [learner.md](./learner.md) |

## Agent Invocation

Agents are invoked by the loop runner:

```typescript
// In runtime/loop.ts
async function invokeAgent(agent: string, context: Context): Promise<Result> {
  const instructions = await readFile(`./agents/${agent}.md`);
  // ... execute in sandbox
}
```

## Agent Context

Each agent receives:

```typescript
interface AgentContext {
  // What to work on
  task?: Task;              // Current task (if task-specific)
  scope?: string;           // Focus area

  // Where to look
  indices: string[];        // Index files to read
  specs: string[];          // Relevant specs

  // Where to write
  outputDir: string;        // Working directory
  stateFile: string;        // State to update

  // Execution
  sandbox: Sandbox;         // just-bash environment
  iteration: number;        // Current loop iteration
}
```

## Agent Output

Agents produce:

```typescript
interface AgentResult {
  status: 'success' | 'partial' | 'failed';

  // Artifacts created
  artifacts: string[];

  // State changes
  stateChanges: StateChange[];

  // For learning
  metrics: Record<string, number>;

  // If more work needed
  continuation?: {
    reason: string;
    nextAction: string;
  };
}
```

## Adding New Agents

1. Create `agents/{name}.md` with instructions
2. Add to this index
3. Implement in `skills/{category}/`
4. Test with single-task loop
5. Document in AGENTS.md

## Agent Quality

Good agent instructions:
- Are self-contained (agent can work without context)
- Reference specs by path (not inline content)
- Define clear inputs and outputs
- Include examples
- Handle edge cases
- Specify when to escalate to human

---

*Master index: [../AGENTS.md](../AGENTS.md)*
