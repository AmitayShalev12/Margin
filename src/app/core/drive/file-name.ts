import { Student } from '../models';

/**
 * The naming convention students are asked to follow:
 *
 *     שם התלמידה - שם העבודה
 *
 * The left side has to be a girl on the roster. The right side is whatever she
 * called her paper, and nothing here reads meaning into it.
 *
 * It exists because of what a shared document is not. A file in the year folder
 * was *put* there by someone, and the folder is the teacher's own assertion
 * that everything in it is work for this course. "Shared with me" asserts
 * nothing at all — it holds memos, colleagues' drafts and years of unrelated
 * paperwork — so something has to stand in for that assertion before a shared
 * file may become a student's submission. The convention is that something.
 *
 * Which is why the match is exact rather than fuzzy. The roster matching used
 * for folder files accepts a name appearing anywhere in the file name, and
 * that is far too loose here: it would let a colleague's document called
 * "הערכת מורה — נועה ברקוביץ׳" take over a student's submission and overwrite
 * the text her comments are anchored to.
 */

/** Dashes a teacher or a student might actually type. */
const SEPARATORS = ['-', '–', '—', '‒', '−'];

/** Extensions worth trimming off the work's name rather than showing. */
const EXTENSIONS = /\.(docx?|pdf|gdoc|odt|rtf|txt|pages)$/i;

/**
 * Compares names the way a person would.
 *
 * Case, the several apostrophes Hebrew is written with (`׳ ' ’ ״ "`), and
 * runs of whitespace all stop mattering — so `נועה ברקוביץ׳` and
 * `נועה ברקוביץ'` are the same girl. Dashes are deliberately **kept**: they
 * are the field separator, and a normalisation that ate them would leave the
 * parser nothing to split on.
 */
export function normaliseName(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’׳״"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedSubmissionName {
  student: Student;
  /** What she called the work. Free text, taken as given. */
  work: string;
}

/** Every index in `name` where a separator sits, with its length. */
function separators(name: string): { index: number; length: number }[] {
  const found: { index: number; length: number }[] = [];
  for (let i = 0; i < name.length; i++) {
    if (SEPARATORS.includes(name[i])) found.push({ index: i, length: 1 });
  }
  return found;
}

/**
 * The girl a name on the left-hand side belongs to, or null.
 *
 * Exact after normalisation, and refuses an ambiguity outright: two students
 * whose names differ only by an apostrophe are indistinguishable here, and
 * picking one of them would attribute a paper by coin toss.
 */
function studentNamed(text: string, students: readonly Student[]): Student | null {
  const wanted = normaliseName(text);
  if (!wanted) return null;

  const matches = students.filter((s) => normaliseName(s.full_name) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Reads `שם התלמידה - שם העבודה`, or returns null.
 *
 * Every separator is tried in turn rather than only the first, because a
 * given name can contain one: `בת-אל כהן - עבודת גמר` splits correctly at the
 * second dash, and splitting blindly at the first would look for a student
 * called `בת`.
 */
export function parseSubmissionName(
  fileName: string | undefined,
  students: readonly Student[],
): ParsedSubmissionName | null {
  const name = (fileName ?? '').trim();
  if (!name) return null;

  for (const separator of separators(name)) {
    const student = studentNamed(name.slice(0, separator.index), students);
    if (!student) continue;

    const work = name.slice(separator.index + separator.length).trim();
    // A name that is nothing but a student and a dash names no work.
    if (!work) continue;

    return { student, work: work.replace(EXTENSIONS, '').trim() || work };
  }

  return null;
}

/**
 * What to ask Drive for so the convention's files come back.
 *
 * Drive's `contains` is **prefix** matching on `name` — `name contains 'Hello'`
 * finds `HelloWorld` and not `otherHello` — which is exactly the shape of the
 * convention, since the student's name is at the front. So the query does the
 * first half of the rule and `parseSubmissionName` does the rest.
 *
 * The term is her **given name**, not her full name, and that is a deliberate
 * loosening: the prefix match is literal, so a surname written with a
 * different apostrophe than the roster uses — `ברקוביץ'` against `ברקוביץ׳` —
 * would silently return nothing at all, which looks exactly like "nobody
 * shared anything". Asking for less brings back a few files that are not
 * papers, and the strict parse then refuses every one of them.
 */
export function searchPrefixes(students: readonly Student[]): string[] {
  const prefixes = students
    .filter((s) => s.active)
    .map((s) => s.full_name.trim().split(/\s+/)[0])
    .filter((word) => word && word.length > 1);

  return [...new Set(prefixes)];
}
