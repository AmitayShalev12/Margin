import { readDocxBlocks } from './docx-blocks';
import { writeZip } from '../export/zip-writer';

/**
 * Reading a Word file into blocks.
 *
 * Drive listed these all along and read none of them: `readDocument` returned
 * null for anything that was not a Google Doc, so a student who writes in Word
 * — which is most of them — arrived as a row with a name and no text, and
 * every screen downstream needs blocks. No drafting, no scoring, no review.
 */

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A `.docx` containing the paragraphs given, built with the real zip writer. */
function docx(paragraphs: string): ArrayBuffer {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${NS}"><w:body>${paragraphs}</w:body></w:document>`;

  const bytes = writeZip(
    [{ name: 'word/document.xml', data: xml }],
    new Date('2026-09-02T09:00:00Z'),
  );
  return bytes.buffer as ArrayBuffer;
}

const p = (text: string, style?: string, numbered = false) =>
  `<w:p>` +
  (style || numbered
    ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${numbered ? '<w:numPr/>' : ''}</w:pPr>`
    : '') +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('a Word file as document blocks', () => {
  it('reads its paragraphs in order', async () => {
    const blocks = await readDocxBlocks(docx(p('פסקה ראשונה') + p('פסקה שנייה')));

    expect(blocks.map((b) => b.text)).toEqual(['פסקה ראשונה', 'פסקה שנייה']);
    expect(blocks.map((b) => b.index)).toEqual([0, 1]);
  });

  it('gives every block an id, so a comment has something to anchor to', async () => {
    const blocks = await readDocxBlocks(docx(p('אחת') + p('שתיים')));

    expect(new Set(blocks.map((b) => b.id)).size).toBe(2);
  });

  it('recognises a heading', async () => {
    const blocks = await readDocxBlocks(docx(p('מבוא', 'Heading1') + p('טקסט')));

    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks[1].type).toBe('paragraph');
  });

  /**
   * A paper written in a Hebrew Word carries the localised style id. Matching
   * only the English one would read every heading in it as body text.
   */
  it('recognises a heading styled in Hebrew', async () => {
    const blocks = await readDocxBlocks(docx(p('פרק תאורטי', 'כותרת 2')));

    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('recognises a numbered list item', async () => {
    const blocks = await readDocxBlocks(docx(p('פריט', undefined, true)));

    expect(blocks[0].type).toBe('list_item');
  });

  /**
   * Spacing is not content. A blank block is something a quote could resolve
   * into, and a comment anchored to nothing is worse than an unanchored one.
   */
  it('drops empty paragraphs rather than numbering them', async () => {
    const blocks = await readDocxBlocks(docx(p('אחת') + p('') + p('שתיים')));

    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.index)).toEqual([0, 1]);
  });

  it('joins the runs Word splits a sentence into', async () => {
    const split = `<w:p><w:r><w:t>שאלת </w:t></w:r><w:r><w:t>המחקר</w:t></w:r></w:p>`;

    const blocks = await readDocxBlocks(docx(split));

    expect(blocks[0].text).toBe('שאלת המחקר');
  });

  it('refuses a file that is not a Word document at all', async () => {
    const notAZip = new TextEncoder().encode('hello').buffer as ArrayBuffer;

    await expect(readDocxBlocks(notAZip)).rejects.toThrow();
  });

  /** Said rather than returned as an empty document that reads as a short one. */
  it('refuses a document with no text in it', async () => {
    await expect(readDocxBlocks(docx(p('')))).rejects.toThrow();
  });
});
