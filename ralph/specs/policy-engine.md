# Policy Engine Specification

> Defines safety policy schema and enforcement behavior for Ralph delivery runs.

## Purpose

The policy engine enforces what Ralph can read, write, and execute, and which actions require human approval.

## Policy File

Default file name: `ralph.policy.json`

```json
{
  "version": 1,
  "mode": "delivery",
  "files": {
    "allowRead": ["."],
    "allowWrite": ["src", "tests", "docs", "specs", "state"],
    "denyRead": [".env", ".git/objects"],
    "denyWrite": [".git", "node_modules", "dist"]
  },
  "commands": {
    "allow": ["npm test", "npm run build", "npm run lint", "git status", "git diff"],
    "deny": ["rm -rf /", "sudo", "curl | sh"]
  },
  "approval": {
    "requiredFor": ["destructive_ops", "dependency_changes", "production_impacting_edits"],
    "requireReason": true
  },
  "checks": {
    "required": ["test", "build"],
    "rollbackOnFail": true
  }
}
```

## Schema

```typescript
type RalphMode = "core" | "delivery";

type ApprovalClass =
  | "destructive_ops"
  | "dependency_changes"
  | "production_impacting_edits";

interface RalphPolicy {
  version: number;
  mode: RalphMode;
  files: {
    allowRead: string[];
    allowWrite: string[];
    denyRead: string[];
    denyWrite: string[];
  };
  commands: {
    allow: string[];
    deny: string[];
  };
  approval: {
    requiredFor: ApprovalClass[];
    requireReason: boolean;
  };
  checks: {
    required: Array<"test" | "build" | "lint" | "typecheck">;
    rollbackOnFail: boolean;
  };
}
```

## Enforcement Rules

1. Any denied file path or command is blocked immediately.
2. Any non-allowlisted write/command is blocked in `delivery` mode.
3. Actions classified under `approval.requiredFor` pause execution until human approval.
4. If any required check fails and `rollbackOnFail` is true, Ralph must rollback before continuing.
5. Policy violations are logged to `state/progress.jsonl` and surfaced as anomalies.

## Approval Classification

Classify actions before execution:

- `destructive_ops`: delete, reset, force operations.
- `dependency_changes`: package manager dependency add/remove/update, lockfile mutations.
- `production_impacting_edits`: infra/deploy/runtime-critical paths (configured per repo).

## Human-on-the-Loop Behavior

1. Human reviews only high-risk gated actions, not every action.
2. Human can approve, reject, or request safer alternative.
3. All decisions are recorded with rationale in `state/learning.jsonl`.

## Mode Differences

- `core` mode allows Ralph platform evolution under stricter code review.
- `delivery` mode prioritizes target-repo safety and blocks Ralph self-modification unless explicitly approved.
