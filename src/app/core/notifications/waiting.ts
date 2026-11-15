import { Annotation, Submission } from '../models';

export type WaitingKind = 'send' | 'decide' | 'new';

export interface WaitingItem {
  id: string;
  text: string;
  link: string;
  kind: WaitingKind;
  paperId: string;
  taskId: string;
  student: string;
  /** The same line without what its group already says. */
  short: string;
}

/**
 * "מה מחכה לי?": the same questions asked of each paper, most urgent first.
 *
 * Worked out from what is already recorded, so it can never disagree with the
 * screens behind it. It knows what the app knows when it is open: noticing new
 * work with the app closed needs server work that does not exist yet.
 */
export function waitingFor(
  papers: readonly Submission[],
  annotations: readonly Annotation[],
  nameOf: (studentId: string) => string,
): WaitingItem[] {
  const newWork: WaitingItem[] = [];
  const toDecide: WaitingItem[] = [];
  const toSend: WaitingItem[] = [];

  for (const paper of papers) {
    const name = nameOf(paper.student_id);
    const comments = annotations.filter((a) => a.submission_id === paper.id);
    const pending = comments.filter((a) => a.status === 'pending').length;
    const approved = comments.some((a) => a.status === 'accepted' || a.status === 'edited');
    const done = paper.status === 'notes_sent' || paper.status === 'finalized';
    const about = { paperId: paper.id, taskId: paper.assignment_id, student: name };

    if (done) continue;
    if (pending) {
      toDecide.push({
        ...about,
        id: `decide:${paper.id}`,
        kind: 'decide',
        text:
          pending === 1
            ? `${name}: הערה אחת ממתינה להחלטה שלך`
            : `${name}: ${pending} הערות ממתינות להחלטה שלך`,
        short: pending === 1 ? 'הערה אחת להחלטה' : `${pending} הערות להחלטה`,
        link: `/review/${paper.id}`,
      });
    } else if (approved) {
      toSend.push({
        ...about,
        id: `send:${paper.id}`,
        kind: 'send',
        text: `${name}: ההערות מוכנות. אפשר לאשר ולשלוח לה`,
        short: 'מוכנה לשליחה',
        link: `/approve/${paper.id}`,
      });
    } else if (!comments.length) {
      newWork.push({
        ...about,
        id: `new:${paper.id}`,
        kind: 'new',
        text: `${name} העלתה עבודה שעוד לא נבדקה`,
        short: 'עוד לא נבדקה',
        link: `/review/${paper.id}`,
      });
    }
  }

  return [...toSend, ...toDecide, ...newWork];
}

export interface WaitingGroup {
  /** The task's id. */
  id: string;
  title: string;
  /** Which course it belongs to; shown only when there is more than one. */
  course: string;
  items: WaitingItem[];
  /** Handed in and not looked at yet: what "check them all" would run on. */
  unchecked: WaitingItem[];
}

/**
 * The same items, gathered under the task each paper was handed in for, in the
 * order the tasks are given. One line per task instead of one per student.
 */
export function groupWaiting(
  items: readonly WaitingItem[],
  tasks: readonly { id: string; title: string; course: string }[],
): WaitingGroup[] {
  return tasks
    .map((task) => {
      const own = items.filter((item) => item.taskId === task.id);
      return { ...task, items: own, unchecked: own.filter((item) => item.kind === 'new') };
    })
    .filter((group) => group.items.length);
}
