# AGENTS.md — Project Delivery Index

> Master index for running Ralph in delivery mode on this repository.

## Identity

This repository is managed by Ralph in `delivery` mode with human-on-the-loop governance.

## Required Inputs

1. `AGENTS.md` (this file)
2. `implementation-plan.md`
3. `ralph.config.json`
4. `ralph.policy.json`
5. Test command
6. Build command

## Core Rules

1. Markdown is the source of truth.
2. Execute one task at a time.
3. Follow policy allowlists for files and commands.
4. Require human approval for high-risk changes.
5. Rollback automatically on failed checks.

## Spec Index

| Spec | Defines |
|------|---------|
| [specs/system-context.md](./specs/system-context.md) | System purpose and constraints |
| [specs/architecture.md](./specs/architecture.md) | High-level technical design |
| [specs/delivery-workflow.md](./specs/delivery-workflow.md) | Delivery lifecycle and gates |
| [specs/quality-gates.md](./specs/quality-gates.md) | Test/build/review requirements |

## State Files

| File | Purpose |
|------|---------|
| [state/tasks.jsonl](./state/tasks.jsonl) | Task operation log |
| [state/progress.jsonl](./state/progress.jsonl) | Run and iteration history |
| [state/learning.jsonl](./state/learning.jsonl) | Learning and review decisions |
