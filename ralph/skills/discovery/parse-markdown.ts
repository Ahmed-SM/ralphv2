/**
 * Parse Markdown Skill
 *
 * Parses markdown files into an AST for task extraction.
 * Uses remark for parsing.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Content, List, ListItem, Heading, Paragraph, Text, Link } from 'mdast';

export interface ParsedMarkdown {
  path: string;
  ast: Root;
  metadata: MarkdownMetadata;
}

export interface MarkdownMetadata {
  title?: string;
  headings: HeadingInfo[];
  taskLists: TaskListInfo[];
  links: LinkInfo[];
}

export interface HeadingInfo {
  depth: number;
  text: string;
  line: number;
}

export interface TaskListInfo {
  line: number;
  items: TaskItemInfo[];
  parentHeading?: string;
}

export interface TaskItemInfo {
  checked: boolean;
  text: string;
  line: number;
  children: TaskItemInfo[];
  links: LinkInfo[];
}

export interface LinkInfo {
  text: string;
  url: string;
  line: number;
}

/**
 * Parse a markdown string into AST with metadata
 */
export async function parseMarkdown(content: string, path: string): Promise<ParsedMarkdown> {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const ast = processor.parse(content) as Root;

  const metadata = extractMetadata(ast, content);

  return {
    path,
    ast,
    metadata,
  };
}

/**
 * Parse a markdown file
 */
export async function parseMarkdownFile(
  filePath: string,
  readFile: (path: string) => Promise<string>
): Promise<ParsedMarkdown> {
  const content = await readFile(filePath);
  return parseMarkdown(content, filePath);
}

/**
 * Extract metadata from AST
 */
function extractMetadata(ast: Root, content: string): MarkdownMetadata {
  const lines = content.split('\n');
  const headings: HeadingInfo[] = [];
  const taskLists: TaskListInfo[] = [];
  const links: LinkInfo[] = [];

  let currentHeading: string | undefined;

  function walk(node: Content | Root, parentLine?: number): void {
    const line = node.position?.start.line ?? parentLine ?? 0;

    switch (node.type) {
      case 'heading': {
        const heading = node as Heading;
        const text = extractText(heading);
        headings.push({ depth: heading.depth, text, line });
        currentHeading = text;
        break;
      }

      case 'list': {
        const list = node as List;
        if (hasTaskItems(list)) {
          const items = extractTaskItems(list);
          taskLists.push({
            line,
            items,
            parentHeading: currentHeading,
          });
        }
        break;
      }

      case 'link': {
        const link = node as Link;
        links.push({
          text: extractText(link),
          url: link.url,
          line,
        });
        break;
      }
    }

    // Recurse into children
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child as Content, line);
      }
    }
  }

  walk(ast);

  // Extract title from first h1
  const h1 = headings.find(h => h.depth === 1);

  return {
    title: h1?.text,
    headings,
    taskLists,
    links,
  };
}

/**
 * Check if a list contains task items (checkboxes)
 */
function hasTaskItems(list: List): boolean {
  return list.children.some(item => {
    const listItem = item as ListItem;
    return listItem.checked !== null && listItem.checked !== undefined;
  });
}

/**
 * Extract task items from a list
 */
function extractTaskItems(list: List): TaskItemInfo[] {
  const items: TaskItemInfo[] = [];

  for (const item of list.children) {
    const listItem = item as ListItem;

    // Only process items with checkboxes
    if (listItem.checked === null || listItem.checked === undefined) {
      continue;
    }

    const text = extractText(listItem);
    const line = listItem.position?.start.line ?? 0;
    const links = extractLinks(listItem);

    // Check for nested task lists
    const children: TaskItemInfo[] = [];
    for (const child of listItem.children) {
      if (child.type === 'list') {
        children.push(...extractTaskItems(child as List));
      }
    }

    items.push({
      checked: listItem.checked,
      text: cleanTaskText(text),
      line,
      children,
      links,
    });
  }

  return items;
}

/**
 * Extract plain text from a node
 */
function extractText(node: Content | Root): string {
  if (node.type === 'text') {
    return (node as Text).value;
  }

  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map(child => extractText(child as Content)).join('');
  }

  return '';
}

/**
 * Extract links from a node
 */
function extractLinks(node: Content | Root): LinkInfo[] {
  const links: LinkInfo[] = [];

  function walk(n: Content | Root): void {
    if (n.type === 'link') {
      const link = n as Link;
      links.push({
        text: extractText(link),
        url: link.url,
        line: link.position?.start.line ?? 0,
      });
    }

    if ('children' in n && Array.isArray(n.children)) {
      for (const child of n.children) {
        walk(child as Content);
      }
    }
  }

  walk(node);
  return links;
}

/**
 * Clean task text by removing markdown formatting
 */
function cleanTaskText(text: string): string {
  return text
    // Remove link syntax but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove inline code backticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove arrow markers
    .replace(/\s*→\s*/g, ' ')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get all task items flattened
 */
export function flattenTaskItems(metadata: MarkdownMetadata): TaskItemInfo[] {
  const items: TaskItemInfo[] = [];

  function flatten(taskItems: TaskItemInfo[]): void {
    for (const item of taskItems) {
      items.push(item);
      if (item.children.length > 0) {
        flatten(item.children);
      }
    }
  }

  for (const list of metadata.taskLists) {
    flatten(list.items);
  }

  return items;
}
