import { Annotation, Assignment, Submission, SubmissionRound } from '../models';

/**
 * Things for her to look at. A flag says what was seen and changes nothing:
 * nothing is failed, scored or sent because of one.
 *
 * Each check is one function in the list at the bottom, so adding a check means
 * adding a function. These two need no AI: they compare records and text that
 * are already here. Checks that have to read for meaning, such as a proposal
 * that drifts from its approved topic, wait for a paid model key.
 */
export interface Flag {
  id: string;
  text: string;
  /** The sentence it refers to, when there is one. */
  quote?: string;
}

export interface CheckContext {
  paper: Submission;
  round: SubmissionRound;
  /** Her earlier rounds of this paper, and her papers for earlier tasks. */
  earlierRounds: readonly SubmissionRound[];
  annotations: readonly Annotation[];
  tasks: readonly Assignment[];
  /** The tasks she has a paper for. */
  handedIn: ReadonlySet<string>;
}

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * A comment on an earlier version whose sentence is still there, word for word.
 *
 * Text only, so it is a prompt to look and not a verdict. She may have answered
 * the comment elsewhere, or the comment may not have asked for a change.
 */
function sameSentenceStillThere({ round, earlierRounds, annotations }: CheckContext): Flag[] {
  const previous = [...earlierRounds].sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
  if (!previous) return [];

  const text = squeeze(round.document_text ?? '');
  return annotations
    .filter(
      (a) =>
        a.round_id === previous.id &&
        (a.status === 'accepted' || a.status === 'edited') &&
        a.anchor.quote.trim().length > 0 &&
        text.includes(squeeze(a.anchor.quote)),
    )
    .map((a) => ({
      id: `same-sentence:${a.id}`,
      text: `המשפט שעליו הערת בגרסה הקודמת מופיע גם כאן באותו ניסוח. ההערה שלך: "${a.body}"`,
      quote: a.anchor.quote,
    }));
}

/** A later stage handed in while an earlier one never was. */
function skippedStage({ paper, tasks, handedIn }: CheckContext): Flag[] {
  const position = tasks.findIndex((t) => t.id === paper.assignment_id);
  return tasks
    .slice(0, Math.max(position, 0))
    .filter((t) => !handedIn.has(t.id))
    .map((t) => ({ id: `skipped:${t.id}`, text: `לא הוגשה המשימה הקודמת "${t.title}".` }));
}

const CHECKS: ((context: CheckContext) => Flag[])[] = [sameSentenceStillThere, skippedStage];

export function runChecks(context: CheckContext): Flag[] {
  return CHECKS.flatMap((check) => check(context));
}
