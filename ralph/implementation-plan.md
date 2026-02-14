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

### Tracker Sync in Main Loop (Phase 19) ✅ COMPLETE
- [x] Implemented `syncTaskToTracker()` in runtime/loop.ts — syncs completed/failed tasks to external tracker
- [x] Implemented `getTrackerAuth()` — reads tracker credentials from RALPH_ or plain env vars
- [x] Implemented `loadTrackerAdapter()` — dynamically loads adapter modules for side-effect registration
- [x] Wired tracker sync into `runLoop()` step 7 (was a TODO placeholder)
- [x] Handles autoCreate (creates issues for unlinked tasks), autoTransition (transitions linked issues), autoComment (adds completion/failure comments)
- [x] Graceful error handling — tracker failures are logged but never crash the loop
- [x] Records link operations in tasks.jsonl when new issues are created
- [x] Exported `syncTaskToTracker` and `getTrackerAuth` from runtime/index.ts
- [x] getTrackerAuth — 6 tests (missing creds, RALPH_ prefix, fallback env vars, hyphen→underscore, linear type, token-only auth)
- [x] syncTaskToTracker — 16 tests (skip when flags disabled, skip on missing creds, create issue, record link op, transition issue, success comment, failure comment, no-create without flag, no-transition without flag, no-comment without flag, error resilience, error logging, missing config file, unmapped status, combined transition+comment, non-Error thrown objects)
- [x] Total: 22 new tests (836 total across 27 test files)

### LLM Integration (Phase 20) ✅ COMPLETE
- [x] Added LLM types to types/index.ts (LLMProvider, LLMMessage, LLMResponse, LLMToolCall, LLMTool, LLMConfig)
- [x] Created runtime/llm.ts — LLM provider abstraction, prompt builder, tool definitions, action executor, response interpreter
- [x] AGENT_TOOLS — 5 sandbox tools (read_file, write_file, run_bash, task_complete, task_blocked)
- [x] buildSystemPrompt — System prompt establishing Ralph agent identity and rules
- [x] buildIterationPrompt — Context-aware prompt from task, spec, agent instructions, previous results
- [x] executeToolCall — Executes LLM tool calls against sandbox (read/write/bash/complete/blocked)
- [x] interpretResponse — Maps LLM response + tool calls to IterationResult (complete/blocked/failed/continue)
- [x] executeLLMIteration — Full iteration pipeline: prompt → LLM → tool execution → result interpretation
- [x] createLLMProvider — Factory with injectable provider (no vendor lock-in)
- [x] loadTaskContext — Loads spec content and agent instructions for a task
- [x] Updated executeIteration in loop.ts — Uses LLM when context.llmProvider is set, falls back to heuristic
- [x] Added llmProvider to LoopContext interface
- [x] Added optional llm config to RuntimeConfig
- [x] Exported LLM functions from runtime/index.ts
- [x] Unit tests — 72 tests → [runtime/llm.test.ts](./runtime/llm.test.ts)
  - AGENT_TOOLS — 7 tests (tool count, individual tool definitions, descriptions)
  - buildSystemPrompt — 5 tests (non-empty, identity, sandbox, completion/blocked mentions)
  - buildIterationPrompt — 10 tests (task ID/title, iteration, status/type, description, spec, agent instructions, previous result, tags, omission of optional sections, action instruction)
  - executeToolCall — 13 tests (read success/error/duration, write success/error, bash success/failure/empty/error, task_complete/empty, task_blocked/missing, unknown tool)
  - interpretResponse — 11 tests (complete, blocked, error, stop-no-actions, length, continue-with-tools, priority-complete, priority-blocked, default-reason, default-error, missing-artifacts)
  - executeLLMIteration — 8 tests (message construction, spec inclusion, tool execution, continue, blocked, conversation history, empty actions, write/bash execution)
  - createLLMProvider — 5 tests (undefined config, disabled, no factory, with factory, disabled-no-factory-call)
  - loadTaskContext — 8 tests (spec loading, missing spec, no spec field, agent instructions by type, missing agent file, epic type, both spec+agent)
  - executeIteration integration — 3 tests (LLM path, heuristic fallback, LLM error handling)
- [x] Total: 72 new tests (908 total across 28 test files)

### Concrete LLM API Clients (Phase 21) ✅ COMPLETE
- [x] Implement AnthropicProvider → [runtime/llm-providers.ts](./runtime/llm-providers.ts)
  - Anthropic Messages API integration (POST /v1/messages)
  - System prompt extraction (top-level `system` field, not in messages)
  - Tool conversion (`parameters` → `input_schema`)
  - Response parsing (text + tool_use content blocks)
  - Stop reason mapping (end_turn→stop, tool_use→tool_calls, max_tokens→length)
  - Custom base URL support
