# Git Watcher Agent

> Monitors git activity to track task progress and update status.

## Responsibility

Watch commits, branches, and PRs. Detect task-related activity. Update task status automatically. This closes the loop between code and tracking.

## Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| Git log | `git log` | Commit history |
| Branches | `git branch` | Active work |
| PRs | GitHub/GitLab API | Code review status |
| Tasks | `./state/tasks.jsonl` | Link targets |

## Output

1. Updated `tasks.jsonl` with status changes
2. Activity log in `progress.jsonl`
3. Tracker updates (via tracker-sync)

## Conventions

### Commit Message Format

```
RALPH-{id}: {action} {subject}

{optional body}
```

Examples:
```
RALPH-001: implement task schema parser
RALPH-002: fix edge case in nested lists
RALPH-003: add tests for tracker sync
```

### Branch Naming

```
ralph/{id}-{slug}
```

Examples:
```
ralph/001-task-schema
ralph/002-tracker-sync
```

## Process

### Step 1: Get Recent Activity

```bash
# Commits since last check
git log --since="{lastCheck}" --format="%H|%s|%an|%aI"

# Active branches
git branch -r --format="%(refname:short)|%(committerdate:iso)"
```

### Step 2: Parse Commits

```typescript
const commitPattern = /^(RALPH-\d+):\s*(.+)$/;

for (const commit of commits) {
  const match = commit.subject.match(commitPattern);
  if (match) {
    const [, taskId, action] = match;
    yield {
      type: 'commit',
      taskId,
      action,
      sha: commit.sha,
      author: commit.author,
      timestamp: commit.timestamp
    };
  }
}
```

### Step 3: Detect Status Changes

| Activity | Inferred Status |
|----------|-----------------|
| First commit on task | `in_progress` |
| PR opened | `review` |
| PR approved | `review` (ready) |
| PR merged | `done` |
| Branch deleted after merge | `done` (confirmed) |

### Step 4: Update Tasks

```typescript
appendToLog('tasks.jsonl', {
  op: 'update',
  id: taskId,
  changes: { status: newStatus },
  source: {
    type: 'commit',
    sha: commit.sha
  },
  timestamp: now()
});
```

### Step 5: Log Progress

```typescript
appendToLog('progress.jsonl', {
  type: 'activity',
  taskId,
  activity: 'commit',
  sha: commit.sha,
  message: commit.subject,
  author: commit.author,
  timestamp: commit.timestamp
});
```

### Step 6: Sync to Tracker

If task has `externalId`:

```typescript
await tracker.addComment(task.externalId,
  `Activity detected:\n\`${commit.sha.slice(0,7)}\` ${commit.subject}`
);

if (statusChanged) {
  await tracker.transitionIssue(task.externalId, newStatus);
}
```

## File Analysis

Optionally analyze changed files:

```typescript
const files = await getCommitFiles(sha);
const aggregates = detectAggregates(files);
const testsCoverage = detectTestChanges(files);

appendToLog('learning.jsonl', {
  type: 'commit_analysis',
  taskId,
  sha,
  filesChanged: files.length,
  aggregates,
  testsAdded: testsCoverage.added,
  timestamp: now()
});
```

## PR Integration

### GitHub

```bash
gh pr list --json number,title,state,headRefName
gh pr view {number} --json commits,reviews,mergedAt
```

### GitLab

```bash
glab mr list --json
glab mr view {number}
```

### Link PR to Task

```typescript
const prPattern = /ralph\/(\d+)-/;
const match = pr.headBranch.match(prPattern);
if (match) {
  const taskId = `RALPH-${match[1]}`;
  appendToLog('progress.jsonl', {
    type: 'pr',
    taskId,
    prNumber: pr.number,
    prUrl: pr.url,
    status: pr.state,
    timestamp: now()
  });
}
```

## Polling vs Webhooks

### Polling (Default)

```typescript
// Run every N minutes
setInterval(async () => {
  await checkGitActivity();
}, config.pollInterval);
```

### Webhooks (Future)

Configure GitHub/GitLab webhooks to push events.

## Edge Cases

### Commit Without Task ID

Log as untracked:
```typescript
appendToLog('progress.jsonl', {
  type: 'untracked_commit',
  sha: commit.sha,
  message: commit.subject,
  timestamp: commit.timestamp
});
```

### Multiple Tasks in One Commit

```
RALPH-001, RALPH-002: implement shared functionality
```

Update both tasks.

### Squash Merges

Track PR merge, not individual commits:
```typescript
if (pr.mergedAt && pr.squashMerge) {
  // Use PR as the activity marker
  markTaskComplete(taskId, { type: 'pr_merge', pr: pr.number });
}
```

### Force Push / Rebase

Detect rewritten history:
```typescript
if (previousSha && !await commitExists(previousSha)) {
  appendToLog('progress.jsonl', {
    type: 'history_rewritten',
    taskId,
    previousSha,
    newSha: currentSha,
    timestamp: now()
  });
}
```

## Metrics

| Metric | Description |
|--------|-------------|
| commits_tracked | Commits with task IDs |
| commits_untracked | Commits without task IDs |
| prs_tracked | PRs linked to tasks |
| status_updates | Auto status changes |
| tasks_completed_via_git | Tasks marked done by merge |

## Configuration

```json
{
  "gitWatcher": {
    "enabled": true,
    "pollInterval": 300,
    "trackUntagged": true,
    "autoTransition": true,
    "prIntegration": "github"
  }
}
```

## Escalation

Escalate to human when:
- Many untracked commits (>50%)
- Task marked done but tests failing
- Conflicting activity (multiple tasks same files)
- Unusual patterns (late night commits, many force pushes)

---

*Spec: [../specs/loop-mechanics.md](../specs/loop-mechanics.md)*
*Index: [./AGENTS.md](./AGENTS.md)*
