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

/**
 * Which task a file is for, from its name.
 *
 * The client's decision: papers stay shared rather than moved into her Drive, so
 * a folder per task is not possible, and the name is what says it. The longest
 * title found wins, so "פרק ראשון" beats "פרק". A tie, or no title at all, comes
 * back null for her to see: a paper filed under the wrong task is worse than one
 * she is asked about.
 */
export function taskForFile<T extends { title: string }>(
  fileName: string | undefined,
  tasks: readonly T[],
): T | null {
  const name = normaliseName(fileName ?? '');
  const found = tasks
    .filter((t) => normaliseName(t.title) && name.includes(normaliseName(t.title)))
    .sort((a, b) => normaliseName(b.title).length - normaliseName(a.title).length);

  if (!found.length) return null;
  const longest = normaliseName(found[0].title).length;
  const tied = found.filter((t) => normaliseName(t.title).length === longest);
  return tied.length === 1 ? tied[0] : null;
}

/** A task title, loosened: no "the" on its words, so "הצעת מחקר" finds "הצעת המחקר". */
function loose(text: string): string {
  return normaliseName(text)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.startsWith('ה') ? word.slice(1) : word))
    .join(' ');
}

/** The ways a student might write a task's title at the top of her paper. */
function titleForms(title: string): string[] {
  // "פרק ג׳ עם פירוש" is also just "פרק ג׳" to her, the same as "פרק ג׳: תוצאות".
  const chapter = /^פרק \S+/.exec(loose(title))?.[0] ?? '';
  const forms = [title, chapter, ...title.split(':')]
    .map((part) => loose(part).replace(/^כל /, ''))
    .filter((form) => form.length > 3);
  return [...new Set(forms)];
}

/** A line this short is a title or a heading, not a sentence of the paper. */
const TITLE_LINE_WORDS = 12;
/** The top of the paper, where she says what it is. */
const OPENING_LINES = 12;

/**
 * Which task a paper is for, from what it says at its top.
 *
 * Used only when the file's name names no task. The opening lines are read in
 * order and the first one that names exactly one task decides. A line that
 * fits two tasks decides nothing, and a paper whose opening names none comes
 * back null: a guess is offered to her, never invented.
 */
export function taskForContent<T extends { title: string }>(
  lines: readonly string[],
  tasks: readonly T[],
): T | null {
  for (const line of lines.slice(0, OPENING_LINES)) {
    const text = loose(line);
    if (!text || text.split(' ').length > TITLE_LINE_WORDS) continue;

    let best: { task: T; length: number }[] = [];
    for (const task of tasks) {
      const length = Math.max(
        0,
        ...titleForms(task.title)
          .filter((form) => ` ${text} `.includes(` ${form} `))
          .map((form) => form.length),
      );
      if (!length) continue;
      if (!best.length || length > best[0].length) best = [{ task, length }];
      else if (length === best[0].length) best.push({ task, length });
    }
    if (best.length === 1) return best[0].task;
  }
  return null;
}
