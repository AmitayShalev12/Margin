import { CountPipe, count } from './count';

/**
 * Hebrew counts.
 *
 * The bug this exists for is easy to miss in English and glaring in Hebrew:
 * `${n} קבצים שנקלטו` at n = 1 reads "1 files that were received", and a
 * native reader sees it on every row of the home screen, since most students
 * hand in one file.
 */

const FILES = { one: 'קובץ אחד שנקלט', two: 'שני קבצים שנקלטו', many: '# קבצים שנקלטו' };

describe('count', () => {
  it('says one in the singular, with the verb agreeing', () => {
    expect(count(1, FILES)).toBe('קובץ אחד שנקלט');
  });

  it('says two in the construct form', () => {
    expect(count(2, FILES)).toBe('שני קבצים שנקלטו');
  });

  it('puts any other number where the # is', () => {
    expect(count(3, FILES)).toBe('3 קבצים שנקלטו');
    expect(count(40, FILES)).toBe('40 קבצים שנקלטו');
  });

  /** Zero is grammatical as a number — "0 קבצים" — and stays one. */
  it('treats zero as a number, not as one', () => {
    expect(count(0, FILES)).toBe('0 קבצים שנקלטו');
  });

  it('says two like any other number when no dual form is given', () => {
    expect(count(2, { one: 'הערה אחת', many: '# הערות' })).toBe('2 הערות');
  });

  /**
   * The reason `many` takes a marker instead of always prefixing the number:
   * in a verb-first sentence the number sits after the verb.
   */
  it('places the number mid-sentence for a verb-first phrase', () => {
    const found = { one: 'נמצאה הערה אחת', many: 'נמצאו # הערות' };
    expect(count(7, found)).toBe('נמצאו 7 הערות');
    expect(count(1, found)).toBe('נמצאה הערה אחת');
  });
});

describe('the count pipe', () => {
  const pipe = new CountPipe();

  it('takes its forms in the order one, many, two', () => {
    expect(pipe.transform(1, 'סעיף אחד', '# סעיפים', 'שני סעיפים')).toBe('סעיף אחד');
    expect(pipe.transform(2, 'סעיף אחד', '# סעיפים', 'שני סעיפים')).toBe('שני סעיפים');
    expect(pipe.transform(5, 'סעיף אחד', '# סעיפים', 'שני סעיפים')).toBe('5 סעיפים');
  });

  it('works without the optional dual', () => {
    expect(pipe.transform(2, 'סעיף אחד', '# סעיפים')).toBe('2 סעיפים');
  });
});
