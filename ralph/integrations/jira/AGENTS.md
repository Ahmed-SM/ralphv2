# Jira Integration

> Instructions for integrating Ralph with Jira.

## Overview

Jira is the primary tracker integration. This adapter supports both Jira Cloud and Jira Data Center/Server.

## Setup

### 1. API Token (Cloud)

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Create new token
3. Set environment variable:
   ```bash
   export RALPH_JIRA_EMAIL=your@email.com
   export RALPH_JIRA_TOKEN=your-api-token
   ```

### 2. Configuration

Copy `config.example.json` to `config.json`:

```json
{
  "type": "jira",
  "baseUrl": "https://your-domain.atlassian.net",
  "project": "RALPH",
  "issueTypeMap": {
    "epic": "Epic",
    "feature": "Story",
    "task": "Task",
    "subtask": "Sub-task",
    "bug": "Bug",
    "refactor": "Task",
    "docs": "Task",
    "test": "Task",
    "spike": "Spike"
  },
  "statusMap": {
    "discovered": "Backlog",
    "pending": "To Do",
    "in_progress": "In Progress",
    "blocked": "Blocked",
    "review": "In Review",
    "done": "Done",
    "cancelled": "Cancelled"
  },
  "autoCreate": false,
  "autoTransition": true,
  "autoComment": true
}
```

## API Reference

### Base URL

- Cloud: `https://{domain}.atlassian.net`
- Server: `https://{your-server}/rest/api/2`

### Authentication

```typescript
// Cloud: Basic auth with email + API token
const auth = Buffer.from(`${email}:${token}`).toString('base64');
headers['Authorization'] = `Basic ${auth}`;

// Server: Bearer token or Basic auth
headers['Authorization'] = `Bearer ${personalAccessToken}`;
```

### Create Issue

```bash
POST /rest/api/3/issue
Content-Type: application/json

{
  "fields": {
    "project": { "key": "RALPH" },
    "issuetype": { "name": "Task" },
    "summary": "Task title",
    "description": {
      "type": "doc",
      "version": 1,
      "content": [...]
    },
    "parent": { "key": "RALPH-1" }  // for subtasks
  }
}
```

### Transition Issue

```bash
# Get available transitions
GET /rest/api/3/issue/{issueKey}/transitions

# Execute transition
POST /rest/api/3/issue/{issueKey}/transitions
{
  "transition": { "id": "31" }
}
```

### Add Comment

```bash
POST /rest/api/3/issue/{issueKey}/comment
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Comment text" }
        ]
      }
    ]
  }
}
```

## Jira-Specific Mappings

### Epic Link

For Cloud (next-gen projects):
```json
{ "parent": { "key": "EPIC-1" } }
```

For Server/classic:
```json
{ "customfield_10014": "EPIC-1" }  // Epic Link field
```

### Story Points

```json
{ "customfield_10016": 5 }  // Story Points field
```

Field IDs vary by instance. Use:
```bash
GET /rest/api/3/field
```

## Rate Limits

- Cloud: 100 requests per minute per user
- Server: Configurable

Implement exponential backoff:
```typescript
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.status === 429) {
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      throw e;
    }
  }
}
```

## Description Formatting

Jira uses Atlassian Document Format (ADF) for Cloud:

```typescript
function toADF(markdown: string): ADFDocument {
  return {
    type: 'doc',
    version: 1,
    content: parseMarkdownToADF(markdown)
  };
}
```

For Server, use wiki markup or plain text.

## Subtask Handling

Jira subtasks require:
1. Parent issue exists
2. Subtask issue type configured
3. Same project as parent

```typescript
async function createSubtask(parentKey: string, task: Task) {
  return await jira.createIssue({
    fields: {
      project: { key: config.project },
      parent: { key: parentKey },
      issuetype: { name: 'Sub-task' },
      summary: task.title,
      description: toADF(task.description)
    }
  });
}
```

## Webhooks (Future)

Configure Jira webhooks for real-time sync:
1. Go to System → Webhooks
2. Add webhook URL: `https://your-ralph/webhooks/jira`
3. Select events: issue created, updated, transitioned

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Check token, ensure not expired |
| 403 Forbidden | Check project permissions |
| 400 Bad Request | Check field IDs, issue type names |
| 404 Not Found | Check issue key, project exists |

## Testing

```bash
# Test connection
curl -u email:token https://your-domain.atlassian.net/rest/api/3/myself

# Test create (dry run)
ralph sync --tracker=jira --dry-run
```

---

*Parent: [../AGENTS.md](../AGENTS.md)*
*Spec: [../../specs/tracker-integration.md](../../specs/tracker-integration.md)*
