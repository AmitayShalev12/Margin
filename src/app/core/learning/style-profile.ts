import { Annotation, AnnotationKind, LearningFeedbackLog, TeacherStyleExample } from '../models';
import { KIND_LABEL } from '../presentation/annotation-kind';

/**
 * What the app has actually learned about how she writes.
 *
 * Everything here is derived from records — her rewrites, her accepts, her
 * dismissals — and nothing is asserted that the log cannot support. That is
 * the point: the style screen used to show four stated observations, which
 * read as insight but were a fixture. A claim with no evidence behind it is
 * worse than no claim, because she has no way to tell the difference.
 *
 * Pure functions, no Angular: the screen renders them and the export writes
 * them, and both are tested without a TestBed.
 */

/** Below this there isn't enough for an honest claim, so nothing is claimed. */
const MIN_EDITS = 4;
const MIN_DISMISSALS = 3;

/** A rewrite has to move the length this much before it counts as shortening. */
const LENGTH_SHIFT = 0.15;

export interface StyleTrait {
  text: string;
  kind: AnnotationKind;
  /** What the claim rests on, shown beside it — "מתוך 8 תיקונים". */
  evidence: string;
}

export interface StyleCounts {
  accepted: number;
  edited: number;
  dismissed: number;
  examples: number;
}

/**
 * Describes what a rewrite changed, in her own terms.
 *
 * Deliberately blunt: length and punctuation are the two things that can be
 * measured from the pair alone. Anything more would be a guess dressed as an
 * observation, and this string is shown to her as a fact about her own edit.
 */
export function describeEdit(aiText: string, finalText: string): string | null {
  const parts: string[] = [];
  const before = aiText.trim();
  const after = finalText.trim();
  if (!before || !after) return null;

  const ratio = after.length / before.length;
  if (ratio <= 1 - LENGTH_SHIFT) parts.push('קיצרת');
  else if (ratio >= 1 + LENGTH_SHIFT) parts.push('הרחבת');

  if (after.endsWith('?') && !before.endsWith('?')) parts.push('הפכת לשאלה');

  return parts.length ? parts.join(', ') : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function countDecisions(
  logs: readonly LearningFeedbackLog[],
  examples: readonly TeacherStyleExample[],
): StyleCounts {
  return {
    accepted: logs.filter((l) => l.action === 'accepted').length,
    edited: logs.filter((l) => l.action === 'edited').length,
    dismissed: logs.filter((l) => l.action === 'dismissed').length,
    examples: examples.filter((e) => e.active).length,
  };
}

/**
 * Observations the log supports, strongest first.
 *
 * Returns an empty list until there is enough to go on — the screen says so
 * plainly rather than filling the space.
 */
export function deriveTraits(
  logs: readonly LearningFeedbackLog[],
  annotations: readonly Annotation[] = [],
): StyleTrait[] {
  const traits: StyleTrait[] = [];

  const edits = logs.filter(
    (l): l is LearningFeedbackLog & { final_text: string } =>
      l.action === 'edited' && !!l.final_text,
  );

  if (edits.length >= MIN_EDITS) {
    const ratios = edits.map(
      (l) => l.final_text.trim().length / Math.max(l.ai_text.trim().length, 1),
    );
    const shortened = ratios.filter((r) => r <= 1 - LENGTH_SHIFT).length;

    if (shortened / edits.length >= 0.5) {
      // Median, not mean: she occasionally replaces a flat note with a warmer
      // and much longer one, and two of those drag an average far enough to
      // contradict the examples printed directly under this sentence.
      traits.push({
        text: `את מקצרת — הניסוח שלך יוצא בערך ${Math.round((1 - median(ratios)) * 100)}% קצר משלי.`,
        kind: 'structure',
        evidence: `מתוך ${edits.length} תיקונים`,
      });
    }

    const turnedIntoQuestions = edits.filter(
      (l) => l.final_text.trim().endsWith('?') && !l.ai_text.trim().endsWith('?'),
    ).length;

    if (turnedIntoQuestions / edits.length >= 0.3) {
      traits.push({
        text: 'את פותחת בשאלה במקום בקביעה.',
        kind: 'language',
        evidence: `${turnedIntoQuestions} מתוך ${edits.length} תיקונים`,
      });
    }
  }

  // Which category she throws away most. Needs the annotation to know the
  // category, so comments deleted since are simply not counted.
  const kindOf = new Map(annotations.map((a) => [a.id, a.kind]));
  const dismissedKinds = logs
    .filter((l) => l.action === 'dismissed')
    .map((l) => kindOf.get(l.target_id))
    .filter((kind): kind is AnnotationKind => !!kind);

  if (dismissedKinds.length >= MIN_DISMISSALS) {
    const tally = new Map<AnnotationKind, number>();
    for (const kind of dismissedKinds) tally.set(kind, (tally.get(kind) ?? 0) + 1);

    const [kind, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count / dismissedKinds.length >= 0.5) {
      traits.push({
        text: `על הערות ${KIND_LABEL[kind]} את מוותרת יותר מכל סוג אחר.`,
        kind,
        evidence: `${count} מתוך ${dismissedKinds.length} הערות שוויתרת עליהן`,
      });
    }
  }

  return traits;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * The learned style, as a file she can keep.
 *
 * Flat, named fields and no ids: this is meant to be opened and read, not
 * re-imported. If the app goes away, the pairs she spent a year producing are
 * still legible in a text editor — which is the whole reason the format is
 * declared rather than left as whatever the store happened to hold.
 */
export interface StyleProfile {
  format: 'margin.style-profile';
  version: 1;
  exported_at: string;
  counts: StyleCounts;
  traits: StyleTrait[];
  style_examples: {
    source: string;
    student_text: string | null;
    teacher_text: string;
    tags: string[];
    created_at: string;
  }[];
  decisions: {
    action: string;
    /** What was drafted for her. */
    ai_text: string;
    /** What she kept. Null when she threw the comment away. */
    final_text: string | null;
    change_note: string | null;
    /** The student's words the comment was on. */
    context_excerpt: string | null;
    created_at: string;
  }[];
}

export function buildStyleProfile(input: {
  logs: readonly LearningFeedbackLog[];
  examples: readonly TeacherStyleExample[];
  annotations?: readonly Annotation[];
  exportedAt: string;
}): StyleProfile {
  const examples = input.examples.filter((e) => e.active);

  return {
    format: 'margin.style-profile',
    version: 1,
    exported_at: input.exportedAt,
    counts: countDecisions(input.logs, input.examples),
    traits: deriveTraits(input.logs, input.annotations),
    style_examples: examples.map((e) => ({
      source: e.source,
      student_text: e.student_text,
      teacher_text: e.teacher_text,
      tags: e.tags,
      created_at: e.created_at,
    })),
    decisions: [...input.logs]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((l) => ({
        action: l.action,
        ai_text: l.ai_text,
        final_text: l.final_text,
        change_note: l.change_note,
        context_excerpt: l.context_excerpt,
        created_at: l.created_at,
      })),
  };
}
