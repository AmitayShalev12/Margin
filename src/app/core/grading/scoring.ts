import {
  GradingCriterionScore,
  GradingFormCategory,
  ScoringMode,
  SubmissionRound,
} from '../models';

/**
 * When a round may carry scores, and when it must not.
 *
 * Her rule, and the half that matters is the refusal:
 *
 *   "יהיה פעם אחת שהם יגישו פסקה, אז את הפסקה צריך להעריך בלי ציון...
 *    לתת רק הערות על הפסקה."
 *
 * The first submission is a single paragraph. It gets comments and no number.
 * Scoring begins from the first part of the theoretical chapter — "זה בערך
 * שבעה עמודים, שישה עמודים" — and from there rises as the work improves.
 *
 * A score on a paragraph is not a small inaccuracy that a later round corrects.
 * It is a number a student reads as a verdict on work she has barely started,
 * and nothing catches up with it.
 */

/**
 * Where scoring starts, in words.
 *
 * She described the threshold in pages, and pages are not a thing the app can
 * see — a Google Doc has no page count until something paginates it. Six pages
 * of Hebrew academic prose runs to roughly 1,200–1,500 words, and the lower end
 * is the safer guess: erring long means her six-page submission arrives
 * unscored and she has to ask for it, which is a nuisance. Erring short means a
 * two-page draft is scored, which is the thing she asked to prevent.
 *
 * It is an estimate and it is treated as one. She can override any round, and
 * the screen says which of the two decided.
 */
export const SCORING_MIN_WORDS = 1200;

export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Whether this round is scored — her decision when she made one, the estimate
 * otherwise.
 */
export function scoringMode(round: SubmissionRound | undefined): ScoringMode {
  if (!round) return 'comments_only';
  if (round.scoring) return round.scoring;

  return wordCount(round.document_text) >= SCORING_MIN_WORDS ? 'scored' : 'comments_only';
}

/** True when she set it herself rather than letting the estimate decide. */
export function scoringWasChosen(round: SubmissionRound | undefined): boolean {
  return !!round?.scoring;
}

/**
 * Why this round is or is not scored, for the screen.
 *
 * Said rather than implied: a form with no numbers on it looks broken, and the
 * difference between "too early to score" and "she asked for comments only" is
 * a difference she should not have to remember.
 */
export function scoringReason(round: SubmissionRound | undefined): string {
  const mode = scoringMode(round);
  const words = wordCount(round?.document_text);

  if (scoringWasChosen(round)) {
    return mode === 'scored' ? 'בחרת לנקד את הסבב הזה.' : 'בחרת שבסבב הזה יהיו הערות בלבד.';
  }

  return mode === 'scored'
    ? `הוגשו ${words} מילים — מספיק כדי להתחיל לנקד.`
    : `הוגשו ${words} מילים בלבד, אז בשלב הזה יש הערות ואין ניקוד. אפשר לנקד בכל זאת.`;
}

/**
 * The points on the form right now, and what is still open.
 *
 * `scored` counts only criteria with a number on them. `awaiting` is every
 * other criterion the model is allowed to score, and `hers` are the ones only
 * she may — kept apart because "not scored yet" and "never going to be scored
 * by the app" read identically on screen and mean opposite things.
 */
export interface ScoreTotals {
  points: number;
  /** The maximum of the criteria that actually carry a score. */
  outOf: number;
  scored: number;
  awaiting: number;
  hers: number;
  /** Every criterion on the rubric, whether scored or not. */
  total: number;
  /** True once nothing is left open — hers included. */
  complete: boolean;
}

export function scoreTotals(
  categories: readonly GradingFormCategory[],
  scores: readonly GradingCriterionScore[],
): ScoreTotals {
  const byCategory = new Map(scores.map((s) => [s.category_id, s]));

  let points = 0;
  let outOf = 0;
  let scored = 0;
  let awaiting = 0;
  let hers = 0;

  for (const category of categories) {
    const score = byCategory.get(category.id);
    const has = score && score.points !== null;

    if (has) {
      points += score.points!;
      outOf += category.max_points ?? 0;
      scored += 1;
    } else if (category.manual_only) {
      hers += 1;
    } else {
      awaiting += 1;
    }
  }

  return {
    points,
    outOf,
    scored,
    awaiting,
    hers,
    total: categories.length,
    complete: awaiting === 0 && hers === 0,
  };
}

/**
 * How a score moved since the round before, in her words.
 *
 * She asked for this explicitly — "שיהיה כתוב... היא שיפרה את זה והזה, הוסיפה
 * זה וזה... ואת הנקודות המעודכנות". A number that changed with no account of
 * why is the part of an automated grade that is impossible to defend to a
 * student.
 */
export function scoreDelta(score: GradingCriterionScore): number | null {
  if (score.points === null || score.previous_points === null) return null;
  return score.points - score.previous_points;
}

export function deltaLabel(score: GradingCriterionScore): string | null {
  const delta = scoreDelta(score);
  if (delta === null || delta === 0) return null;

  return delta > 0 ? `עלה ב־${delta}` : `ירד ב־${Math.abs(delta)}`;
}

/**
 * The final grade, and only when every part of it is in.
 *
 * The paper is 65% of it, the presentation 10%, ongoing tasks 25% — and that
 * last number is one she types, because nothing in Margin ever sees it. She
 * was clear this arithmetic belongs at the end: "לא צריך את זה לפני כן".
 *
 * Returns null while anything is missing rather than a partial total. A final
 * grade computed from two of its three parts is not a draft of the grade; it
 * is a wrong grade with the authority of a number.
 */
export function finalGrade(input: {
  weights: readonly { name: string; percent: number }[];
  parts: Readonly<Record<string, number | null>>;
}): number | null {
  if (!input.weights.length) return null;

  let total = 0;
  for (const weight of input.weights) {
    const value = input.parts[weight.name];
    if (value === null || value === undefined) return null;
    total += (value * weight.percent) / 100;
  }

  return Math.round(total * 10) / 10;
}
