/**
 * Where a student stands against her course's deadlines.
 *
 * PROPOSED DEFINITIONS, awaiting the client's approval:
 *   אדום   behind on two or more deadlines, or a deadline passed and nothing handed in
 *   כתום   behind on exactly one deadline, and has handed in something
 *   צהוב   has not started, and no deadline has passed yet
 *   ירוק   handed in something and missed nothing
 * "Behind" is a task with no paper after its date, or a paper that came in after
 * it. The client's decision: a late paper stays marked late, and says that it
 * was handed in and checked.
 */
export type Light = 'red' | 'orange' | 'yellow' | 'green';

export const LIGHT_ORDER: readonly Light[] = ['red', 'orange', 'yellow', 'green'];

export const LIGHT_LABEL: Record<Light, string> = {
  red: 'באיחור',
  orange: 'איחור במועד אחד',
  yellow: 'עוד לא התחילה',
  green: 'בזמן',
};

export interface ProgressTask {
  id: string;
  /** The day it is due, or null for a task with no date. */
  due: string | null;
}

export interface Progress {
  light: Light;
  /** Tasks she has a paper for. */
  handedIn: number;
  /** Tasks whose date passed with no paper of hers. */
  missed: number;
  /** Tasks whose paper came in after the date. */
  late: number;
}

/** What a paper needs to say about its date. */
export interface PaperDates {
  assignment_id: string;
  created_at: string;
  drive_created_at: string | null;
  status: string;
}

export interface LatePaper {
  taskId: string;
  checked: boolean;
}

/**
 * Papers that came in after their task's date.
 *
 * By when the file was created in Drive, or else when it was uploaded here. Not
 * by when it was last edited, because revising a paper after comments is what
 * she is meant to do, and it would make every revised paper look late.
 */
export function latePapers(
  tasks: readonly ProgressTask[],
  papers: readonly PaperDates[],
): LatePaper[] {
  return papers.flatMap((paper) => {
    const due = tasks.find((t) => t.id === paper.assignment_id)?.due;
    const day = (paper.drive_created_at ?? paper.created_at).slice(0, 10);
    return due && day > due
      ? [
          {
            taskId: paper.assignment_id,
            checked: paper.status === 'notes_sent' || paper.status === 'finalized',
          },
        ]
      : [];
  });
}

/** "הוגשה באיחור ונבדקה", said of one task. */
export function lateNote(title: string, checked: boolean): string {
  return `${title}: הוגשה באיחור${checked ? ' ונבדקה' : ', עוד לא נבדקה'}`;
}

export function progressOf(
  tasks: readonly ProgressTask[],
  handedInTaskIds: ReadonlySet<string>,
  today: string,
  lateTaskIds: ReadonlySet<string> = new Set(),
): Progress {
  const handedIn = tasks.filter((t) => handedInTaskIds.has(t.id)).length;
  const missed = tasks.filter((t) => t.due && t.due < today && !handedInTaskIds.has(t.id)).length;

  const late = tasks.filter((t) => lateTaskIds.has(t.id)).length;
  const behind = missed + late;

  let light: Light = 'green';
  if (behind >= 2 || (missed >= 1 && handedIn === 0)) light = 'red';
  else if (behind === 1) light = 'orange';
  else if (handedIn === 0) light = 'yellow';

  return { light, handedIn, missed, late };
}
