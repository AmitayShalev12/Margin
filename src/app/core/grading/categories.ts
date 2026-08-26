import { derivedId } from '../ids';
import { Annotation, AnnotationKind, DocumentBlock, GradingFormCategory, UUID } from '../models';
import { sectionsOf } from '../presentation/document-render';

/**
 * The headings on the teacher's internal grading form.
 *
 * They are meant to be *hers*: the ones that recur on her own forms year after
 * year. Where a previous year exists, those are reused verbatim rather than
 * regenerated — a form she does not recognise is a form she has to re-learn.
 * The set below is only what a first course starts with, before there is any
 * history to learn from.
 */

export interface CategoryTemplate {
  key: string;
  name: string;
  description: string;
}

/**
 * A quantitative-methods seminar, in the order a paper is read. Chosen to
 * match the structure of the work rather than the app's own comment
 * categories, because that is how a grading form is actually laid out.
 */
export const STARTING_CATEGORIES: CategoryTemplate[] = [
  {
    key: 'question',
    name: 'שאלת המחקר וההשערות',
    description: 'מיקוד השאלה, ניסוח ההשערות, והקשר ביניהן.',
  },
  {
    key: 'literature',
    name: 'סקירת ספרות ומקורות',
    description: 'היקף הסקירה, דיוק ההפניות, ושימוש במקורות עדכניים.',
  },
  {
    key: 'method',
    name: 'שיטת המחקר',
    description: 'משתתפים, כלים, הליך — ומידת הפירוט שמאפשרת שחזור.',
  },
  {
    key: 'findings',
    name: 'ממצאים וניתוח סטטיסטי',
    description: 'דיווח מלא של הנתונים, ובחירת ניתוח מתאימה למערך.',
  },
  {
    key: 'discussion',
    name: 'דיון ומסקנות',
    description: 'חיבור הממצאים לשאלה, זהירות בטענות, והכרה במגבלות.',
  },
  {
    key: 'writing',
    name: 'לשון וכתיבה',
    description: 'בהירות הניסוח, מבנה הפסקאות, ועמידה בכללי הכתיבה המחקרית.',
  },
  {
    key: 'strengths',
    name: 'חוזקות',
    description: 'מה עבד, ושווה שהתלמידה תדע שעבד.',
  },
];

/**
 * Words that place a comment in a category, by the kind of comment it is.
 *
 * Matched against the category's *name*, so this works for a heading she wrote
 * herself in a previous year just as well as for the starting set — nothing
 * here depends on our own wording surviving.
 */
const KIND_WORDS: Record<AnnotationKind, string[]> = {
  language: ['לשון', 'ניסוח', 'כתיב', 'שפה', 'סגנון'],
  structure: ['מבנה', 'ארגון', 'סדר', 'רצף'],
  sources: ['מקור', 'ספרות', 'ציטוט', 'ביבליוג', 'הפני'],
  content: ['תוכן', 'ניתוח', 'ממצא', 'עומק', 'תוצא'],
  praise: ['חוזק', 'חיזוק', 'שבח'],
  formatting: ['טכני', 'עיצוב', 'פורמט'],
  other: [],
};

/** Hebrew glues a conjunction onto the next word; "ודיון" has to find "דיון". */
function stems(text: string): string[] {
  return text
    .split(/[\s,.;:()"'׳״־–—]+/)
    .map((word) => word.replace(/^ו/, ''))
    .filter((word) => word.length >= 3)
    .map((word) => word.slice(0, 4));
}

/**
 * Her categories for this course.
 *
 * History wins outright. Only a course with none gets the starting set, and
 * those are marked `learned` because the app derived them — she did not.
 */
/**
 * True when these headings are the default set rather than her own.
 *
 * Read from the rows themselves, so it stays right after a reload: the screen
 * has to be able to say "these are a starting point" instead of presenting
 * seven constants as though they came from her past years.
 */
export function isStartingSet(categories: readonly GradingFormCategory[]): boolean {
  return categories.length > 0 && categories.every((c) => c.origin === 'starting');
}

export function buildCategories(
  courseId: UUID,
  history: readonly GradingFormCategory[],
): GradingFormCategory[] {
  const existing = history.filter((c) => c.course_id === courseId && c.active);
  if (existing.length) return [...existing].sort((a, b) => a.sort_order - b.sort_order);

  const now = new Date().toISOString();
  return STARTING_CATEGORIES.map((template, index) => ({
    id: derivedId('grading-category', `${courseId}:${template.key}`),
    course_id: courseId,
    name: template.name,
    description: template.description,
    // Not 'learned'. Nothing was learned — there was no history to learn
    // from, and saying otherwise is the fixture-as-insight failure again.
    origin: 'starting' as const,
    // The starting set is a list of headings, not a rubric: no sections and
    // nothing to score out of. Said as null rather than as zero, so a screen
    // cannot render "0 נקודות" for a criterion that was never worth points.
    section: null,
    max_points: null,
    manual_only: false,
    sort_order: index,
    active: true,
    created_at: now,
    updated_at: now,
  }));
}

/**
 * Which category a comment belongs under.
 *
 * Two signals, in order of trust. Where the comment sits in the paper is the
 * stronger one — a note in the findings section is about the findings whatever
 * kind it was filed as — and the kind of comment is the fallback for the
 * categories that cut across the whole document, like language.
 *
 * Returns null when nothing matches, which the caller turns into the last
 * category rather than guessing.
 */
export function categoryFor(
  annotation: Annotation,
  blocks: readonly DocumentBlock[],
  categories: readonly GradingFormCategory[],
): GradingFormCategory | null {
  if (!categories.length) return null;

  const section = sectionsOf(blocks).find((s) =>
    s.block_indexes.some((i) => blocks[i]?.id === annotation.anchor.block_id),
  );
  const sectionStems = section ? stems(section.title) : [];
  const kindWords = KIND_WORDS[annotation.kind] ?? [];

  let best: { category: GradingFormCategory; score: number } | null = null;

  for (const category of categories) {
    const name = category.name;
    let score = 0;

    // Counted, not merely detected. "שיטת המחקר" and "שאלת המחקר" both share
    // a word with the heading "שיטת המחקר"; only counting every match tells
    // them apart, and a tie would otherwise be settled by sort order alone.
    score += sectionStems.filter((stem) => name.includes(stem)).length * 3;
    score += kindWords.filter((word) => name.includes(word)).length * 2;

    // Praise belongs with praise wherever it appears in the paper: a strength
    // is not a finding about the findings chapter.
    if (annotation.kind === 'praise' && KIND_WORDS.praise.some((w) => name.includes(w))) {
      score += 4;
    }

    if (score > 0 && (!best || score > best.score)) best = { category, score };
  }

  return best?.category ?? null;
}
