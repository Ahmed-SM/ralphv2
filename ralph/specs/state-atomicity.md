# State Atomicity Specification

> Defines safe concurrent writes for Ralph append-only state files.

## Goal

Prevent lost updates when multiple runs write `tasks.jsonl`, `progress.jsonl`, and `learning.jsonl`.

## Files in Scope

- `state/tasks.jsonl`
- `state/progress.jsonl`
- `state/learning.jsonl`

## Problem

Naive read-modify-write causes last-writer-wins data loss under concurrent runs.

## Required Semantics

1. **Atomic append** for each JSONL event.
2. **Compare-and-swap (CAS)** for versioned updates.
3. **No whole-file overwrite** for append operations.

## Atomic Append Contract

```typescript
interface AppendRequest {
  path: string;
  eventId: string;      // globally unique
  payload: unknown;
  expectedTailHash?: string;
}

interface AppendResult {
  ok: boolean;
  offset?: number;
  tailHash: string;
  conflict?: 'tail_mismatch';
}
```

Rules:
- Append writes one complete line or nothing.
- Duplicate `eventId` is ignored (idempotent success).
- If `expectedTailHash` is provided and mismatched, return conflict.

## CAS Update Contract

Used for lock/lease metadata and derived snapshots.

```typescript
interface CasWrite<T> {
  key: string;
  expectedVersion: number;
  nextValue: T;
}
```

Rules:
- Write succeeds only when version matches.
- On conflict, caller reloads and retries with backoff.

## Filesystem Backend (Minimum)

- Use per-file lock (`*.lock`) with lease timeout.
- Hold lock only for append duration.
- Use append mode (`O_APPEND`) rather than rewrite.

## Validation

- Every event includes `eventId`, `timestamp`, and `source`.
- Reader de-duplicates by `eventId`.
- Corrupt line handling: skip invalid lines, log validation event.

## Metrics

- `append_conflicts`
- `append_retries`
- `cas_conflicts`
- `dedup_hits`

---

*Referenced by: [AGENTS.md](../AGENTS.md), [implementation-plan.md](../implementation-plan.md)*
