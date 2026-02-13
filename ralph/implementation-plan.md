# Implementation Plan — Ralph v1

> This is the active implementation plan. Agents read this to understand current work.

## Overview

Build Ralph: a self-evolving agentic delivery system that reads specs, extracts tasks, syncs with trackers, watches git, and learns over time.

## Phases

### Phase 1: Foundation ✅ COMPLETE
> Establish self-hosting structure

- [x] Create directory structure
- [x] Write AGENTS.md (master index) → see [AGENTS.md](./AGENTS.md)
- [x] Write implementation-plan.md (this file)
- [x] Write core specs:
  - [x] Task schema → [specs/task-schema.md](./specs/task-schema.md)
  - [x] Tracker integration → [specs/tracker-integration.md](./specs/tracker-integration.md)
  - [x] Learning system → [specs/learning-system.md](./specs/learning-system.md)
  - [x] Loop mechanics → [specs/loop-mechanics.md](./specs/loop-mechanics.md)
- [x] Write agent instructions:
  - [x] Task discovery → [agents/task-discovery.md](./agents/task-discovery.md)
  - [x] Tracker sync → [agents/tracker-sync.md](./agents/tracker-sync.md)
  - [x] Git watcher → [agents/git-watcher.md](./agents/git-watcher.md)
  - [x] Learner → [agents/learner.md](./agents/learner.md)
- [x] Initialize state files
- [x] Create integration stubs
- [x] Create type definitions → [types/index.ts](./types/index.ts)
- [x] Create runtime scaffolding → [runtime/](./runtime/)

### Phase 2: Task Discovery ✅ COMPLETE
> Extract tasks from markdown automatically

- [x] Implement markdown parser → [skills/discovery/parse-markdown.ts](./skills/discovery/parse-markdown.ts)
- [x] Implement task extractor → [skills/discovery/extract-tasks.ts](./skills/discovery/extract-tasks.ts)
- [x] Implement spec citation resolver → [skills/discovery/resolve-citations.ts](./skills/discovery/resolve-citations.ts)
- [x] Test: Ralph extracts tasks from this plan
- [x] Output: tasks.jsonl populated (67 tasks extracted)

### Phase 3: Tracker Sync ✅ COMPLETE
> Push tasks to Jira (and other trackers)

- [x] Implement tracker abstraction → [skills/normalize/tracker-interface.ts](./skills/normalize/tracker-interface.ts)
- [x] Implement Jira adapter → [integrations/jira/adapter.ts](./integrations/jira/adapter.ts)
- [x] Implement issue creator → [skills/normalize/create-issue.ts](./skills/normalize/create-issue.ts)
- [x] Implement status updater → [skills/normalize/update-status.ts](./skills/normalize/update-status.ts)
- [x] Implement sync CLI → [skills/normalize/cli.ts](./skills/normalize/cli.ts)
- [ ] Test with Jira (requires credentials configuration)

### Phase 4: Git Watcher ✅ COMPLETE
> Track commits and update task status

- [x] Implement commit parser → [skills/track/parse-commits.ts](./skills/track/parse-commits.ts)
- [x] Implement task-commit linker → [skills/track/link-commits.ts](./skills/track/link-commits.ts)
- [x] Implement status inferrer → [skills/track/infer-status.ts](./skills/track/infer-status.ts)
- [x] Implement watcher CLI → [skills/track/cli.ts](./skills/track/cli.ts)
- [x] Test: Git watcher runs successfully
- [ ] Test with actual git repo and commits

### Phase 5: Learning Layer ✅ COMPLETE
> Accumulate patterns, improve over time

- [x] Implement metrics recorder → [skills/track/record-metrics.ts](./skills/track/record-metrics.ts)
- [x] Implement pattern detector → [skills/discovery/detect-patterns.ts](./skills/discovery/detect-patterns.ts)
- [x] Implement AGENTS.md improver → [skills/discovery/improve-agents.ts](./skills/discovery/improve-agents.ts)
- [x] Implement learning CLI → [skills/discovery/learn-cli.ts](./skills/discovery/learn-cli.ts)
- [x] Test: Ralph proposes improvement to its own docs
- [x] Output: Self-improving system

### Phase 6: Just-Bash Integration ✅ COMPLETE
> Sandboxed execution environment

