/**
 * Resolve Citations Skill
 *
 * Resolves spec citations in tasks to enrich descriptions.
 * Reads linked spec files and extracts relevant content.
 */

import type { Task } from '../../types/index.js';
import { parseMarkdown, type ParsedMarkdown } from './parse-markdown.js';

export interface ResolutionResult {
  task: Task;
  enriched: boolean;
  specContent?: string;
}

export interface ResolutionContext {
  readFile: (path: string) => Promise<string>;
  basePath: string;
}

/**
 * Resolve citation for a single task
 */
export async function resolveCitation(
  task: Task,
  context: ResolutionContext
): Promise<ResolutionResult> {
  if (!task.spec) {
    return { task, enriched: false };
  }

  try {
    // Resolve spec path
    const specPath = resolveSpecPath(task.spec, context.basePath);

    // Read and parse spec
    const content = await context.readFile(specPath);
    const parsed = await parseMarkdown(content, specPath);

    // Extract description from spec
    const description = extractDescription(parsed);

    // Enrich task
    const enrichedTask: Task = {
      ...task,
      description: description || task.description,
    };

    return {
      task: enrichedTask,
      enriched: true,
      specContent: content,
    };
  } catch (error) {
    // Spec not found or unreadable - keep task as-is
    console.warn(`Could not resolve spec for ${task.id}: ${task.spec}`);
    return { task, enriched: false };
  }
}

/**
 * Resolve citations for multiple tasks
 */
export async function resolveCitations(
  tasks: Task[],
  context: ResolutionContext
): Promise<ResolutionResult[]> {
  const results: ResolutionResult[] = [];

  for (const task of tasks) {
    const result = await resolveCitation(task, context);
    results.push(result);
  }

  return results;
}

/**
 * Resolve spec path relative to base
 */
function resolveSpecPath(spec: string, basePath: string): string {
  // Handle relative paths
  if (spec.startsWith('./')) {
    // Remove ./ prefix and join with base
    const relativePath = spec.slice(2);
    return joinPaths(basePath, relativePath);
  }

  if (spec.startsWith('../')) {
    // Handle parent directory references
    return joinPaths(basePath, spec);
  }

  // Absolute path or just filename
  return spec;
}

/**
 * Simple path join (works on both Windows and Unix)
 */
function joinPaths(base: string, relative: string): string {
  // Get directory of base if it's a file
  const baseDir = base.includes('.') ? base.split('/').slice(0, -1).join('/') : base;

  // Handle .. in relative path
  const baseParts = baseDir.split('/').filter(Boolean);
  const relativeParts = relative.split('/').filter(Boolean);

  const resultParts = [...baseParts];

  for (const part of relativeParts) {
    if (part === '..') {
      resultParts.pop();
    } else if (part !== '.') {
      resultParts.push(part);
    }
  }

  return resultParts.join('/');
}

/**
 * Extract description from parsed spec
 */
function extractDescription(parsed: ParsedMarkdown): string {
  const lines: string[] = [];

  // Get title
  if (parsed.metadata.title) {
    lines.push(parsed.metadata.title);
  }

  // Get first paragraph or overview section
  const headings = parsed.metadata.headings;
  const overviewHeading = headings.find(h =>
    h.text.toLowerCase().includes('overview') ||
    h.text.toLowerCase().includes('description') ||
    h.text.toLowerCase().includes('summary')
  );

  if (overviewHeading) {
    // Find next heading after overview
    const overviewIndex = headings.indexOf(overviewHeading);
    const nextHeading = headings[overviewIndex + 1];

    // Extract text between overview and next heading
    // This is a simplified extraction - full implementation would walk the AST
    lines.push(`See: ${parsed.path}`);
  } else if (parsed.metadata.title) {
    lines.push(`See: ${parsed.path}`);
  }

  return lines.join('\n');
}

/**
 * Extract section content from spec
 */
export function extractSection(
  parsed: ParsedMarkdown,
  sectionTitle: string
): string | null {
  const headings = parsed.metadata.headings;

  const targetHeading = headings.find(h =>
    h.text.toLowerCase().includes(sectionTitle.toLowerCase())
  );

  if (!targetHeading) {
    return null;
  }

  // Would extract content between this heading and next
  // Simplified for now
  return `Section: ${targetHeading.text}`;
}

/**
 * Get all spec references from tasks
 */
export function getSpecReferences(tasks: Task[]): string[] {
  const specs = new Set<string>();

  for (const task of tasks) {
    if (task.spec) {
      specs.add(task.spec);
    }
  }

  return Array.from(specs);
}

/**
 * Validate spec references exist
 */
export async function validateSpecReferences(
  specs: string[],
  context: ResolutionContext
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  for (const spec of specs) {
    try {
      const path = resolveSpecPath(spec, context.basePath);
      await context.readFile(path);
      results.set(spec, true);
    } catch {
      results.set(spec, false);
    }
  }

  return results;
}
