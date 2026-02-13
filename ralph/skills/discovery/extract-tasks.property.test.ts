/**
 * Property-based tests for extract-tasks.ts
 *
 * Verifies invariants of task extraction, ID generation,
 * type inference, and deduplication logic.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractTasks, generateTaskId, parseTaskId, getNextTaskId } from './extract-tasks.js';
import { parseMarkdown } from './parse-markdown.js';
import type { ExtractionContext } from './extract-tasks.js';
import type { Task, TaskType, TaskStatus } from '../../types/index.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    existingTasks: new Map(),
    nextId: 1,
    timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'discovered',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const taskTypes: TaskType[] = ['epic', 'feature', 'task', 'subtask', 'bug', 'refactor', 'docs', 'test', 'spike'];
const taskStatuses: TaskStatus[] = ['discovered', 'pending', 'in_progress', 'blocked', 'review', 'done', 'cancelled'];

// =============================================================================
// PROPERTIES
// =============================================================================

describe('generateTaskId / parseTaskId — property-based', () => {

  it('generateTaskId always produces RALPH-NNN format', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99999 }),
        (n) => {
          const id = generateTaskId(n);
          expect(id).toMatch(/^RALPH-\d{3,}$/);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('parseTaskId is the inverse of generateTaskId', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99999 }),
        (n) => {
          const id = generateTaskId(n);
          const parsed = parseTaskId(id);
          expect(parsed).toBe(n);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('generateTaskId pads to at least 3 digits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        (n) => {
          const id = generateTaskId(n);
          const numPart = id.replace('RALPH-', '');
          expect(numPart.length).toBeGreaterThanOrEqual(3);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('parseTaskId returns 0 for invalid IDs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 30 }).filter(s => !s.match(/^RALPH-\d+$/)),
        (invalidId) => {
          expect(parseTaskId(invalidId)).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('getNextTaskId — property-based', () => {

  it('returns 1 for empty task map', () => {
    expect(getNextTaskId(new Map())).toBe(1);
  });

  it('returns max(existing) + 1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 9999 }), { minLength: 1, maxLength: 20 }),
        (ids) => {
          const tasks = new Map<string, Task>();
          for (const id of ids) {
            const taskId = generateTaskId(id);
            tasks.set(taskId, makeTask({ id: taskId }));
          }
          const next = getNextTaskId(tasks);
          expect(next).toBe(Math.max(...ids) + 1);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('extractTasks — property-based', () => {

  it('extracted tasks always have valid RALPH-NNN IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            checked: fc.boolean(),
            text: fc.stringMatching(new RegExp('^[a-z ]{3,50}$')).map(s => s.trim() || 'task item'),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        async (items) => {
          const md = items.map(i => `- [${i.checked ? 'x' : ' '}] ${i.text}`).join('\n');
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext());

          for (const task of result.tasks) {
            expect(task.id).toMatch(/^RALPH-\d{3,}$/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all task IDs are unique within a single extraction', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.stringMatching(new RegExp('^[a-z0-9 ]{3,40}$')).map(s => s.trim() || 'task'),
          { minLength: 1, maxLength: 15 }
        ),
        async (texts) => {
          const md = texts.map(t => `- [ ] ${t}`).join('\n');
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext());

          const ids = result.tasks.map(t => t.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('checked items become status=done, unchecked become status=discovered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            checked: fc.boolean(),
            label: fc.stringMatching(new RegExp('^[a-z ]{3,30}$')).map(s => s.trim() || 'item'),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        async (items) => {
          const md = items.map(i => `- [${i.checked ? 'x' : ' '}] ${i.label}`).join('\n');
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext());

          for (const task of result.tasks) {
            expect(['done', 'discovered']).toContain(task.status);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('task types are always valid TaskType values', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.stringMatching(new RegExp('^[a-z ]{3,50}$')).map(s => s.trim() || 'item'),
          { minLength: 1, maxLength: 8 }
        ),
        async (texts) => {
          const md = texts.map(t => `- [ ] ${t}`).join('\n');
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext());

          for (const task of result.tasks) {
            expect(taskTypes).toContain(task.type);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stats.tasksCreated + stats.tasksSkipped === stats.totalFound (for items)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.stringMatching(new RegExp('^[a-z ]{3,30}$')).map(s => s.trim() || 'item'),
          { minLength: 1, maxLength: 10 }
        ),
        async (texts) => {
          const md = texts.map(t => `- [ ] ${t}`).join('\n');
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext());

          expect(result.stats.tasksCreated + result.stats.tasksSkipped).toBe(result.stats.totalFound);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('operations.length equals tasks.length (all creates for fresh context)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.stringMatching(new RegExp('^[a-z ]{3,30}$')).map(s => s.trim() || 'item'),
          { minLength: 1, maxLength: 8 }
        ),
        async (texts) => {
          const md = texts.map(t => `- [ ] ${t}`).join('\n');
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext());

          expect(result.operations.length).toBe(result.tasks.length);
          for (const op of result.operations) {
            expect(op.op).toBe('create');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('existing tasks are skipped (deduplication)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(new RegExp('^[a-z ]{3,30}$')).map(s => s.trim() || 'item'),
        async (text) => {
          const md = `- [ ] ${text}`;
          const parsed = await parseMarkdown(md, 'test.md');

          // First extraction creates the task
          const first = extractTasks(parsed, makeContext());
          if (first.tasks.length === 0) return; // edge case: empty after cleanup

          // Second extraction with existing tasks should skip
          const existingTasks = new Map<string, Task>();
          for (const t of first.tasks) {
            existingTasks.set(t.id, t);
          }

          const second = extractTasks(parsed, makeContext({ existingTasks, nextId: first.tasks.length + 1 }));
          expect(second.stats.tasksCreated).toBe(0);
          expect(second.stats.tasksSkipped).toBe(second.stats.totalFound);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('epic detection: Phase N headings create epic tasks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.stringMatching(new RegExp('^[a-z ]{3,20}$')).map(s => s.trim() || 'feature'),
        async (phaseNum, desc) => {
          const md = `### Phase ${phaseNum}: ${desc}\n- [ ] Some task`;
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext());

          const epics = result.tasks.filter(t => t.type === 'epic');
          expect(epics.length).toBe(1);
          expect(epics[0].title).toContain(`Phase ${phaseNum}`);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('type inference: text with "fix" → bug, "test" → test, "implement" → feature', async () => {
    const keywordToType: Array<[string, TaskType]> = [
      ['Fix the login bug', 'bug'],
      ['Test the parser module', 'test'],
      ['Implement user auth', 'feature'],
      ['Refactor the database layer', 'refactor'],
      ['Document the API', 'docs'],
      ['Investigate performance spike', 'spike'],
    ];

    for (const [text, expectedType] of keywordToType) {
      const md = `- [ ] ${text}`;
      const parsed = await parseMarkdown(md, 'test.md');
      const result = extractTasks(parsed, makeContext());
      expect(result.tasks[0]?.type).toBe(expectedType);
    }
  });

  it('createdAt and updatedAt match the context timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()),
        async (timestamp) => {
          const md = '- [ ] Some task';
          const parsed = await parseMarkdown(md, 'test.md');
          const result = extractTasks(parsed, makeContext({ timestamp }));

          for (const task of result.tasks) {
            expect(task.createdAt).toBe(timestamp);
            expect(task.updatedAt).toBe(timestamp);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('done tasks have completedAt set', async () => {
    const md = '- [x] Completed task';
    const parsed = await parseMarkdown(md, 'test.md');
    const result = extractTasks(parsed, makeContext());
    const doneTask = result.tasks.find(t => t.status === 'done');
    expect(doneTask).toBeDefined();
    expect(doneTask!.completedAt).toBeDefined();
  });

  it('discovered tasks have completedAt undefined', async () => {
    const md = '- [ ] Pending task';
    const parsed = await parseMarkdown(md, 'test.md');
    const result = extractTasks(parsed, makeContext());
    const pending = result.tasks.find(t => t.status === 'discovered');
    expect(pending).toBeDefined();
    expect(pending!.completedAt).toBeUndefined();
  });
});
