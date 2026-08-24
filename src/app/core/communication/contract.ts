/**
 * Wire contract for the `student-email` Edge Function.
 *
 * Canonical here, restated in `supabase/functions/student-email/index.ts` —
 * Deno and the Angular build don't share a module graph, so the two copies are
 * kept in step by hand, the same arrangement `annotate` and `student-form` use.
 */

/** One phrasing option to offer. */
export interface EmailVariantBrief {
  key: string;
  /** The Hebrew label on the chip she picks between. */
  label: string;
  /** What makes this option different, for the model. */
  brief: string;
}

/**
 * Three options, deliberately differing in *register* rather than in voice.
 *
 * The voice is hers in all three — that is what the style examples and her past
 * rewrites are for. What she is actually choosing between is how much of the
 * review to put in a message: the headline, the walk-through, or the
 * encouragement first. Offering "formal" and "friendly" versions would be
 * offering to write as someone other than her, which is the one thing this app
 * is built not to do.
 */
export const VARIANT_BRIEFS: readonly EmailVariantBrief[] = [
  {
    key: 'short',
    label: 'קצר',
    brief:
      'A few lines. The one or two things that matter most and what to do next. Assume she will open the document and read the comments there — this message points her at them, it does not repeat them.',
  },
  {
    key: 'detailed',
    label: 'מפורט',
    brief:
      'Walks through the main points in the order they appear in the paper, grouped so she can act on them one at a time. Still a message, not a report: no headings, no numbered rubric.',
  },
  {
    key: 'warm',
    label: 'מעודד',
    brief:
      'Opens with what genuinely worked, named specifically enough that it could not be said about any other paper, then turns to what is worth working on. Encouraging without inflating: nothing praised that is not on the comments.',
  },
];

export interface EmailRequest {
  student_name: string;
  /** How she would actually address her — first name. */
  first_name: string;
  course_name: string;
  assignment_title: string;
  round_number: number;
  /** The batch restatement she confirmed, when there is one. */
  summary: string | null;
  /** The comments she stood behind, in document order. */
  comments: { kind: string; body: string; quote: string | null }[];
  variants: EmailVariantBrief[];

  // -- voice ----------------------------------------------------------------
  style_examples: { source: string; student_text: string | null; teacher_text: string }[];
  /** Her rewrites of drafted comments — her voice, at comment scale. */
  style_edits: { ai_text: string; final_text: string; change_note: string | null }[];
  /** Her rewrites of drafted emails. The strongest signal there is for this. */
  email_edits: { ai_text: string; final_text: string; change_note: string | null }[];
}

export interface EmailResponse {
  /**
   * One entry per requested key. Labels are not returned — the client owns
   * them, so a model that renames an option cannot rename the chip.
   */
  variants: { key: string; subject: string; body: string }[];
}
