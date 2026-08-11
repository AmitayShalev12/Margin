import { ISODateTime, OwnedByTeacher, Timestamped, UUID } from './common';

export type StyleExampleSource =
  | 'past_feedback' // הערות שכתבה בשנים קודמות
  | 'past_email' // מייל ששלחה לתלמידה
  | 'past_grading_form' // טופס הערכה ישן
  | 'manual'; // הדביקה ידנית

/**
 * A sample of the teacher's real writing, used to teach the model her voice.
 * `student_text` is the excerpt she was responding to (when known) and
 * `teacher_text` is what she actually wrote — the pair is what makes it
 * useful as a style example rather than just a tone sample.
 */
export interface TeacherStyleExample extends Timestamped, OwnedByTeacher {
  id: UUID;
  /** Null when the example applies to all of her courses. */
  course_id: UUID | null;
  source: StyleExampleSource;
  student_text: string | null;
  teacher_text: string;
  tags: string[];
  active: boolean;
}

/** Which kind of generated text a feedback log entry refers to. */
export type LearningTargetType =
  'annotation' | 'grading_entry' | 'student_email' | 'student_grading_form';

export type LearningAction = 'accepted' | 'edited' | 'dismissed';

/**
 * The training signal. Every time the teacher accepts, rewrites or throws
 * away something the AI drafted, we record the before and after. This log is
 * what later generations are conditioned on — it is the reason the phrasing
 * should visibly drift toward her own over a year.
 */
export interface LearningFeedbackLog extends OwnedByTeacher {
  id: UUID;
  course_id: UUID | null;
  target_type: LearningTargetType;
  target_id: UUID;
  action: LearningAction;
  /** What the model produced. */
  ai_text: string;
  /** What the teacher ended up with. Null when dismissed. */
  final_text: string | null;
  /** Short human-readable note on what changed — e.g. "קיצרה, ריככה ניסוח". */
  change_note: string | null;
  /** The surrounding student text, so the example stays interpretable. */
  context_excerpt: string | null;
  created_at: ISODateTime;
}
