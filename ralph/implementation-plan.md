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

**Failure Mode Pattern Detector Implemented**

Ralph v1 MVP is now functional with:
- Task discovery from markdown specs
- Tracker sync (Jira, GitHub Issues, Linear adapters)
- Git activity watching
- Learning system with pattern detection (12 detectors including failure modes)
- Sandboxed execution environment
- Retry mode for failed tasks (onFailure: 'retry' with configurable maxRetries)
- Notification system (console/Slack/email channels)
- Unit test suite (679 tests across 20 core modules)
- Property-based test suite (79 tests across 4 parsing/state modules)
- Integration test suite (56 tests across 3 pipelines, including live git)
- CLI commands: run, discover, sync, status, learn, dashboard

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

### Completion Detection Methods (Phase 28) ✅ COMPLETE
- [x] Added `CompletionCriteria` type to types/index.ts (file_exists, test_passing, validate)
- [x] Added optional `completion` field to `Task` interface
- [x] Implement completion.ts → [runtime/completion.ts](./runtime/completion.ts)
- [x] checkCompletion — top-level dispatcher, returns null when no criteria defined
- [x] checkTestPassing — runs `npm test -- --grep "<id>"` (or custom command), exit 0 = complete
- [x] checkFileExists — checks that expected artifact file exists and is non-empty
- [x] checkValidate — runs custom validation script with RALPH_TASK_ID env var, exit 0 = complete
- [x] createCompletionContext — adapter from Executor to CompletionContext interface
- [x] Wired into executeTaskLoop in loop.ts — checks task.completion after each iteration
- [x] Exported from runtime/index.ts
- [x] Unit tests — 49 tests → [runtime/completion.test.ts](./runtime/completion.test.ts)
  - checkCompletion — 5 tests (null for no criteria, null for undefined, delegates to file_exists/test_passing/validate)
  - checkCriteria — 3 tests (dispatches each criteria type)
  - checkTestPassing — 11 tests (exit 0, default command, custom command, empty grep fallback, exit 1, stderr in reason, stdout fallback, non-zero exit codes, bash error, non-Error throws, truncation)
  - checkFileExists — 5 tests (file exists, file missing, correct path, artifacts on success, no artifacts on failure)
  - checkValidate — 10 tests (exit 0, RALPH_TASK_ID env, exit non-zero, stdout as artifacts, empty stdout, script error, non-Error throws, truncation, stderr in reason, stdout fallback)
  - createCompletionContext — 4 tests (bash passthrough, fileExists true/false/error)
  - integration scenarios — 6 tests (file_exists complete/incomplete, test_passing complete/incomplete, validate complete/incomplete)
  - edge cases — 5 tests (result shape, optional artifacts, custom command ignores grep, empty path, complex script path)
- [x] Total: 49 new tests (1241 total across 33 test files)

### Missing Pattern Detectors (Phase 29) ✅ COMPLETE
- [x] Implement detectTestGaps → [skills/discovery/detect-patterns.ts](./skills/discovery/detect-patterns.ts)
  - Groups tasks by aggregate/domain, computes test-to-total task ratio
  - Detects areas with < 20% test coverage and >= 3 non-test tasks
  - Reports worst coverage area first, includes coverage percentage
  - Confidence scales with sample size
- [x] Implement detectHighChurn → [skills/discovery/detect-patterns.ts](./skills/discovery/detect-patterns.ts)
  - Groups metrics by aggregate/domain, sums filesChanged per area
  - Detects areas with > 1.5x the overall average files-per-task
  - Requires minSamples tasks (default 5) per area
  - Reports total files, task count, and avgFilesPerTask
- [x] Implement detectCoupling → [skills/discovery/detect-patterns.ts](./skills/discovery/detect-patterns.ts)
  - Detects co-change patterns between areas (aggregate, domain, tags)
  - Generates pairs from areas touched by each task
  - Requires >= 3 co-occurrences to trigger
  - Deduplicates tags that match aggregate or domain
  - Reports most coupled pair first