- [x] Implement OpenAIProvider → [runtime/llm-providers.ts](./runtime/llm-providers.ts)
  - OpenAI Chat Completions API integration (POST /v1/chat/completions)
  - Tool wrapping ({ type: 'function', function: { ... } })
  - Response parsing (choices[0].message with tool_calls)
  - JSON argument parsing with malformed-JSON resilience
  - Finish reason mapping (content_filter→error)
  - Custom base URL support
- [x] Implement createProvider factory — routes by provider type, resolves API keys from env
- [x] Implement resolveApiKey — ANTHROPIC_API_KEY / OPENAI_API_KEY env var fallback
- [x] Wire createDefaultLLMProvider into llm.ts — async dynamic import for ESM compatibility
- [x] Wire LLM provider into runLoop — auto-initializes from config.llm
- [x] Native fetch (Node 20+) — zero external SDK dependencies
- [x] Injectable fetchFn for testability — no real HTTP calls in tests
- [x] Exported from runtime/index.ts
- [x] Unit tests — 77 tests → [runtime/llm-providers.test.ts](./runtime/llm-providers.test.ts)
  - formatAnthropicMessages — 5 tests (system extraction, concatenation, no system, order, empty)
  - formatAnthropicTools — 3 tests (input_schema conversion, empty, field preservation)
  - parseAnthropicResponse — 7 tests (text, tool_use, multiple tools, empty, max_tokens, missing input, text concatenation)
  - mapAnthropicStopReason — 6 tests (end_turn, stop_sequence, tool_use, max_tokens, null, unknown)
  - AnthropicProvider — 12 tests (no key, URLs, headers, body params, system prompt, tools, API error, full response, default model)
  - formatOpenAIMessages — 3 tests (roles, content, empty)
  - formatOpenAITools — 2 tests (function wrapping, empty)
  - parseOpenAIResponse — 8 tests (text, tool_calls, multiple, empty choices, malformed JSON, null content, length, content_filter)
  - mapOpenAIFinishReason — 6 tests (stop, tool_calls, length, content_filter, null, unknown)
  - OpenAIProvider — 12 tests (no key, URLs, headers, body params, system in messages, tools, API error, full response, default model)
  - resolveApiKey — 6 tests (explicit key, ANTHROPIC env, OPENAI env, custom provider, missing env, no mutation)
  - createProvider — 8 tests (anthropic, openai, custom error, unknown error, fetchFn passthrough, env resolution)
- [x] Total: 77 new tests (985 total across 29 test files)

### Sandbox Rollback on Task Failure (Phase 22) ✅ COMPLETE
- [x] Implemented sandbox rollback in `runLoop()` — calls `executor.rollback()` when a task fails before marking it blocked
- [x] Aligns with loop-mechanics spec: "If iteration fails: Discard filesystem changes (OverlayFS)"
- [x] Prevents failed task changes from polluting sandbox state for subsequent tasks
- [x] Unit tests — 5 tests (rollback on failure, no rollback on success, rollback discards pending changes, success flushes without rollback, failed+successful task isolation)
- [x] Total: 5 new tests (990 total across 29 test files)

### CLI --dry-run and --task Flags (Phase 23) ✅ COMPLETE
- [x] Implemented `--dry-run` flag — skips git commits and tracker sync, logs `[DRY RUN]` prefix
- [x] Implemented `--task=<id>` flag — targets a single task by ID, sets maxTasksPerRun to 1
- [x] Added `dryRun` and `taskFilter` optional fields to `LoopConfig` type
- [x] Updated `pickNextTask()` to accept `taskFilter` parameter — returns targeted task directly, allows picking blocked tasks when explicitly requested
- [x] Updated `runLoop()` — reads dryRun/taskFilter from config, skips git/tracker when dry-run
- [x] Updated CLI `main()` — parses `--dry-run` and `--task=<id>` args, applies overrides to config
- [x] Dry-run still executes task iterations and records learning (only git commits and tracker sync are suppressed)
- [x] Unit tests — 15 tests (5 dry-run: skip git commit, skip tracker sync, still execute iterations, still record learning, default false; 10 taskFilter: pick specific task, no match returns null, done/cancelled returns null, blocked task picked when targeted, in_progress/discovered targeted, normal selection without filter, state derivation before filter, empty tasks returns null)
- [x] Total: 15 new tests (1005 total across 29 test files)

