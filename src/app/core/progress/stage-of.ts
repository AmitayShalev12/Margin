/**
 * Which stage each student has reached: the furthest task, in the order the
 * tasks are given, that she has handed a paper in for.
 *
 * Worked out from what is recorded, never stored, so it cannot disagree with
 * the table beside it.
 */
export interface StageColumn<S> {
  /** The task's id; null for the students who have not handed anything in. */
  taskId: string | null;
  title: string;
  /** Its place in the process, from 1. Zero for "not started". */
  number: number;
  students: S[];
}

export function studentsByStage<S extends { id: string }>(
  tasks: readonly { id: string; title: string }[],
  students: readonly S[],
  papers: readonly { assignment_id: string; student_id: string }[],
): StageColumn<S>[] {
  const place = new Map(tasks.map((task, index) => [task.id, index]));
  const furthest = new Map<string, number>();
  for (const paper of papers) {
    const index = place.get(paper.assignment_id);
    if (index === undefined) continue;
    furthest.set(paper.student_id, Math.max(furthest.get(paper.student_id) ?? -1, index));
  }

  const columns: StageColumn<S>[] = tasks.map((task, index) => ({
    taskId: task.id,
    title: task.title,
    number: index + 1,
    students: students.filter((s) => furthest.get(s.id) === index),
  }));
  const waiting = students.filter((s) => !furthest.has(s.id));
  return waiting.length
    ? [{ taskId: null, title: 'עוד לא הגישו', number: 0, students: waiting }, ...columns]
    : columns;
}
