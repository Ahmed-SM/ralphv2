# Tracker Sync Agent

> Synchronizes tasks with external issue trackers (Jira, GitHub Issues, Linear).

## Responsibility

Read tasks from `state/tasks.jsonl`. Create/update corresponding issues in configured tracker. Maintain bidirectional link.

## Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| Tasks | `./state/tasks.jsonl` | Tasks to sync |
| Config | `./integrations/{tracker}/config.json` | Tracker settings |
| Instructions | `./integrations/{tracker}/AGENTS.md` | Tracker-specific rules |

## Output

1. Created/updated issues in tracker
2. Updated `tasks.jsonl` with external IDs
3. Logged sync events in `progress.jsonl`

## Process

### Step 1: Load Configuration

```typescript
const config = await readJson('./integrations/jira/config.json');
const instructions = await readFile('./integrations/jira/AGENTS.md');
```

### Step 2: Derive Current State

Replay `tasks.jsonl` to get current tasks:

```typescript
const tasks = deriveTaskState('./state/tasks.jsonl');
```

### Step 3: Identify Sync Candidates

Tasks needing sync:
- `status === 'discovered'` → needs creation
- `status === 'pending'` without `externalId` → needs creation
- `updatedAt > lastSyncAt` → needs update
- External status changed → needs local update

### Step 4: Create Issues

For tasks without `externalId`:

```typescript
// Map Ralph task to tracker format
const issue = {
  project: config.project,
  issuetype: config.issueTypeMap[task.type],
  summary: task.title,
  description: formatDescription(task),
  parent: task.parent ? getExternalId(task.parent) : undefined
};

// Create via API
const created = await tracker.createIssue(issue);

// Link back
appendToLog('tasks.jsonl', {
  op: 'link',
  id: task.id,
  externalId: created.key,
  externalUrl: created.url,
  timestamp: now()
});
```

### Step 5: Update Status

For tasks with status changes:

```typescript
const transition = config.statusMap[task.status];
await tracker.transitionIssue(task.externalId, transition);

// Add comment
await tracker.addComment(task.externalId,
  `Status updated to ${task.status} by Ralph`);
```

### Step 6: Pull External Changes

Check for changes made in tracker:

```typescript
const externalIssue = await tracker.getIssue(task.externalId);

if (externalIssue.status !== config.statusMap[task.status]) {
  // Tracker wins for status
  appendToLog('tasks.jsonl', {
    op: 'update',
    id: task.id,
    changes: { status: reverseStatusMap(externalIssue.status) },
    source: 'tracker',
    timestamp: now()
  });
}
```

### Step 7: Handle Hierarchy

When task has parent:

```typescript
// Ensure parent exists in tracker first
if (task.parent) {
  const parent = tasks.get(task.parent);
  if (!parent.externalId) {
    // Create parent first
    await syncTask(parent);
  }

  // Create as subtask
  await tracker.createSubtask(parent.externalId, task);
}
```

## Description Format

```markdown
## Description
{task.description}

## Source
- Spec: [{task.spec}]({task.spec})
- Discovered: {task.source.path}:{task.source.line}

## Ralph
- ID: {task.id}
- Created: {task.createdAt}

---
*Managed by Ralph. Do not edit description.*
```

## Approval Modes

### Manual Mode (`autoCreate: false`)

1. Output proposed issues to `state/proposed-issues.json`
2. Log to progress: `{"type":"proposal","issues":[...]}`
3. Human reviews and approves
4. On approval, create issues

### Review Mode (`autoCreate: "review"`)

1. Create issues as drafts (if supported)
2. Notify human for review
3. Human approves or rejects
4. Update status accordingly

### Auto Mode (`autoCreate: true`)

1. Create issues immediately
2. Log creation
3. Notify human of batch (optional)

## Rate Limiting

- Respect tracker API limits
- Default: 60 requests/minute for Jira
- Batch operations where possible
- Retry with backoff on 429

## Error Handling

| Error | Action |
|-------|--------|
| Auth failure | Log, notify human, stop |
| Rate limit | Backoff, retry |
| Issue not found | Check if deleted, update local |
| Network error | Retry 3x, then fail |
| Validation error | Log, skip issue, continue |

## Metrics

| Metric | Description |
|--------|-------------|
| issues_created | New issues created |
| issues_updated | Issues updated |
| issues_synced | Total synced |
| sync_errors | Errors encountered |
| sync_duration | Time taken |

## Escalation

Escalate to human when:
- Auth failure
- Bulk creation (>10 issues at once)
- Conflicting state (local vs remote)
- Unknown issue type mapping

## Example Run

Input (`tasks.jsonl` state):
```json
[
  {"id": "RALPH-001", "type": "epic", "title": "Phase 1: Foundation", "status": "in_progress"},
  {"id": "RALPH-002", "type": "task", "title": "Write task schema", "parent": "RALPH-001", "status": "done"}
]
```

Output (Jira):
```
RALPH-1: Phase 1: Foundation (Epic, In Progress)
└── RALPH-2: Write task schema (Task, Done)
```

Updated `tasks.jsonl`:
```jsonl
{"op":"link","id":"RALPH-001","externalId":"RALPH-1","externalUrl":"https://jira.../RALPH-1","timestamp":"..."}
{"op":"link","id":"RALPH-002","externalId":"RALPH-2","externalUrl":"https://jira.../RALPH-2","timestamp":"..."}
```

---

*Spec: [../specs/tracker-integration.md](../specs/tracker-integration.md)*
*Index: [./AGENTS.md](./AGENTS.md)*
