import { OwnedByTeacher, Timestamped, UUID } from './common';

/** Columns of the college's student list, kept so the export matches it. */
export interface StudentRosterDetails {
  status: string | null;
  pedagogic_year: string | null;
  track: string | null;
  department: string | null;
}

export interface Student extends Timestamped, OwnedByTeacher {
  id: UUID;
  full_name: string;
  email: string | null;
  /** Class / group, e.g. `יב'2`. */
  class_name: string | null;
  /**
   * The Google account the student submits from. Used by the reliability
   * module (Phase 5) to notice when a file was created by someone else.
   */
  drive_account_email: string | null;
  /**
   * Her own Drive folder, when she has one.
   *
   * Null is ordinary: work also arrives through the course-wide folder or by
   * sharing a document. A folder of her own is simply the arrangement that
   * scales best — the teacher opens one place and everything of that girl's is
   * in it.
   */
  drive_folder_id: string | null;
  notes: string | null;
  active: boolean;
  phone?: string | null;
  /** From the sign-up form. Never sent to the AI. */
  id_number?: string | null;
  address?: string | null;
  mobile?: string | null;
  roster_details?: StudentRosterDetails | null;
}
