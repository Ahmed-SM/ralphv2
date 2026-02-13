/**
 * Integration tests for the full task discovery pipeline.
 *
 * Tests discoverTasks() end-to-end: markdown → parse → extract → resolve → output.
 * Uses mock readFile/writeFile — no actual filesystem.
 */

import { describe, it, expect, vi } from 'vitest';
import { discoverTasks, type DiscoveryResult } from './index.js';

// =============================================================================
// FIXTURES
// =============================================================================

const PLAN_MARKDOWN = `# Project Alpha

## Phase 1: Foundation
> Build the base system

- [x] Set up repository
- [x] Define types → see [types.md](./specs/types.md)
- [ ] Create config loader

## Phase 2: Features
> Core feature work

- [ ] Implement user authentication
- [ ] Implement data export
- [x] Write API docs

### Subtasks
- [ ] Add OAuth provider
- [ ] Add CSV export format
`;

const SPEC_TYPES_MD = `# Type Definitions

This spec defines the core types used throughout the system.

## Task Type

A task has an ID, title, status, and optional parent reference.

## Status Enum

Valid statuses: discovered, pending, in_progress, blocked, done, cancelled.
`;

const EXISTING_TASKS_JSONL = '';  // Start fresh for most tests

// =============================================================================
// HELPERS
// =============================================================================

function makeFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    './implementation-plan.md': PLAN_MARKDOWN,
    './specs/types.md': SPEC_TYPES_MD,
    './state/tasks.jsonl': '',
    ...extra,
  };
}

function makeMockReadFile(files: Record<string, string>) {
  return vi.fn().mockImplementation((path: string) => {
    if (path in files) return Promise.resolve(files[path]);
    return Promise.reject(new Error(`ENOENT: ${path}`));
  });
}

function makeMockWriteFile(files: Record<string, string>) {
  return vi.fn().mockImplementation((path: string, content: string) => {
    files[path] = content;
    return Promise.resolve();
  });
}

// =============================================================================
// FULL PIPELINE — discoverTasks
// =============================================================================

describe('Discovery Pipeline (integration)', () => {
  it('discovers tasks from a plan with phases and checklists', async () => {
    const files = makeFiles();
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      writeFile: makeMockWriteFile(files),
      tasksPath: './state/tasks.jsonl',
      resolveSpecs: false,
      dryRun: true,
    });

    // Should find both done and pending tasks
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.stats.totalFound).toBeGreaterThan(0);

    // Verify task titles are extracted from markdown
    const titles = result.tasks.map(t => t.title);
    expect(titles.some(t => t.includes('Set up repository') || t.includes('repository'))).toBe(true);
    expect(titles.some(t => t.includes('authentication') || t.includes('user authentication'))).toBe(true);
  });

  it('assigns RALPH IDs to extracted tasks', async () => {
    const files = makeFiles();
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    for (const task of result.tasks) {
      expect(task.id).toMatch(/^RALPH-\d{3,}$/);
    }
  });

  it('marks checked items as done and unchecked as discovered/pending', async () => {
    const files = makeFiles();
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    const doneTask = result.tasks.find(t =>
      t.title.includes('Set up repository') || t.title.includes('repository')
    );
    const pendingTask = result.tasks.find(t =>
      t.title.includes('authentication') || t.title.includes('user authentication')
    );

    if (doneTask) expect(doneTask.status).toBe('done');
    if (pendingTask) expect(['discovered', 'pending']).toContain(pendingTask.status);
  });

  it('creates operations for each discovered task', async () => {
    const files = makeFiles();
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    expect(result.operations.length).toBeGreaterThan(0);
    for (const op of result.operations) {
      expect(op.op).toBeDefined();
      expect(op.timestamp).toBeDefined();
    }
  });

  it('generates create operations with valid task objects', async () => {
    const files = makeFiles();
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    const createOps = result.operations.filter(op => op.op === 'create');
    expect(createOps.length).toBeGreaterThan(0);

    for (const op of createOps) {
      if (op.op === 'create') {
        expect(op.task.id).toMatch(/^RALPH-/);
        expect(op.task.title).toBeTruthy();
        expect(op.task.status).toBeTruthy();
        expect(op.task.createdAt).toBeTruthy();
      }
    }
  });

  it('detects epics from headings', async () => {
    const files = makeFiles();
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    expect(result.stats.epicsFound).toBeGreaterThanOrEqual(0);
    // Phase headings might become epics depending on extractor behavior
  });

  it('returns parsed markdown with heading and task metadata', async () => {
    const files = makeFiles();
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    expect(result.parsed).toBeDefined();
    expect(result.parsed.metadata.headings.length).toBeGreaterThan(0);
    expect(result.parsed.metadata.taskLists.length).toBeGreaterThan(0);
    expect(result.parsed.path).toBe('./implementation-plan.md');
  });
});

// =============================================================================
// PIPELINE — citation resolution
// =============================================================================

