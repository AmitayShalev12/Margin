import { ZipError, readZipParts } from './zip';

/**
 * Her old marked-up papers, read back.
 *
 * A teacher who has been doing this for years already has the thing Margin
 * spends a year learning: hundreds of comments in her own words, sitting in
 * Word documents. This reads them out — each note together with the sentence
 * it was written about, which is what makes it a style example rather than a
 * tone sample.
 *
 * Nothing here touches the student's writing or keeps the document. The file
 * is read in the browser, the pairs are extracted, and the bytes are dropped.
 */

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const COMMENTS_PART = 'word/comments.xml';
const DOCUMENT_PART = 'word/document.xml';

export interface ImportedComment {
  /** Word's own id for the comment, used to pair it with its anchor. */
  id: string;
  author: string;
  /** What she wrote. */
  body: string;
  /** The span she wrote it about, when the comment was anchored to one. */
  quote: string | null;
}

export interface DocxImport {
  comments: ImportedComment[];
  /** Every author who left a comment, with how many — she confirms whose are hers. */
  authors: { name: string; count: number }[];
}

export class DocxError extends Error {
  constructor(
    readonly hebrew: string,
    message: string,
  ) {
    super(message);
    this.name = 'DocxError';
  }
}

function parseXml(xml: string, part: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new DocxError('הקובץ לא נקרא. יכול להיות שהוא פגום.', `Malformed XML in ${part}`);
  }
  return doc;
}

/**
 * The text of one element, with paragraph breaks kept.
 *
 * `w:t` runs are the text; a comment of three sentences is often a dozen of
 * them, split wherever Word felt like it. Paragraph boundaries are the only
 * breaks that mean anything, so they survive and the rest are joined.
 */
function textOf(element: Element): string {
  const paragraphs = [...element.getElementsByTagNameNS(WORD_NS, 'p')];

  const read = (scope: Element) =>
    [...scope.getElementsByTagNameNS(WORD_NS, 't')].map((t) => t.textContent ?? '').join('');

  const text = paragraphs.length
    ? paragraphs
        .map(read)
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
    : read(element);

  return text.trim();
}

/**
 * The span each comment was anchored to.
 *
 * Word marks an anchor with `commentRangeStart` and `commentRangeEnd` around
 * the text, as siblings rather than as a wrapper — so the range cannot be read
 * off the tree shape. The document is walked in order instead, with a set of
 * open ids: every `w:t` encountered belongs to whichever comments are open at
 * that moment, and overlapping anchors fall out of it for free.
 */
function anchorsIn(document: Document): Map<string, string> {
  const quotes = new Map<string, string[]>();
  const open = new Set<string>();

  const walk = (node: Node): void => {
    if (node.nodeType === 1) {
      const element = node as Element;
      const local = element.localName;
      const id = element.getAttributeNS(WORD_NS, 'id');

      if (local === 'commentRangeStart' && id) {
        open.add(id);
        if (!quotes.has(id)) quotes.set(id, []);
      } else if (local === 'commentRangeEnd' && id) {
        open.delete(id);
      } else if (local === 't' && open.size) {
        const text = element.textContent ?? '';
        for (const openId of open) quotes.get(openId)?.push(text);
      }
    }

    for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
  };

  walk(document);

  const anchored = new Map<string, string>();
  for (const [id, parts] of quotes) {
    const quote = parts.join('').replace(/\s+/g, ' ').trim();
    if (quote) anchored.set(id, quote);
  }
  return anchored;
}

/**
 * Reads the comments out of a `.docx`.
 *
 * A document with no comments is not an error — it is a teacher who picked the
 * wrong file, or one who marked up on paper — and it says so rather than
 * failing.
 */
export async function readDocxComments(file: ArrayBuffer): Promise<DocxImport> {
  let parts: Map<string, string>;
  try {
    parts = await readZipParts(file, [COMMENTS_PART, DOCUMENT_PART]);
  } catch (error) {
    if (error instanceof ZipError) {
      throw new DocxError(
        'זה לא נראה כמו קובץ Word. צריך קובץ ‎.docx‎ — לא ‎.doc‎ ולא PDF.',
        error.message,
      );
    }
    throw error;
  }

  const commentsXml = parts.get(COMMENTS_PART);
  if (!commentsXml) return { comments: [], authors: [] };

  const anchors = parts.has(DOCUMENT_PART)
    ? anchorsIn(parseXml(parts.get(DOCUMENT_PART)!, DOCUMENT_PART))
    : new Map<string, string>();

  const comments: ImportedComment[] = [];
  const byAuthor = new Map<string, number>();

  for (const element of parseXml(commentsXml, COMMENTS_PART).getElementsByTagNameNS(
    WORD_NS,
    'comment',
  )) {
    const id = element.getAttributeNS(WORD_NS, 'id') ?? '';
    const body = textOf(element);
    // A comment with no text teaches nothing about how she writes.
    if (!body) continue;

    const author = (element.getAttributeNS(WORD_NS, 'author') ?? '').trim() || 'ללא שם';

    comments.push({ id, author, body, quote: anchors.get(id) ?? null });
    byAuthor.set(author, (byAuthor.get(author) ?? 0) + 1);
  }

  const authors = [...byAuthor.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { comments, authors };
}
