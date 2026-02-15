# Tracker Idempotency Specification

> Defines idempotent and deduplicated tracker operations for Jira and other trackers.

## Goal

Ensure repeated sync attempts do not create duplicate issues/comments/transitions.

## Operation Identity

Every outbound tracker mutation must carry a deterministic operation key.

```typescript
type TrackerOpType = 'create_issue' | 'update_issue' | 'transition' | 'comment' | 'link';

interface TrackerOpKey {
  taskId: string;
  opType: TrackerOpType;
  fingerprint: string;   // hash of relevant payload
}
```

Key format:
`{taskId}:{opType}:{fingerprint}`

## Dedupe Log

Persist in append-only log:

`state/tracker-ops.jsonl`

```typescript
interface TrackerOpRecord {
  opKey: string;
  taskId: string;
  opType: TrackerOpType;
  status: 'started' | 'succeeded' | 'failed';
  externalId?: string;
  externalRef?: string;
  timestamp: string;
  error?: string;
}
```

Rules:
- If `succeeded` exists for same `opKey`, skip API call.
- Retries are allowed only for `failed` or missing completion.
- Creation must be followed by task `link` write with the same `opKey` context.

## Create-Issue Idempotency

Before creating:
1. Check local link (`task.externalId`).
2. Check dedupe log for successful create `opKey`.
3. Optionally query tracker by Ralph task ID label/custom field.

Only create when all checks are negative.

## Transition/Comment Idempotency

- Transition fingerprint includes `fromStatus -> toStatus`.
- Comment fingerprint includes normalized body hash.
- Repeated sync with same fingerprint must be no-op.

## Failure Handling

- Network timeout after unknown result: mark as `failed_unknown`, then reconcile by lookup before retry.
- Conflict response (already exists/already transitioned): treat as success and record `succeeded`.

## Metrics

- `tracker_dedup_skips`
- `tracker_create_duplicates_prevented`
- `tracker_unknown_outcomes_reconciled`
- `tracker_idempotent_conflicts`

---

*Referenced by: [AGENTS.md](../AGENTS.md), [implementation-plan.md](../implementation-plan.md)*
