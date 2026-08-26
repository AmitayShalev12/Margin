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
  sort_order: number;
  active: boolean;
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
