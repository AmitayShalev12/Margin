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
  notes: string | null;
  active: boolean;
}
