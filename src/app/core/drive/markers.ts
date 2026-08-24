import { AnnotationKind } from '../models';

/**
 * The numbered marker Margin puts in the document beside a commented span.
 *
 * It exists because Google will not anchor a comment. The Drive comments API
 * ignores its own anchor field on a Doc and labels the result *"Original
 * content deleted"*; the Docs API can anchor properly but only under a
 * Developer Preview that needs a Workspace account. Without either, a comment
 * has no connection to the sentence it is about — so the connection is made
 * the way a teacher with a red pen would make it: a small number by the line,
 * and the same number on the note.
 *
 * **This is the one place Margin adds anything to a student's writing**, and
 * everything about the format is chosen to keep that reversible and safe:
 *
 * - **One character.** Not `[1]`, not `⟦1⟧`. A single glyph is a single index
 *   to insert, to restyle and to remove, and the write guard can therefore
 *   refuse any request touching more than one character — which is what makes
 *   "it cannot damage her text" checkable rather than promised.
 * - **No digits.** A European digit inside right-to-left text forms its own
 *   left-to-right run and drags the neutral characters around it. `①` carries
 *   its number without a digit in the string, so the reading order of the
 *   Hebrew either side is untouched. This matters most beside notation like
 *   `(r = .42, p < .01)`, where a stray reordering corrupts a statistic.
 * - **Nothing a student types.** Enclosed alphanumerics do not appear in
 *   ordinary prose, so a marker can be found again even without its recorded
 *   position.
 */

/** Enclosed numbers, in the three ranges Unicode provides them. */
const CIRCLED_1_20 = 0x2460; // ①–⑳
const CIRCLED_21_35 = 0x3251; // ㉑–㉟
const CIRCLED_36_50 = 0x32b1; // ㊱–㊿

/** Above this Unicode runs out and the marker would need a digit. */
export const MAX_MARKER = 50;

/**
 * The glyph for a number, or null past what can be rendered as one character.
 *
 * Null rather than a fallback like `(51)`: a multi-character marker breaks the
 * single-index guarantee the write guard rests on, and a paper with fifty-one
 * comments on one round is a different conversation.
 */
export function markerChar(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > MAX_MARKER) return null;
  if (n <= 20) return String.fromCodePoint(CIRCLED_1_20 + n - 1);
  if (n <= 35) return String.fromCodePoint(CIRCLED_21_35 + n - 21);
  return String.fromCodePoint(CIRCLED_36_50 + n - 36);
}

/** The number a glyph stands for, or null if it is not one of ours. */
export function markerNumber(char: string): number | null {
  if ([...char].length !== 1) return null;
  const code = char.codePointAt(0);
  if (code === undefined) return null;

  if (code >= CIRCLED_1_20 && code <= CIRCLED_1_20 + 19) return code - CIRCLED_1_20 + 1;
  if (code >= CIRCLED_21_35 && code <= CIRCLED_21_35 + 14) return code - CIRCLED_21_35 + 21;
  if (code >= CIRCLED_36_50 && code <= CIRCLED_36_50 + 14) return code - CIRCLED_36_50 + 36;
  return null;
}

/** True for any glyph Margin could have inserted. */
export function isMarker(char: string): boolean {
  return markerNumber(char) !== null;
}

export interface Rgb {
  red: number;
  green: number;
  blue: number;
}

function hex(value: string): Rgb {
  return {
    red: parseInt(value.slice(1, 3), 16) / 255,
    green: parseInt(value.slice(3, 5), 16) / 255,
    blue: parseInt(value.slice(5, 7), 16) / 255,
  };
}

/**
 * The category hues, taken from `_categories.scss` rather than re-picked.
 *
 * `--k-ink` in each class: the saturated hue the app already uses for that
 * category's spine, dot and legend swatch. A marker in a different green from
 * the one on screen would be a second vocabulary for the same thing.
 */
export const MARKER_HEX: Record<AnnotationKind, string> = {
  language: '#2b6f6a',
  structure: '#42598f',
  sources: '#a8642b',
  content: '#7a4667',
  praise: '#4a7a55',
  // The two neutrals, kept deliberately quiet so they never compete.
  formatting: '#5f6b70',
  other: '#6b7579',
};

export function markerColour(kind: AnnotationKind): Rgb {
  return hex(MARKER_HEX[kind]);
}

/** How a comment names itself, so the panel and the document line up. */
export function numberedCommentText(
  n: number,
  kindLabel: string,
  body: string,
  quote: string,
  section: string | null,
): string {
  const glyph = markerChar(n);
  const head = glyph ? `${glyph} ${kindLabel}` : kindLabel;
  const where = section ? ` · ${section}` : '';
  return `${head}${where}\n״${quote}״\n\n${body}`;
}
