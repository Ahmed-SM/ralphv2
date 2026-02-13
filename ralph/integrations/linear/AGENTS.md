# Linear Integration

> Instructions for integrating Ralph with Linear.

## Status: Implemented

Adapter implemented in [adapter.ts](./adapter.ts) with 70 unit tests.

## Overview

Linear is a modern issue tracker popular with startups. Its API is GraphQL-based.

## Features

- Create issues from tasks (via GraphQL mutations)
- Create projects from epics
- Sub-issue creation via parentId
- Issue relation creation (blocks, related, duplicate)
- Workflow state transitions
- Label resolution by name
- Comment creation
- Dry-run mode support
- Token and OAuth authentication

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

## Configuration

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
