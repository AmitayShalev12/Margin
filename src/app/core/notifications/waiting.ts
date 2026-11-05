import { Annotation, Submission } from '../models';

export interface WaitingItem {
  id: string;
  text: string;
  link: string;
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

    if (done) continue;
    if (pending) {
      toDecide.push({
        id: `decide:${paper.id}`,
        text:
          pending === 1
            ? `${name}: הערה אחת ממתינה להחלטה שלך`
            : `${name}: ${pending} הערות ממתינות להחלטה שלך`,
        link: `/review/${paper.id}`,
      });
    } else if (approved) {
      toSend.push({
        id: `send:${paper.id}`,
        text: `${name}: ההערות מוכנות. אפשר לאשר ולשלוח לה`,
        link: `/approve/${paper.id}`,
      });
    } else if (!comments.length) {
      newWork.push({
        id: `new:${paper.id}`,
        text: `${name} העלתה עבודה שעוד לא נבדקה`,
        link: `/review/${paper.id}`,
      });
    }
  }

  return [...toSend, ...toDecide, ...newWork];
}
