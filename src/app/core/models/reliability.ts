import { ISODateTime, Json, Timestamped, UUID } from './common';

/**
 * Individual signals the reliability module can raise (built in Phase 5).
 * Every one of these is circumstantial — the UI frames them as things worth
 * the teacher's attention, never as a verdict.
 */
export type ReliabilityFlagCode =
  | 'similar_to_past_work' // דומה לעבודה קודמת בארכיון
  | 'creator_mismatch' // המסמך נוצר בחשבון אחר
  | 'ownership_transferred' // הבעלות על הקובץ הועברה
  | 'created_near_deadline' // נוצר סמוך מאוד למועד ההגשה
  | 'bulk_paste' // רוב התוכן הופיע בהדבקה אחת
  | 'few_revisions' // כמעט ללא היסטוריית עריכה
  | 'unknown_editor'; // חשבון עורך שלא מוכר לתלמידה הזו

export type ReliabilitySeverity = 'info' | 'attention' | 'high';

export interface ReliabilityFlag {
  code: ReliabilityFlagCode;
  severity: ReliabilitySeverity;
  /** Teacher-facing Hebrew wording, phrased as an observation. */
  message: string;
  /** Whatever backed the flag: offsets, timestamps, matched excerpt. */
  evidence: Json | null;
}

/** An account that touched the file, from Drive's revision history. */
export interface DocumentEditor {
  email: string | null;
  display_name: string | null;
  first_edit_at: ISODateTime | null;
  last_edit_at: ISODateTime | null;
  revision_count: number;
  /** True when this account appears in no other work by this student. */
  unfamiliar: boolean;
}

export interface RevisionSummary {
  first_revision_at: ISODateTime | null;
  last_revision_at: ISODateTime | null;
  revision_count: number;
  /** Largest single jump in document size, in characters. */
  largest_single_insert_chars: number | null;
  /** Distinct editing sessions, clustered by gaps in the revision history. */
  editing_sessions: number | null;
  /** Minutes between the file's creation and the assignment deadline. */
  minutes_before_deadline: number | null;
}

/** The authenticity check attached to one round of one submission. */
export interface ReliabilityCheck extends Timestamped {
  id: UUID;
  submission_id: UUID;
  round_id: UUID | null;
  checked_at: ISODateTime;

  file_creator_email: string | null;
  file_owner_email: string | null;
  editors: DocumentEditor[];
  revision_summary: RevisionSummary | null;

  /** Highest text similarity found against the archive, 0–1. */
  max_similarity: number | null;
  /** The submission that similarity was against. */
  similar_submission_id: UUID | null;

  flags: ReliabilityFlag[];
  /** The teacher looked and decided it's fine. */
  dismissed: boolean;
  dismissed_note: string | null;
}
