import { ISODateTime, Timestamped, UUID } from './common';

/**
 * A heading on the teacher's internal grading form (טופס הערכה), e.g.
 * "מבנה וארגון", "שימוש במקורות". Categories are per course and are largely
 * *learned* from her own grading forms from previous years, then adapted to
 * the current assignment — so the form looks like the one she already uses.
 */
export interface GradingFormCategory extends Timestamped {
  id: UUID;
  course_id: UUID;
  name: string;
  description: string | null;
  /**
   * Where the heading came from.
   *
   * `starting` is the default set, used when a course has no past forms to
   * learn from — kept distinct from `learned` so the screen can say which it
   * is looking at rather than implying a history that does not exist.
   */
  origin: 'learned' | 'teacher' | 'starting' | 'imported';
  /**
   * The section this criterion sits under on her rubric — `פרק תאורטי`.
   *
   * Null for a flat list of learned headings, which is what a form assembled
   * from past years looks like. Section totals are the sum of their children
   * and are never stored, so they cannot disagree with them.
   */
  section: string | null;
  /**
   * What this criterion is worth. Null when the form carries no point values
   * at all — a real state, and one the screen has to say rather than show a
   * zero for.
   */
  max_points: number | null;
  /**
   * Only she may score this one.
   *
   * Her 2.2 asks whether Chabad sources are woven in with a חסידית reading,
   * and her 4.2 is typesetting — neither is something a model can see, and a
   * guess at either is five points of invention. Marked rather than inferred:
   * her rubric is not the only rubric, and the next teacher's 2.2 is something
   * else entirely.
   */
  manual_only: boolean;
  sort_order: number;
  active: boolean;
}

/**
 * Whether a round may carry scores at all.
 *
 * The first submission is a single paragraph and gets comments and nothing
 * else — "לתת רק הערות על הפסקה". Scoring begins from the first part of the
 * theoretical chapter, six or seven pages in. A score on a paragraph is a
 * number a student reads as a verdict on work she has barely started.
 */
export type ScoringMode = 'comments_only' | 'scored';

/**
 * One criterion's score on one submission, as it stands today.
 *
 * Per submission and not per round: the form is one document that follows the
 * work, and `round_number` records which round last moved it.
 */
export interface GradingCriterionScore extends Timestamped {
  id: UUID;
  submission_id: UUID;
  category_id: UUID;
  /**
   * Null is "not assessable yet", and it is the ordinary state for most of the
   * year — the research chapter does not exist in November. It must never be
   * rendered as a zero.
   */
  points: number | null;
  /** What it was before this round moved it, so the change reads on its own. */
  previous_points: number | null;
  status: 'draft' | 'final';
  /** What improved since last time, in the words she is shown. */
  change_note: string | null;
  /**
   * Why this criterion got this score, in the model's own words.
   *
   * Asked for outright: "שעל כל פרמטר יהיה לו גם הסבר למה הוא נותן את הציון
   * הזה... כדי שנוכל לעקוב אחרי הרציונל שלו". Distinct from `change_note`,
   * which says what moved since last round; this says why the number is what
   * it is at all, and is wanted even on a criterion that has never moved.
   *
   * The model's reasoning, never hers. Shown as such.
   */
  rationale: string | null;
  /**
   * The score the rationale was written for.
   *
   * She can override any score by hand, and an explanation of 5 sitting under
   * a 7 she typed is worse than none: it reads as a justification of her own
   * number in a voice that never made that judgement.
   */
  rationale_points: number | null;
  round_number: number;
  origin: 'ai' | 'teacher';
  /** Once she has touched it, no generated score overwrites it. */
  edited_by_teacher: boolean;
  scored_at: ISODateTime;
}

/**
 * One line on the internal grading form for a specific submission. Usually
 * derived from a resolved annotation, but the teacher can add her own.
 */
export interface GradingFormEntry extends Timestamped {
  id: UUID;
  submission_id: UUID;
  category_id: UUID;
  /** The annotation this line came from, when there is one. */
  annotation_id: UUID | null;
  body: string;
  ai_body: string | null;
  origin: 'ai' | 'teacher';
  edited_by_teacher: boolean;
  sort_order: number;
}

export type StudentGradingFormStatus = 'draft' | 'approved' | 'sent';

export interface StudentGradingFormSection {
  title: string;
  body: string;
  /** The internal category this section was translated from, if any. */
  category_id: UUID | null;
}

/**
 * The year-end, student-facing form — deliberately a separate record from the
 * teacher's internal one. Phase 4 generates it by learning the teacher's own
 * historical translation from internal notes to student-appropriate wording.
 */
export interface StudentGradingForm extends Timestamped {
  id: UUID;
  student_id: UUID;
  course_id: UUID;
  year: string;
  sections: StudentGradingFormSection[];
  summary: string | null;
  status: StudentGradingFormStatus;
  edited_by_teacher: boolean;
  /** Internal entries this form was generated from — provenance. */
  source_entry_ids: UUID[];
  approved_at: ISODateTime | null;
  sent_at: ISODateTime | null;
}
