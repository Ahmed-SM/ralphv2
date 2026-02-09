/**
 * Debug script for markdown parsing
 */

import { readFile } from 'fs/promises';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Content, List, ListItem } from 'mdast';

async function debug(): Promise<void> {
  const content = await readFile('./implementation-plan.md', 'utf-8');

  const processor = unified().use(remarkParse).use(remarkGfm);
  const ast = processor.parse(content) as Root;

  console.log('AST Root type:', ast.type);
  console.log('Children count:', ast.children.length);

  // Find all lists
  function findLists(node: Content | Root, depth = 0): void {
    const indent = '  '.repeat(depth);

    if (node.type === 'list') {
      const list = node as List;
      console.log(`${indent}LIST at line ${node.position?.start.line}: ${list.children.length} items`);

      for (const item of list.children) {
        const listItem = item as ListItem;
        console.log(`${indent}  ITEM: checked=${listItem.checked}`);
      }
    }

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        findLists(child as Content, depth + 1);
      }
    }
  }

  findLists(ast);
}

debug().catch(console.error);
