import { SubmissionStatus } from '../models';

/**
 * Statuses where the work is sitting with the teacher. The dashboard shows
 * exactly these, and nothing else.
 */
export const NEEDS_TEACHER: readonly SubmissionStatus[] = ['new', 'resubmitted', 'in_review'];

export function needsTeacher(status: SubmissionStatus): boolean {
  return NEEDS_TEACHER.includes(status);
}

/** Class carrying the status colour custom properties — see `_categories.scss`. */
export function statusClass(status: SubmissionStatus): string {
  return `st-${status}`;
}

/**
 * A plain sentence describing where a submission stands — the submissions
 * list shows one of these instead of a row of badges.
 *
 * `pendingCount` is the number of comments still waiting on a decision; it is
 * only woven in where it actually tells her something.
 */
export function statusLine(status: SubmissionStatus, pendingCount: number): string {
  switch (status) {
    case 'new':
      return 'הגיעה חדשה, טרם נפתחה';
    case 'in_review':
      return 'פתוחה אצלך באמצע בדיקה';
    case 'resubmitted':
      return pendingCount > 0
        ? `הוגשה מחדש — ${commentsWaiting(pendingCount)}`
        : 'הוגשה מחדש, הכול הוחלט';
    case 'notes_sent':
      return 'ההערות נשלחו — ממתין לתלמידה';
    case 'student_revised':
      return 'התלמידה עדכנה את העבודה';
    case 'finalized':
      return 'הסתיים';
  }
}

/**
 * The same information as a fuller sentence, for the dashboard — there each
 * item gets a whole card, so it can afford a line rather than a fragment.
 */
export function statusSummary(status: SubmissionStatus, pendingCount: number): string {
  switch (status) {
    case 'new':
      return 'הגיעה חדשה, טרם נפתחה.';
    case 'in_review':
      return 'התחלת לבדוק ועצרת באמצע.';
    case 'resubmitted':
      return pendingCount > 0
        ? `חזרה אליך אחרי תיקונים — ${commentsWaiting(pendingCount)}.`
        : 'חזרה אליך אחרי תיקונים.';
    case 'notes_sent':
      return 'ההערות נשלחו, ממתין לתלמידה.';
    case 'student_revised':
      return 'התלמידה עדכנה את העבודה.';
    case 'finalized':
      return 'הסתיים.';
  }
}

/** "12 הערות מחכות להחלטה שלך" — with the Hebrew dual and singular handled. */
export function commentsWaiting(count: number): string {
  if (count === 1) return 'הערה אחת מחכה להחלטה שלך';
  if (count === 2) return 'שתי הערות מחכות להחלטה שלך';
  return `${count} הערות מחכות להחלטה שלך`;
}

/** Relative day, the way she would say it rather than as a date. */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);

  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days === 2) return 'לפני יומיים';
  if (days < 21) return `לפני ${days} ימים`;
  const weeks = Math.round(days / 7);
  return weeks === 2 ? 'לפני שבועיים' : `לפני ${weeks} שבועות`;
}

/**
 * When a round came in, to the minute.
 *
 * Every round carries one, including the first — "סבב 1" is a submission too,
 * and a teacher looking at a paper wants to know when it arrived without
 * having to work out whether "לפני 3 ימים" means Tuesday or Wednesday.
 *
 * The clock matters as much as the day here: work handed in at 23:58 on the
 * night of a deadline and work handed in at 09:10 the next morning are the
 * same "אתמול", and they are not the same thing.
 *
 * The value behind it is Drive's `modifiedTime` for the file as this round
 * captured it — Margin has no submit button to stamp, and the last time she
 * touched the document is the closest honest answer.
 */
export function submittedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;

  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;

  const date = new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(when);

  const time = new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(when);

  return `${date}, ${time}`;
}
