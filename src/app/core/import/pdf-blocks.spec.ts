import { PdfItem, blocksFromPdfPages, isPdf } from './pdf-blocks';

/**
 * Pieces laid out the way pdf.js reads a Hebrew Word export: reading order,
 * Hebrew runs and numbers as separate pieces, an empty piece at each line end.
 * Positions are taken from a real export of a test paper. All text is invented.
 */
const piece = (str: string, x: number, y: number, width: number): PdfItem => ({
  str,
  x,
  y,
  width,
  height: 12,
});
const eol = (y: number): PdfItem => ({ str: '', x: 90, y, width: 0, height: 0 });

const PAGE: PdfItem[] = [
  piece('פרק ב׳: שיטת המחקר', 400, 711, 110),
  eol(679),
  piece('נבדקים', 470, 679, 40),
  eol(666),
  piece('במחקר השתתפו', 430, 666, 80),
  piece('80', 417, 666, 10.6),
  piece('תלמידים מכיתות ה׳ ו', 320, 666, 92),
  piece('-', 316, 666, 4),
  piece('ו׳ בשני בתי ספר ממלכתיים במרכז הארץ.', 90, 666, 226),
  eol(653),
  piece('הם נבחרו בדגימת נוחות.', 380, 653, 130),
  eol(615),
  piece('3', 300, 40, 6),
];

describe('a PDF as document blocks', () => {
  const blocks = blocksFromPdfPages([PAGE]);

  it('keeps headings and paragraphs apart, in reading order', () => {
    expect(blocks.map((b) => b.text)).toEqual([
      'פרק ב׳: שיטת המחקר',
      'נבדקים',
      'במחקר השתתפו 80 תלמידים מכיתות ה׳ ו-ו׳ בשני בתי ספר ממלכתיים במרכז הארץ. הם נבחרו בדגימת נוחות.',
    ]);
  });

  it('numbers the blocks the way a Word file is numbered', () => {
    expect(blocks.map((b) => [b.id, b.index, b.type])).toEqual([
      ['b0', 0, 'paragraph'],
      ['b1', 1, 'paragraph'],
      ['b2', 2, 'paragraph'],
    ]);
  });

  it('leaves out a page number standing alone', () => {
    expect(blocks.some((b) => b.text === '3')).toBe(false);
  });

  it('reads a scanned PDF, which has no text, as nothing', () => {
    expect(blocksFromPdfPages([[eol(700), eol(680)]])).toEqual([]);
  });

  it('never runs a paragraph across a page break', () => {
    const one = [piece('סוף העמוד הראשון שממשיך בשורה ארוכה מאוד מאוד מאוד', 90, 100, 420)];
    const two = [piece('ותחילת העמוד השני', 380, 700, 130)];
    expect(blocksFromPdfPages([one, two]).length).toBe(2);
  });

  it('knows a PDF by its type or its name', () => {
    expect(isPdf('הצעה.PDF')).toBe(true);
    expect(isPdf('file', 'application/pdf')).toBe(true);
    expect(isPdf('הצעה.docx')).toBe(false);
  });
});
