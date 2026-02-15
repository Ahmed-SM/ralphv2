import { describe, it, expect } from 'vitest';
import { resolveStatePaths, legacyStatePaths, slugifyRepoName } from './state-paths.js';

describe('slugifyRepoName', () => {
  it('normalizes repository name from working directory', () => {
    expect(slugifyRepoName('/tmp/My Repo')).toBe('my-repo');
  });

  it('falls back to repo for empty slug', () => {
    expect(slugifyRepoName('/tmp/---')).toBe('repo');
  });
});

describe('legacyStatePaths', () => {
  it('returns legacy state paths', () => {
    const paths = legacyStatePaths('core', 'ralph');
    expect(paths.baseDir).toBe('./state');
    expect(paths.tasks).toBe('./state/tasks.jsonl');
    expect(paths.scoped).toBe(false);
  });
});

describe('resolveStatePaths', () => {
  it('uses core scoped path when no state files exist', async () => {
    const readFile = async (_path: string): Promise<string> => {
      throw new Error('ENOENT');
    };

    const paths = await resolveStatePaths(readFile, '/tmp/ralph', 'core');
    expect(paths.baseDir).toBe('./state/core');
    expect(paths.tasks).toBe('./state/core/tasks.jsonl');
    expect(paths.scoped).toBe(true);
  });

  it('uses delivery scoped path when no state files exist', async () => {
    const readFile = async (_path: string): Promise<string> => {
      throw new Error('ENOENT');
    };

    const paths = await resolveStatePaths(readFile, '/tmp/Example Repo', 'delivery');
    expect(paths.baseDir).toBe('./state/delivery/example-repo');
    expect(paths.progress).toBe('./state/delivery/example-repo/progress.jsonl');
    expect(paths.scoped).toBe(true);
  });

  it('falls back to legacy path when legacy state exists', async () => {
    const files = new Map<string, string>([
      ['./state/tasks.jsonl', '{"op":"create"}\n'],
    ]);
    const readFile = async (path: string): Promise<string> => {
      const content = files.get(path);
      if (content === undefined) throw new Error('ENOENT');
      return content;
    };

    const paths = await resolveStatePaths(readFile, '/tmp/repo-name', 'delivery');
    expect(paths.baseDir).toBe('./state');
    expect(paths.scoped).toBe(false);
  });

  it('prefers scoped path when scoped state exists', async () => {
    const files = new Map<string, string>([
      ['./state/core/tasks.jsonl', '{"op":"create"}\n'],
      ['./state/tasks.jsonl', '{"op":"create"}\n'],
    ]);
    const readFile = async (path: string): Promise<string> => {
      const content = files.get(path);
      if (content === undefined) throw new Error('ENOENT');
      return content;
    };

    const paths = await resolveStatePaths(readFile, '/tmp/ralph', 'core');
    expect(paths.baseDir).toBe('./state/core');
    expect(paths.scoped).toBe(true);
  });
});
