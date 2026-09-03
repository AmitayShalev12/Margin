import { DocumentBlock } from '../models';
import { DocxError, parseXml } from './docx-comments';
import { ZipError, readZipParts } from './zip';

/**
 * A `.docx` as the document blocks the app anchors comments to.
 *
 * Drive has always *listed* Word files — they are in `DOCUMENT_MIMES` and turn
 * up in the folder — but `readDocument` returned null for anything that was
 * not a Google Doc, so they arrived as submissions with no text in them.
 * Nothing downstream could touch one: no drafting, no scoring, no review. The
 * paper was in her folder and the app could see its name and nothing else.
 *
 * Blocks rather than a wall of text, because every comment in this app is
 * anchored to one. `readDocxText` already existed and is not enough: it
 * flattens the document to a string, and a quote resolved against a string has
 * no block to belong to.
 */

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_PART = 'word/document.xml';

/**
 * Word's own heading styles, as they appear in `w:pStyle`.
 *
 * `Heading1` is the English name and `1 כותרת` the Hebrew one; a document
 * written in a Hebrew Word carries the localised style id, and matching only
 * the English one would read every heading in her students' papers as an
 * ordinary paragraph.
 */
function headingLevel(style: string | null): number | null {
  if (!style) return null;

  const english = /^heading\s*(\d)$/i.exec(style.trim());
  if (english) return Number(english[1]);

  // `כותרת 1`, and the style-id form Word writes for it.
  const hebrew = /^(?:כותרת|kotert)\s*(\d)$/i.exec(style.trim());
  if (hebrew) return Number(hebrew[1]);

  return null;
}

/** The text of one paragraph, joining its runs and honouring line breaks. */
function paragraphText(paragraph: Element): string {
  let text = '';

  for (const node of Array.from(paragraph.getElementsByTagNameNS(WORD_NS, '*')) as Element[]) {
    if (node.localName === 't') text += node.textContent ?? '';
    // `w:br` and `w:tab` are whitespace in the source and whitespace here; a
    // paragraph broken across lines is still one paragraph.
    else if (node.localName === 'br' || node.localName === 'tab') text += ' ';
  }

  return text.replace(/\s+/g, ' ').trim();
}

function styleOf(paragraph: Element): string | null {
  const style = paragraph.getElementsByTagNameNS(WORD_NS, 'pStyle')[0];
  return style?.getAttributeNS(WORD_NS, 'val') ?? style?.getAttribute('w:val') ?? null;
}

function isListItem(paragraph: Element): boolean {
  return paragraph.getElementsByTagNameNS(WORD_NS, 'numPr').length > 0;
}

/**
 * Reads a `.docx` into blocks.
 *
 * Tables are walked as well as paragraphs: a student's data table is content
 * she may well be commented on, and skipping it would leave a hole in the
 * document that a quote could resolve into. Each cell's paragraphs come
 * through in reading order, which is not the visual order of a table but is
 * the order the text was written in.
 */
export async function readDocxBlocks(file: ArrayBuffer): Promise<DocumentBlock[]> {
  let parts: Map<string, string>;
  try {
    parts = await readZipParts(file, [DOCUMENT_PART]);
  } catch (error) {
    if (error instanceof ZipError) {
      throw new DocxError(
        'זה לא נראה כמו קובץ Word. צריך קובץ ‎.docx‎ — לא ‎.doc‎ ולא PDF.',
        error.message,
      );
    }
    throw error;
  }

  const xml = parts.get(DOCUMENT_PART);
  if (!xml) throw new DocxError('לא הצלחתי לקרוא את תוכן הקובץ.', 'No word/document.xml');

  const body = parseXml(xml, DOCUMENT_PART).documentElement;
  const blocks: DocumentBlock[] = [];

  for (const paragraph of Array.from(body.getElementsByTagNameNS(WORD_NS, 'p')) as Element[]) {
    const text = paragraphText(paragraph);
    // An empty paragraph is spacing, not content. Kept out so a quote can
    // never resolve to a blank block, and so the block indices she sees line
    // up with paragraphs she can actually point at.
    if (!text) continue;

    const level = headingLevel(styleOf(paragraph));
    const index = blocks.length;

    blocks.push({
      id: `b${index}`,
      index,
      type: level !== null ? 'heading' : isListItem(paragraph) ? 'list_item' : 'paragraph',
      text,
      ...(level !== null ? { level } : {}),
    });
  }

  if (!blocks.length) {
    throw new DocxError('הקובץ נראה ריק — לא מצאתי בו טקסט.', 'no paragraphs');
  }

  return blocks;
}
