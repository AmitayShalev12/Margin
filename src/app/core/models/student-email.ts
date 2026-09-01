import { ISODateTime, Timestamped, UUID } from './common';

/**
 * `skipped` is a decision, not a failure.
 *
 * Not every round needs a covering message: the comments are already on the
 * student's document, and she may be seeing the girl on Thursday anyway.
 * Without a way to say so, the only ways past this screen were to write a
 * message she did not want to send or to mark one sent that never was — and
 * the second is a lie the app would then keep, in a log that feeds the model.
 */
export type StudentEmailStatus = 'draft' | 'approved' | 'sent' | 'failed' | 'skipped';

/** One phrasing option the teacher can pick between before sending. */
export interface StudentEmailVariant {
  key: string;
  /** Short Hebrew label, e.g. "קצר ותכליתי" / "מעודד". */
  label: string;
  subject: string;
  body: string;
}

/**
 * A message to a student about a round of feedback. Generated with a few
 * phrasing options, always editable, and never sent without the teacher
 * approving it.
 */
export interface StudentEmail extends Timestamped {
  id: UUID;
  submission_id: UUID;
  student_id: UUID;
  round_id: UUID | null;

  subject: string;
  body: string;

  /** The variants offered; `selected_variant_key` is the one she chose. */
  variants: StudentEmailVariant[];
  selected_variant_key: string | null;

  /** The generated body before her edits — feeds the learning loop. */
  ai_body: string | null;
  edited_by_teacher: boolean;

  status: StudentEmailStatus;
  sent_at: ISODateTime | null;
  error_message: string | null;
}
