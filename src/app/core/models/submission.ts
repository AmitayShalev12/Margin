import { ScoringMode } from './grading-form';
import { ISODateTime, Json, Timestamped, UUID } from './common';

/**
 * Where a submission sits in the revision cycle.
 *
 * The cycle is iterative, not one-shot: the teacher sends notes, the student
 * revises the same document, and it comes back for another round. Statuses
 * name the state of the *conversation*, not just "reviewed / not reviewed".
 */
export type SubmissionStatus =
  | 'new' // הגיעה, טרם נפתחה
  | 'in_review' // בבדיקה אצל המורה
  | 'notes_sent' // ההערות נשלחו, ממתין לתלמידה
  | 'student_revised' // התלמידה ערכה את המסמך
  | 'resubmitted' // הוגשה מחדש לסבב נוסף
  | 'finalized'; // הסתיים

export const SUBMISSION_STATUS_ORDER: readonly SubmissionStatus[] = [
  'new',
  'in_review',
  'notes_sent',
  'student_revised',
  'resubmitted',
  'finalized',
];

/**
 * One student's work on one assignment, across all its revision rounds.
 * The per-round content lives in `SubmissionRound` so history is never
 * overwritten when the student revises.
 */
export interface Submission extends Timestamped {
  id: UUID;
  assignment_id: UUID;
  student_id: UUID;

  status: SubmissionStatus;
  /** 1-based; matches the highest `SubmissionRound.round_number`. */
  current_round: number;
  title: string | null;

  // -- Google Drive linkage (populated in Phase 3) -------------------------
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_mime_type: string | null;
  drive_web_view_link: string | null;
  /** Current owner of the file according to Drive. */
  drive_owner_email: string | null;
  /** Account that originally created the file — may differ from the owner. */
  drive_creator_email: string | null;
  drive_created_at: ISODateTime | null;
  drive_modified_at: ISODateTime | null;
  drive_revision_count: number | null;
  /** Untouched Drive API payload, kept so Phase 5 can re-analyse it later. */
  drive_metadata_raw: Json | null;

  last_synced_at: ISODateTime | null;
  word_count: number | null;
}

/**
 * A single block of the submitted document. Blocks carry stable ids so that
 * annotations stay anchored even after the student edits the text around
 * them.
 */
export interface DocumentBlock {
  id: string;
  index: number;
  type: 'heading' | 'paragraph' | 'quote' | 'list_item';
  text: string;
  /** Heading level, when `type === 'heading'`. */
  level?: number;
}

/**
 * One revision cycle of a submission. Each round keeps its own copy of the
 * document text, so the teacher can always look back at what a comment was
 * originally written against.
 */
export interface SubmissionRound extends Timestamped {
  id: UUID;
  submission_id: UUID;
  round_number: number;

  /** Plain text of the document as it was in this round. */
  document_text: string | null;
  /** Structured blocks, used to anchor annotations. */
  document_blocks: DocumentBlock[] | null;
  /** Drive revision this round was captured from. */
  drive_revision_id: string | null;

  received_at: ISODateTime;
  /**
   * Whether this round carries scores.
   *
   * Null means nobody decided and the app applies the rule from how much was
   * submitted; a value means she chose. Kept apart because "she asked for
   * comments only" and "it is too short to score" are different facts and the
   * screen says which.
   */
  scoring: ScoringMode | null;
  notes_sent_at: ISODateTime | null;

  /**
   * Plain-language restatement the AI writes before annotations are
   * finalized ("understanding confirmation", Phase 4). The teacher confirms
   * or adjusts it, and only then are the annotations committed.
   */
  ai_summary: string | null;
  ai_summary_confirmed_at: ISODateTime | null;
}
