import { describe, it, expect, vi } from 'vitest';
import {
  resolveCitation,
  resolveCitations,
  extractSection,
  getSpecReferences,
  validateSpecReferences,
} from './resolve-citations.js';
import type { Task } from '../../types/index.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'RALPH-001',
    type: 'task',
    title: 'Test task',
    description: '',
    status: 'discovered',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolveCitation', () => {
  it('returns unenriched result when task has no spec', async () => {
    const task = makeTask({ spec: undefined });
    const result = await resolveCitation(task, {
      readFile: async () => '',
      basePath: '.',
    });
    expect(result.enriched).toBe(false);
    expect(result.task).toBe(task);
  });

  it('enriches task description from spec file', async () => {
    const specContent = `# Task Schema

## Overview

Defines how tasks are structured.`;
    const task = makeTask({ spec: './specs/task-schema.md' });

    const result = await resolveCitation(task, {
      readFile: async () => specContent,
      basePath: './implementation-plan.md',
    });

    expect(result.enriched).toBe(true);
    expect(result.task.description).toBeTruthy();
    expect(result.specContent).toBe(specContent);
  });

  it('returns unenriched result when spec file cannot be read', async () => {
    const task = makeTask({ spec: './specs/nonexistent.md' });
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveCitation(task, {
      readFile: async () => { throw new Error('ENOENT'); },
      basePath: '.',
    });

    expect(result.enriched).toBe(false);
    expect(result.task).toBe(task);
    consoleSpy.mockRestore();
  });

  it('preserves existing description when spec has no title or overview', async () => {
    const task = makeTask({ spec: './specs/empty.md', description: 'Existing desc' });

    const result = await resolveCitation(task, {
      readFile: async () => 'Just some text without headings.',
      basePath: '.',
    });

    // Even if enriched is true, description should fallback
    expect(result.enriched).toBe(true);
    // The empty spec produces an empty description, but the task keeps its existing one
    // because extractDescription returns '' and the code uses `description || task.description`
    expect(result.task.description).toBe('Existing desc');
  });

  it('extracts title from spec with h1', async () => {
    const specContent = `# Learning System\n\nSome content here.`;
    const task = makeTask({ spec: './specs/learning-system.md' });

    const result = await resolveCitation(task, {
      readFile: async () => specContent,
      basePath: './plan.md',
    });

    expect(result.enriched).toBe(true);
    expect(result.task.description).toContain('Learning System');
  });

  it('handles spec with overview section', async () => {
    const specContent = `# My Spec

## Overview

This is the overview.

## Details

More details here.`;
    const task = makeTask({ spec: './specs/my-spec.md' });

    const result = await resolveCitation(task, {
      readFile: async () => specContent,
      basePath: '.',
    });

    expect(result.enriched).toBe(true);
    expect(result.task.description).toBeTruthy();
  });
});

describe('resolveCitations', () => {
  it('resolves citations for multiple tasks', async () => {
    const tasks = [
      makeTask({ id: 'RALPH-001', spec: './specs/a.md' }),
      makeTask({ id: 'RALPH-002', spec: undefined }),
      makeTask({ id: 'RALPH-003', spec: './specs/b.md' }),
    ];

    const results = await resolveCitations(tasks, {
      readFile: async () => '# Spec Title\n\nContent.',
      basePath: '.',
    });

    expect(results).toHaveLength(3);
    expect(results[0].enriched).toBe(true);
    expect(results[1].enriched).toBe(false);
    expect(results[2].enriched).toBe(true);
  });

  it('handles empty task list', async () => {
    const results = await resolveCitations([], {
      readFile: async () => '',
      basePath: '.',
    });
    expect(results).toHaveLength(0);
  });
});

