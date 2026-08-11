import { ISODateTime, Timestamped, UUID } from './common';

/** A task set within a course. Students submit against an assignment. */
export interface Assignment extends Timestamped {
  id: UUID;
  course_id: UUID;
  title: string;
  /** The task as given to the students — the AI reads this as intent. */
  brief: string | null;
  due_at: ISODateTime | null;
  /**
   * Drive folder to watch for this specific assignment. Falls back to the
   * course folder when null.
   */
  drive_folder_id: string | null;
  expected_min_words: number | null;
  archived: boolean;
}
