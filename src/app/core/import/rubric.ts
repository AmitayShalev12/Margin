import { readZipParts } from './zip';

/**
 * Her rubric, read out of the document she already marks against.
 *
 * Typing seventeen criteria and their point values by hand is seventeen
 * chances to get a number wrong, and a rubric that is nearly hers is worse
 * than none: every score it produces is off by an amount nobody notices. So it
 * is read from her own file.
 *
 * The shape it expects is the shape her form actually has — a numbered section
 * carrying a total, then numbered criteria each carrying their own points in
 * brackets:
 *
 *   2. פרק תאורטי 42 נקודות
 *   2.1 סקירה של מחקר מגוון רלוונטי, ועדכני ______________(8)____ נקודות
 *
 * Nothing is inferred. A line that does not match is skipped, and the totals
 * she wrote are checked against the sum of what was read rather than trusted —
 * a rubric that does not add up is reported, because the alternative is a form
 * quietly scored out of 97.
 */

const DOCUMENT_PART = 'word/document.xml';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface RubricCriterion {
  /** `2.1`, as she numbers them. Kept because she refers to them by number. */
  code: string;
  section: string;
  name: string;
  maxPoints: number;
}

export interface RubricSection {
  /** `2` */
  code: string;
  name: string;
  /** The total she wrote beside the heading. */
  statedPoints: number | null;
  /** The sum of the criteria actually read. */
  readPoints: number;
}

export interface RubricWeight {
  name: string;
  percent: number;
}

export interface ParsedRubric {
  title: string | null;
  criteria: RubricCriterion[];
  sections: RubricSection[];
  /**
   * How the final grade is composed, from the block at the foot of her form:
   * the paper 65%, the presentation 10%, ongoing tasks 25%. Read rather than
   * retyped for the same reason as the points.
   */
  weights: RubricWeight[];
  /** Total of every criterion read. Hers comes to 100. */
  totalPoints: number;
  /**
   * Where her stated totals and the criteria disagree, in her words. Empty is
   * the good case; anything here means the document was read imperfectly or
   * her own arithmetic drifted, and either way she should see it.
   */
  warnings: string[];
}

export class RubricError extends Error {
  constructor(
    readonly hebrew: string,
    message: string,
  ) {
    super(message);
    this.name = 'RubricError';
  }
}

/** Hebrew and Latin digits are the same characters here; only the shape varies. */
const SECTION_LINE = /^(\d+)\s*[.．]\s*(.+?)[\s_.]*?(\d+)\s*נקודות\s*$/;
const CRITERION_LINE = /^(\d+\.\d+)\s*[.．]?\s*(.+)$/;
/** The points a criterion is worth, written in brackets among the fill-in rules. */
const BRACKETED_POINTS = /\((\d+)\)/;

/**
 * Strips the furniture: fill-in rules, the bracketed points, the trailing word.
 *
 * Underscores go in runs of one or more — her form has `סטטיסטיים:_ ____`, and
 * a rule that only caught runs of two left a stray `_` welded to the name.
 */
function tidy(text: string): string {
  return text
    .replace(/_+/g, ' ')
    .replace(/[–—.]{2,}/g, ' ')
    .replace(/\(\d+\s*%?\)/g, ' ')
    .replace(/נקודות/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\-–—\s]+$/g, '')
    .trim();
}

/** A line from the final-grade block: `1. .פרזנטציה (10%)______`. */
const WEIGHT_LINE = /\((\d+)\s*%\)/;

/** Every paragraph of the document, in order, as plain text. */
function paragraphs(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new RubricError('הקובץ לא נקרא. יכול להיות שהוא פגום.', 'Malformed document.xml');
  }

  return [...doc.getElementsByTagNameNS(WORD_NS, 'p')]
    .map((p) =>
      [...p.getElementsByTagNameNS(WORD_NS, 't')]
        .map((t) => t.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

export function parseRubricParagraphs(lines: readonly string[]): ParsedRubric {
  const criteria: RubricCriterion[] = [];
  const sections: RubricSection[] = [];
  const weights: RubricWeight[] = [];
  const warnings: string[] = [];

  let title: string | null = null;
  let current: RubricSection | null = null;

  for (const line of lines) {
    if (!title && /קריטריונים|הערכת עבודה/.test(line)) {
      title = tidy(line);
      continue;
    }

    /**
     * The weighting block, which sits below the rubric and is numbered the
     * same way. Taken first because `3. ציון העבודה (65%)` would otherwise be
     * read as a third section — there is no `נקודות` on these lines, so the
     * section pattern misses them, but the criterion pattern would not.
     */
    const weight = WEIGHT_LINE.exec(line);
    if (weight) {
      const name = tidy(line.replace(/^[\d.\s]+/, ''));
      if (name) weights.push({ name, percent: Number(weight[1]) });
      continue;
    }

    /**
     * A criterion is tried before a section, because `2.1 …(8)… נקודות` also
     * satisfies the section pattern — the section number `2` followed by `.1`.
     * Reading it as a section would silently drop the criterion and invent a
     * heading worth 8 points.
     */
    const criterion = CRITERION_LINE.exec(line);
    if (criterion) {
      const points = BRACKETED_POINTS.exec(criterion[2]);
      const name = tidy(criterion[2]);
      if (points && name) {
        criteria.push({
          code: criterion[1],
          section: current?.name ?? '',
          name,
          maxPoints: Number(points[1]),
        });
      } else if (name) {
        warnings.push(`לא מצאתי ניקוד לסעיף ${criterion[1]} (${name}).`);
      }
      continue;
    }

    const section = SECTION_LINE.exec(line);
    if (section) {
      current = {
        code: section[1],
        name: tidy(section[2]),
        statedPoints: Number(section[3]),
        readPoints: 0,
      };
      sections.push(current);
    }
  }

  for (const section of sections) {
    section.readPoints = criteria
      .filter((c) => c.section === section.name)
      .reduce((sum, c) => sum + c.maxPoints, 0);

    if (section.statedPoints !== null && section.readPoints !== section.statedPoints) {
      warnings.push(
        `בפרק "${section.name}" כתוב ${section.statedPoints} נקודות, ` +
          `והסעיפים שקראתי מסתכמים ב־${section.readPoints}.`,
      );
    }
  }

  const totalPoints = criteria.reduce((sum, c) => sum + c.maxPoints, 0);
  if (criteria.length && totalPoints !== 100) {
    warnings.push(`סך הנקודות שקראתי הוא ${totalPoints} ולא 100.`);
  }

  const totalPercent = weights.reduce((sum, w) => sum + w.percent, 0);
  if (weights.length && totalPercent !== 100) {
    warnings.push(`המשקלות לציון הסופי מסתכמים ב־${totalPercent}% ולא ב־100%.`);
  }

  return { title, criteria, sections, weights, totalPoints, warnings };
}

export async function readRubric(file: ArrayBuffer): Promise<ParsedRubric> {
  const parts = await readZipParts(file, [DOCUMENT_PART]);
  const xml = parts.get(DOCUMENT_PART);

  if (!xml) {
    throw new RubricError(
      'זה לא נראה כמו קובץ Word. צריך קובץ ‎.docx‎ — לא ‎.doc‎ ולא PDF.',
      'No word/document.xml in archive',
    );
  }

  const rubric = parseRubricParagraphs(paragraphs(xml));

  if (!rubric.criteria.length) {
    throw new RubricError(
      'לא מצאתי בקובץ סעיפי הערכה עם ניקוד. הפורמט שאני מזהה הוא ״2.1 שם הסעיף (8) נקודות״.',
      'No criteria matched',
    );
  }

  return rubric;
}
