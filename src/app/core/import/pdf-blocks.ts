import { DocumentBlock } from '../models';

/**
 * Reading a PDF into blocks.
 *
 * A PDF has no paragraphs, only pieces of text placed on a page. Word puts
 * them in reading order, Hebrew included, so the work here is putting the
 * pieces back into lines and the lines back into paragraphs: a new line when
 * the text moves down, a new paragraph when it moves down by more than a line.
 *
 * A scanned PDF is pictures of pages and has no text at all. It reads as no
 * blocks, and the caller says so rather than storing an empty paper.
 */

/** One piece of text as pdf.js gives it: what it says and where it sits. */
export interface PdfItem {
  str: string;
  /** Left edge and baseline, in points from the bottom-left of the page. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pieces closer than this share a word: "ה׳ ו" + "-" + "ו׳" is one. Pieces further apart get a space. */
const SPACE_GAP = 0.15;
/** A drop this much larger than the usual line spacing starts a paragraph. */
const PARAGRAPH_GAP = 1.4;
/**
 * A line this much shorter than the page's text width ends its paragraph.
 * That is how a paragraph's last line looks, and how a heading looks: Word
 * often puts no extra space under a heading, so the drop alone misses it.
 */
const SHORT_LINE = 0.8;

interface Line {
  text: string;
  y: number;
  height: number;
  /** Where the line's text starts and ends across the page. */
  left: number;
  right: number;
}

function linesOf(items: readonly PdfItem[]): Line[] {
  const lines: Line[] = [];
  let current: { pieces: PdfItem[]; y: number; height: number } | null = null;

  const close = () => {
    if (!current) return;
    let text = '';
    let previous: PdfItem | null = null;
    for (const piece of current.pieces) {
      if (previous && text && !text.endsWith(' ') && !piece.str.startsWith(' ')) {
        // Nearest edges, whichever way the line runs.
        const gap = Math.min(
          Math.abs(previous.x - (piece.x + piece.width)),
          Math.abs(piece.x - (previous.x + previous.width)),
        );
        if (gap > SPACE_GAP * Math.max(previous.height, piece.height, 1)) text += ' ';
      }
      text += piece.str;
      previous = piece;
    }
    text = text.replace(/\s+/g, ' ').trim();
    const left = Math.min(...current.pieces.map((p) => p.x));
    const right = Math.max(...current.pieces.map((p) => p.x + p.width));
    if (text) lines.push({ text, y: current.y, height: current.height, left, right });
    current = null;
  };

  for (const item of items) {
    if (!item.str || !item.str.trim()) {
      // An empty piece is pdf.js marking a line's end; its own position says nothing.
      continue;
    }
    const height = item.height || 1;
    if (current && Math.abs(current.y - item.y) <= height * 0.5) {
      current.pieces.push(item);
      current.height = Math.max(current.height, height);
    } else {
      close();
      current = { pieces: [item], y: item.y, height };
    }
  }
  close();
  return lines;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Lines into paragraphs, page by page; a paragraph never runs across a page break. */
export function blocksFromPdfPages(pages: readonly (readonly PdfItem[])[]): DocumentBlock[] {
  const paragraphs: string[] = [];

  for (const items of pages) {
    const lines = linesOf(items);
    const drops = lines.slice(1).map((line, i) => lines[i].y - line.y).filter((d) => d > 0);
    const usual = median(drops) || (lines[0]?.height ?? 12) * 1.2;
    const width = lines.length
      ? Math.max(...lines.map((l) => l.right)) - Math.min(...lines.map((l) => l.left))
      : 0;

    let paragraph = '';
    lines.forEach((line, i) => {
      const drop = i ? lines[i - 1].y - line.y : 0;
      // Up the page means a new column or a footnote area: also a new paragraph.
      const before = lines[i - 1];
      const breaks =
        i > 0 &&
        (drop > usual * PARAGRAPH_GAP ||
          drop < 0 ||
          before.right - before.left < width * SHORT_LINE);
      if (breaks && paragraph) {
        paragraphs.push(paragraph);
        paragraph = '';
      }
      // A word broken across lines with a hyphen joins back up; anything else gets a space.
      paragraph = paragraph
        ? /[A-Za-z]-$/.test(paragraph)
          ? paragraph.slice(0, -1) + line.text
          : `${paragraph} ${line.text}`
        : line.text;
    });
    if (paragraph) paragraphs.push(paragraph);
  }

  return paragraphs
    // A page number alone on its line is furniture, not the paper.
    .filter((text) => !/^\d{1,3}$/.test(text))
    .map((text, index) => ({ id: `b${index}`, index, type: 'paragraph' as const, text }));
}

/** Where the browser finds pdf.js's worker; copied there from the package at build time. */
const WORKER_URL = '/pdf.worker.min.mjs';

/** One piece of text in pdf.js's own shape; only the fields read here. */
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** Reads a PDF's text into blocks. Loads pdf.js only when a PDF actually arrives. */
export async function readPdfBlocks(data: ArrayBuffer): Promise<DocumentBlock[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const pdf = await task.promise;
  try {
    const pages: PdfItem[][] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      // Marked-content entries carry no text; only pieces with a string are kept.
      const items = content.items as unknown as Partial<PdfTextItem>[];
      pages.push(
        items
          .filter((item): item is PdfTextItem => typeof item.str === 'string' && !!item.transform)
          .map((item) => ({
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height,
          })),
      );
    }
    return blocksFromPdfPages(pages);
  } finally {
    await task.destroy();
  }
}

export function isPdf(name: string | null | undefined, mime?: string | null): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(name ?? '');
}
