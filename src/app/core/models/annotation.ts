import { ISODateTime, Timestamped, UUID } from './common';

/**
 * Where a comment sits on the document. Anchored to a block plus character
 * offsets, and carrying the quoted text itself — if the student edits the
 * document, the quote lets us re-locate the span instead of losing it.
 */
export interface TextAnchor {
  block_id: string;
  block_index: number;
  /** Character offset within the block, inclusive. */
  start: number;
  /** Character offset within the block, exclusive. */
  end: number;
  /** The exact text the comment refers to. */
  quote: string;
}

export type AnnotationKind =
  | 'language' // ניסוח, לשון, תחביר
  | 'structure' // מבנה ורצף הטיעון
  | 'sources' // מקורות חסרים או שגויים
  | 'content' // תוכן, דיוק, עומק
  | 'formatting' // טכני / עיצובי
  | 'praise' // חיזוק — חשוב שלא הכל יהיה תיקון
  | 'other';

/**
 * Lifecycle of a single margin comment.
 *
 * `pending`   — the AI drafted it, the teacher hasn't decided yet
 * `accepted`  — she kept the AI wording as-is
 * `edited`    — she rewrote it (the original stays in `ai_body`)
 * `dismissed` — she rejected it; it never reaches the student
 * `resolved`  — a later round shows the student addressed it
 */
export type AnnotationStatus = 'pending' | 'accepted' | 'edited' | 'dismissed' | 'resolved';

export type AnnotationOrigin = 'ai' | 'teacher';

/** An inline comment anchored to a span of the submitted document. */
export interface Annotation extends Timestamped {
  id: UUID;
  submission_id: UUID;
  round_id: UUID;

  anchor: TextAnchor;
  kind: AnnotationKind;

  /** The wording as it currently stands — what the student would see. */
  body: string;
  /** The AI's original draft. Null for comments the teacher wrote herself. */
  ai_body: string | null;

  origin: AnnotationOrigin;
  edited_by_teacher: boolean;
  status: AnnotationStatus;

  /** Model's own confidence, 0–1. Used to sort, never shown as a number. */
  confidence: number | null;

  /** Which grading-form category this comment feeds into, once resolved. */
  grading_category_id: UUID | null;
  /** Round number in which the comment was marked resolved. */
  resolved_in_round: number | null;

  sort_order: number;

  /**
   * The Drive comment id, once this has been posted to the student's document.
   *
   * Non-null is the record that it went out, and it is what stops a second
   * send from posting the same comment twice — a re-send after further review
   * posts only what is still null here. Nothing clears it: the comment exists
   * in her Drive whether or not Margin still thinks it should.
   */
  posted_comment_id: string | null;
  posted_at: ISODateTime | null;

  /**
   * The number of the marker Margin inserted in the document for this comment.
   *
   * Null when none was placed — the span could not be located, or the document
   * has not been marked. Non-null is what makes a re-send leave an existing
   * marker exactly as it is, and what gives removal something to find.
   */
  marker_number: number | null;
}
