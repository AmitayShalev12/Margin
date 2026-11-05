/**
 * Where a student stands against her course's deadlines.
 *
 * PROPOSED DEFINITIONS, awaiting the client's approval:
 *   אדום   missed two or more deadlines, or a deadline passed and nothing handed in
 *   כתום   missed exactly one deadline, and has handed in something
 *   צהוב   has not started, and no deadline has passed yet
 *   ירוק   handed in something and missed nothing
 * "Missed" means the date has passed and that task has no paper of hers. A late
 * paper stops counting as missed the moment it arrives.
 */
export type Light = 'red' | 'orange' | 'yellow' | 'green';

export const LIGHT_ORDER: readonly Light[] = ['red', 'orange', 'yellow', 'green'];

export const LIGHT_LABEL: Record<Light, string> = {
  red: 'באיחור',
  orange: 'מועד אחד הוחמץ',
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
}

export function progressOf(
  tasks: readonly ProgressTask[],
  handedInTaskIds: ReadonlySet<string>,
  today: string,
): Progress {
  const handedIn = tasks.filter((t) => handedInTaskIds.has(t.id)).length;
  const missed = tasks.filter((t) => t.due && t.due < today && !handedInTaskIds.has(t.id)).length;

  let light: Light = 'green';
  if (missed >= 2 || (missed === 1 && handedIn === 0)) light = 'red';
  else if (missed === 1) light = 'orange';
  else if (handedIn === 0) light = 'yellow';

  return { light, handedIn, missed };
}