### LLM Cost Tracking & Budget Enforcement (Phase 24) ✅ COMPLETE
- [x] Added `LLMUsage` type (inputTokens, outputTokens) to types/index.ts
- [x] Added `usage?: LLMUsage` to `LLMResponse` — providers now return token counts
- [x] Added `maxCostPerRun` to `LoopConfig` — spec-aligned global cost limit ($50 default)
- [x] Added `costPerInputToken`, `costPerOutputToken` to `LLMConfig` — configurable per-token rates
- [x] Implemented `estimateCost()` — computes USD cost from token usage with configurable rates
- [x] Updated `parseAnthropicResponse()` — extracts usage from Anthropic API response
- [x] Updated `parseOpenAIResponse()` — extracts usage from OpenAI API response
- [x] Updated `executeLLMIteration()` — returns `usage` alongside result and actions
- [x] Updated `executeIteration()` — propagates usage from LLM path
- [x] Updated `executeTaskLoop()` — accumulates per-task cost, enforces `maxCostPerTask` limit
- [x] Updated `executeTaskLoop()` — checks `maxCostPerRun` via `runCostSoFar` parameter
- [x] Updated `runLoop()` — tracks `totalCost` across tasks, stops on run cost limit
- [x] Added `totalCost` to `LoopResult` — observable cost reporting
- [x] Added `cost` and `taskCostSoFar` to progress.jsonl iteration events
- [x] Updated ralph.config.json — added `maxCostPerRun: 50`
- [x] Exported `estimateCost` from runtime/index.ts
- [x] Unit tests — 21 tests (6 estimateCost: undefined/defaults/custom/fallback/zero/large; 6 executeTaskLoop cost: no-LLM/accumulate/task-limit/run-limit/progress-log/heuristic; 3 usage parsing: Anthropic/OpenAI/executeLLMIteration; 3 Anthropic usage: extract/missing/propagate; 3 OpenAI usage: extract/missing/propagate)
- [x] Total: 21 new tests (1026 total across 29 test files)

### CLI Entry Point Refactor (Phase 25) ✅ COMPLETE
- [x] Extracted CLI logic from runtime/index.ts into runtime/cli.ts (testable module)
- [x] Created root cli.ts — shebang entry point for `npx ralph` / `npm install -g ralph`
- [x] package.json bin → dist/cli.js now has a matching source file
- [x] Updated tsconfig.json to include cli.ts in compilation
- [x] runtime/index.ts simplified to library exports + direct-execution fallback
- [x] Dependency injection via CliDeps interface (readFile, writeFile, log, error, importModule, cwd)
- [x] Pure functions: parseArgs, resolveCommand, replayTaskOps, loadConfig
- [x] Command handlers: runMain, runDiscover, runStatus, dispatch
- [x] Unit tests — 60 tests → [runtime/cli.test.ts](./runtime/cli.test.ts)
  - parseArgs — 15 tests (default run, all commands, --help/-h, --dry-run, --task, --config, multiple flags, unknown command)
  - resolveCommand — 7 tests (undefined, empty, --help, -h, flag passthrough, valid commands, unknown)
  - replayTaskOps — 7 tests (empty, create, update status/title, missing task, non-create ops, multiple updates)
  - loadConfig — 3 tests (valid JSON, missing file, invalid JSON)
  - dispatch — 4 tests (help, --help, sync stub, learn stub)
  - runMain — 8 tests (banner, --dry-run, --task, success/failure exit codes, logging)
  - runDiscover — 3 tests (end-to-end, dry-run writeFile, custom planFile)
  - runStatus — 4 tests (counts by status, in-progress display, missing file, update replay)
  - dispatch integration — 4 tests (no args→run, discover, status, flag passthrough)
  - constants — 5 tests (HELP_TEXT commands/options, BANNER content, DEFAULT_CONFIG_PATH)
- [x] Total: 60 new tests (1086 total across 30 test files)

