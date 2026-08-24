import { DocumentBlock, TextAnchor } from '../models';

/**
 * Finds a comment's quoted text in the document as it stands *now*.
 *
 * The offsets on a `TextAnchor` were taken when the document was synced. By the
 * time the teacher sends her comments the student may have rewritten the
 * paragraph above, and every offset after it has moved. A comment quoting a
 * sentence the student no longer wrote — or worse, quoting whatever text has
 * slid into those coordinates — is not a small error: it tells her she wrote
 * something she didn't.
 *
 * So the rule is the anchor resolver's rule, in the other direction: the quote
 * is the truth and the offsets are a hint. Confirm, relocate, or refuse. There
 * is no fourth option where a comment goes out unverified.
 */

export interface QuoteLocation {
  block_index: number;
  /** Character offsets into the *current* block text. */
  start: number;
  end: number;
  /** False when it was still exactly where the anchor said it would be. */
  moved: boolean;
}

/**
 * Whitespace-insensitive view of a string, with a way back.
 *
 * Docs normalises spacing on its own — a double space becomes one, a line
 * break moves — often enough that an exact-match-only search would report
 * quotes as missing that are plainly still in the paragraph. Every other
 * character is compared exactly; nothing here is case-folding or
 * transliteration, which would start matching text that genuinely differs.
 */
interface Normalised {
  text: string;
  /** `map[i]` is where character `i` sits in the original string. */
  map: number[];
}

function normalise(source: string): Normalised {
  const chars: string[] = [];
  const map: number[] = [];
  let gap = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (/\s/.test(char)) {
      gap = true;
      continue;
    }
    // A run of any whitespace collapses to one space, and only between
    // characters — so a leading or trailing run disappears entirely.
    if (gap && chars.length) {
      chars.push(' ');
      map.push(i);
    }
    gap = false;
    chars.push(char);
    map.push(i);
  }

  return { text: chars.join(''), map };
}

/** Every position in `haystack` where `needle` starts. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return found;
    found.push(at);
    // Overlapping matches count: a repeated phrase is exactly the case we
    // need to notice, and stepping past the whole needle would hide some.
    from = at + 1;
  }
}

interface Hit {
  block_index: number;
  start: number;
  end: number;
}

function findIn(block: DocumentBlock, quote: string): Hit[] {
  const haystack = normalise(block.text);
  const needle = normalise(quote);
  if (!needle.text) return [];

  return occurrences(haystack.text, needle.text).map((at) => ({
    block_index: block.index,
    start: haystack.map[at],
    // The last matched character's origin, plus itself.
    end: haystack.map[at + needle.text.length - 1] + 1,
  }));
}

/**
 * Where this comment's quote is now, or null if it cannot be placed safely.
 *
 * Null covers two different situations, and both mean the same thing for the
 * caller: don't post it, tell her. Either the text is gone, or it now appears
 * more than once with nothing to say which is meant — and a coin flip between
 * two paragraphs is not better than an honest omission.
 */
export function locateQuote(
  blocks: readonly DocumentBlock[],
  anchor: TextAnchor,
): QuoteLocation | null {
  const quote = anchor.quote?.trim();
  if (!quote) return null;

  // 1. Still exactly where it was. The overwhelmingly common case: nobody has
  //    touched the document since the sync.
  const atAnchor = blocks[anchor.block_index];
  if (atAnchor && atAnchor.text.slice(anchor.start, anchor.end) === anchor.quote) {
    return { block_index: anchor.block_index, start: anchor.start, end: anchor.end, moved: false };
  }

  // 2. Its own paragraph, found by id first — block ids carry the Docs
  //    character index, so an edit earlier in the document moves the position
  //    but the paragraph is still recognisably the same one.
  for (const block of [blocks.find((b) => b.id === anchor.block_id), atAnchor].filter(
    (b): b is DocumentBlock => !!b,
  )) {
    const hits = findIn(block, quote);
    if (hits.length === 1) return { ...hits[0], moved: true };
    // Several copies inside one paragraph and no way to choose: refuse here
    // rather than fall through to a document-wide search that cannot do
    // better.
    if (hits.length > 1) return null;
  }

  // 3. Anywhere in the document — the paragraph was moved or rewritten around
  //    it. Accepted only when there is exactly one candidate.
  const everywhere = blocks.flatMap((block) => findIn(block, quote));
  if (everywhere.length !== 1) return null;

  return { ...everywhere[0], moved: true };
}
