import { ISODateTime, Timestamped, UUID } from './common';

export type StudentEmailStatus = 'draft' | 'approved' | 'sent' | 'failed';

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
