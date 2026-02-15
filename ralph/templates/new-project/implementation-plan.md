# Implementation Plan — New Project

> Initial delivery plan generated for a target repository.

## Goal

Deliver scoped features safely for this project with human-on-the-loop approvals for high-risk actions.

## Phase 0: Onboarding

- [ ] Validate required files: `AGENTS.md`, `implementation-plan.md`, `ralph.config.json`, `ralph.policy.json`
- [ ] Validate test and build commands
- [ ] Validate policy allowlists and approval gates

## Phase 1: Baseline Context

- [ ] Generate or update `specs/system-context.md`
- [ ] Generate or update `specs/architecture.md`
- [ ] Generate or update `specs/delivery-workflow.md`
- [ ] Generate or update `specs/quality-gates.md`

## Phase 2: Task Graph

- [ ] Extract tasks from specs into `state/tasks.jsonl`
- [ ] Classify tasks by type (bugfix, feature, migration, test hardening)
- [ ] Prioritize first delivery slice

## Phase 3: Execution

- [ ] Execute one task at a time in sandbox
- [ ] Run required checks (test/build) after each iteration
- [ ] On failure, rollback and retry/mark blocked per policy

## Phase 4: Review and Promotion

- [ ] Keep human approvals for gated actions
- [ ] Track KPIs (success rate, cycle time, rollback rate, interventions)
- [ ] Promote autonomy level only after KPI threshold passes for N consecutive runs
