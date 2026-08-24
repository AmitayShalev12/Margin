import { DocumentBlock } from '../models';
import { DocsDocument, DocsParagraph, DocsStructuralElement } from './drive-types';

/**
 * Turns a Google Doc into the `DocumentBlock[]` the review screen anchors
 * against.
 *
 * The hard constraint: annotation offsets are character positions into
 * `block.text`, so extraction must not quietly rewrite the text. Specifically
 * it does NOT collapse runs of spaces, trim inside a paragraph, normalise
 * non-breaking spaces, or touch Latin/numeric notation — a statistic like
 * `(r = .42, p < .01)` has to arrive exactly as written or the review
 * screen's bidi isolation has nothing to isolate.
 *
 * The only edits made are:
 *   - the trailing newline Docs appends to every paragraph is dropped
 *   - two control characters are mapped to `\n` (see `normaliseBreaks`)
 * Both are documented below and neither changes any other character.
 */

/**
 * Docs uses VERTICAL TAB for a soft line break (shift+enter) and FORM FEED
 * for a page break. Both are one character and become one character, so every
 * offset after them is unchanged — which is the whole point.
 */
function normaliseBreaks(text: string): string {
  // \u000B is a soft line break (shift+enter), \u000C a page break.
  return text.replace(/[\u000B\u000C]/g, '\n');
}

/** Raw heading depth as Docs names it. Null means "not a heading". */
function rawHeadingLevel(named: string | undefined): number | null {
  if (!named) return null;
  if (named === 'TITLE' || named === 'SUBTITLE') return 0;
  const match = /^HEADING_(\d)$/.exec(named);
  return match ? Number(match[1]) : null;
}

interface RawBlock {
  id: string;
  type: DocumentBlock['type'];
  text: string;
  /**
   * The Docs index of each character of `text`, in order.
   *
   * Built here rather than computed later, and that is the whole point: a
   * paragraph's characters are *not* contiguous from its start index. Inline
   * objects, footnote references and page breaks each occupy an index and
   * contribute no text, so `paragraphStart + offset` silently drifts past any
   * of them — and a comment anchored on drifted indices lands on the wrong
   * sentence. Every index here comes from the element Google reported it on.
   */
  indices: number[];
  /** Docs heading depth, before it is mapped onto Phase 2's levels. */
  rawLevel: number | null;
  /** True for TITLE/SUBTITLE, which are never section headings. */
  titleStyle: boolean;
}

function paragraphToBlock(
  paragraph: DocsParagraph,
  startIndex: number | undefined,
  fallbackIndex: number,
): RawBlock | null {
  // Character by character, each carrying the Docs index it actually sits at.
  const chars: string[] = [];
  const indices: number[] = [];

  for (const element of paragraph.elements ?? []) {
    const content = element.textRun?.content;
    if (!content) continue;

    const base = element.startIndex;
    for (let i = 0; i < content.length; i++) {
      chars.push(content[i]);
      // An element without a start index cannot be anchored against; -1 marks
      // it unusable rather than inventing a position.
      indices.push(base === undefined ? -1 : base + i);
    }
  }

  const joined = chars.join('');

  // Every Docs paragraph ends with a newline; that terminator is structure,
  // not content. Nothing else is trimmed.
  const text = normaliseBreaks(joined).replace(/\n$/, '');
  if (text.trim() === '') return null;

  const named = paragraph.paragraphStyle?.namedStyleType;
  const rawLevel = rawHeadingLevel(named);
  const isHeading = rawLevel !== null;

  return {
    // Docs' own character index — stable within a revision and traceable back
    // to the document when debugging an anchor.
    id: startIndex === undefined ? `b${fallbackIndex}` : `p${startIndex}`,
    type: isHeading ? 'heading' : paragraph.bullet ? 'list_item' : 'paragraph',
    text,
    // Trimmed to match `text` exactly, so index N of one is index N of the other.
    indices: indices.slice(0, text.length),
    rawLevel,
    titleStyle: named === 'TITLE' || named === 'SUBTITLE',
  };
}

