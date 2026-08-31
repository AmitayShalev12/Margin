import { DocumentBlock } from '../models';

/**
 * Which sources the paper cites, and whether they are anywhere to be found.
 *
 * Built instead of an AI-text detector, and the difference is the whole point.
 * A detector answers "was this written by a machine" with a number nobody can
 * check, and it is wrong most often on exactly this kind of writing — careful,
 * formal, in a register that is not the student's everyday one. What it
 * produces is an accusation with no evidence attached.
 *
 * This answers a smaller question completely: **the paper cites Cohen 2021 and
 * Cohen 2021 is not in the bibliography.** That is a fact the teacher can look
 * at, and it happens to catch the thing she is actually worried about —
 * invented references are the most reliable trace an AI-written paper leaves,
 * because a model that does not know a source will produce a plausible one.
 *
 * It reads text and nothing else. No model, no network, and therefore nothing
 * of a student's work leaving the browser.
 */

/** One citation as it appears in the body: an author and a year. */
export interface Citation {
  /** As written, for showing back to her. */
  text: string;
  /** Normalised for comparison — surname and year. */
  key: string;
  author: string;
  year: string;
}

export interface CitationReport {
  /** Cited in the body, absent from the bibliography. The finding that matters. */
  missing: Citation[];
  /** In the bibliography, never cited. Usually padding, sometimes an oversight. */
  uncited: string[];
  /** Every distinct citation found in the body. */
  cited: Citation[];
  /** How many entries the bibliography holds. */
  entries: number;
  /**
   * True when there is no bibliography to compare against, which is not a
   * finding about the paper — it is the check having nothing to run on, and it
   * must not read as "nothing is missing".
   */
  noBibliography: boolean;
}

/**
 * Headings that begin the reference list.
 *
 * Everything from here to the end of the paper is the bibliography. Matched on
 * the heading rather than on what the lines look like, because a reference and
 * a sentence containing a citation are not reliably distinguishable by shape.
 */
const BIBLIOGRAPHY_HEADINGS =
  /^\s*(ביבליוגרפיה|רשימת\s+מקורות|מקורות|רשימה\s+ביבליוגרפית|references|bibliography|works\s+cited)\s*$/i;

/**
 * A citation in the body — APA's two shapes, in Hebrew and in English.
 *
 *   (כהן, 2021)      (Cohen, 2021)      (כהן ולוי, 2021)
 *   כהן (2021)       Cohen (2021)
 *
 * Deliberately narrow. A pattern loose enough to catch every citation style
 * also catches "(ראו פרק 3)" and every year mentioned in passing, and a report
 * full of things that were never citations is one she stops reading.
 */
const PARENTHETICAL = /\(([^()]{2,60}?),\s*(\d{4})[a-z]?\)/g;
const NARRATIVE =
  /([֐-׿A-Za-z][֐-׿\w'’\-]{1,30}(?:\s+(?:ו|and|&)\s*[֐-׿\w'’\-]{2,30})?)\s*\((\d{4})[a-z]?\)/g;

/**
 * Words that sit before a bracketed year without being anybody's name.
 *
 * "הנתונים נאספו בשנת (2021)" is not a citation of a scholar called בשנת, and
 * a report that says it is gets ignored by the second paper — at which point
 * it is worse than nothing, because it has taught her to skip it.
 *
 * A list rather than a rule, and an incomplete one by nature: it covers what
 * actually appears in front of a year in these papers, and will need adding to
 * the first time something new does. That is the honest shape of the problem —
 * "is this token a surname" has no general answer.
 */
const NOT_AN_AUTHOR = new Set([
  'בשנת',
  'משנת',
  'לשנת',
  'בשנים',
  'שנת',
  'בין',
  'לפי',
  'ראו',
  'ראה',
  'פרק',
  'טבלה',
  'תרשים',
  'נספח',
  'עמוד',
  'in',
  'since',
  'year',
  'see',
  'table',
  'figure',
  'chapter',
  'appendix',
  'page',
]);

/** Strips the geresh variants and case so `ברקוביץ׳` and `ברקוביץ'` agree. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’׳״"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The surname a citation is filed under.
 *
 * Everything before the first comma or connective, which is where APA puts the
 * name that the bibliography entry also starts with. "כהן ולוי" files under
 * "כהן", and that is the one the reference list will begin with too.
 */
function surname(author: string): string {
  const first = author
    .split(/,| ו| and | & |ואחרים|et al/i)[0]
    .replace(/^[\s(]+|[\s)]+$/g, '')
    .trim();
  return normalise(first);
}

export function citationsIn(text: string): Citation[] {
  const found = new Map<string, Citation>();

  const add = (raw: string, author: string, year: string) => {
    const name = surname(author);
    // A "citation" whose author is a number, a single letter, or a word that
    // is not a name at all is a page reference or an aside, not a source.
    if (!name || name.length < 2 || /^\d+$/.test(name)) return;
    if (NOT_AN_AUTHOR.has(name)) return;

    const key = `${name}|${year}`;
    if (!found.has(key)) found.set(key, { text: raw.trim(), key, author: name, year });
  };

  for (const match of text.matchAll(PARENTHETICAL)) add(match[0], match[1], match[2]);
  for (const match of text.matchAll(NARRATIVE)) add(match[0], match[1], match[2]);

  return [...found.values()];
}

/**
 * Splits the paper at its reference-list heading.
 *
 * Returns the bibliography lines and the body separately, because a citation
 * inside the bibliography is the entry itself and counting it as a citation
 * would make every reference look cited.
 */
export function splitBibliography(blocks: readonly DocumentBlock[]): {
  body: string;
  entries: string[];
} {
  const at = blocks.findIndex(
    (b) => b.type === 'heading' && BIBLIOGRAPHY_HEADINGS.test(b.text.trim()),
  );

  if (at === -1) {
    return { body: blocks.map((b) => b.text).join('\n'), entries: [] };
  }

  return {
    body: blocks
      .slice(0, at)
      .map((b) => b.text)
      .join('\n'),
    entries: blocks
      .slice(at + 1)
      .map((b) => b.text.trim())
      .filter(Boolean),
  };
}

export function checkCitations(blocks: readonly DocumentBlock[]): CitationReport {
  const { body, entries } = splitBibliography(blocks);
  const cited = citationsIn(body);

  if (!entries.length) {
    return { missing: [], uncited: [], cited, entries: 0, noBibliography: true };
  }

  const flat = entries.map((entry) => normalise(entry));

  /**
   * An entry answers a citation when it carries both the surname and the year.
   * Matching on the name alone would let a 2019 paper stand in for a 2021 one
   * by the same author, which is exactly the substitution a model makes.
   */
  const missing = cited.filter(
    (citation) =>
      !flat.some((entry) => entry.includes(citation.author) && entry.includes(citation.year)),
  );

  const uncited = entries.filter(
    (entry) =>
      !cited.some((citation) => {
        const flatEntry = normalise(entry);
        return flatEntry.includes(citation.author) && flatEntry.includes(citation.year);
      }),
  );

  return { missing, uncited, cited, entries: entries.length, noBibliography: false };
}
