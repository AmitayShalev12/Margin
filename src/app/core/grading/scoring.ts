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

/**
 * How a criterion is named to the model, and matched back afterwards.
 *
 * Her own number where the rubric has one — she says "2.1" out loud, and it is
 * what she will look for in a note. A uuid round-tripped through a language
 * model is a uuid that comes back subtly wrong, and a score attached to the
 * wrong criterion is worse than no score: it is a defensible-looking number in
 * the wrong row.
 *
 * Falls back to the id for a form with no numbering, where there is nothing
 * more readable to use.
 */
export function criterionKey(category: GradingFormCategory): string {
  const numbered = /^(\d+(?:\.\d+)*)\s/.exec(category.name);
  return numbered ? numbered[1] : category.id;
}

/**
 * Matches what the model sent back to the criteria it was given.
 *
 * Anything it could not be matched to is dropped rather than guessed at, and
 * a score outside its criterion's range is clamped — a model that answers 9
 * out of 8 has misread the rubric, and storing 9 would put the form over 100
 * without anything on screen looking wrong.
 */
/**
 * The leading criterion number in whatever the model chose to send.
 *
 * It is given `2.1` and asked to return `2.1`, and it does not reliably
 * comply: `[2.1]` echoing the bracket it was shown in, `2.1 סקירת ספרות`
 * echoing the whole line, `2.1.` with her full stop. Every one of those is
 * unambiguously about criterion 2.1, and matching only the exact string threw
 * away all seventeen scores of a paper — silently, because a dropped score
 * looks exactly like a criterion nobody has read yet.
 *
 * Only the number is trusted. A key with no number in it falls back to the
 * whole trimmed string, which is what an unnumbered form's key looks like.
 */
function keyOf(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^[[(]|[\])]$/g, '')
    .trim();
  const numbered = /^(\d+(?:\.\d+)*)/.exec(trimmed);
  return numbered ? numbered[1] : trimmed;
}

export interface ResolvedScores {
  matched: {
    category: GradingFormCategory;
    points: number | null;
    note: string;
    /** The model's reasoning for this score. Empty when it gave none. */
    rationale: string;
  }[];
  /**
   * Keys the model sent that answer to nothing on her form.
   *
   * Returned rather than quietly discarded so the screen can say what it saw.
   * A scoring pass where every key missed is indistinguishable on screen from
   * one that was never run.
   */
  unmatched: string[];
}

export function resolveScores(
  categories: readonly GradingFormCategory[],
  drafted: readonly { key: string; points: number | null; note: string; rationale?: string }[],
): ResolvedScores {
  const byKey = new Map(categories.map((c) => [keyOf(criterionKey(c)), c]));

  const matched: ResolvedScores['matched'] = [];
  const unmatched: string[] = [];

  for (const draft of drafted) {
    const category = byKey.get(keyOf(draft.key));

    // Her own criteria were never sent, so a score for one is a model that
    // invented a row. Dropped rather than stored against her judgement — and
    // not reported as a mismatch, because it is not one.
    if (category?.manual_only) continue;

    if (!category) {
      unmatched.push(draft.key);
      continue;
    }

    const max = category.max_points;
    const points =
      draft.points === null
        ? null
        : Math.max(0, max === null ? draft.points : Math.min(draft.points, max));

    matched.push({ category, points, note: draft.note, rationale: draft.rationale ?? '' });
  }

  return { matched, unmatched };
}

/**
 * A score as she reads it: `3/4` and the percentage beside it.
 *
 * Both, because they answer different questions. `3/4` is what she writes on
 * the form and what a student argues with; `75%` is what makes two criteria
 * worth different maxima comparable at a glance.
 *
 * Null points give null back rather than `0/4` and `0%`. A criterion that
 * cannot be judged yet and a criterion judged worth nothing are opposite
 * findings, and they must never render alike.
 */
export interface ScoreDisplay {
  points: number;
  outOf: number;
  /** Rounded to whole percent — a grading form is not a laboratory. */
  percent: number;
  label: string;
}

export function scoreDisplay(
  points: number | null | undefined,
  outOf: number | null | undefined,
): ScoreDisplay | null {
  if (points === null || points === undefined) return null;
  if (!outOf) return null;

  const percent = Math.round((points / outOf) * 100);
  return { points, outOf, percent, label: `${points}/${outOf}` };
}

/** One section of her rubric, totalled from the criteria actually scored. */
export interface SectionTotal {
  name: string;
  points: number;
  outOf: number;
  /** Criteria in this section still carrying no score. */
  awaiting: number;
  display: ScoreDisplay | null;
}

/**
 * Her rubric's sections, each with its own subtotal.
 *
 * A section's total is the sum of its children and is never stored, so it
 * cannot drift from them. `outOf` counts only the criteria that carry a score:
 * a theoretical chapter half written should read `18/24`, not `18/42`, which
 * would look like a failing paper rather than an unfinished one.
 */
export function sectionTotals(
  categories: readonly GradingFormCategory[],
  scores: readonly GradingCriterionScore[],
): SectionTotal[] {
  const byCategory = new Map(scores.map((s) => [s.category_id, s]));
  const order: string[] = [];
  const totals = new Map<string, SectionTotal>();

  for (const category of categories) {
    const name = category.section ?? 'ללא פרק';
    if (!totals.has(name)) {
      order.push(name);
      totals.set(name, { name, points: 0, outOf: 0, awaiting: 0, display: null });
    }

    const section = totals.get(name)!;
    const score = byCategory.get(category.id);

    if (score && score.points !== null) {
      section.points += score.points;
      section.outOf += category.max_points ?? 0;
    } else {
      section.awaiting += 1;
    }
  }

  for (const section of totals.values()) {
    section.display = scoreDisplay(section.outOf ? section.points : null, section.outOf);
  }

  return order.map((name) => totals.get(name)!);
}
