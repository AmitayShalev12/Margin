import { DocsRange } from './drive-types';
import { QuoteLocation } from './quote-locator';

/**
 * Turning a located quote into a range the Docs editor will anchor a comment to.
 *
 * The arithmetic everyone reaches for — paragraph start plus character offset —
 * is wrong, and wrong quietly. A paragraph's characters are not contiguous from
 * its start index: inline images, footnote references and page breaks each
 * occupy an index and contribute no text, so every offset after one of them
 * drifts. A comment anchored on a drifted index lands on a different sentence,
 * with nothing on screen to say it happened.
 *
 * So no arithmetic. `extractDocument` records the real index of every character
 * as it reads them, and this looks them up.
 */

/**
 * The document range covering a located quote, or null if it cannot be
 * addressed safely.
 *
 * Null rather than a best guess, for the reason the quote locator refuses:
 * a comment in the wrong place is worse than a comment that did not go.
 */
export function docsRange(indices: readonly number[][], location: QuoteLocation): DocsRange | null {
  const forBlock = indices[location.block_index];
  if (!forBlock) return null;

  const start = forBlock[location.start];
  const last = forBlock[location.end - 1];

  // -1 marks a character Google reported no position for, and an absent entry
  // means the map and the text have diverged. Neither can be anchored.
  if (start === undefined || last === undefined || start < 0 || last < 0) return null;

  const endIndex = last + 1;
  if (endIndex <= start) return null;

  return { startIndex: start, endIndex };
}

/**
 * Whether a range covers exactly the characters of the quote and no more.
 *
 * A span containing an inline object is still anchorable — the range simply
 * covers the object too — but it is worth being able to tell the two apart,
 * because a large discrepancy means the map and the text disagree rather than
 * that the paragraph holds a picture.
 */
export function rangeIsExact(range: DocsRange, location: QuoteLocation): boolean {
  return range.endIndex - range.startIndex === location.end - location.start;
}
