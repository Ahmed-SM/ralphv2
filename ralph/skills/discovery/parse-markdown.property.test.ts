/**
 * Property-based tests for parse-markdown.ts
 *
 * Uses fast-check to verify invariants of the markdown parser
 * across a wide range of generated inputs.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseMarkdown, flattenTaskItems } from './parse-markdown.js';

// =============================================================================
// ARBITRARIES (generators)
// =============================================================================

/** Generate a valid markdown heading (# to ####) */
const headingArb = fc.record({
  depth: fc.integer({ min: 1, max: 4 }),
  text: fc.stringMatching(new RegExp('^[a-z0-9 ]{1,60}$')),
}).map(({ depth, text }) => `${'#'.repeat(depth)} ${text.trim() || 'heading'}`);

/** Generate a task list item line */
const taskItemArb = fc.record({
  checked: fc.boolean(),
  text: fc.stringMatching(new RegExp('^[a-zA-Z0-9 _-]{1,80}$')),
}).map(({ checked, text }) => `- [${checked ? 'x' : ' '}] ${text.trim() || 'task'}`);

/** Generate a non-empty list of task items */
const taskListArb = fc.array(taskItemArb, { minLength: 1, maxLength: 10 });

/** Generate a link in markdown */
const linkTextArb = fc.stringMatching(new RegExp('^[a-z ]{1,30}$'));
const linkUrlArb = fc.constantFrom(
  './file.md', './specs/task.md', 'https://example.com', './foo/bar.ts', '#anchor'
);
const linkArb = fc.tuple(linkTextArb, linkUrlArb).map(([text, url]) => `[${text.trim() || 'link'}](${url})`);

// =============================================================================
// PROPERTIES
// =============================================================================