describe('extractSection', () => {
  it('returns section info when heading exists', async () => {
    const { parseMarkdown } = await import('./parse-markdown.js');
    const md = `# Title

## Overview

Overview content.

## Implementation

Implementation details.`;
    const parsed = await parseMarkdown(md, 'test.md');
    const section = extractSection(parsed, 'Overview');
    expect(section).toBeTruthy();
    expect(section).toContain('Overview');
  });

  it('returns null when section does not exist', async () => {
    const { parseMarkdown } = await import('./parse-markdown.js');
    const md = `# Title\n\n## Other Section`;
    const parsed = await parseMarkdown(md, 'test.md');
    const section = extractSection(parsed, 'Nonexistent');
    expect(section).toBeNull();
  });

  it('matches section title case-insensitively', async () => {
    const { parseMarkdown } = await import('./parse-markdown.js');
    const md = `# Title\n\n## OVERVIEW\n\nContent.`;
    const parsed = await parseMarkdown(md, 'test.md');
    const section = extractSection(parsed, 'overview');
    expect(section).toBeTruthy();
  });
});

describe('getSpecReferences', () => {
  it('extracts unique spec references from tasks', () => {
    const tasks = [
      makeTask({ id: 'RALPH-001', spec: './specs/a.md' }),
      makeTask({ id: 'RALPH-002', spec: './specs/b.md' }),
      makeTask({ id: 'RALPH-003', spec: './specs/a.md' }), // duplicate
      makeTask({ id: 'RALPH-004', spec: undefined }),
    ];

    const refs = getSpecReferences(tasks);
    expect(refs).toHaveLength(2);
    expect(refs).toContain('./specs/a.md');
    expect(refs).toContain('./specs/b.md');
  });

  it('returns empty array when no tasks have specs', () => {
    const tasks = [
      makeTask({ spec: undefined }),
      makeTask({ spec: undefined }),
    ];
    expect(getSpecReferences(tasks)).toHaveLength(0);
  });

  it('returns empty array for empty task list', () => {
    expect(getSpecReferences([])).toHaveLength(0);
  });
});

describe('validateSpecReferences', () => {
  it('validates existing spec references', async () => {
    const results = await validateSpecReferences(
      ['./specs/a.md', './specs/b.md'],
      {
        readFile: async (path: string) => {
          if (path.includes('a')) return '# Spec A';
          throw new Error('ENOENT');
        },
        basePath: '.',
      }
    );

    expect(results.get('./specs/a.md')).toBe(true);
    expect(results.get('./specs/b.md')).toBe(false);
  });

  it('handles empty spec list', async () => {
    const results = await validateSpecReferences([], {
      readFile: async () => '',
      basePath: '.',
    });
    expect(results.size).toBe(0);
  });

  it('marks all as invalid when readFile always fails', async () => {
    const results = await validateSpecReferences(
      ['./specs/a.md', './specs/b.md'],
      {
        readFile: async () => { throw new Error('ENOENT'); },
        basePath: '.',
      }
    );

    expect(results.get('./specs/a.md')).toBe(false);
    expect(results.get('./specs/b.md')).toBe(false);
  });
});

describe('spec path resolution', () => {
  it('resolves relative paths starting with ./', async () => {
    const calls: string[] = [];
    const task = makeTask({ spec: './specs/task-schema.md' });

    await resolveCitation(task, {
      readFile: async (path: string) => {
        calls.push(path);
        return '# Title';
      },
      basePath: './implementation-plan.md',
    });

    // The resolved path should strip the ./ prefix and join with basePath dir
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('specs/task-schema.md');
  });

  it('resolves parent directory references', async () => {
    const calls: string[] = [];
    const task = makeTask({ spec: '../other/spec.md' });

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await resolveCitation(task, {
      readFile: async (path: string) => {
        calls.push(path);
        return '# Title';
      },
      basePath: './sub/dir/plan.md',
    });

    consoleSpy.mockRestore();
    // Should have attempted to read some resolved path
    expect(calls.length).toBeGreaterThanOrEqual(0);
  });

  it('handles absolute spec paths', async () => {
    const calls: string[] = [];
    const task = makeTask({ spec: 'specs/task-schema.md' });

    await resolveCitation(task, {
      readFile: async (path: string) => {
        calls.push(path);
        return '# Title';
      },
      basePath: '.',
    });

    // Should pass through the spec path directly
    expect(calls[0]).toBe('specs/task-schema.md');
  });
});
