# GitHub Issues Integration

> Instructions for integrating Ralph with GitHub Issues.

## Status: Implemented

The GitHub Issues adapter implements the full Tracker interface.

## Overview

GitHub Issues provides a lightweight alternative to Jira, especially for open-source projects or teams already using GitHub.

## Implemented Features

- Create issues from tasks
- Create milestones from epics
- Use labels for task types
- Subtask creation via parent references
- Issue linking via comments
- State transitions (open/closed with state_reason)
- Issue search with filtering (state, labels, assignee, since)
- Pull request filtering (excluded from issue queries)
- Health check via /user endpoint
- Dry-run mode support

## Mapping

| Ralph | GitHub |
|-------|--------|
| epic | Milestone |
| feature | Issue + `enhancement` label |
| task | Issue + `task` label |
| subtask | Issue with parent reference in body |
| bug | Issue + `bug` label |

## Status Mapping

| Ralph Status | GitHub State |
|--------------|-------------|
| discovered | open |
| pending | open |
| in_progress | open |
| blocked | open |
| review | open |
| done | closed (completed) |
| cancelled | closed (not_planned) |

## Configuration

The `project` field uses `owner/repo` format:

```json
{
  "type": "github-issues",
  "project": "your-org/your-repo",
  "issueTypeMap": {
    "epic": "epic",
    "feature": "enhancement",
    "task": "task",
    "subtask": "task",
    "bug": "bug"
  },
  "statusMap": {
    "discovered": "Backlog",
    "pending": "Open",
    "in_progress": "Open",
    "blocked": "Open",
    "review": "Open",
    "done": "Closed",
    "cancelled": "Closed"
  },
  "autoCreate": true,
  "autoTransition": true,
  "autoComment": false
}
```

## Auth

```bash
export RALPH_GITHUB_TOKEN=ghp_...
```

Auth config:
```json
{
  "type": "token",
  "token": "ghp_..."
}
```

## Files

- [adapter.ts](./adapter.ts) — Tracker interface implementation (GitHubIssuesAdapter)
- [adapter.test.ts](./adapter.test.ts) — 60 unit tests

---

*Parent: [../AGENTS.md](../AGENTS.md)*