- [x] Create runtime executor → [runtime/executor.ts](./runtime/executor.ts)
- [x] Create loop runner → [runtime/loop.ts](./runtime/loop.ts)
- [x] Implement sandbox config → [runtime/sandbox.ts](./runtime/sandbox.ts)
- [x] Integrate sandbox with executor
- [x] Test: Ralph executes in sandbox
- [x] Output: Fully autonomous execution

## Current Task

**Unit Test Suite Added**

Ralph v1 MVP is now functional with:
- Task discovery from markdown specs
- Tracker sync (Jira adapter)
- Git activity watching
- Learning system with pattern detection
- Sandboxed execution environment
- Unit test suite (289 tests across 11 core modules)

### Test Coverage (Phase 7) ✅ COMPLETE
- [x] parse-markdown.ts — 12 tests (parsing, metadata extraction, task list flattening)
- [x] extract-tasks.ts — 19 tests (task extraction, ID generation, type inference, epic parsing)
- [x] parse-commits.ts — 36 tests (git log parsing, task ID extraction, action inference, branch parsing)
- [x] link-commits.ts — 18 tests (commit-task linking, status inference, aggregation, orphan detection)
- [x] infer-status.ts — 25 tests (status inference from git/PR/branch, anomaly detection, batch inference)
- [x] loop.ts (deriveTaskState, isBlocked) — 17 tests (operation replay, task blocking logic)

### Test Coverage (Phase 8) ✅ COMPLETE
- [x] resolve-citations.ts — 20 tests (citation resolution, spec enrichment, path resolution, spec validation)
- [x] detect-patterns.ts — 33 tests (estimation drift, task clustering, blocking chains, bug hotspots, iteration anomalies, velocity trends, bottlenecks, complexity signals, summary building)
- [x] record-metrics.ts — 30 tests (task metric recording, aggregate computation, JSONL persistence, period formatting)

### Bug Fix
- [x] Fixed `extractText` in parse-markdown.ts to handle `inlineCode` nodes (backtick text was silently dropped)

### Exported for Testability
- [x] Exported `deriveTaskState` and `isBlocked` from runtime/loop.ts

### Test Coverage (Phase 9) ✅ COMPLETE
- [x] sandbox.ts — 55 tests (file overlay read/write/delete, pending changes, flush to disk, rollback, reset, path allow/deny, command allow/deny/limits, resource tracking, execution log, caching, env vars)
- [x] executor.ts — 24 tests (createExecutor factory, bash delegation, readFile/writeFile through sandbox, flush/rollback, getPendingChanges, getSandbox, GitOperations: status/add/commit/log/diff/branch/checkout)

Next steps for production readiness:
1. Add LLM integration for intelligent task execution
2. Live testing with Jira credentials
3. Live testing with actual git repository
4. Add more tracker adapters (GitHub Issues, Linear)
5. Integration tests for full discovery and git-watcher pipelines
6. Property-based tests for edge cases in parsing modules
7. Unit tests for remaining modules (normalize/)

## Dependencies

```
Phase 1 (Foundation) ✅
    ↓
Phase 2 (Task Discovery) ✅
    ↓
Phase 3 (Tracker Sync) ✅
    ↓
Phase 4 (Git Watcher) ✅
    ↓
Phase 5 (Learning) ✅
    ↓
Phase 6 (Just-Bash) ✅
```

## Success Criteria

Phase 1 complete: ✅
- [x] All specs written
- [x] All agent instructions written
- [x] State files initialized
- [x] Ralph can read this plan and identify next task

Phase 2 complete: ✅
- [x] Ralph extracts tasks from this file
- [x] tasks.jsonl contains structured tasks
- [x] Tasks have proper hierarchy (phases → tasks → subtasks)

Phase 3 complete: ✅
- [x] Tracker interface defined
- [x] Jira adapter implemented
- [x] Sync CLI operational (preview mode works)
- [ ] Live Jira test (pending credentials)

Phase 4 complete: ✅
- [x] Commit parser extracts task IDs
- [x] Git activity linked to tasks
- [x] Status inference from commits
- [x] Anomaly detection
- [ ] Live git test (pending git repo)

Phase 5 complete: ✅
- [x] Metrics recorded from execution
- [x] Patterns detected in history
- [x] Improvement proposals generated
- [x] Learning CLI operational

Phase 6 complete: ✅
- [x] Sandbox configuration implemented
- [x] File change tracking (overlay behavior)
- [x] Command allowlisting/denylisting
- [x] Resource usage tracking
- [x] Autonomous loop execution tested

---

*Status: All core phases complete - Ralph v1 MVP ready*
*Human review: Required for production deployment*