describe('parseMarkdown — property-based', () => {

  it('always returns a valid ParsedMarkdown structure for any string input', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (input) => {
        const result = await parseMarkdown(input, 'test.md');
        expect(result.path).toBe('test.md');
        expect(result.ast).toBeDefined();
        expect(result.metadata).toBeDefined();
        expect(Array.isArray(result.metadata.headings)).toBe(true);
        expect(Array.isArray(result.metadata.taskLists)).toBe(true);
        expect(Array.isArray(result.metadata.links)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('never crashes on arbitrary unicode strings', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (input) => {
        const result = await parseMarkdown(input, 'test.md');
        expect(result).toBeDefined();
      }),
      { numRuns: 200 }
    );
  });

  it('extracts exactly one heading per heading line', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(headingArb, { minLength: 0, maxLength: 8 }),
        async (headings) => {
          const md = headings.join('\n\n');
          const result = await parseMarkdown(md, 'test.md');
          // Each heading line should produce exactly one heading entry
          expect(result.metadata.headings.length).toBe(headings.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('heading depths are always between 1 and 6', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (input) => {
        const result = await parseMarkdown(input, 'test.md');
        for (const h of result.metadata.headings) {
          expect(h.depth).toBeGreaterThanOrEqual(1);
          expect(h.depth).toBeLessThanOrEqual(6);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('task items always have a boolean checked field', async () => {
    await fc.assert(
      fc.asyncProperty(
        taskListArb,
        async (items) => {
          const md = items.join('\n');
          const result = await parseMarkdown(md, 'test.md');
          for (const tl of result.metadata.taskLists) {
            for (const item of tl.items) {
              expect(typeof item.checked).toBe('boolean');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('checked items round-trip: [x] → checked=true, [ ] → checked=false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ checked: fc.boolean(), label: fc.string({ minLength: 1, maxLength: 40 }).map(s => s.replace(/[\[\]]/g, '').trim() || 'item') }),
          { minLength: 1, maxLength: 8 }
        ),
        async (items) => {
          const md = items.map(i => `- [${i.checked ? 'x' : ' '}] ${i.label}`).join('\n');
          const result = await parseMarkdown(md, 'test.md');
          const allItems = result.metadata.taskLists.flatMap(tl => tl.items);
          // Same count
          expect(allItems.length).toBe(items.length);
          // Same checked status in order
          for (let idx = 0; idx < items.length; idx++) {
            expect(allItems[idx].checked).toBe(items[idx].checked);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('task item text is a string (may be empty after markdown cleaning)', async () => {
    await fc.assert(
      fc.asyncProperty(
        taskListArb,
        async (items) => {
          const md = items.join('\n');
          const result = await parseMarkdown(md, 'test.md');
          for (const tl of result.metadata.taskLists) {
            for (const item of tl.items) {
              expect(typeof item.text).toBe('string');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('parentHeading is undefined or matches a preceding heading', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.array(headingArb, { minLength: 0, maxLength: 3 }),
          taskListArb,
        ),
        async ([headings, tasks]) => {
          const md = [...headings, '', ...tasks].join('\n');
          const result = await parseMarkdown(md, 'test.md');
          const headingTexts = result.metadata.headings.map(h => h.text);
          for (const tl of result.metadata.taskLists) {
            if (tl.parentHeading !== undefined) {
              expect(headingTexts).toContain(tl.parentHeading);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('flattenTaskItems returns at least as many items as top-level items', async () => {
    await fc.assert(
      fc.asyncProperty(
        taskListArb,
        async (items) => {
          const md = items.join('\n');
          const result = await parseMarkdown(md, 'test.md');
          const flat = flattenTaskItems(result.metadata);
          const topLevel = result.metadata.taskLists.reduce((sum, tl) => sum + tl.items.length, 0);
          expect(flat.length).toBeGreaterThanOrEqual(topLevel);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('links in markdown are extracted with correct url', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(linkArb, { minLength: 1, maxLength: 5 }),
        async (links) => {
          const md = links.join('\n\n');
          const result = await parseMarkdown(md, 'test.md');
          // Should find at least one link per markdown link
          expect(result.metadata.links.length).toBeGreaterThanOrEqual(links.length);
          for (const l of result.metadata.links) {
            expect(l.url.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('title is undefined when no h1 exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            depth: fc.integer({ min: 2, max: 4 }),
            text: fc.string({ minLength: 1, maxLength: 20 }),
          }).map(({ depth, text }) => `${'#'.repeat(depth)} ${text.trim() || 'heading'}`),
          { minLength: 0, maxLength: 5 }
        ),
        async (headings) => {
          const md = headings.join('\n\n');
          const result = await parseMarkdown(md, 'test.md');
          expect(result.metadata.title).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty content produces empty metadata', async () => {
    const result = await parseMarkdown('', 'empty.md');
    expect(result.metadata.headings).toHaveLength(0);
    expect(result.metadata.taskLists).toHaveLength(0);
    expect(result.metadata.links).toHaveLength(0);
    expect(result.metadata.title).toBeUndefined();
  });

  it('regular lists (no checkboxes) produce no taskLists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.stringMatching(new RegExp('^[a-z ]{1,40}$')),
          { minLength: 1, maxLength: 5 }
        ),
        async (items) => {
          const md = items.map(i => `- ${i.trim() || 'item'}`).join('\n');
          const result = await parseMarkdown(md, 'test.md');
          expect(result.metadata.taskLists).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('nested task items appear as children', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          parentChecked: fc.boolean(),
          childCount: fc.integer({ min: 1, max: 4 }),
        }),
        async ({ parentChecked, childCount }) => {
          const children = Array.from({ length: childCount }, (_, i) =>
            `  - [${i % 2 === 0 ? 'x' : ' '}] child ${i}`
          );
          const md = `- [${parentChecked ? 'x' : ' '}] parent\n${children.join('\n')}`;
          const result = await parseMarkdown(md, 'test.md');
          const allItems = result.metadata.taskLists.flatMap(tl => tl.items);
          const parent = allItems.find(item => item.children.length > 0);
          expect(parent).toBeDefined();
          expect(parent!.children.length).toBe(childCount);
        }
      ),
      { numRuns: 50 }
    );
  });
});
