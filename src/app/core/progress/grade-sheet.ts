/** One task on a student's card: what she handed in for it, and what it scored. */
export interface CardRow {
  taskId: string;
  number: number;
  title: string;
  paperId: string | null;
  /** The day it came in, as text ready to show; null when missing. */
  handedIn: string | null;
  score: { points: number; outOf: number } | null;
}

export interface CardSummary {
  handedIn: number;
  missing: number;
  /** The mean of the scored stages, as a percentage; null when nothing is scored. */
  average: number | null;
}

export function summarise(rows: readonly CardRow[]): CardSummary {
  const scored = rows.filter((r) => r.score && r.score.outOf > 0);
  return {
    handedIn: rows.filter((r) => r.paperId).length,
    missing: rows.filter((r) => !r.paperId).length,
    average: scored.length
      ? Math.round(
          scored.reduce((sum, r) => sum + (r.score!.points / r.score!.outOf) * 100, 0) / scored.length,
        )
      : null,
  };
}

/** A stage's score the way she reads one off a marked form. */
export function scoreText(score: CardRow['score']): string {
  return score ? `${score.points} מתוך ${score.outOf}` : 'עוד לא נוקד';
}

/**
 * The grade sheet as plain text, to paste into a message or an email.
 *
 * Only what the student may see about herself: her name, the course, each
 * stage with whether it was handed in and its score. Nothing about anyone else.
 */
export function gradeSheetText(input: {
  student: string;
  course: string;
  rows: readonly CardRow[];
}): string {
  const summary = summarise(input.rows);
  const lines = input.rows.map((row) => {
    const state = row.paperId ? `הוגש${row.handedIn ? ` (${row.handedIn})` : ''}` : 'עוד לא הוגש';
    const score = row.paperId ? ` · ${scoreText(row.score)}` : '';
    return `${row.number}. ${row.title}: ${state}${score}`;
  });
  return [
    `גיליון ציונים: ${input.student}`,
    input.course,
    '',
    ...lines,
    '',
    `הוגשו ${summary.handedIn} מתוך ${input.rows.length} שלבים.`,
    ...(summary.average === null ? [] : [`ממוצע השלבים שנוקדו: ${summary.average}.`]),
  ].join('\n');
}