- [x] Wired all 3 detectors into detectPatterns() detector array
- [x] Exported detectTestGaps, detectHighChurn, detectCoupling for direct testing
- [x] Unit tests — 29 tests
  - test_gap — 10 tests (no tests, low ratio, adequate ratio, few tasks, worst first, domain fallback, suggestion, evidence, description, confidence scaling)
  - high_churn — 9 tests (high frequency, few samples, similar areas, no filesChanged, zero filesChanged, domain fallback, avgFilesPerTask, suggestion, confidence scaling)
  - coupling — 10 tests (co-change detection, few co-changes, same area, via tags, most coupled first, suggestion, evidence, no areas, no duplicate tags, confidence scaling)
- [x] Total: 29 new tests (1270 total across 33 test files)

### Git Watcher Loop Integration (Phase 30) ✅ COMPLETE
- [x] Added `GitWatcherConfig` type to types/index.ts (enabled, taskPrefix, minConfidence, maxCommits, detectAnomalies)
- [x] Added optional `gitWatcher` field to `RuntimeConfig`
- [x] Implemented `runGitWatcher()` in runtime/loop.ts — bridges LoopContext to WatchContext, delegates to watchGitActivity
- [x] Wired `runGitWatcher()` into `runLoop()` step 0 (before task selection) — detects external commits that update task status
- [x] Task prefix derived from `git.commitPrefix` when `gitWatcher.taskPrefix` not set
- [x] Dry-run mode propagated from `loop.dryRun`
- [x] Anomaly hooks fired for git watcher anomalies (stale tasks, no activity, long running)
- [x] Graceful error handling — git watcher failures are logged, never crash the loop
- [x] Updated ralph.config.json with gitWatcher section
- [x] Exported `runGitWatcher` from runtime/index.ts
- [x] Unit tests — 20 tests → [runtime/git-watcher-loop.test.ts](./runtime/git-watcher-loop.test.ts)
  - runGitWatcher — 17 tests (disabled config, enabled config, watchGitActivity delegation, taskPrefix from commitPrefix, dryRun passthrough, error resilience, non-Error handling, bash delegation, readFile/writeFile delegation, default config values, stderr+stdout handling, execCommand throws on no stdout, status inference from commits, summary logging, anomaly hook firing, detectAnomalies=false, maxCommits)
  - GitWatcherConfig — 3 tests (optional on RuntimeConfig, all fields, required-only)
- [x] Total: 20 new tests (1290 total across 34 test files)

Next steps for production readiness:
1. ~~Add LLM integration for intelligent task execution~~ ✅ Done
2. ~~Implement concrete LLM API client (Anthropic/OpenAI HTTP adapter)~~ ✅ Done
3. ~~Sandbox rollback on task failure~~ ✅ Done
4. ~~CLI --dry-run and --task flags~~ ✅ Done
5. ~~LLM cost tracking & budget enforcement~~ ✅ Done
6. ~~CLI entry point refactor (proper bin entry)~~ ✅ Done
7. ~~Loop hooks / observability~~ ✅ Done
8. ~~Task schema validation~~ ✅ Done
9. ~~Git watcher integration in main loop~~ ✅ Done
10. ~~Standalone sync CLI command~~ ✅ Done
11. Live testing with Jira credentials
12. Live testing with actual git repository
13. Live testing with Linear API key
14. ~~Standalone learn CLI command~~ ✅ Done
15. ~~Metrics dashboard CLI command~~ ✅ Done

