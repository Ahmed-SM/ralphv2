# Linear Integration

> Instructions for integrating Ralph with Linear.

## Status: Planned

This integration is planned for Phase 3+.

## Overview

Linear is a modern issue tracker popular with startups. Its API is GraphQL-based.

## Planned Features

- Create issues from tasks
- Create projects from epics
- Sync status bidirectionally
- Track cycles
- Link to PRs via GitHub integration

## Mapping

| Ralph | Linear |
|-------|--------|
| epic | Project |
| feature | Issue |
| task | Issue |
| subtask | Sub-issue |
| bug | Issue + Bug label |

## API

```graphql
# Create issue
mutation {
  issueCreate(input: {
    teamId: "..."
    title: "..."
    description: "..."
    projectId: "..."  # for epic link
  }) {
    issue {
      id
      identifier
      url
    }
  }
}
```

## Authentication

```bash
export RALPH_LINEAR_API_KEY=lin_api_...
```

## Configuration (Planned)

```json
{
  "type": "linear",
  "teamId": "...",
  "defaultProjectId": "...",
  "labels": {
    "bug": "bug-label-id",
    "feature": "feature-label-id"
  },
  "autoSync": true
}
```

---

*Parent: [../AGENTS.md](../AGENTS.md)*
