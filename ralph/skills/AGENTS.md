# Skills Index

> Skills are executable TypeScript modules that agents use to perform actions.

## Philosophy

Skills are the "hands" of agents. They:
1. Are pure functions where possible
2. Take typed inputs, return typed outputs
3. Are testable in isolation
4. Can be composed into workflows
5. Are discovered via filesystem

## Directory Structure

```
skills/
  AGENTS.md           # This file
  discovery/          # Task extraction skills
    parse-markdown.ts
    extract-tasks.ts
    resolve-citations.ts
  normalize/          # Data transformation
    to-common-schema.ts
    create-issue.ts
    update-status.ts
  track/              # Progress tracking
    parse-commits.ts
    link-commits.ts
    infer-status.ts
    record-metrics.ts
```

## Skill Interface

```typescript
interface Skill<TInput, TOutput> {
  name: string;
  description: string;

  // Schema for validation
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;

  // Execution
  execute(input: TInput, context: SkillContext): Promise<TOutput>;
}

interface SkillContext {
  sandbox: Sandbox;        // just-bash environment
  config: Config;          // Ralph configuration
  logger: Logger;          // Structured logging
}
```

## Example Skill

```typescript
// skills/discovery/extract-tasks.ts

import { Skill } from '../types';
import { Task, MarkdownDocument } from '../../specs/types';

export const extractTasks: Skill<MarkdownDocument, Task[]> = {
  name: 'extract-tasks',
  description: 'Extract tasks from a parsed markdown document',

  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      ast: { type: 'object' }
    },
    required: ['path', 'ast']
  },

  outputSchema: {
    type: 'array',
    items: { $ref: '#/definitions/Task' }
  },

  async execute(doc, context) {
    const tasks: Task[] = [];

    // Walk AST looking for task markers
    walk(doc.ast, (node) => {
      if (isTaskItem(node)) {
        tasks.push(nodeToTask(node, doc.path));
      }
    });

    context.logger.info(`Extracted ${tasks.length} tasks from ${doc.path}`);
    return tasks;
  }
};
```

## Skill Discovery

Skills are discovered at runtime:

```typescript
async function discoverSkills(dir: string): Promise<Map<string, Skill>> {
  const skills = new Map();
  const files = await glob(`${dir}/**/*.ts`);

  for (const file of files) {
    const module = await import(file);
    for (const [name, skill] of Object.entries(module)) {
      if (isSkill(skill)) {
        skills.set(skill.name, skill);
      }
    }
  }

  return skills;
}
```

## Skill Composition

Skills can be composed:

```typescript
const taskDiscoveryPipeline = compose(
  parseMarkdown,
  extractTasks,
  resolveCitations,
  deduplicateTasks
);

const result = await taskDiscoveryPipeline.execute(input, context);
```

## Testing Skills

Each skill should have tests:

```typescript
// skills/discovery/extract-tasks.test.ts

import { extractTasks } from './extract-tasks';

describe('extractTasks', () => {
  it('extracts checkbox items as tasks', async () => {
    const doc = parseMarkdown('- [ ] Task one\n- [ ] Task two');
    const tasks = await extractTasks.execute(doc, mockContext);
    expect(tasks).toHaveLength(2);
  });

  it('marks checked items as done', async () => {
    const doc = parseMarkdown('- [x] Done task');
    const tasks = await extractTasks.execute(doc, mockContext);
    expect(tasks[0].status).toBe('done');
  });
});
```

## Adding New Skills

1. Create file in appropriate category
2. Implement `Skill` interface
3. Export as named export
4. Add tests
5. Document in this index

---

*Referenced by: [../AGENTS.md](../AGENTS.md)*
