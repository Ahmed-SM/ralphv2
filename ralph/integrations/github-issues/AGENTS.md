# GitHub Issues Integration

> Instructions for integrating Ralph with GitHub Issues.

## Status: Planned

This integration is planned for Phase 3+.

## Overview

GitHub Issues provides a lightweight alternative to Jira, especially for open-source projects or teams already using GitHub.

## Planned Features

- Create issues from tasks
- Create milestones from epics
- Use labels for task types
- Track PRs linked to issues
- Auto-close issues on PR merge

## Mapping

| Ralph | GitHub |
|-------|--------|
| epic | Milestone |
| feature | Issue + `enhancement` label |
| task | Issue |
| subtask | Checkbox in issue body |
| bug | Issue + `bug` label |

## API

```bash
# Auth
export RALPH_GITHUB_TOKEN=ghp_...

# Create issue
gh api repos/{owner}/{repo}/issues -f title="..." -f body="..."

# Add label
gh api repos/{owner}/{repo}/issues/{number}/labels -f labels[]="bug"

# Close issue
gh api repos/{owner}/{repo}/issues/{number} -f state="closed"
```

## Configuration (Planned)

```json
{
  "type": "github-issues",
  "owner": "your-org",
  "repo": "your-repo",
  "labels": {
    "epic": "epic",
    "feature": "enhancement",
    "bug": "bug",
    "task": "task"
  },
  "autoClose": true,
  "linkPRs": true
}
```

---

*Parent: [../AGENTS.md](../AGENTS.md)*
