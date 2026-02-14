# Ralph — Agentic Delivery OS

> A self-evolving system that reads specs, extracts tasks, syncs with trackers, watches git, and learns over time.

## Philosophy

Ralph follows these core principles:

1. **Markdown is the source of truth** — Specs, plans, and agent instructions are markdown files
2. **Index-based context** — Agents read indices and lookup only what's needed
3. **Filesystem is state** — Everything persists as files, git is memory
4. **One task at a time** — Pick one task, loop until complete, then next (Ralph-loop)
5. **Self-hosting** — Ralph's own development follows Ralph's rules
6. **Human on the loop** — Autonomous execution, human observes and intervenes on anomalies

## Quick Start

```bash
# Install dependencies
npm install

# Run Ralph
npm run ralph

# Or with options
npm run ralph -- --dry-run
npm run ralph -- --task RALPH-001
```

## Structure

```
ralph/
├── AGENTS.md                 # Master index - THE source of truth
├── implementation-plan.md    # Current work plan with task citations
├── ralph.config.json         # Runtime configuration
│
├── specs/                    # Specifications
│   ├── task-schema.md
│   ├── tracker-integration.md
│   ├── learning-system.md
│   └── loop-mechanics.md
│
├── agents/                   # Agent instructions
│   ├── AGENTS.md            # Agent index
│   ├── task-discovery.md
│   ├── tracker-sync.md
│   ├── git-watcher.md
│   └── learner.md
│
├── integrations/             # Tracker integrations
│   ├── AGENTS.md
│   ├── jira/
│   ├── github-issues/
│   └── linear/
│
├── state/                    # Runtime state (git-tracked)
│   ├── tasks.jsonl          # Discovered tasks
│   ├── progress.jsonl       # Execution history
│   └── learning.jsonl       # Patterns and metrics
│
├── skills/                   # Executable TypeScript modules
│   ├── discovery/
│   ├── normalize/
│   └── track/
│
├── runtime/                  # Execution engine
│   ├── executor.ts          # Just-bash wrapper
│   ├── loop.ts              # Main loop
│   └── index.ts             # Entry point
│
└── types/                    # TypeScript definitions
    └── index.ts
```

## How It Works

### The Ralph Loop

```
1. Read AGENTS.md (master index)
2. Read implementation-plan.md (current plan)
3. Pick ONE unfinished task
4. Loop until task complete:
   a. Execute task actions
   b. Observe filesystem/git state
   c. If not complete → iterate
   d. If complete → commit to git
5. Update tracker (Jira, etc.)
6. Record learning metrics
7. Next task
```

### Task Discovery

Ralph reads markdown files and extracts tasks:

```markdown
- [ ] Task description → becomes a task
- [x] Done task → marked as complete
### Phase 1 → becomes an epic
```

### Tracker Sync

Tasks are pushed to configured trackers:

```
tasks.jsonl → Jira issues
             → GitHub issues
             → Linear issues
```

### Learning

Ralph observes its own execution and proposes improvements:

- Estimation accuracy
- Bug hotspots
- Test gaps
- Failure modes

## Configuration

See `ralph.config.json`:

```json
{
  "planFile": "./implementation-plan.md",
  "agentsFile": "./AGENTS.md",
  "loop": {
    "maxIterationsPerTask": 10,
    "maxTasksPerRun": 50
  },
  "tracker": {
    "type": "jira",
    "autoCreate": false
  },
  "learning": {
    "enabled": true,
    "autoApplyImprovements": false
  }
}
```

## Development

```bash
# Build
npm run build

# Type check
npm run typecheck

# Test
npm test

# Dev mode (watch)
npm run dev
```

## Current Status

- ✅ Phase 1: Foundation (complete)
- ✅ Phase 2: Task Discovery (complete)
- ✅ Phase 3: Tracker Sync (complete)
- ✅ Phase 4: Git Watcher (complete)
- ✅ Phase 5: Learning Layer (complete)
- ✅ Phase 6: Just-Bash Integration (complete)

## References

- [AGENTS.md](./AGENTS.md) — Master index
- [implementation-plan.md](./implementation-plan.md) — Current work
- [Vercel: AGENTS.md](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
- [Vercel: Self-driving infrastructure](https://vercel.com/blog/self-driving-infrastructure)
- [Vercel: Agents with filesystems and bash](https://vercel.com/blog/how-to-build-agents-with-filesystems-and-bash)
- [just-bash](https://github.com/vercel-labs/just-bash)

---

*Ralph is self-hosting: this project is managed by Ralph itself.*
