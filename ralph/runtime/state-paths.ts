import { basename } from 'path';
import type { RalphMode } from '../types/index.js';

export interface StatePaths {
  baseDir: string;
  tasks: string;
  progress: string;
  learning: string;
  trackerOps: string;
  mode: RalphMode;
  repo: string;
  scoped: boolean;
}

const LEGACY_BASE_DIR = './state';
const CORE_BASE_DIR = './state/core';
const DELIVERY_BASE_DIR = './state/delivery';

function buildStatePaths(baseDir: string, mode: RalphMode, repo: string, scoped: boolean): StatePaths {
  return {
    baseDir,
    tasks: `${baseDir}/tasks.jsonl`,
    progress: `${baseDir}/progress.jsonl`,
    learning: `${baseDir}/learning.jsonl`,
    trackerOps: `${baseDir}/tracker-ops.jsonl`,
    mode,
    repo,
    scoped,
  };
}

async function exists(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyStateFile(
  readFile: (path: string) => Promise<string>,
  paths: StatePaths,
): Promise<boolean> {
  const [tasks, progress, learning] = await Promise.all([
    exists(readFile, paths.tasks),
    exists(readFile, paths.progress),
    exists(readFile, paths.learning),
  ]);
  return tasks || progress || learning;
}

export function slugifyRepoName(workDir: string): string {
  const raw = basename(workDir).toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return slug || 'repo';
}

export function legacyStatePaths(mode: RalphMode = 'core', repo = 'repo'): StatePaths {
  return buildStatePaths(LEGACY_BASE_DIR, mode, repo, false);
}

export async function resolveStatePaths(
  readFile: (path: string) => Promise<string>,
  workDir: string,
  mode: RalphMode = 'core',
): Promise<StatePaths> {
  const repo = slugifyRepoName(workDir);
  const scopedBase = mode === 'core'
    ? CORE_BASE_DIR
    : `${DELIVERY_BASE_DIR}/${repo}`;

  const scopedPaths = buildStatePaths(scopedBase, mode, repo, true);
  const legacyPaths = legacyStatePaths(mode, repo);

  const [scopedExists, legacyExists] = await Promise.all([
    hasAnyStateFile(readFile, scopedPaths),
    hasAnyStateFile(readFile, legacyPaths),
  ]);

  if (scopedExists) return scopedPaths;
  if (legacyExists) return legacyPaths;
  return scopedPaths;
}
