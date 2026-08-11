import { DocumentBlock, TextAnchor } from '../models';
import { splitLtrRuns } from '../presentation/document-render';
import { DraftAnnotation, GENERATED_KINDS } from './contract';

/**
 * Turns a drafted comment's quote into a real `TextAnchor`.
 *
 * The rule throughout is that a comment either anchors to exactly the words it
 * quoted, or it is thrown away. Nothing here searches approximately, trims to
 * fit, or falls back to "close enough" — a comment landing on the wrong words
 * would be worse than the comment not existing, because the teacher has no way
 * to tell that it moved.
 */

export type RejectionReason =
  | 'unknown_block'
  | 'quote_not_found'
  | 'quote_ambiguous'
  | 'splits_notation'
  | 'empty'
  | 'unknown_kind'
  | 'duplicate_span';

export interface ResolvedAnnotation {
  anchor: TextAnchor;
  draft: DraftAnnotation;
}

export interface Rejection {
  draft: DraftAnnotation;
  reason: RejectionReason;
}

export interface ResolutionResult {
  resolved: ResolvedAnnotation[];
  rejected: Rejection[];
}

/**
 * Spans of a block that must not be cut into.
 *
 * These are the runs the review screen bidi-isolates — statistics, English
 * terms, citations. An anchor that starts or ends inside one would split the
 * isolate in two when rendered, and `(r = .42, p < .01)` becomes unreadable.
 * Anchoring to a *whole* run, or around it, is fine.
 */
function protectedRuns(text: string): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let cursor = 0;

  for (const part of splitLtrRuns(text)) {
    if (part.ltr) runs.push({ start: cursor, end: cursor + part.text.length });
    cursor += part.text.length;
  }

  return runs;
}

/** True when [start, end) begins or ends part-way through an isolated run. */
export function splitsNotation(text: string, start: number, end: number): boolean {
  return protectedRuns(text).some(
    (run) => (start > run.start && start < run.end) || (end > run.start && end < run.end),
  );
}

function resolveOne(
  draft: DraftAnnotation,
  blocks: readonly DocumentBlock[],
  taken: Set<string>,
): ResolvedAnnotation | Rejection {
  if (!draft.quote?.trim() || !draft.body?.trim()) return { draft, reason: 'empty' };
  if (!GENERATED_KINDS.includes(draft.kind)) return { draft, reason: 'unknown_kind' };

  const block = blocks.find((b) => b.id === draft.block_id);
  if (!block) return { draft, reason: 'unknown_block' };

  const start = block.text.indexOf(draft.quote);
  if (start === -1) return { draft, reason: 'quote_not_found' };

  // A quote appearing twice in one block gives no way to know which the model
  // meant. Rather than pick, ask for a longer quote by discarding this one.
  if (block.text.indexOf(draft.quote, start + 1) !== -1) {
    return { draft, reason: 'quote_ambiguous' };
  }

  const end = start + draft.quote.length;
  if (splitsNotation(block.text, start, end)) return { draft, reason: 'splits_notation' };

  const key = `${block.id}:${start}:${end}`;
  if (taken.has(key)) return { draft, reason: 'duplicate_span' };
  taken.add(key);

  return {
    draft,
    anchor: {
      block_id: block.id,
      block_index: block.index,
      start,
      end,
      quote: draft.quote,
    },
  };
}

/**
 * Resolves a whole batch, keeping what anchors cleanly and reporting the rest.
 *
 * Rejections are returned rather than swallowed: a batch where half the quotes
 * failed to resolve is a signal about the generation, not something to hide
 * behind a shorter list of comments.
 */
export function resolveAnnotations(
  drafts: readonly DraftAnnotation[],
  blocks: readonly DocumentBlock[],
): ResolutionResult {
  const resolved: ResolvedAnnotation[] = [];
  const rejected: Rejection[] = [];
  const taken = new Set<string>();

  for (const draft of drafts) {
    const outcome = resolveOne(draft, blocks, taken);
    if ('anchor' in outcome) resolved.push(outcome);
    else rejected.push(outcome);
  }

  // Document order, so the margin column reads top to bottom.
  resolved.sort(
    (a, b) => a.anchor.block_index - b.anchor.block_index || a.anchor.start - b.anchor.start,
  );

  return { resolved, rejected };
}
