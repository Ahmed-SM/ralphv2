# Task Discovery Agent

> Extracts structured tasks from markdown documents.

## Responsibility

Read markdown specs, implementation plans, and documentation. Extract actionable tasks. Output to `state/tasks.jsonl`.

## Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| Implementation plan | `./implementation-plan.md` | Current work items |
| Specs | `./specs/*.md` | Detailed requirements |
| ADRs | `./docs/adr/*.md` | Architecture decisions |
| README | `./README.md` | Project overview |

## Output

Append to `./state/tasks.jsonl`:

```jsonl
{"op":"create","task":{...},"timestamp":"...","source":"implementation-plan.md:15"}
```

## Process

### Step 1: Read Index

Start with `implementation-plan.md`. This is the active work index.

### Step 2: Identify Task Markers

Look for these patterns:

```markdown
- [ ] Task description → pending task
- [x] Task description → completed task
- TODO: description → informal task
- FIXME: description → bug task
- Phase N: Title → epic/milestone

### Section Header
→ May contain task list
```

### Step 3: Extract Task Structure

For each task found:

```typescript
{
  id: generateId(),           // RALPH-XXX
  type: inferType(context),   // task, feature, bug, etc.
  title: extractTitle(line),
  description: extractDescription(context),
  spec: findSpecCitation(line),  // e.g., "./specs/task-schema.md"
  source: {
    type: 'spec',
    path: currentFile,
    line: lineNumber
  },
  status: isChecked ? 'done' : 'discovered',
  parent: findParentTask(context),
  createdAt: now()
}
```

### Step 4: Resolve Citations

If task references a spec:
```markdown
- [ ] Write task schema → [specs/task-schema.md](./specs/task-schema.md)
```

Read the cited spec to enrich the task description.

### Step 5: Detect Hierarchy

```markdown
### Phase 1: Foundation        → parent task (epic)
- [ ] Write AGENTS.md          → child task
  - [ ] Define agent index     → subtask
  - [ ] Define conventions     → subtask
```

### Step 6: Deduplicate

Before creating:
1. Read existing `tasks.jsonl`
2. Check if task already exists (by title + source)
3. If exists, skip or update
4. If new, create

### Step 7: Output

Append create operations to `tasks.jsonl`:

```jsonl
{"op":"create","task":{"id":"RALPH-001","type":"task","title":"Write task schema specification","spec":"./specs/task-schema.md","status":"discovered","source":{"type":"spec","path":"./implementation-plan.md","line":15},"createdAt":"2024-01-15T10:00:00Z"},"timestamp":"2024-01-15T10:00:00Z"}
```

## Type Inference

| Context | Inferred Type |
|---------|---------------|
| Under "Phase N" | epic |
| Has subtasks | feature |
| Contains "fix", "bug", "broken" | bug |
| Contains "refactor", "clean" | refactor |
| Contains "test", "spec" | test |
| Contains "doc", "readme" | docs |
| Contains "investigate", "spike" | spike |
| Default | task |

## Edge Cases

### Nested Lists
```markdown
- [ ] Parent
  - [ ] Child 1
  - [ ] Child 2
```
→ Create parent-child relationships

### Multiple Checklists
```markdown
## Section A
- [ ] Task A1

## Section B
- [ ] Task B1
```
→ Group by section context

### Mixed Checked/Unchecked
```markdown
- [x] Done task
- [ ] Pending task
```
→ Respect status

### Inline Code References
```markdown
- [ ] Update `src/config.ts` to support new format
```
→ Extract file path as context

## Metrics

Record for learning:

| Metric | Description |
|--------|-------------|
| tasks_discovered | Total new tasks found |
| tasks_from_plan | From implementation plan |
| tasks_from_specs | From spec files |
| hierarchy_depth | Max nesting level |

## Escalation

Escalate to human when:
- Ambiguous task description
- Conflicting information between sources
- Task references non-existent spec
- Circular dependencies detected

## Example Run

Input (`implementation-plan.md`):
```markdown
### Phase 1: Foundation
- [x] Create directory structure
- [ ] Write task schema → [specs/task-schema.md](./specs/task-schema.md)
- [ ] Write loop mechanics → [specs/loop-mechanics.md](./specs/loop-mechanics.md)
```

Output (`tasks.jsonl`):
```jsonl
{"op":"create","task":{"id":"RALPH-001","type":"epic","title":"Phase 1: Foundation","status":"in_progress",...}}
{"op":"create","task":{"id":"RALPH-002","type":"task","title":"Create directory structure","parent":"RALPH-001","status":"done",...}}
{"op":"create","task":{"id":"RALPH-003","type":"task","title":"Write task schema","parent":"RALPH-001","spec":"./specs/task-schema.md","status":"discovered",...}}
{"op":"create","task":{"id":"RALPH-004","type":"task","title":"Write loop mechanics","parent":"RALPH-001","spec":"./specs/loop-mechanics.md","status":"discovered",...}}
```

---

*Spec: [../specs/task-schema.md](../specs/task-schema.md)*
*Index: [./AGENTS.md](./AGENTS.md)*
