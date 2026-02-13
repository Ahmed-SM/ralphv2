import { describe, it, expect } from 'vitest';
import { extractTasks, generateTaskId, parseTaskId, getNextTaskId } from './extract-tasks.js';
import { parseMarkdown } from './parse-markdown.js';
import type { ExtractionContext } from './extract-tasks.js';
import type { Task } from '../../types/index.js';

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    existingTasks: new Map(),
    nextId: 1,
    timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('generateTaskId', () => {
  it('pads single digit', () => {
    expect(generateTaskId(1)).toBe('RALPH-001');
  });

  it('pads double digit', () => {
    expect(generateTaskId(42)).toBe('RALPH-042');
  });

  it('handles triple digit', () => {
    expect(generateTaskId(100)).toBe('RALPH-100');
  });

  it('handles large numbers', () => {
    expect(generateTaskId(1234)).toBe('RALPH-1234');
  });
});

describe('parseTaskId', () => {
  it('extracts number from valid ID', () => {
    expect(parseTaskId('RALPH-001')).toBe(1);
    expect(parseTaskId('RALPH-042')).toBe(42);
    expect(parseTaskId('RALPH-100')).toBe(100);
  });

  it('returns 0 for invalid ID', () => {
    expect(parseTaskId('INVALID')).toBe(0);
    expect(parseTaskId('')).toBe(0);
    expect(parseTaskId('RALPH-')).toBe(0);
  });
});

describe('getNextTaskId', () => {
  it('returns 1 for empty tasks', () => {
    expect(getNextTaskId(new Map())).toBe(1);
  });

  it('returns max + 1', () => {
    const tasks = new Map<string, Task>();
    tasks.set('RALPH-005', { id: 'RALPH-005' } as Task);
    tasks.set('RALPH-003', { id: 'RALPH-003' } as Task);
    expect(getNextTaskId(tasks)).toBe(6);
  });
});

describe('extractTasks', () => {
  it('extracts simple tasks from markdown', async () => {
    const md = `## Tasks
- [ ] Implement feature A
- [x] Write documentation`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].id).toBe('RALPH-001');
    expect(result.tasks[0].title).toContain('Implement feature A');
    expect(result.tasks[0].status).toBe('discovered');
    expect(result.tasks[1].status).toBe('done');
    expect(result.stats.tasksCreated).toBe(2);
  });

  it('creates epic from phase heading', async () => {
    const md = `### Phase 1: Foundation ✅ COMPLETE
- [x] Create directory structure
- [x] Write AGENTS.md`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    // Should create an epic + 2 tasks
    const epic = result.tasks.find(t => t.type === 'epic');
    expect(epic).toBeDefined();
    expect(epic!.title).toContain('Phase 1');
    expect(epic!.status).toBe('done');
    expect(result.stats.epicsFound).toBe(1);
  });

  it('links tasks to parent epic', async () => {
    const md = `### Phase 2: Task Discovery
- [ ] Implement markdown parser
- [ ] Implement task extractor`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    const epic = result.tasks.find(t => t.type === 'epic');
    const childTasks = result.tasks.filter(t => t.parent === epic?.id);
    expect(childTasks).toHaveLength(2);
  });

  it('skips existing tasks by title match', async () => {
    const md = `- [ ] Existing task
- [ ] New task`;
    const parsed = await parseMarkdown(md, 'plan.md');

    const existingTasks = new Map<string, Task>();
    existingTasks.set('RALPH-001', {
      id: 'RALPH-001',
      title: 'Existing task',
      type: 'task',
      status: 'in_progress',
    } as Task);

    const context = makeContext({ existingTasks, nextId: 2 });
    const result = extractTasks(parsed, context);

    expect(result.stats.tasksSkipped).toBe(1);
    expect(result.stats.tasksCreated).toBe(1);
  });

  it('handles nested subtasks', async () => {
    const md = `- [ ] Parent task
  - [ ] Sub task one
  - [ ] Sub task two`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    const subtasks = result.tasks.filter(t => t.type === 'subtask');
    expect(subtasks.length).toBeGreaterThanOrEqual(2);
    expect(result.stats.subtasksFound).toBeGreaterThanOrEqual(2);
  });

  it('infers task types from text', async () => {
    const md = `- [ ] Fix login bug
- [ ] Refactor auth module
- [ ] Add user registration
- [ ] Test payment flow
- [ ] Document API endpoints
- [ ] Investigate performance spike`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    const types = result.tasks.map(t => t.type);
    expect(types).toContain('bug');
    expect(types).toContain('refactor');
    expect(types).toContain('feature');
    expect(types).toContain('test');
    expect(types).toContain('docs');
    expect(types).toContain('spike');
  });

  it('increments IDs correctly across tasks', async () => {
    const md = `- [ ] Task one
- [ ] Task two
- [ ] Task three`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    expect(result.tasks[0].id).toBe('RALPH-001');
    expect(result.tasks[1].id).toBe('RALPH-002');
    expect(result.tasks[2].id).toBe('RALPH-003');
  });

  it('creates corresponding operations for each task', async () => {
    const md = `- [ ] Task A
- [ ] Task B`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    expect(result.operations).toHaveLength(2);
    expect(result.operations[0].op).toBe('create');
    expect(result.operations[0].timestamp).toBe('2025-01-01T00:00:00Z');
  });

  it('extracts spec links from task items', async () => {
    const md = `- [ ] Task schema → [specs/task-schema.md](./specs/task-schema.md)`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    expect(result.tasks[0].spec).toBe('./specs/task-schema.md');
  });

  it('marks completed tasks with completedAt timestamp', async () => {
    const md = `- [x] Done task`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    expect(result.tasks[0].status).toBe('done');
    expect(result.tasks[0].completedAt).toBe('2025-01-01T00:00:00Z');
  });

  it('returns empty result for no task lists', async () => {
    const md = `# Just a heading\n\nSome paragraph text.`;
    const parsed = await parseMarkdown(md, 'plan.md');
    const result = extractTasks(parsed, makeContext());

    expect(result.tasks).toHaveLength(0);
    expect(result.stats.totalFound).toBe(0);
  });
});