### Loop Hooks / Observability (Phase 26) ✅ COMPLETE
- [x] Added `LoopHooks` interface to types/index.ts (onTaskStart, onIterationStart, onAction, onIterationEnd, onTaskEnd, onAnomaly)
- [x] Added optional `hooks` field to `LoopContext`
- [x] Implemented `invokeHook()` — safe hook invocation with error catching (hook errors are logged, never crash the loop)
- [x] Wired `onTaskStart` into `runLoop()` — fires when a task is picked for processing
- [x] Wired `onTaskEnd` into `runLoop()` — fires after task success/failure handling
- [x] Wired `onIterationStart` into `executeTaskLoop()` — fires before each iteration
- [x] Wired `onIterationEnd` into `executeTaskLoop()` — fires after each iteration with result
- [x] Wired `onAction` into `executeIteration()` — fires for each LLM tool call action
- [x] Wired `onAnomaly` into `runLearningAnalysis()` — fires on iteration_anomaly and failure_mode patterns with severity derived from confidence
- [x] Exported `invokeHook` from runtime/index.ts
- [x] Unit tests — 29 tests → [runtime/loop-hooks.test.ts](./runtime/loop-hooks.test.ts)
  - invokeHook — 11 tests (correct args for all hook types, undefined hooks, undefined specific hook, non-function hook, Error catch+log, non-Error catch, task/iteration/result/anomaly/action argument passing)
  - executeTaskLoop hooks — 5 tests (onIterationStart fires, onIterationEnd fires with result, multi-iteration hook calls, undefined hooks safety, empty hooks safety)
  - executeIteration hooks — 5 tests (onAction with LLM tool calls, no onAction in heuristic path, no onAction when LLM returns no tools, multiple tool calls, hook error doesn't prevent result)
  - LoopContext hooks field — 3 tests (optional, complete hooks, partial hooks)
  - hook error resilience — 3 tests (onIterationStart error, onIterationEnd error, all hooks throwing)
  - LoopHooks interface — 2 tests (all methods optional, any subset)
- [x] Total: 29 new tests (1115 total across 31 test files)

### Task Schema Validation (Phase 27) ✅ COMPLETE
- [x] Implement validate-task.ts → [skills/discovery/validate-task.ts](./skills/discovery/validate-task.ts)
- [x] Status lifecycle transitions (ALLOWED_TRANSITIONS map from spec lifecycle diagram)
- [x] isValidTransition / getAllowedTransitions — lifecycle-aware transition checks
- [x] validateCreate — unique ID, parent exists, blockers exist, completedAt on done
- [x] validateUpdate — task exists, valid transition, completedAt on done, parent/blocker existence
- [x] validateRelate — source and target task existence with relation-aware rule names
- [x] validateOperation — dispatcher for all operation types (create, update, relate, link)
- [x] validateOperationLog — full log replay validation (audit existing tasks.jsonl)
- [x] validateAndAppendTaskOp — validated write to tasks.jsonl (in runtime/loop.ts)
- [x] Wired into updateTaskStatus — validates before appending, advisory mode for resilience
- [x] Exported from runtime/index.ts
- [x] Unit tests — 77 tests → [skills/discovery/validate-task.test.ts](./skills/discovery/validate-task.test.ts)
  - isValidTransition — 16 tests (all valid paths, all invalid paths, terminal states, unknown status)
  - getAllowedTransitions — 5 tests (discovered, pending, done, cancelled, unknown)
  - validateCreate — 12 tests (valid, duplicate ID, missing parent, parent exists, missing blocker, multiple blockers, blockers exist, done without completedAt, done with completedAt, non-done, multiple errors)
  - validateUpdate — 11 tests (valid transition, missing task, early return, invalid transition, same status, done without completedAt, done with completedAt, existing completedAt, missing parent, missing blocker, title-only, error message)
  - validateRelate — 7 tests (both exist, missing source, missing target, both missing, parent rule, blockedBy rule, subtask rule)
  - validateOperation — 5 tests (create dispatch, update dispatch, relate dispatch, link missing, link valid)
  - validateOperationLog — 14 tests (empty, clean log, duplicate ID, invalid transition, missing parent, continues after errors, accumulated state, relate valid, relate invalid, full lifecycle, blocked cycle, review paths, link valid, link invalid)
  - edge cases — 6 tests (empty blockedBy, undefined blockedBy, no changes, operation type, taskId, result shape)
- [x] Total: 77 new tests (1192 total across 32 test files)

Next steps for production readiness:
1. ~~Add LLM integration for intelligent task execution~~ ✅ Done
2. ~~Implement concrete LLM API client (Anthropic/OpenAI HTTP adapter)~~ ✅ Done
3. ~~Sandbox rollback on task failure~~ ✅ Done
4. ~~CLI --dry-run and --task flags~~ ✅ Done
5. ~~LLM cost tracking & budget enforcement~~ ✅ Done
6. ~~CLI entry point refactor (proper bin entry)~~ ✅ Done
7. ~~Loop hooks / observability~~ ✅ Done
8. ~~Task schema validation~~ ✅ Done
9. Live testing with Jira credentials
10. Live testing with actual git repository
11. Live testing with Linear API key

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
