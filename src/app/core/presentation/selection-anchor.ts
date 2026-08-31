import { DocumentBlock, TextAnchor } from '../models';

/**
 * Turns a sentence she selected in the paper into an anchor.
 *
 * The offsets are found by searching the block's own text for what she
 * selected, rather than by reading them off the DOM. That is deliberate: the
 * rendered paragraph is a row of spans with template whitespace between them,
 * and counting characters through it puts every anchor a few positions out —
 * invisibly, and only for some paragraphs.
 *
 * It is also the rule the drafted comments already use (`anchor-resolver.ts`
 * locates a model's quote the same way), so a comment she wrote and a comment
 * the model wrote are anchored by the same thing and behave alike when the
 * student edits the paper underneath them.
 */

export type SelectionRefusal =
  /** Nothing selected, or only whitespace. */
  | 'empty'
  /** The selection is not inside a block of the document. */
  | 'no_block'
  /** Selected across two paragraphs; there is no single span to anchor to. */
  | 'not_found'
  /** The same words appear twice in the paragraph, so the span is ambiguous. */
  | 'ambiguous';

export type SelectionAnchor =
  { ok: true; anchor: TextAnchor } | { ok: false; reason: SelectionRefusal };

/**
 * The block's text with runs of whitespace collapsed, plus a map back.
 *
 * `map[i]` is the offset in the original text of the character that ended up
 * at `i`. A selection dragged across a line break arrives with a newline in
 * it, and the paragraph it came from may have none — comparing the two
 * directly would fail on text that plainly matches.
 */
function collapse(text: string): { flat: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let space = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/\s/.test(char)) {
      if (space || out.length === 0) continue;
      out.push(' ');
      map.push(i);
      space = true;
    } else {
      out.push(char);
      map.push(i);
      space = false;
    }
  }

  // A trailing space belongs to nothing.
  if (out.length && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }

  return { flat: out.join(''), map };
}

export function anchorFromSelection(
  blocks: readonly DocumentBlock[],
  blockId: string | null,
  selected: string,
): SelectionAnchor {
  const wanted = collapse(selected).flat;
  if (!wanted) return { ok: false, reason: 'empty' };

  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1) return { ok: false, reason: 'no_block' };

  const block = blocks[index];
  const { flat, map } = collapse(block.text);

  const at = flat.indexOf(wanted);
  if (at === -1) return { ok: false, reason: 'not_found' };

  /**
   * Two identical spans in one paragraph give no way to know which she meant.
   * Refused rather than guessed: an anchor on the wrong occurrence puts her
   * comment beside a sentence she was not reading.
   */
  if (flat.indexOf(wanted, at + 1) !== -1) return { ok: false, reason: 'ambiguous' };

  const start = map[at];
  // `end` is exclusive, so it is one past the last character's real offset.
  const end = map[at + wanted.length - 1] + 1;

  return {
    ok: true,
    anchor: {
      block_id: block.id,
      block_index: index,
      start,
      end,
      // The paper's own words, not the selection's — the selection may carry
      // whitespace the document does not, and the quote is what re-locates
      // the comment after the student edits around it.
      quote: block.text.slice(start, end),
    },
  };
}

/** Why nothing was anchored, in her words. */
export const SELECTION_REFUSAL: Record<SelectionRefusal, string> = {
  empty: 'לא נבחר טקסט.',
  no_block: 'אפשר לסמן רק בתוך העבודה עצמה.',
  not_found: 'אפשר לסמן רק בתוך פסקה אחת. סימנת קטע שעובר בין פסקאות.',
  ambiguous: 'הקטע הזה מופיע פעמיים בפסקה. אפשר לסמן קצת יותר כדי שיהיה ברור לאיזה מהם התכוונת.',
};
