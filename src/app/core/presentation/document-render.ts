import { Annotation, DocumentBlock, UUID } from '../models';

/**
 * A run of text inside a paragraph, ready to render.
 *
 * `annotation_id` is set on runs the teacher can tap to open a comment;
 * `ltr` marks runs that must be bidi-isolated (statistics, English terms)
 * so they don't scramble the surrounding Hebrew.
 */
export interface TextRun {
  text: string;
  annotation_id: UUID | null;
  ltr: boolean;
}

export interface RenderedBlock {
  block: DocumentBlock;
  runs: TextRun[];
}

/**
 * A maximal stretch of non-Hebrew characters containing at least one Latin
 * letter. That is what needs isolating — `(r = .42, p < .01)` renders with
 * its brackets the wrong way round otherwise. Bare numbers are left alone:
 * they are already weak-LTR and behave correctly inside Hebrew.
 */
const LTR_RUN = /[^֐-׿\s]*[A-Za-z][^֐-׿]*/g;

/** Characters allowed to open and close an isolated run. */
const LTR_EDGE_START = /[A-Za-z0-9([]/;
const LTR_EDGE_END = /[A-Za-z0-9)\]%]/;

/**
 * Splits a stretch of plain text into isolated and non-isolated runs.
 * Punctuation that belongs to the surrounding Hebrew sentence is trimmed back
 * out of the isolate, so a sentence-final full stop stays with the sentence.
 */
export function splitLtrRuns(text: string): { text: string; ltr: boolean }[] {
  const out: { text: string; ltr: boolean }[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LTR_RUN)) {
    let start = match.index ?? 0;
    let end = start + match[0].length;

    while (start < end && !LTR_EDGE_START.test(text[start])) start++;
    while (end > start && !LTR_EDGE_END.test(text[end - 1])) end--;
    if (start >= end) continue;

    if (start > cursor) out.push({ text: text.slice(cursor, start), ltr: false });
    out.push({ text: text.slice(start, end), ltr: true });
    cursor = end;
  }

  if (cursor < text.length) out.push({ text: text.slice(cursor), ltr: false });
  return out;
}

/**
 * Weaves a block's annotations back into its text.
 *
 * The document is stored as plain text and comments are anchored by character
 * offset, so rendering means slicing the text at each anchor rather than
 * storing pre-marked HTML. That is what lets a comment survive the student
 * rewriting the paragraph around it.
 *
 * Dismissed annotations are skipped — the teacher rejected them, so the
 * student's text should show no trace.
 */
export function renderBlock(block: DocumentBlock, annotations: readonly Annotation[]): TextRun[] {
  const anchored = annotations
    .filter((a) => a.anchor.block_id === block.id && a.status !== 'dismissed')
    .sort((a, b) => a.anchor.start - b.anchor.start);

  const runs: TextRun[] = [];
  let cursor = 0;

  const pushPlain = (text: string) => {
    if (!text) return;
    for (const part of splitLtrRuns(text)) {
      runs.push({ text: part.text, annotation_id: null, ltr: part.ltr });
    }
  };

  for (const a of anchored) {
    // Overlapping anchors would double-render the shared characters; the
    // first comment on a span wins.
    if (a.anchor.start < cursor) continue;

    pushPlain(block.text.slice(cursor, a.anchor.start));
    runs.push({
      text: block.text.slice(a.anchor.start, a.anchor.end),
      annotation_id: a.id,
      ltr: false,
    });
    cursor = a.anchor.end;
  }

  pushPlain(block.text.slice(cursor));
  return runs;
}

/**
 * A section of the document — a level-2 heading and everything under it.
 * Comments are grouped this way in the review screen so a long paper doesn't
 * arrive as one flat list of forty notes.
 */
export interface DocumentSection {
  id: string;
  title: string;
  /** Indexes of the blocks belonging to this section. */
  block_indexes: number[];
}

/**
 * Derives sections from the document's own headings, rather than storing a
 * grouping alongside it. Phase 3 pulls real documents out of Drive, and their
 * headings are the only structure we can count on being there.
 */
export function sectionsOf(blocks: readonly DocumentBlock[]): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let current: DocumentSection | null = null;

  for (const block of blocks) {
    // The level-1 heading is the paper's title, not a section of it.
    if (block.type === 'heading' && (block.level ?? 1) > 1) {
      current = { id: block.id, title: block.text, block_indexes: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      if (block.type === 'heading') continue;
      current = { id: 'opening', title: 'פתיחה', block_indexes: [] };
      sections.push(current);
    }
    current.block_indexes.push(block.index);
  }

  return sections;
}