function walk(content: DocsStructuralElement[], out: RawBlock[]): void {
  for (const element of content) {
    if (element.paragraph) {
      const block = paragraphToBlock(element.paragraph, element.startIndex, out.length);
      if (block) out.push(block);
      continue;
    }

    if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          walk(cell.content ?? [], out);
        }
      }
      continue;
    }

    // A generated table of contents repeats every heading verbatim. Including
    // it would invent duplicate sections and give the teacher comments on
    // navigation furniture.
    if (element.tableOfContents) continue;
  }
}

/**
 * Maps Docs heading depths onto the two levels the review screen cares about:
 * level 1 is the paper's title, level 2 is a section.
 *
 * Students are inconsistent about this — some use HEADING_1 for sections with
 * a TITLE above, some use HEADING_2 under a HEADING_1 title. So rather than a
 * fixed table, the *shallowest heading depth that occurs more than once* is
 * taken to be the section level: a depth used repeatedly is structure, a depth
 * used once is a title. TITLE and SUBTITLE never compete for this — Docs has
 * dedicated styles for them and they are always level 1.
 */
function assignLevels(blocks: RawBlock[]): (number | undefined)[] {
  const counts = new Map<number, number>();
  for (const b of blocks) {
    if (b.rawLevel === null || b.titleStyle) continue;
    counts.set(b.rawLevel, (counts.get(b.rawLevel) ?? 0) + 1);
  }

  const depths = [...counts.keys()].sort((a, b) => a - b);
  const recurring = depths.find((d) => (counts.get(d) ?? 0) >= 2);
  // With no repeated depth, the first heading reads as the title and the next
  // distinct depth as the sections. With only one depth in play, it is the
  // sections — a lone heading is more useful as a group than as a title.
  const sectionDepth = recurring ?? depths[1] ?? depths[0];

  return blocks.map((b) => {
    if (b.rawLevel === null) return undefined;
    if (b.titleStyle || sectionDepth === undefined) return 1;
    if (b.rawLevel < sectionDepth) return 1;
    if (b.rawLevel === sectionDepth) return 2;
    return Math.min(6, 2 + (b.rawLevel - sectionDepth));
  });
}

/**
 * Extracts the blocks. Returns them already indexed, so they can be written
 * straight onto a `SubmissionRound`.
 */
export function extractDocumentBlocks(doc: DocsDocument): DocumentBlock[] {
  return extractDocument(doc).blocks;
}

/**
 * The blocks, plus where each character really sits in the document.
 *
 * One traversal produces both, deliberately. A second walk to build the index
 * map would have to reproduce every decision this one makes — which paragraphs
 * are skipped as empty, that a table of contents is ignored, that table cells
 * are descended into — and the day the two disagreed, comments would anchor
 * onto the wrong paragraph with nothing to show it had happened.
 *
 * `indices[i]` of block `n` is the Docs index of `blocks[n].text[i]`, or -1
 * where Google reported no position for the element it came from.
 */
export function extractDocument(doc: DocsDocument): {
  blocks: DocumentBlock[];
  indices: number[][];
} {
  const raw: RawBlock[] = [];
  walk(doc.body?.content ?? [], raw);

  const levels = assignLevels(raw);

  return {
    blocks: raw.map((b, index) => ({
      id: b.id,
      index,
      type: b.type,
      text: b.text,
      ...(levels[index] === undefined ? {} : { level: levels[index] }),
    })),
    indices: raw.map((b) => b.indices),
  };
}

/**
 * The plain-text rendering stored on `SubmissionRound.document_text`.
 * Blocks are joined with a blank line, matching how the seed data was written
 * so the two are interchangeable.
 */
export function blocksToText(blocks: readonly DocumentBlock[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

/** Rough word count, used only for the "how long is this" hint on a row. */
export function countWords(blocks: readonly DocumentBlock[]): number {
  return blocksToText(blocks)
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}
