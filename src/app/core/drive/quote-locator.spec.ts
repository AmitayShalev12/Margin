import { DocumentBlock, TextAnchor } from '../models';
import { locateQuote } from './quote-locator';

/**
 * The rule under test is the anchor resolver's, in the other direction: a
 * comment goes onto a student's document only if the words it quotes are still
 * there. Most of these tests are about what it *refuses* to do, because that is
 * the property worth having — a comment quoting a sentence she never wrote is
 * worse than a comment she has to place by hand.
 */

function block(index: number, text: string, id = `p${index * 100}`): DocumentBlock {
  return { id, index, type: 'paragraph', text };
}

function anchorOn(blocks: DocumentBlock[], index: number, quote: string): TextAnchor {
  const start = blocks[index].text.indexOf(quote);
  return {
    block_id: blocks[index].id,
    block_index: index,
    start,
    end: start + quote.length,
    quote,
  };
}

describe('locateQuote', () => {
  it('confirms a quote that has not moved', () => {
    const blocks = [block(0, 'המדגם כלל 42 תלמידות מכיתות יא ויב.')];
    const found = locateQuote(blocks, anchorOn(blocks, 0, 'המדגם כלל 42 תלמידות'));

    expect(found).toEqual({ block_index: 0, start: 0, end: 20, moved: false });
  });

  /**
   * The common case after a student keeps working: a paragraph was added above,
   * so every stored offset is wrong, and the sentence itself is untouched.
   */
  it('follows a quote that slid when text was added above it', () => {
    const original = [block(0, 'פתיחה קצרה.'), block(1, 'המדגם כלל 42 תלמידות.')];
    const anchor = anchorOn(original, 1, 'המדגם כלל 42 תלמידות');

    const now = [
      block(0, 'פתיחה קצרה.'),
      block(1, 'פסקה חדשה שנוספה.'),
      block(2, 'המדגם כלל 42 תלמידות.'),
    ];
    const found = locateQuote(now, anchor);

    expect(found).toEqual({ block_index: 2, start: 0, end: 20, moved: true });
  });

  it('finds it when the sentence moved within its own paragraph', () => {
    const original = [block(0, 'המדגם כלל 42 תלמידות. הן מילאו שאלון.')];
    const anchor = anchorOn(original, 0, 'הן מילאו שאלון');

    const now = [block(0, 'לאחר אישור ההורים, הן מילאו שאלון. המדגם כלל 42 תלמידות.')];
    const found = locateQuote(now, anchor);

    expect(found?.moved).toBe(true);
    expect(now[0].text.slice(found!.start, found!.end)).toBe('הן מילאו שאלון');
  });

  /**
   * Docs re-flows spacing on its own, and reporting a quote as missing over a
   * double space would send the teacher looking for a problem that isn't there.
   * Every other character still has to match exactly.
   */
  it('tolerates changed spacing, since Docs changes it unasked', () => {
    const original = [block(0, 'המדגם  כלל   42 תלמידות.')];
    const anchor = anchorOn(original, 0, 'המדגם  כלל   42');

    const found = locateQuote([block(0, 'המדגם כלל 42 תלמידות.')], anchor);

    expect(found).not.toBeNull();
    expect('המדגם כלל 42 תלמידות.'.slice(found!.start, found!.end)).toBe('המדגם כלל 42');
  });

  // -- what it refuses ------------------------------------------------------

  it('refuses when the student rewrote the sentence', () => {
    const original = [block(0, 'המדגם היה אקראי לחלוטין.')];
    const anchor = anchorOn(original, 0, 'אקראי לחלוטין');

    expect(locateQuote([block(0, 'המדגם היה מדגם נוחות.')], anchor)).toBeNull();
  });

  /**
   * The case that makes this worth writing. Offsets alone would happily place
   * the comment on whatever text has slid into those coordinates, and the
   * student would be told she wrote something she didn't.
   */
  it('refuses rather than comment on whatever now sits at the old offsets', () => {
    const original = [block(0, 'המדגם היה אקראי לחלוטין ולכן מייצג.')];
    const anchor = anchorOn(original, 0, 'אקראי לחלוטין');

    // Same length, entirely different claim, sitting exactly where it was.
    const now = [block(0, 'המדגם היה קטן ומוגבל מאוד ולכן מייצג.')];
    const found = locateQuote(now, anchor);

    expect(found).toBeNull();
  });

  /**
   * The stored offsets no longer match, and the phrase now reads in two places.
   * Nearest-by-index would be a guess dressed as a location.
   */
  it('refuses when the quote moved and now appears twice', () => {
    const original = [block(0, 'פתיחה.'), block(1, 'יש לבסס את הטענה.')];
    const anchor = anchorOn(original, 1, 'יש לבסס את הטענה');

    // A paragraph was inserted above, so the id the anchor names is gone and
    // its index now points at something else entirely.
    const now = [
      block(0, 'פתיחה.', 'p0'),
      block(1, 'פסקה חדשה לגמרי.', 'p60'),
      block(2, 'גם כאן יש לבסס את הטענה.', 'p140'),
      block(3, 'ושוב, יש לבסס את הטענה.', 'p220'),
    ];

    expect(locateQuote(now, anchor)).toBeNull();
  });

  /**
   * The mirror of the above, and the reason it is not simply "refuse on any
   * duplicate": when the anchor still matches exactly, we know which one is
   * meant, and a copy elsewhere in the paper is beside the point.
   */
  it('keeps an exact hit even when the phrase also appears elsewhere', () => {
    const blocks = [block(0, 'יש לבסס את הטענה.'), block(1, 'גם כאן יש לבסס את הטענה.')];
    const found = locateQuote(blocks, anchorOn(blocks, 0, 'יש לבסס את הטענה'));

    expect(found).toEqual({ block_index: 0, start: 0, end: 16, moved: false });
  });

  it('refuses a repeated phrase inside one paragraph', () => {
    const anchor: TextAnchor = {
      block_id: 'p0',
      block_index: 0,
      start: 0,
      end: 4,
      quote: 'לכן',
    };

    expect(locateQuote([block(0, 'לכן, ולכן שוב, לכן.')], anchor)).toBeNull();
  });

  it('refuses an empty quote instead of matching everything', () => {
    const anchor: TextAnchor = { block_id: 'p0', block_index: 0, start: 0, end: 0, quote: '   ' };

    expect(locateQuote([block(0, 'טקסט כלשהו.')], anchor)).toBeNull();
  });

  it('refuses when the document came back empty', () => {
    const original = [block(0, 'המדגם כלל 42 תלמידות.')];
    expect(locateQuote([], anchorOn(original, 0, 'המדגם'))).toBeNull();
  });
});
