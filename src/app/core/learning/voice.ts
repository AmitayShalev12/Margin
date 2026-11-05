import {
  Annotation,
  GradingCriterionScore,
  LearningFeedbackLog,
  StudentEmail,
  TeacherStyleExample,
} from '../models';

/**
 * Everything she wrote in her own words, as one list.
 *
 * The log only ever recorded her reaction to a draft, so the things she wrote
 * unprompted taught the model nothing: a comment she added herself, her note
 * replying to a score, a message she wrote from scratch. Those are her voice
 * with no draft in the way, the clearest sample there is.
 *
 * Pure, so the store, the export and the tests read the same list.
 */
export interface WritingSample {
  source: string;
  /** The student's sentence it was written on, when there is one. */
  student_text: string | null;
  teacher_text: string;
  at: string;
}

export function herWriting(input: {
  examples: readonly TeacherStyleExample[];
  annotations: readonly Annotation[];
  scores: readonly GradingCriterionScore[];
  emails: readonly StudentEmail[];
}): WritingSample[] {
  const samples: WritingSample[] = [
    ...input.examples
      .filter((e) => e.active)
      .map((e) => ({
        source: e.source as string,
        student_text: e.student_text,
        teacher_text: e.teacher_text,
        at: e.created_at,
      })),
    // A dismissed comment of her own is one she decided against.
    ...input.annotations
      .filter((a) => a.origin === 'teacher' && a.status !== 'dismissed')
      .map((a) => ({
        source: 'own_comment',
        student_text: a.anchor.quote,
        teacher_text: a.body,
        at: a.updated_at,
      })),
    // Her side of the argument over a score: the model's turns are not her voice.
    ...input.scores.flatMap((s) =>
      (s.discussion ?? [])
        .filter((turn) => turn.role === 'teacher')
        .map((turn) => ({
          source: 'grade_note',
          student_text: null,
          teacher_text: turn.text,
          at: turn.at,
        })),
    ),
    // `ai_body` is null only for a message she wrote herself. Her rewrites of
    // drafted messages reach the prompt through the learning log instead.
    ...input.emails
      .filter((e) => e.ai_body === null)
      .map((e) => ({
        source: 'own_email',
        student_text: null,
        teacher_text: e.body,
        at: e.updated_at,
      })),
  ];

  const seen = new Set<string>();
  return samples
    .filter((s) => s.teacher_text.trim())
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((s) => {
      const key = s.teacher_text.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const ASSISTANT_SAMPLES = 12;
const ASSISTANT_SAMPLE_LENGTH = 240;

/**
 * What the assistant may see of her voice: her words, and only hers.
 *
 * The assistant's promise is that no paper content and no email address leaves
 * through it, so the student's sentence stays behind and any sample holding an
 * address is left out whole.
 */
export function voiceSamples(
  writing: readonly WritingSample[],
  logs: readonly LearningFeedbackLog[],
): string[] {
  const rewrites = logs
    .filter((l) => l.action === 'edited' && !!l.final_text)
    .map((l) => ({ text: l.final_text as string, at: l.created_at }));

  const all = [...writing.map((w) => ({ text: w.teacher_text, at: w.at })), ...rewrites].sort(
    (a, b) => b.at.localeCompare(a.at),
  );

  const texts = all
    .map((s) => s.text.trim())
    .filter((text) => text && !text.includes('@'))
    .map((text) => text.slice(0, ASSISTANT_SAMPLE_LENGTH));

  return [...new Set(texts)].slice(0, ASSISTANT_SAMPLES);
}
