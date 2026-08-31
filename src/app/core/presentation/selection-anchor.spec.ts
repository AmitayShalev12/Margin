import { DocumentBlock } from '../models';
import { anchorFromSelection } from './selection-anchor';

/**
 * Anchoring a comment she wrote to the sentence she selected.
 *
 * The offsets have to be right for the same reason the drafted ones do: they
 * are what puts the comment beside the sentence in the paper, and what
 * re-locates it after the student edits around it. An anchor a few characters
 * out is not visibly wrong until it is on a student's document.
 */

const BLOCKS: DocumentBlock[] = [
  {
    id: 'b-intro',
    type: 'paragraph',
    text: 'מחקרים רבים הוכיחו שקיים קשר בין המשתנים. הקשר בין המשתנים היה מובהק.',
  },
  {
    id: 'b-method',
    type: 'paragraph',
    text: 'במחקר השתתפו 48 תלמידות.',
  },
] as DocumentBlock[];

describe('anchoring what she selected', () => {
  it('finds the offsets of a selected sentence', () => {
    const result = anchorFromSelection(BLOCKS, 'b-intro', 'מחקרים רבים הוכיחו');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.anchor.block_id).toBe('b-intro');
    expect(result.anchor.block_index).toBe(0);
    expect(result.anchor.start).toBe(0);
    expect(result.anchor.quote).toBe('מחקרים רבים הוכיחו');
    // Exclusive, so slicing the block by the offsets gives the quote back.
    expect(BLOCKS[0].text.slice(result.anchor.start, result.anchor.end)).toBe('מחקרים רבים הוכיחו');
  });

  it('anchors a span in the middle of a paragraph', () => {
    const result = anchorFromSelection(BLOCKS, 'b-intro', 'היה מובהק');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(BLOCKS[0].text.slice(result.anchor.start, result.anchor.end)).toBe('היה מובהק');
  });

  /**
   * A selection dragged across a wrapped line arrives with a newline in it,
   * and the paragraph it came from has none. Compared directly it would fail
   * on text that plainly matches.
   */
  it('matches a selection carrying whitespace the paragraph does not', () => {
    const result = anchorFromSelection(BLOCKS, 'b-intro', '  מחקרים   רבים\n הוכיחו  ');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchor.quote).toBe('מחקרים רבים הוכיחו');
  });

  /**
   * Two identical spans in one paragraph give no way to know which she meant,
   * and an anchor on the wrong one puts her comment beside a sentence she was
   * not reading.
   */
  it('refuses an ambiguous selection rather than picking one', () => {
    const result = anchorFromSelection(BLOCKS, 'b-intro', 'בין המשתנים');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('ambiguous');
  });

  it('refuses a selection that is not in the paragraph', () => {
    const result = anchorFromSelection(BLOCKS, 'b-intro', 'במחקר השתתפו');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_found');
  });

  it('refuses an empty or whitespace selection', () => {
    expect(anchorFromSelection(BLOCKS, 'b-intro', '   ')).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('refuses a selection outside any block', () => {
    const result = anchorFromSelection(BLOCKS, null, 'מחקרים רבים');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_block');
  });

  it('carries the block index, which is what orders the comments', () => {
    const result = anchorFromSelection(BLOCKS, 'b-method', '48 תלמידות');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchor.block_index).toBe(1);
  });
});
