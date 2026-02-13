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
- [x] Test with actual git repo and commits → [skills/track/git-watcher-live.integration.test.ts](./skills/track/git-watcher-live.integration.test.ts)

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
- Unit test suite (679 tests across 20 core modules)
- Property-based test suite (79 tests across 4 parsing/state modules)
- Integration test suite (56 tests across 3 pipelines, including live git)

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

### Test Coverage (Phase 10) ✅ COMPLETE
- [x] tracker-interface.ts — 26 tests (taskToIssue mapping, formatDescription, mapStatusToRalph, factory registration/creation)
- [x] create-issue.ts — 16 tests (single/batch issue creation, subtask handling, hierarchy sorting, link operation generation, error handling)
- [x] update-status.ts — 21 tests (status updates, transition matching, push/pull/auto sync, batch sync, operation generation)
- [x] sync.ts — 15 tests (syncToTracker push, syncFromTracker pull, bidirectional sync, filtering, force updates, error recording)

### Property-Based Tests (Phase 11) ✅ COMPLETE
- [x] parse-markdown.ts — 14 property tests (arbitrary string resilience, heading extraction invariants, task checkbox round-trip, parentHeading consistency, flatten monotonicity, link extraction, nested children)
- [x] extract-tasks.ts — 18 property tests (ID format/uniqueness, generateTaskId↔parseTaskId inverse, getNextTaskId correctness, status mapping, type inference, stats invariants, deduplication, epic detection, timestamp propagation)
- [x] parse-commits.ts — 28 property tests (git log parsing resilience, SHA format, shortSha derivation, simple format parsing, task ID extraction/normalization/deduplication/case-insensitivity, custom prefixes, action inference, commit partitioning, branch detection, buildGitLogCommand)
- [x] loop.ts (deriveTaskState, isBlocked) — 19 property tests (event sourcing create/update/link/relate, overwrite semantics, silent ignore of missing tasks, relationship accumulation, replay determinism, last-write-wins ordering, blocking logic with done/cancelled/active/missing blockers, mixed blocker scenarios)

### Unit Tests (Phase 12) ✅ COMPLETE
- [x] improve-agents.ts — 46 tests (generateImprovements for all pattern types: estimation_drift, bug_hotspot, blocking_chain, iteration_anomaly, bottleneck, velocity_trend; metrics-based proposals; summary building; evidence/confidence propagation; saveProposals JSONL persistence; loadPendingProposals filtering; printProposals smoke tests)

### Integration Tests (Phase 13) ✅ COMPLETE
- [x] Discovery pipeline — 16 integration tests (full discoverTasks end-to-end: markdown→parse→extract→resolve→output, RALPH ID assignment, status mapping, operation generation, citation resolution, dry-run/write modes, deduplication across runs, edge cases)
- [x] Git watcher pipeline — 18 integration tests (full watchGitActivity end-to-end: git log→parse→link→infer→output, task reference extraction, commit filtering, status inference, anomaly detection, persistence, custom task prefix, orphan refs, edge cases)

### Live Git Integration Tests (Phase 14) ✅ COMPLETE
- [x] Live git log parsing — 5 tests (parseSimpleGitLog and parseGitLog against real repo output, SHA validation, date ordering, max-count, format cross-validation)
- [x] Live git command building — 2 tests (buildGitLogCommand produces executable commands, since-date filtering against real history)
- [x] Live task ref extraction — 2 tests (extractTaskRefs gracefully handles repos without task IDs, inferAction classifies real commit subjects)
- [x] Live linking and inference — 3 tests (aggregateByTask with seeded tasks from real commits, inferStatuses with real data, detectAnomalies with real data)
- [x] Live watchGitActivity pipeline — 6 tests (full pipeline against real repo, commit structure validation, maxCommits, pre-seeded tasks, dry-run safety, anomaly detection)
- [x] Live branch parsing — 2 tests (current branch, branch listing from real git)
- [x] Live filterNewCommits — 2 tests (progress event filtering with real SHAs, empty progress passthrough)

### GitHub Issues Adapter (Phase 15) ✅ COMPLETE
- [x] Implement GitHubIssuesAdapter → [integrations/github-issues/adapter.ts](./integrations/github-issues/adapter.ts)
- [x] Issue CRUD (create, get, update, find with filters)
- [x] Milestone creation for epics
- [x] Subtask creation via parent references
- [x] Issue linking via comments
- [x] State transitions (open/closed with state_reason)
- [x] Pull request filtering from issue queries
- [x] Dry-run mode support
- [x] Register adapter in tracker factory
- [x] Unit tests — 60 tests (constructor, auth, healthCheck, CRUD, transitions, subtasks, linking, comments, type inference, error handling, registration)

