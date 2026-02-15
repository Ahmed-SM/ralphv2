# Ralph — Agentic Delivery OS

> A self-evolving agentic delivery system for all kinds of software projects that reads specs, extracts tasks, syncs with trackers, watches git, and learns over time with human-on-the-loop governance.

## Philosophy

Ralph follows these core principles:

1. **Markdown is the source of truth** — Specs, plans, and agent instructions are markdown files
2. **Index-based context** — Agents read indices and lookup only what's needed
3. **Filesystem is state** — Everything persists as files, git is memory
4. **One task at a time** — Pick one task, loop until complete, then next (Ralph-loop)
5. **Self-hosting** — Ralph's own development follows Ralph's rules
6. **Human on the loop** — Autonomous execution, human observes and intervenes on anomalies

## Operating Modes

Ralph uses two explicit modes:

- `Ralph-Core` (self-evolving mode)
  - Improves Ralph itself (platform/runtime/spec workflow).
  - Uses stricter review for platform-affecting behavior changes.
- `Ralph-Delivery` (project delivery mode)
  - Delivers features/fixes/migrations across different project types and stacks.
  - Keeps human-on-the-loop approval gates for destructive, dependency, and production-impacting changes.

## Quick Start

```bash
# Install dependencies
npm install

# Run Ralph loop
npm run ralph

# Run with options
npm run ralph -- --dry-run
npm run ralph -- --task RALPH-001

# Other CLI commands
npm run ralph -- status
npm run ralph -- dashboard
npm run ralph -- review
npm run ralph -- approve IMPROVE-001
npm run ralph -- reject IMPROVE-001 --reason="not applicable"
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

### New Project Workflow

When Ralph is pointed at a new repository, the workflow is:

1. Onboard with a standard contract (config-only first): `AGENTS.md`, `implementation-plan.md`, `ralph.config.json`, test/build commands, and policy file.
2. Bootstrap baseline specs and task plan: generate/normalize `specs/*.md`, generate `implementation-plan.md`, and populate `state/tasks.jsonl`.
3. Require human approval for generated plans/specs before execution (`draft -> pending_review -> approved | rejected -> applied`).
4. Execute one task at a time in sandbox: run task actions, then run test/build/policy checks.
5. Apply safety behavior by default:
   - failing checks trigger rollback
   - retries/blocked flow is applied per config
   - mandatory approval gates apply to destructive or production-impacting changes
6. Progress autonomy with templates:
   - reusable task patterns: bugfix, feature, migration, test hardening
   - L2: auto-commit on green
   - L3: auto-PR with policy gates
   - promotion only after KPI thresholds pass for consecutive runs
7. Keep a drift-aware maintenance loop: detect spec/plan drift, propose updates, and log rationale in learning state.

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

# Module CLIs (legacy/direct)
npm run discover
npm run sync
npm run watch
npm run learn
```

## Current Status

- ✅ Ralph v1 MVP complete
- ✅ Phases 1-42 complete (foundation through improvement review CLI)
- ✅ Test suite: 1582 tests across 36 test files
- ✅ CLI commands available: `run`, `discover`, `sync`, `status`, `learn`, `dashboard`, `review`, `approve`, `reject`
- 🟡 Phase 43 planned: Inductive External Delivery OS
- ⏳ Remaining live validation: Jira credentials, external-system induction pilots
- ⏳ Additional production-readiness priorities tracked in `implementation-plan.md`:
  - Project Adapter Contract (config-only onboarding)
  - Hard safety rails before autonomy increase
  - Standardized delivery workflow templates

## References

- [AGENTS.md](./AGENTS.md) — Master index
- [implementation-plan.md](./implementation-plan.md) — Current work
- [Vercel: AGENTS.md](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
- [Vercel: Self-driving infrastructure](https://vercel.com/blog/self-driving-infrastructure)
- [Vercel: Agents with filesystems and bash](https://vercel.com/blog/how-to-build-agents-with-filesystems-and-bash)
- [just-bash](https://github.com/vercel-labs/just-bash)

---

_Ralph is self-hosting: this project is managed by Ralph itself._
