# Multi-Run Consensus Specification

> Defines how Ralph coordinates multiple concurrent runs safely.

## Goal

Allow parallel Ralph workers without duplicate task execution, race conditions, or conflicting side effects.

## Core Model

Ralph uses a lightweight consensus model with:

1. **Leader lease** for run scheduling authority.
2. **Task claim lease** for exclusive task execution.
3. **Versioned operations** for conflict detection.

## Leader Lease

Only the leader may assign tasks.

```typescript
interface LeaderLease {
  leaseId: string;
  workerId: string;
  epoch: number;
  acquiredAt: string;
  expiresAt: string;
}
```

Rules:
- Lease acquisition is atomic.
- Lease renewal must include matching `leaseId` and `epoch`.
- Expired lease can be stolen by another worker.
- Scheduler actions are rejected when lease is invalid.

## Task Claims

Before execution, a worker must claim exactly one task.

```typescript
interface TaskClaim {
  taskId: string;
  workerId: string;
  leaseId: string;
  epoch: number;
  claimedAt: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
}
```

Rules:
- Claim is accepted only if no active claim exists for `taskId`.
- Claims expire automatically and may be reassigned.
- Commit/sync requires an active claim owned by the same worker.

## State Machine

```
unclaimed -> claimed -> executing -> done
                  \-> released -> unclaimed
                  \-> expired  -> unclaimed
```

## Required Runtime Checks

Before mutating state or tracker:

1. Validate leader lease.
2. Validate task claim ownership.
3. Validate operation version (monotonic for task).

If any check fails:
- Abort mutation.
- Log conflict event to `state/progress.jsonl`.
- Requeue task if claim expired.

## Failure Recovery

- Worker crash: claim expires; another worker resumes task.
- Leader crash: lease expires; new leader elected.
- Split-brain detection: higher `epoch` wins; lower epoch actions rejected.

## Configuration

```typescript
interface ConsensusConfig {
  enabled: boolean;
  backend: 'filesystem' | 'redis' | 'etcd';
  leaderLeaseTtlMs: number;
  taskClaimTtlMs: number;
  renewIntervalMs: number;
}
```

Default for local mode:
- `enabled: false`
- `backend: 'filesystem'`

## Events

Append to `state/progress.jsonl`:
- `leader_acquired`
- `leader_renewed`
- `leader_lost`
- `task_claimed`
- `task_claim_expired`
- `consensus_conflict`

---

*Referenced by: [AGENTS.md](../AGENTS.md), [implementation-plan.md](../implementation-plan.md)*
