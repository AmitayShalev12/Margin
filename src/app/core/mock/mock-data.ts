import { Injectable, computed, signal } from '@angular/core';

import { Annotation, AnnotationStatus, Submission, SubmissionStatus, UUID } from '../models';
import * as seed from './seed-data';

/**
 * Stands in for the Supabase-backed data layer until Phase 3.
 *
 * It holds the same records the real tables will, and mutations write back the
 * same fields — `status`, `body`, `edited_by_teacher`, `resolved_in_round` —
 * so swapping this for real queries is a change of source, not of shape.
 */
@Injectable({ providedIn: 'root' })
export class MockDataService {
  readonly course = seed.COURSE;
  readonly assignment = seed.ASSIGNMENT;
  readonly students = seed.STUDENTS;
  readonly documentBlocks = seed.DOCUMENT_BLOCKS;
  readonly rounds = seed.ROUNDS;
  readonly courseRules = seed.COURSE_RULES;
  readonly courseMaterials = seed.COURSE_MATERIALS;
  readonly learnedRuleNotes = seed.LEARNED_RULE_NOTES;
  readonly styleExamples = seed.STYLE_EXAMPLES;
  readonly styleTraits = seed.STYLE_TRAITS;
  readonly feedbackLogs = seed.FEEDBACK_LOGS;

  private readonly _submissions = signal<Submission[]>(seed.SUBMISSIONS);
  private readonly _annotations = signal<Annotation[]>(seed.ANNOTATIONS);

  readonly submissions = this._submissions.asReadonly();
  readonly annotations = this._annotations.asReadonly();

  /** Annotations still visible on the document — dismissed ones are gone. */
  readonly liveAnnotations = computed(() =>
    this._annotations().filter((a) => a.status !== 'dismissed'),
  );

  readonly pendingCount = computed(
    () => this._annotations().filter((a) => a.status === 'pending').length,
  );

  readonly resolvedCount = computed(
    () => this._annotations().filter((a) => a.status === 'resolved').length,
  );

  studentName(studentId: UUID): string {
    return this.students.find((s) => s.id === studentId)?.full_name ?? '—';
  }

  submission(id: UUID | null | undefined): Submission | undefined {
    if (!id) return undefined;
    return this._submissions().find((s) => s.id === id);
  }

  roundFor(submissionId: UUID) {
    return this.rounds.find((r) => r.submission_id === submissionId);
  }

  /**
   * How many comments on a given submission still need a decision. Only the
   * demo submission carries real annotations; the rest report zero, which is
   * exactly what an unopened submission would report.
   */
  annotationsPending(submissionId: UUID): number {
    return this._annotations().filter(
      (a) => a.submission_id === submissionId && a.status === 'pending',
    ).length;
  }

  // -- mutations ------------------------------------------------------------

  /**
   * Accept, dismiss or resolve a comment. Phase 4 also writes a
   * `LearningFeedbackLog` row here — that is the point where the training
   * signal is captured.
   */
  setAnnotationStatus(id: UUID, status: AnnotationStatus) {
    this._annotations.update((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        const round = this.roundFor(a.submission_id)?.round_number ?? 1;
        return {
          ...a,
          status,
          resolved_in_round: status === 'resolved' ? round : null,
          updated_at: new Date().toISOString(),
        };
      }),
    );
  }

  /** The teacher rewrote a comment: her wording wins, the AI's is kept. */
  editAnnotation(id: UUID, body: string) {
    this._annotations.update((list) =>
      list.map((a) =>
        a.id === id
          ? {
              ...a,
              body: body.trim(),
              status: 'edited' as AnnotationStatus,
              edited_by_teacher: true,
              updated_at: new Date().toISOString(),
            }
          : a,
      ),
    );
  }

  setSubmissionStatus(id: UUID, status: SubmissionStatus) {
    this._submissions.update((list) =>
      list.map((s) => (s.id === id ? { ...s, status, updated_at: new Date().toISOString() } : s)),
    );
  }
}