### Linear Adapter (Phase 16) ✅ COMPLETE
- [x] Implement LinearAdapter → [integrations/linear/adapter.ts](./integrations/linear/adapter.ts)
- [x] GraphQL API integration (queries and mutations)
- [x] Issue CRUD (create, get, update, find with filters)
- [x] Project creation for epics (epic → Linear Project)
- [x] Sub-issue creation via parentId
- [x] Issue relation creation (blocks, related, duplicate)
- [x] Workflow state transitions via state resolution
- [x] Label resolution by name
- [x] Comment creation
- [x] Dry-run mode support
- [x] Token and OAuth authentication
- [x] Register adapter in tracker factory
- [x] Unit tests — 70 tests (constructor, auth headers, healthCheck, CRUD, transitions, subtasks, linking, comments, type inference, project mapping, error handling, dry-run, registration)

### Jira Adapter Unit Tests (Phase 17) ✅ COMPLETE
- [x] Unit tests — 77 tests → [integrations/jira/adapter.test.ts](./integrations/jira/adapter.test.ts)
- [x] Constructor (name, baseUrl defaults)
- [x] Auth headers (Basic email:token, Basic username:password, token, OAuth Bearer, Content-Type/Accept)
- [x] healthCheck (healthy, unhealthy on API failure, unhealthy on network error, /myself endpoint)
- [x] connect/disconnect (healthCheck delegation, no-op disconnect)
- [x] createIssue (fields mapping, type mapping, labels, ADF description, parent for subtasks, dry-run)
- [x] getIssue (fetch by key, field mapping, parent/subtasks, assignee, browse URL)
- [x] updateIssue (title, description, labels, assignee, status via transitions, no-op for empty changes)
- [x] findIssues (JQL construction, project/status/type/assignee/updatedSince/query filters, maxResults, AND combination)
- [x] createSubtask (parent key, configured subtask type, project key)
- [x] linkIssues (Blocks, Relates, Duplicate, Parent, is-blocked-by mapping, /issueLink endpoint)
- [x] transitionIssue (match by name, match by target status case-insensitive, warn on no match, GET+POST flow)
- [x] getTransitions (mapped transitions, correct endpoint)
- [x] addComment (ADF format, text content, correct endpoint)
- [x] ADF conversion (multi-paragraph, line break collapse, empty paragraph filtering, nested node extraction, null description)
- [x] Dry-run mode (POST/PUT/link intercepted, GET allowed, console logging)
- [x] API error handling (descriptive errors, response body in message, empty response body)
- [x] Request URL construction (baseUrl + /rest/api/3 prefix)
- [x] Registration (jira factory registered in tracker registry)

### Loop Orchestration Tests (Phase 18) ✅ COMPLETE
- [x] Exported loop internals for testability (pickNextTask, executeTaskLoop, executeIteration, updateTaskStatus, recordTaskCompletion, readJsonl, appendJsonl)
- [x] readJsonl — 7 tests (empty/missing/whitespace files, single/multiple line parsing, blank line skipping, TaskOperation parsing)
- [x] appendJsonl — 3 tests (file creation, append to existing, content preservation)
- [x] pickNextTask — 12 tests (empty/missing/done/cancelled tasks, pending/discovered selection, in_progress priority, oldest-first ordering, blocked task skipping, operation log replay, review/blocked status filtering)
- [x] executeIteration — 6 tests (spec exists → complete, missing spec, discovered tasks, pending tasks, empty spec, no spec field)
- [x] executeTaskLoop — 5 tests (first-iteration completion, max iterations limit, progress event writing, time limit, iteration count)
- [x] updateTaskStatus — 7 tests (update operation appending, completedAt on done, no completedAt on non-done, progress event with reason, no progress without reason, append to existing operations)
- [x] recordTaskCompletion — 5 tests (task_completed event, failure with blockers, undefined blockers, complexity recording, filesChanged/linesChanged defaults)
- [x] Loop orchestration scenarios — 14 tests (multi-task processing, dependency ordering, in_progress resume, all-done detection, status accumulation, learning accumulation, progress logging)
- [x] Total: 59 new tests (814 total across 27 test files)

Next steps for production readiness:
1. Add LLM integration for intelligent task execution
2. Live testing with Jira credentials
3. Live testing with actual git repository
4. Live testing with Linear API key

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
- [x] Live git test (22 integration tests against real repo)

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
