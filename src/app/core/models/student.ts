import { OwnedByTeacher, Timestamped, UUID } from './common';

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
}
