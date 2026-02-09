# Tracker Integration Specification

> Defines how Ralph integrates with external issue trackers.

## Design Principle

Ralph is tracker-agnostic. All trackers implement a common interface. The specific tracker is a runtime configuration.

## Tracker Interface

```typescript
interface Tracker {
  name: string;                    // e.g., "jira", "github-issues", "linear"

  // Connection
  connect(config: TrackerConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;

  // Issues
  createIssue(task: Task): Promise<ExternalIssue>;
  updateIssue(externalId: string, changes: IssueChanges): Promise<void>;
  getIssue(externalId: string): Promise<ExternalIssue>;

  // Queries
  findIssue(query: IssueQuery): Promise<ExternalIssue[]>;

  // Relationships
  linkIssues(from: string, to: string, type: LinkType): Promise<void>;
  createSubtask(parent: string, task: Task): Promise<ExternalIssue>;

  // Status
  transitionIssue(externalId: string, status: string): Promise<void>;
  getTransitions(externalId: string): Promise<Transition[]>;

  // Comments
  addComment(externalId: string, comment: string): Promise<void>;
}
```

## Configuration

```typescript
interface TrackerConfig {
  type: 'jira' | 'github-issues' | 'linear';

  // Connection
  baseUrl?: string;        // For self-hosted
  auth: AuthConfig;

  // Mapping
  project: string;         // Project key (e.g., "PA", "RALPH")
  issueTypeMap: Record<TaskType, string>;  // Map Ralph types to tracker types
  statusMap: Record<TaskStatus, string>;   // Map Ralph status to tracker status

  // Behavior
  autoCreate: boolean;     // Create issues automatically
  autoTransition: boolean; // Update status automatically
  autoComment: boolean;    // Add comments on activity
}
```

## Auth Config

```typescript
type AuthConfig =
  | { type: 'token'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'oauth'; clientId: string; clientSecret: string; accessToken?: string }
```

## External Issue

```typescript
interface ExternalIssue {
  id: string;              // Internal ID
  key: string;             // Display key (e.g., "PA-123")
  url: string;             // Web URL

  title: string;
  description: string;
  status: string;
  type: string;

  parent?: string;
  subtasks?: string[];

  created: string;
  updated: string;
}
```

## Mapping Ralph → Tracker

### Issue Types

| Ralph Type | Jira | GitHub | Linear |
|------------|------|--------|--------|
| epic | Epic | Milestone | Project |
| feature | Story | Issue (enhancement) | Issue |
| task | Task | Issue | Issue |
| subtask | Sub-task | Checkbox item | Sub-issue |
| bug | Bug | Issue (bug) | Bug |

### Status Mapping

| Ralph Status | Jira | GitHub | Linear |
|--------------|------|--------|--------|
| discovered | Backlog | Open | Backlog |
| pending | To Do | Open | Todo |
| in_progress | In Progress | Open | In Progress |
| blocked | Blocked | Open | Blocked |
| review | In Review | Open | In Review |
| done | Done | Closed | Done |
| cancelled | Cancelled | Closed | Cancelled |

## Sync Behavior

### Ralph → Tracker (Push)

1. Task created in Ralph → Create issue in tracker
2. Task status updated → Transition issue
3. Task modified → Update issue fields
4. Subtask added → Create linked subtask

### Tracker → Ralph (Pull)

1. Issue status changed externally → Update task status
2. Issue commented → Log in progress.jsonl
3. Issue closed externally → Mark task done

### Conflict Resolution

If both Ralph and tracker have changes:
1. Tracker wins for status (human authority)
2. Ralph wins for description (spec is source of truth)
3. Log conflict in learning.jsonl

## Integration Directory Structure

```
integrations/
  AGENTS.md              # How integrations work
  jira/
    AGENTS.md            # Jira-specific instructions
    config.json          # Configuration (gitignored secrets)
    adapter.ts           # Implements Tracker interface
  github-issues/
    AGENTS.md
    adapter.ts
  linear/
    AGENTS.md
    adapter.ts
```

## Configuration File

`integrations/{tracker}/config.json`:

```json
{
  "type": "jira",
  "baseUrl": "https://company.atlassian.net",
  "project": "RALPH",
  "issueTypeMap": {
    "epic": "Epic",
    "feature": "Story",
    "task": "Task",
    "subtask": "Sub-task",
    "bug": "Bug"
  },
  "statusMap": {
    "pending": "To Do",
    "in_progress": "In Progress",
    "done": "Done"
  },
  "autoCreate": false,
  "autoTransition": true,
  "autoComment": true
}
```

Note: Auth tokens stored in environment variables, not config files.

## Human Approval Modes

| Mode | Behavior |
|------|----------|
| `manual` | Ralph proposes, human creates |
| `review` | Ralph creates as draft, human approves |
| `auto` | Ralph creates automatically |

Default: `review`

---

*Referenced by: [AGENTS.md](../AGENTS.md), [agents/tracker-sync.md](../agents/tracker-sync.md)*