### Standalone Sync CLI Command (Phase 31) ✅ COMPLETE
- [x] Implemented `runSync()` in runtime/cli.ts — standalone `ralph sync` command
- [x] Loads ralph.config.json and tracker config from configPath
- [x] Resolves tracker auth from env via `getTrackerAuth()` (reuses loop.ts function)
- [x] Dynamically imports tracker adapter for factory registration
- [x] Performs bidirectional sync (pull first, then push) via `syncBidirectional()`
- [x] Supports `--dry-run` (no writes, logs mode)
- [x] Supports `--task=<id>` (filters sync to single task via taskIds option)
- [x] Prints structured pull/push summary (processed/created/updated/skipped/errors/duration)
- [x] Returns exit code 1 on errors (missing config, missing creds, sync errors, tracker creation failure)
- [x] Graceful adapter import failure handling (caught, doesn't crash)
- [x] Wired into `dispatch()` (replaces stub)
- [x] Unit tests — 16 tests → [runtime/cli.test.ts](./runtime/cli.test.ts)
  - runSync — 14 tests (header logging, missing tracker config, missing credentials, tracker creation failure, bidirectional success, sync errors exit code, error display, task filter passthrough, dry-run passthrough, auth resolution, tracker creation args, syncBidirectional throws, adapter import failure, summary with durations)
  - dispatch integration — 2 tests (sync via dispatch with creds, sync combined flags)
- [x] Total: 16 new tests (1306 total across 34 test files)

### Standalone Learn CLI Command (Phase 32) ✅ COMPLETE
- [x] Implemented `runLearn()` in runtime/cli.ts — standalone `ralph learn` command
- [x] Loads ralph.config.json and checks `learning.enabled` flag
- [x] Reads `minConfidence` from config (default 0.7)
- [x] Loads and replays task operations from state/tasks.jsonl (create, update, link)
- [x] Filters to completed tasks, computes metrics via `recordTaskMetrics()`
- [x] Computes aggregate metrics for current period via `computeAggregateMetrics()`
- [x] Runs pattern detection via `detectPatterns()` with config-driven minConfidence
- [x] Generates improvement proposals via `generateImprovements()`
- [x] Saves proposals to state/learning.jsonl (unless `--dry-run`)
- [x] Displays pending proposals with ID, title, target, confidence
- [x] Prints learning summary (tasks analyzed, patterns detected, proposals created, pending)
- [x] Supports `--dry-run` (no writes, logs mode)
- [x] Graceful handling of missing tasks file
- [x] Returns 0 when learning disabled or no completed tasks
- [x] Wired into `dispatch()` (replaces stub)
- [x] Dynamic module imports via CliDeps.importModule for testability
- [x] Unit tests — 17 tests → [runtime/cli.test.ts](./runtime/cli.test.ts)
  - runLearn — 15 tests (header logging, learning disabled, no completed tasks, missing tasks file, recordTaskMetrics call count, detectPatterns context, minConfidence from config, generateImprovements args, save proposals, dry-run skips save, pending proposals display, learning summary, operation replay, link replay, no-save when empty, saved count logging)
  - dispatch integration — 2 tests (learn via dispatch, learn with --dry-run flag)
- [x] Total: 17 new tests (1323 total across 34 test files)

### Retry onFailure Mode & README Fix (Phase 33) ✅ COMPLETE
- [x] Implemented `onFailure: 'retry'` mode in `runLoop()` → [runtime/loop.ts](./runtime/loop.ts)
  - Re-attempts failed tasks up to `maxRetries` times before marking as blocked
  - Rollback sandbox between retry attempts to ensure clean state
  - Accumulates iterations and cost across retries in LoopResult
  - Successful retry commits changes (respects autoCommit and dryRun)
  - Falls through to blocked status after all retries exhausted
  - `onFailure: 'stop'` and `'continue'` modes unchanged
- [x] Added optional `maxRetries` field to `LoopConfig` type (default 1 when retry mode)
- [x] Updated `onTaskEnd` hook to use resolved success status (accounts for retry recovery)
- [x] Updated tracker sync to use resolved success status
- [x] Fixed README.md — updated Current Status section (all phases were complete but README showed Phase 2 as "in progress")
- [x] Unit tests — 13 tests → [runtime/loop-orchestration.test.ts](./runtime/loop-orchestration.test.ts)
  - retry succeeds on retry attempt
  - marks task as blocked after all retries exhausted
  - defaults to maxRetries=1 when not specified
  - rollback called between retry attempts
  - accumulates iterations and cost across retries
  - no retry on first success
  - onFailure=continue still works
  - onFailure=stop still works
  - retry commits changes on successful retry with autoCommit
  - maxRetries=0 means immediate block
  - onTaskEnd hook receives correct success status
  - LoopConfig accepts maxRetries field
  - LoopConfig maxRetries is optional
- [x] Total: 13 new tests (1380 total across 35 test files)

### Improvement Auto-Application (Phase 34) ✅ COMPLETE
- [x] Implement apply-improvements.ts → [skills/discovery/apply-improvements.ts](./skills/discovery/apply-improvements.ts)
  - `makeBranchName()` — generates `ralph/learn-{timestamp}` branch names per spec
  - `makeCommitMessage()` — formats `RALPH-LEARN: {title}` commit messages per spec
  - `applyContentToFile()` — applies proposal content to target files (section replacement, append, or create)
  - `applySingleProposal()` — reads target, applies content, stages, and commits
  - `applyImprovements()` — batch pipeline: save branch → create learn branch → apply each → return to original branch
  - `markProposalsApplied()` — appends `improvement_applied` events to learning.jsonl
  - `updateProposalStatuses()` — updates proposal status from `pending` to `applied` in learning.jsonl
- [x] Implement `autoApplyImprovements()` in runtime/loop.ts — loads pending proposals, builds ApplyContext from LoopContext, applies improvements, logs results
- [x] Wired into `runLearningAnalysis()` — auto-apply triggers when `config.learning.autoApplyImprovements` is true
- [x] `ApplyContext` interface — injectable dependencies (readFile, writeFile, gitBranch, gitCheckout, gitAdd, gitCommit, gitCurrentBranch)
- [x] Section-aware file editing — replaces `## {section}` content when section exists, appends otherwise
- [x] Branch isolation — all improvements applied on dedicated branch, original branch restored after
- [x] Graceful error handling — individual proposal failures don't block others, branch creation failure errors all proposals
- [x] Non-pending proposal skipping — only `status: 'pending'` proposals are applied
- [x] Exported `autoApplyImprovements` from runtime/index.ts
- [x] Unit tests — 44 tests → [skills/discovery/apply-improvements.test.ts](./skills/discovery/apply-improvements.test.ts)
  - makeBranchName — 4 tests (ISO format, sanitization, prefix, no trailing Z)
  - makeCommitMessage — 2 tests (RALPH-LEARN prefix, title preservation)
  - applyContentToFile — 8 tests (null file creates, append without section, append when section missing, section replacement, preserve surrounding content, no trailing newline, empty content, section at end of file)
  - applySingleProposal — 5 tests (full pipeline, missing file, commit failure, write errors, commit message format)
  - applyImprovements — 11 tests (empty, skip non-pending, save branch, restore branch, multiple commits, branch name, branch failure, partial failure, gitCurrentBranch failure, checkout-back failure, mixed skipped/applied)
  - markProposalsApplied — 4 tests (empty list, append events, create file, multiple events)
  - updateProposalStatuses — 5 tests (empty IDs, update matching, preserve non-matching, preserve non-proposals, missing file, preserve non-JSON)
  - autoApplyImprovements integration — 4 tests (no pending, loads proposals, full pipeline with branch, error resilience)
- [x] Total: 44 new tests (1424 total across 36 test files)

### Task Priority Support (Phase 35) ✅ COMPLETE
- [x] Added `priority?: number` field to `Task` interface in types/index.ts (higher number = higher priority, default: 0)
- [x] Updated `pickNextTask()` in runtime/loop.ts — sorts by priority after in_progress status, before creation time
- [x] Aligns with loop-mechanics spec: "Highest priority pending task" → "Oldest if same priority"
- [x] Undefined priority treated as 0 (backwards compatible with existing tasks)
- [x] Priority persists through `create` and `update` task operations via `deriveTaskState()`
- [x] Blocked tasks still skipped regardless of priority
- [x] In-progress tasks still resume first regardless of priority
- [x] Unit tests — 8 tests → [runtime/loop-orchestration.test.ts](./runtime/loop-orchestration.test.ts)
  - higher priority picked over lower priority
  - falls back to oldest when priorities equal
  - undefined priority treated as 0
  - in_progress beats higher priority pending
  - higher priority among multiple in_progress tasks
  - negative priority handled correctly
  - priority persists through update operations
  - blocked tasks skipped even with high priority
- [x] Property-based tests — 4 tests → [runtime/loop.property.test.ts](./runtime/loop.property.test.ts)
  - priority preserved through create operations
  - priority updated through update operations
  - undefined priority preserved (defaults to 0 in selection)
  - last priority update wins
- [x] Total: 12 new tests (1436 total across 36 test files)

### Tracker Pull Sync in Main Loop (Phase 36) ✅ COMPLETE
- [x] Added `autoPull` field to `TrackerRuntimeConfig` in types/index.ts
- [x] Implemented `pullFromTracker()` in runtime/loop.ts — pulls external tracker status changes into Ralph's task state
  - Loads tracker config and auth from environment (reuses `getTrackerAuth()`)
  - Derives current task state from tasks.jsonl operation log
  - Fetches linked tasks' external issue status via `tracker.getIssue()`
  - Updates local task status when tracker status differs (tracker wins per spec conflict resolution)
  - Skips terminal states (done, cancelled) — no need to poll
  - Graceful error handling — individual task errors counted, never crash the loop
- [x] Wired into `runLoop()` step 0.5 (after git watcher, before task selection) — ensures `pickNextTask` sees latest external state
- [x] Dry-run mode support — logs intent without executing
- [x] Updated ralph.config.json with `autoPull: true`
- [x] Exported `pullFromTracker` from runtime/index.ts
- [x] Unit tests — 13 tests → [runtime/loop-orchestration.test.ts](./runtime/loop-orchestration.test.ts)
  - skips when autoPull is false
  - skips when credentials are missing
  - skips when no linked tasks exist
  - updates local status when tracker status differs
  - skips tasks with matching status
  - skips done tasks (terminal state)
  - skips cancelled tasks (terminal state)
  - handles getIssue errors gracefully
  - handles non-Error throw objects
  - processes multiple linked tasks
  - records update operations in tasks.jsonl
  - handles tracker config file read error
  - writes progress event for status change
  - logs pull summary with count
- [x] Total: 13 new tests (1449 total across 36 test files)

### Tracker Sync Conflict Resolution & Logging (Phase 37) ✅ COMPLETE
- [x] Added `TrackerConflictEvent` type to types/index.ts — logs conflict field, ralph/tracker values, and resolution strategy
- [x] Updated `LearningEvent` union type to include `TrackerConflictEvent`
- [x] Updated `pullFromTracker()` in runtime/loop.ts with conflict detection and logging:
  - Status conflict: logs `tracker_conflict` event with `resolution: 'tracker_wins'` before applying tracker status (human authority)
  - Description conflict: logs `tracker_conflict` event with `resolution: 'ralph_wins'`, pushes Ralph's description back to tracker (spec is source of truth)
  - Graceful error handling for description push failures (logged but not counted as errors)
  - Return type updated to include `conflicts: number`
- [x] Unit tests — 10 tests → [runtime/loop-orchestration.test.ts](./runtime/loop-orchestration.test.ts)
  - logs tracker_conflict event to learning.jsonl on status change
  - conflict event has correct fields (taskId, field, ralphValue, trackerValue, resolution, externalId)
  - logs description conflict when tracker description differs
  - pushes Ralph description back to tracker (ralph_wins)
  - does not log conflict when statuses match
  - does not log description conflict when descriptions match
  - handles updateIssue error gracefully on description push
  - logs multiple conflicts for multiple tasks
  - includes conflict count in return value
  - description push skipped when tracker has no description change
- [x] Total: 10 new tests (1414 total across 35 test files)

### Discovered Task Lifecycle Promotion (Phase 38) ✅ COMPLETE
- [x] Fixed `discovered → in_progress` lifecycle violation in `runLoop()` → [runtime/loop.ts](./runtime/loop.ts)
  - `pickNextTask()` selects `discovered` tasks as candidates, but spec lifecycle only allows `discovered → pending → in_progress`
  - Added automatic promotion: when a picked task has status `discovered`, first transitions to `pending` before `in_progress`
  - Aligns with task-schema.md lifecycle: `discovered → pending → in_progress → done`
  - `pending` and `in_progress` tasks unaffected (no double-promotion)
  - Resolves issues.md bug: "Status transition errors: Some tasks have status discovered which doesn't allow transition to in_progress"
- [x] Unit tests — 7 tests → [runtime/loop-orchestration.test.ts](./runtime/loop-orchestration.test.ts)
  - promotes discovered task to pending before in_progress
  - does not double-promote a pending task
  - pickNextTask includes discovered tasks as candidates
  - discovered task follows valid lifecycle through full orchestration
  - in_progress task skips promotion entirely
  - discovered task with higher priority is promoted correctly
  - discovered task targeted by --task filter is promoted
- [x] Total: 7 new tests (1423 total across 35 test files)

### Metrics Dashboard CLI Command (Phase 39) ✅ COMPLETE
- [x] Implemented `ralph dashboard` CLI command → [runtime/cli.ts](./runtime/cli.ts)
  - Reads `state/learning.jsonl`, `state/tasks.jsonl`, `state/progress.jsonl`
  - Generates formatted learning summary report per specs/learning-system.md
  - Task metrics: completed count, failed count, average iterations, estimation accuracy
  - Patterns detected: human-readable descriptions with data (factor, area, coverage, files/task)
  - Improvements: applied/pending/rejected counts from learning events
  - Anomalies: severity-tagged with optional task ID
  - 30-day rolling window filter on timestamped events
  - Graceful handling of missing state files (returns empty dashboard)
- [x] Added `dashboard` to CliCommand type, VALID_COMMANDS, HELP_TEXT, dispatch
- [x] Pure functions `buildDashboardData()` and `formatDashboard()` for testability
- [x] Exported `runDashboard`, `buildDashboardData`, `formatDashboard`, `DashboardData` from runtime/index.ts
- [x] Unit tests — 42 tests
  - buildDashboardData — 18 tests (empty inputs, completed/failed task counts, update replay, pattern extraction with data fields, improvement status counting, improvement_applied events, anomaly extraction, average iterations from progress, estimation accuracy, invalid JSON resilience, period label, coverage/churn patterns, anomaly without taskId, blank lines, no estimates)
  - formatDashboard — 14 tests (header, period, task metrics, avg iterations show/hide, estimation accuracy show/hide, patterns present/empty, improvements present/empty, anomalies with severity/taskId/no-taskId, low severity prefix omission)
  - runDashboard — 8 tests (header logging, missing files resilience, task display, pattern display, anomaly display, improvement counts, file reads, dispatch integration)
  - parseArgs/resolveCommand — 2 tests (dashboard command parsing)
- [x] Total: 42 new tests (1465 total across 35 test files)

### Notification System (Phase 40) ✅ COMPLETE
- [x] Implement notifications.ts → [runtime/notifications.ts](./runtime/notifications.ts)
  - `formatNotification()` — formats anomaly/task_complete/limit_reached events into human-readable payloads
  - `sendConsole()` — console channel with severity-based prefixes (!!!/!!/i)
  - `sendSlack()` — Slack webhook channel with Block Kit formatting and severity emojis
  - `sendEmail()` — email webhook channel (HTTP-to-email bridge)
  - `shouldNotify()` — config-driven event filtering (onAnomaly, onComplete, limit_reached)
  - `dispatchNotification()` — main dispatcher: checks config, formats, routes to channel
  - `resolveNotificationEnv()` — reads RALPH_SLACK_WEBHOOK_URL, RALPH_EMAIL_WEBHOOK_URL, RALPH_EMAIL_TO
  - `notifyAnomaly()`, `notifyTaskComplete()`, `notifyLimitReached()` — convenience helpers
- [x] Wired into runLoop() — notifyTaskComplete after each task
- [x] Wired into runLoop() — notifyLimitReached on maxTimePerRun and maxCostPerRun
- [x] Wired into runLearningAnalysis() — notifyAnomaly on iteration_anomaly and failure_mode patterns
- [x] Wired into runGitWatcher() — notifyAnomaly on git watcher anomalies
- [x] Injectable NotificationDeps for testability (no real HTTP in tests)
- [x] Graceful error handling — notification failures never crash the loop (.catch(() => {}))
- [x] Exported from runtime/index.ts
- [x] Unit tests — 51 tests → [runtime/notifications.test.ts](./runtime/notifications.test.ts)
  - formatNotification — 7 tests (anomaly high/medium/low severity mapping, successful/failed task, limit reached, timestamp)
  - sendConsole — 3 tests (critical !!!, warning !!, info i prefix)
  - sendSlack — 7 tests (POST to webhook, Block Kit payload, rotating_light/warning/info emojis, non-ok response, fetch error, non-Error throws)
  - sendEmail — 5 tests (POST to webhook, payload fields, non-ok response, fetch error, non-Error throws)
  - shouldNotify — 7 tests (anomaly on/off, task_complete on/off, limit_reached with onAnomaly/onComplete/both off)
  - resolveNotificationEnv — 3 tests (undefined defaults, RALPH_SLACK_WEBHOOK_URL, RALPH_EMAIL vars)
  - dispatchNotification — 9 tests (skip when disabled, console/slack/email dispatch, missing slack URL, missing email URL/recipient, unknown channel, error resilience)
  - notifyAnomaly — 2 tests (dispatch, respects onAnomaly=false)
  - notifyTaskComplete — 3 tests (success, failure, respects onComplete=false)
  - notifyLimitReached — 2 tests (dispatch, respects disabled flags)
  - integration scenarios — 3 tests (full anomaly→slack, full completion→email, all disabled)
- [x] Total: 51 new tests (1516 total across 36 test files)

### Failure Mode Pattern Detector (Phase 41) ✅ COMPLETE
- [x] Implement `detectFailureModes()` → [skills/discovery/detect-patterns.ts](./skills/discovery/detect-patterns.ts)
  - Groups failed/blocked/cancelled tasks by area (aggregate/domain) to find recurring failure concentrations
  - Falls back to grouping by task type when no single area has >= 2 failures
  - Combines task status (blocked/cancelled) with metrics blockers > 0 for comprehensive failure detection
  - Deduplicates tasks that appear in both task map and metrics
  - Computes failure rate when total tasks in area is known
  - Confidence scales with failure count (min 2 failures to trigger, confidence = min(count/6, 1) * 0.8)
  - Reports top failure area/type, failure count, total failures, failure rate, suggestion
- [x] Added `detectFailureModes` to `detectPatterns()` detector array (was missing — `failure_mode` was in PatternType but had no detector)
- [x] Exported `detectFailureModes` for direct testing
- [x] Unit tests — 19 tests
  - Area-based detection — 3 tests (blocked status, cancelled status, metrics with blockers)
  - Threshold — 2 tests (< 2 failures returns null, non-failed statuses ignored)
  - Fallback grouping — 3 tests (type fallback, type grouping returns null when < 2, spread across areas)
  - Area selection — 2 tests (domain fallback, most failures first)
  - Deduplication — 1 test (task map + metrics same taskId counted once)
  - Data fields — 4 tests (failure rate, suggestion, evidence, totalFailures)
  - Confidence — 1 test (scales with failure count)
  - Integration — 2 tests (included in detectPatterns array, type grouping suggestion)
  - Combined sources — 1 test (task status + metric blockers combined)
- [x] Total: 19 new tests (1535 total across 36 test files)

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
