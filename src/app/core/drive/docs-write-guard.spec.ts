import { docsRange, rangeIsExact } from './docs-range';
import { isAnchoredCommentInsert, isCommentCreation } from './drive-api';

/**
 * The one thing Margin must never be able to do.
 *
 * Anchoring a comment means calling `documents.batchUpdate` — the same endpoint
 * that deletes content, replaces text, restyles paragraphs and rewrites tables.
 * Permitting it by URL would hand the app every one of those over a student's
 * paper. So the body is inspected, and this is the test that says so: the same
 * shape as the reliability suite's proof that the refused flags cannot be
 * raised, and for the same reason — a guarantee nobody checks is a comment.
 */

const DOC = 'https://docs.googleapis.com/v1/documents/abc123:batchUpdate';
const insert = (range = { startIndex: 5, endIndex: 12 }) => ({
  requests: [{ insertComment: { content: 'הערה', range } }],
});

describe('what may be sent to the Docs write endpoint', () => {
  it('allows a batch that is nothing but comment insertions', () => {
    expect(isAnchoredCommentInsert(DOC, insert())).toBe(true);

    const several = {
      requests: [
        { insertComment: { content: 'א', range: { startIndex: 1, endIndex: 3 } } },
        { insertComment: { content: 'ב', range: { startIndex: 8, endIndex: 9 } } },
      ],
    };
    expect(isAnchoredCommentInsert(DOC, several)).toBe(true);
  });

  /**
   * Each of these would alter the student's own writing. Not one is a request
   * the app makes today — the point is that it could not, even by mistake.
   */
  it('refuses every request type that could change her text', () => {
    const forbidden = [
      { deleteContentRange: { range: { startIndex: 1, endIndex: 40 } } },
      { replaceAllText: { containsText: { text: 'הוכיחו' }, replaceText: 'הראו' } },
      { insertText: { location: { index: 12 }, text: '①' } },
      { updateTextStyle: { range: { startIndex: 1, endIndex: 9 }, textStyle: {} } },
      { updateParagraphStyle: { range: { startIndex: 1, endIndex: 9 }, paragraphStyle: {} } },
      { deleteParagraphBullets: { range: { startIndex: 1, endIndex: 9 } } },
      { insertInlineImage: { location: { index: 4 }, uri: 'https://example.invalid/a.png' } },
      { deleteNamedRange: { name: 'x' } },
      { replaceImage: { imageObjectId: 'i', uri: 'https://example.invalid/b.png' } },
      { acceptSuggestion: { suggestionId: 's' } },
    ];

    for (const request of forbidden) {
      expect(isAnchoredCommentInsert(DOC, { requests: [request] })).toBe(false);
    }
  });

  /** A destructive request smuggled in beside a legitimate one. */
  it('refuses a batch that hides a deletion among the comments', () => {
    const mixed = {
      requests: [
        { insertComment: { content: 'הערה', range: { startIndex: 1, endIndex: 3 } } },
        { deleteContentRange: { range: { startIndex: 1, endIndex: 400 } } },
      ],
    };

    expect(isAnchoredCommentInsert(DOC, mixed)).toBe(false);
  });

  /** Two keys on one request, one of them permitted. */
  it('refuses a request carrying anything beside the insertion', () => {
    const smuggled = {
      requests: [
        {
          insertComment: { content: 'הערה', range: { startIndex: 1, endIndex: 3 } },
          deleteContentRange: { range: { startIndex: 1, endIndex: 400 } },
        },
      ],
    };

    expect(isAnchoredCommentInsert(DOC, smuggled)).toBe(false);
  });

  it('refuses an empty or malformed batch rather than sending it', () => {
    expect(isAnchoredCommentInsert(DOC, { requests: [] })).toBe(false);
    expect(isAnchoredCommentInsert(DOC, {})).toBe(false);
    expect(isAnchoredCommentInsert(DOC, { requests: 'insertComment' })).toBe(false);
    expect(isAnchoredCommentInsert(DOC, { requests: [null] })).toBe(false);
  });

  it('refuses a comment insertion aimed at any other endpoint', () => {
    const elsewhere = [
      'https://docs.googleapis.com/v1/documents/abc123',
      'https://www.googleapis.com/drive/v3/files/abc123',
      'https://www.googleapis.com/drive/v3/files/abc123/permissions',
      'https://docs.googleapis.com.evil.invalid/v1/documents/abc123:batchUpdate',
    ];

    for (const url of elsewhere) expect(isAnchoredCommentInsert(url, insert())).toBe(false);
  });

  /** The two permitted writes stay distinct — neither vouches for the other. */
  it('keeps the two write paths separate', () => {
    expect(isCommentCreation(DOC)).toBe(false);
    expect(
      isAnchoredCommentInsert('https://www.googleapis.com/drive/v3/files/a/comments', insert()),
    ).toBe(false);
  });
});

/**
 * Where the comment lands.
 *
 * `paragraphStart + offset` is the arithmetic everyone reaches for and it is
 * wrong wherever a paragraph holds anything that occupies an index without
 * contributing text. These pin the lookup, and pin that it refuses rather than
 * guesses.
 */
describe('docsRange', () => {
  const at = (block_index: number, start: number, end: number) => ({
    block_index,
    start,
    end,
    moved: false,
  });

  it('reads the real index of each character, not an offset from the paragraph', () => {
    // A paragraph whose characters jump: an inline object sits at index 14.
    const indices = [[10, 11, 12, 13, 15, 16, 17]];

    expect(docsRange(indices, at(0, 0, 4))).toEqual({ startIndex: 10, endIndex: 14 });
    // Spanning the object: the range covers it, and says so by being wider.
    const across = docsRange(indices, at(0, 2, 6))!;
    expect(across).toEqual({ startIndex: 12, endIndex: 17 });
    expect(rangeIsExact(across, at(0, 2, 6))).toBe(false);
  });

  it('is exact when the characters are contiguous', () => {
    const indices = [[10, 11, 12, 13, 14]];
    const range = docsRange(indices, at(0, 1, 4))!;

    expect(range).toEqual({ startIndex: 11, endIndex: 14 });
    expect(rangeIsExact(range, at(0, 1, 4))).toBe(true);
  });

  it('refuses a character Google reported no position for', () => {
    expect(docsRange([[10, -1, 12]], at(0, 0, 2))).toBeNull();
    expect(docsRange([[-1, 11, 12]], at(0, 0, 2))).toBeNull();
  });

  it('refuses when the map and the text have diverged', () => {
    expect(docsRange([[10, 11]], at(0, 0, 5))).toBeNull();
    expect(docsRange([], at(0, 0, 2))).toBeNull();
    expect(docsRange([[10, 11, 12]], at(3, 0, 2))).toBeNull();
  });
});
