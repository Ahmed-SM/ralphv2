# Integrations Index

> This file explains how Ralph integrates with external trackers.

## Philosophy

Ralph is tracker-agnostic. Each integration:
1. Implements a common interface
2. Has its own AGENTS.md with specific instructions
3. Uses environment variables for secrets
4. Can be swapped without code changes

## Available Integrations

| Tracker | Status | Directory |
|---------|--------|-----------|
| Jira | Primary | [jira/](./jira/) |
| GitHub Issues | Planned | [github-issues/](./github-issues/) |
| Linear | Planned | [linear/](./linear/) |

## Common Interface

All integrations must implement:

```typescript
interface TrackerAdapter {
  // Identity
  name: string;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;

  // CRUD
  createIssue(task: Task): Promise<ExternalIssue>;
  updateIssue(id: string, changes: Partial<Task>): Promise<void>;
  getIssue(id: string): Promise<ExternalIssue>;
  findIssues(query: Query): Promise<ExternalIssue[]>;

  // Hierarchy
  createSubtask(parentId: string, task: Task): Promise<ExternalIssue>;
  linkIssues(from: string, to: string, type: LinkType): Promise<void>;

  // Status
  transitionIssue(id: string, status: string): Promise<void>;
  getTransitions(id: string): Promise<Transition[]>;

  // Comments
  addComment(id: string, body: string): Promise<void>;
}
```

## Adding New Integration

1. Create directory: `integrations/{name}/`
2. Create `AGENTS.md` with tracker-specific instructions
3. Create `config.example.json` (no secrets)
4. Create `adapter.ts` implementing interface
5. Add to this index
6. Test with dry-run mode

## Configuration

Each integration has:
- `config.json` — settings (gitignored if contains secrets)
- `config.example.json` — template for setup

Environment variables for secrets:
```bash
RALPH_JIRA_TOKEN=...
RALPH_GITHUB_TOKEN=...
RALPH_LINEAR_API_KEY=...
```

## Dry Run Mode

Test integration without side effects:

```typescript
const adapter = createAdapter({ dryRun: true });
await adapter.createIssue(task);
// Logs what would happen, doesn't create
```

---

*Referenced by: [../AGENTS.md](../AGENTS.md)*
