import { AnnotationKind, DocumentBlock } from '../models';

/**
 * The wire contract with the `annotate` Edge Function.
 *
 * This file is canonical; `supabase/functions/annotate/index.ts` restates it
 * because a Deno function can't import from the Angular sources. `contract.spec.ts`
 * asserts the kind list here still matches the app's own `AnnotationKind`.
 */

/** Every kind the review screen has a colour for — no others are accepted. */
export const GENERATED_KINDS: readonly AnnotationKind[] = [
  'language',
  'structure',
  'sources',
  'content',
  'formatting',
  'praise',
  'other',
];

export interface AnnotateRequest {
  /**
   * The categories the model may use, sent rather than restated server-side.
   * One source of truth: the function builds its response schema from this, so
   * a kind added here can never drift out of step with the Edge Function or
   * arrive without a colour on the review screen.
   */
  allowed_kinds: AnnotationKind[];
  student_name: string;
  round_number: number;
  course_name: string;
  assignment_title: string;
  assignment_brief: string | null;
  blocks: Pick<DocumentBlock, 'id' | 'type' | 'level' | 'text'>[];
  rules: { kind: string; body: string; origin: string }[];
  materials: { kind: string; title: string; notes: string | null; content: string | null }[];
  /**
   * The authorities she defers to — the Hebrew Academy, a style guide, a
   * departmental standard. Where "correct" comes from for this course.
   *
   * Sent as names and notes, not as fetched pages: nothing here opens a URL,
   * and the prompt says so, because a model told to "read from" a link it
   * cannot open will cheerfully invent what it found there. What it does have
   * is its own knowledge of a named authority, which for something like the
   * Academy is substantial — and her note beside it, which is verbatim.
   */
  sources: { title: string; url: string | null; notes: string | null }[];
  /**
   * Whether this round may carry scores at all.
   *
   * `comments_only` and the model returns none — her first submission is a
   * single paragraph and gets comments and no number. Sent rather than decided
   * server-side, because the decision may be hers and the reason lives with the
   * round.
   */
  scoring: 'comments_only' | 'scored';
  /**
   * Her rubric, as the model is allowed to see it.
   *
   * Criteria she alone judges are **absent from this list**, not flagged
   * within it. A model that cannot see 2.2 cannot score 2.2; an instruction
   * not to score it is a request, and requests are followed most of the time.
   *
   * `key` is her own criterion number where she has one — she says "2.1" out
   * loud, and a uuid echoed back through a model is a uuid that comes back
   * subtly wrong.
   */
  rubric: { key: string; name: string; section: string | null; max_points: number | null }[];
  /**
   * What each criterion stood at before this round, so the model can say what
   * changed rather than only what the score now is.
   */
  previous_scores: { key: string; points: number | null }[];
  style_examples: { source: string; student_text: string | null; teacher_text: string }[];
  /**
   * Her decisions on comments that were drafted for her, from
   * `LearningFeedbackLog`. Three arrays rather than one tagged list, because
   * each teaches something different and the prompt presents them separately:
   * rewrites teach her phrasing, accepts confirm a phrasing already landed,
   * and dismissals are the only signal about what not to raise at all.
   */
  style_edits: {
    ai_text: string;
    final_text: string;
    change_note: string | null;
    context_excerpt: string | null;
  }[];
  style_accepted: { ai_text: string; context_excerpt: string | null }[];
  style_dismissed: { ai_text: string; context_excerpt: string | null }[];
}

/** One drafted comment, before its quote has been located in the document. */
export interface DraftAnnotation {
  block_id: string;
  quote: string;
  kind: AnnotationKind;
  body: string;
}

/** One criterion, scored or explicitly not. */
export interface DraftScore {
  key: string;
  /**
   * Null is a real answer and the common one: the submitted text does not
   * support a judgement on this criterion yet. It is never a zero, and the
   * `note` says what is missing.
   */
  points: number | null;
  /**
   * What changed since the round before. She asked for this by name — a number
   * that moved with no account of why is the part of an automated grade that
   * cannot be defended to a student.
   */
  note: string;
  /**
   * Why this criterion earned this score at all, in the model's own words.
   *
   * Separate from `note`, which only speaks about movement. She asked for this
   * after testing: "שעל כל פרמטר יהיה לו גם הסבר למה הוא נותן את הציון הזה...
   * כדי שנוכל לעקוב אחרי הרציונל שלו" — wanted on every criterion, including
   * the ones that never moved and the ones with no score yet.
   */
  rationale: string;
}

export interface AnnotateResponse {
  /** The plain-language restatement the teacher confirms, once per batch. */
  summary: string;
  annotations: DraftAnnotation[];
  /** Absent when the round is comments-only. */
  scores?: DraftScore[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}
