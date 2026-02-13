import { describe, it, expect } from 'vitest';
import { parseMarkdown, flattenTaskItems } from './parse-markdown.js';
import type { MarkdownMetadata } from './parse-markdown.js';

describe('parseMarkdown', () => {
  it('parses empty content', async () => {
    const result = await parseMarkdown('', 'test.md');
    expect(result.path).toBe('test.md');
    expect(result.metadata.title).toBeUndefined();
    expect(result.metadata.headings).toHaveLength(0);
    expect(result.metadata.taskLists).toHaveLength(0);
  });

  it('extracts title from first h1', async () => {
    const md = '# My Title\n\nSome text.';
    const result = await parseMarkdown(md, 'test.md');
    expect(result.metadata.title).toBe('My Title');
  });

  it('extracts headings at different depths', async () => {
    const md = `# H1
## H2
### H3
#### H4`;
    const result = await parseMarkdown(md, 'test.md');
    expect(result.metadata.headings).toHaveLength(4);
    expect(result.metadata.headings[0]).toMatchObject({ depth: 1, text: 'H1' });
    expect(result.metadata.headings[1]).toMatchObject({ depth: 2, text: 'H2' });
    expect(result.metadata.headings[2]).toMatchObject({ depth: 3, text: 'H3' });
    expect(result.metadata.headings[3]).toMatchObject({ depth: 4, text: 'H4' });
  });

  it('extracts task lists with checked and unchecked items', async () => {
    const md = `## Tasks
- [x] Done task
- [ ] Pending task
- [x] Another done`;
    const result = await parseMarkdown(md, 'test.md');
    expect(result.metadata.taskLists).toHaveLength(1);
    const taskList = result.metadata.taskLists[0];
    expect(taskList.items).toHaveLength(3);
    expect(taskList.items[0].checked).toBe(true);
    expect(taskList.items[0].text).toContain('Done task');
    expect(taskList.items[1].checked).toBe(false);
    expect(taskList.items[1].text).toContain('Pending task');
    expect(taskList.parentHeading).toBe('Tasks');
  });

  it('ignores regular lists (non-task)', async () => {
    const md = `## Notes
- Item one
- Item two
- Item three`;
    const result = await parseMarkdown(md, 'test.md');
    expect(result.metadata.taskLists).toHaveLength(0);
  });

  it('extracts nested task items', async () => {
    const md = `- [x] Parent task
  - [x] Sub task one
  - [ ] Sub task two`;
    const result = await parseMarkdown(md, 'test.md');
    // remark may produce multiple task lists; find the one with children
    const allItems = result.metadata.taskLists.flatMap(tl => tl.items);
    const parent = allItems.find(i => i.children.length > 0);
    expect(parent).toBeDefined();
    expect(parent!.checked).toBe(true);
    expect(parent!.children).toHaveLength(2);
    expect(parent!.children[0].checked).toBe(true);
    expect(parent!.children[1].checked).toBe(false);
  });

  it('extracts links from task items', async () => {
    const md = `- [x] Implement parser → [parse-markdown.ts](./skills/discovery/parse-markdown.ts)`;
    const result = await parseMarkdown(md, 'test.md');
    const item = result.metadata.taskLists[0].items[0];
    expect(item.links).toHaveLength(1);
    expect(item.links[0].url).toBe('./skills/discovery/parse-markdown.ts');
  });

  it('cleans task text by removing markdown formatting', async () => {
    const md = `- [ ] **Bold** text with \`code\` and [link](http://example.com) → arrow`;
    const result = await parseMarkdown(md, 'test.md');
    const item = result.metadata.taskLists[0].items[0];
    expect(item.text).toBe('Bold text with code and link arrow');
  });

  it('extracts links from document body', async () => {
    const md = `See [AGENTS.md](./AGENTS.md) and [plan](./implementation-plan.md)`;
    const result = await parseMarkdown(md, 'test.md');
    expect(result.metadata.links).toHaveLength(2);
    expect(result.metadata.links[0].url).toBe('./AGENTS.md');
    expect(result.metadata.links[1].url).toBe('./implementation-plan.md');
  });

  it('handles multiple task lists under different headings', async () => {
    const md = `## Phase 1
- [x] Task A
- [x] Task B

## Phase 2
- [ ] Task C
- [ ] Task D`;
    const result = await parseMarkdown(md, 'test.md');
    expect(result.metadata.taskLists).toHaveLength(2);
    expect(result.metadata.taskLists[0].parentHeading).toBe('Phase 1');
    expect(result.metadata.taskLists[1].parentHeading).toBe('Phase 2');
  });
});

describe('flattenTaskItems', () => {
  it('flattens nested task items', async () => {
    const md = `- [x] Parent
  - [x] Child 1
  - [ ] Child 2
- [ ] Sibling`;
    const result = await parseMarkdown(md, 'test.md');
    const flat = flattenTaskItems(result.metadata);
    // Should contain Parent, Child 1, Child 2, Sibling at minimum
    const texts = flat.map(f => f.text);
    expect(texts.some(t => t.includes('Parent'))).toBe(true);
    expect(texts.some(t => t.includes('Child 1'))).toBe(true);
    expect(texts.some(t => t.includes('Child 2'))).toBe(true);
    expect(texts.some(t => t.includes('Sibling'))).toBe(true);
    expect(flat.length).toBeGreaterThanOrEqual(4);
  });

  it('returns empty array for no task lists', () => {
    const metadata: MarkdownMetadata = {
      headings: [],
      taskLists: [],
      links: [],
    };
    expect(flattenTaskItems(metadata)).toHaveLength(0);
  });
});
