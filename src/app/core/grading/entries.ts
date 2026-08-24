import { derivedId } from '../ids';
import {
  Annotation,
  AnnotationStatus,
  DocumentBlock,
  GradingFormCategory,
  GradingFormEntry,
  UUID,
} from '../models';
import { categoryFor } from './categories';

/**
 * Turning a review into a grading form.
 *
 * The lines on the form are the comments she stood behind, in her own words.
 * Nothing is regenerated or re-summarised, which is the whole reason the
 * Hebrew reads like hers: it *is* hers. A model asked to "write the grading
 * form" would produce the flat institutional register this app exists to avoid,
 * and it would do it over text she has already approved.
 */

/**
 * Which decisions put a comment on the form.
 *
 * `resolved` alone would be too narrow — it means the student fixed it in a
 * later round, and a first-round submission may never reach that state at all.
 * What belongs on a grading form is everything she stood behind: kept as
 * drafted, rewritten, or worked through. A comment she threw away does not.
 */
const COUNTS_TOWARD_GRADE: readonly AnnotationStatus[] = ['accepted', 'edited', 'resolved'];

export function countsTowardGrade(status: AnnotationStatus): boolean {
  return COUNTS_TOWARD_GRADE.includes(status);
}

/**
 * The form for one submission, rebuilt from its annotations.
 *
 * Derived rather than accumulated: recomputing from the annotations means a
 * comment she dismisses after the fact leaves the form, and one she changes
 * her mind about comes back. An entry she wrote herself is not touched — it is
 * passed in and kept.
 */
/**
 * The document a comment was written against.
 *
 * A lookup rather than one array, because a submission accumulates rounds and
 * the form spans all of them. Handing every annotation the *current* round's
 * blocks meant an earlier round's comment was categorised by matching its
 * quote against a document that no longer contained it — so it silently landed
 * in the fallback heading. Wrong, and wrong in the way that is hardest to
 * notice: the form still looked complete.
 */
export type BlocksForRound = (roundId: UUID) => readonly DocumentBlock[];

export function buildEntries(
  submissionId: UUID,
  annotations: readonly Annotation[],
  blocksFor: BlocksForRound,
  categories: readonly GradingFormCategory[],
  teacherEntries: readonly GradingFormEntry[] = [],
): GradingFormEntry[] {
  if (!categories.length) return [...teacherEntries];

  const fallback = categories[categories.length - 1];
  const now = new Date().toISOString();

  const derived = annotations
    .filter((a) => a.submission_id === submissionId && countsTowardGrade(a.status))
    .sort((a, b) => a.anchor.block_index - b.anchor.block_index || a.anchor.start - b.anchor.start)
    .map((annotation, index) => {
      // Its own round's document, not whichever one is open now.
      const category =
        categoryFor(annotation, blocksFor(annotation.round_id), categories) ?? fallback;

      return {
        // Derived from the annotation, so re-running produces the same row
        // rather than a duplicate every time she resolves something.
        id: derivedId('grading-entry', annotation.id),
        submission_id: submissionId,
        category_id: category.id,
        annotation_id: annotation.id,
        // Her wording as it now stands — the AI's original only if she kept it.
        body: annotation.body,
        ai_body: annotation.ai_body,
        origin: annotation.origin,
        edited_by_teacher: annotation.edited_by_teacher,
        sort_order: index,
        created_at: annotation.created_at,
        updated_at: now,
      } satisfies GradingFormEntry;
    });

  return [...derived, ...teacherEntries.filter((e) => e.submission_id === submissionId)];
}

export interface GradingFormGroup {
  category: GradingFormCategory;
  entries: GradingFormEntry[];
}

/**
 * The form as it is read: by category, in her order, empty ones included.
 *
 * An empty heading is information — it says she raised nothing there — so it
 * stays on the form rather than being tidied away.
 */
export function groupByCategory(
  entries: readonly GradingFormEntry[],
  categories: readonly GradingFormCategory[],
): GradingFormGroup[] {
  return [...categories]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((category) => ({
      category,
      entries: entries
        .filter((e) => e.category_id === category.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    }));
}