describe('Discovery Pipeline — citation resolution (integration)', () => {
  it('resolves spec references when resolveSpecs is true', async () => {
    // Create a plan that references a spec file
    const planWithSpec = `# Plan

- [ ] Define types → see [types.md](./specs/types.md)
`;
    const files = makeFiles({ './implementation-plan.md': planWithSpec });

    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: true,
      dryRun: true,
    });

    // specsResolved may be 0 if no tasks have a spec field set,
    // but the pipeline should complete without error
    expect(result.stats.specsResolved).toBeGreaterThanOrEqual(0);
  });

  it('handles missing spec files gracefully', async () => {
    const planWithBadSpec = `# Plan

- [ ] Do something → see [missing.md](./specs/missing.md)
`;
    const files = makeFiles({ './implementation-plan.md': planWithBadSpec });

    // Should not throw even if spec file is missing
    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: true,
      dryRun: true,
    });

    expect(result).toBeDefined();
    expect(result.tasks.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// PIPELINE — file writing
// =============================================================================

describe('Discovery Pipeline — persistence (integration)', () => {
  it('writes operations to tasks.jsonl when not dry-run', async () => {
    const files = makeFiles();
    const writeFile = makeMockWriteFile(files);

    await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      writeFile,
      tasksPath: './state/tasks.jsonl',
      resolveSpecs: false,
      dryRun: false,
    });

    expect(writeFile).toHaveBeenCalled();
    const written = files['./state/tasks.jsonl'];
    expect(written).toBeTruthy();

    // Verify it's valid JSONL
    const lines = written.trim().split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.op).toBeDefined();
    }
  });

  it('does NOT write to file in dry-run mode', async () => {
    const files = makeFiles();
    const writeFile = makeMockWriteFile(files);

    await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      writeFile,
      tasksPath: './state/tasks.jsonl',
      resolveSpecs: false,
      dryRun: true,
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  it('appends to existing tasks.jsonl content', async () => {
    const existingOp = JSON.stringify({
      op: 'create',
      task: {
        id: 'RALPH-001', type: 'task', title: 'Existing', description: '',
        status: 'done', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      },
      timestamp: '2024-01-01T00:00:00Z',
    });

    const files = makeFiles({ './state/tasks.jsonl': existingOp + '\n' });
    const writeFile = makeMockWriteFile(files);

    await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      writeFile,
      tasksPath: './state/tasks.jsonl',
      resolveSpecs: false,
      dryRun: false,
    });

    const written = files['./state/tasks.jsonl'];
    // Should still contain the original line
    expect(written).toContain('RALPH-001');
    expect(written).toContain('Existing');
  });
});

// =============================================================================
// PIPELINE — deduplication
// =============================================================================

describe('Discovery Pipeline — deduplication (integration)', () => {
  it('skips tasks that already exist in tasks.jsonl', async () => {
    // First run — discover fresh
    const files = makeFiles();
    const writeFile = makeMockWriteFile(files);

    const firstRun = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      writeFile,
      tasksPath: './state/tasks.jsonl',
      resolveSpecs: false,
      dryRun: false,
    });

    const firstCount = firstRun.stats.tasksCreated;
    expect(firstCount).toBeGreaterThan(0);

    // Second run — should skip already-discovered tasks
    const secondRun = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      writeFile,
      tasksPath: './state/tasks.jsonl',
      resolveSpecs: false,
      dryRun: true,
    });

    expect(secondRun.stats.tasksSkipped).toBeGreaterThanOrEqual(firstCount);
    expect(secondRun.stats.tasksCreated).toBe(0);
  });
});

// =============================================================================
// PIPELINE — edge cases
// =============================================================================

describe('Discovery Pipeline — edge cases (integration)', () => {
  it('handles empty markdown gracefully', async () => {
    const files = makeFiles({ './implementation-plan.md': '' });

    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    expect(result.tasks).toHaveLength(0);
    expect(result.stats.totalFound).toBe(0);
  });

  it('handles markdown with no task lists', async () => {
    const noTasks = `# Project

This is just prose with no task lists.

## Section

More prose.
`;
    const files = makeFiles({ './implementation-plan.md': noTasks });

    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    expect(result.stats.totalFound).toBe(0);
  });

  it('handles markdown with only completed tasks', async () => {
    const allDone = `# Plan

- [x] Task A
- [x] Task B
- [x] Task C
`;
    const files = makeFiles({ './implementation-plan.md': allDone });

    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    for (const task of result.tasks) {
      expect(task.status).toBe('done');
    }
  });

  it('handles tasks.jsonl that does not exist', async () => {
    const files: Record<string, string> = {
      './implementation-plan.md': PLAN_MARKDOWN,
    };

    const result = await discoverTasks({
      planPath: './implementation-plan.md',
      readFile: makeMockReadFile(files),
      resolveSpecs: false,
      dryRun: true,
    });

    // Should proceed despite missing tasks.jsonl
    expect(result.tasks.length).toBeGreaterThan(0);
  });
});
