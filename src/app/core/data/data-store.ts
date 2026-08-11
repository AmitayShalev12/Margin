import { Injectable, computed, inject, signal } from '@angular/core';

import { newId } from '../ids';
import { describeEdit } from '../learning/style-profile';
import * as seed from '../mock/seed-data';
import {
  Annotation,
  AnnotationStatus,
  Assignment,
  Course,
  LearningAction,
  LearningFeedbackLog,
  Submission,
  SubmissionRound,
  SubmissionStatus,
  TeacherStyleExample,
  UUID,
} from '../models';
import { SupabaseService } from '../supabase/supabase';
import { PersistedSnapshot, Repository } from './repository';

/**
 * The app's record store.
 *
 * It starts out holding the seeded demonstration records, layers anything
 * durable over them on boot, and writes every change straight back out. Field
 * names and shapes are the Supabase tables' exactly, so the repository can
 * upsert records as they are.
 *
 * Writes are fire-and-forget: the signal updates immediately so the screen
 * never waits on the network, and a failure surfaces on `persistError`
 * instead of being swallowed.
 */

export type SyncPhase = 'idle' | 'syncing' | 'error';

export interface SyncState {
  phase: SyncPhase;
  last_synced_at: string | null;
  /** Hebrew, teacher-facing. Null when the last sync was clean. */
  message: string | null;
  created: number;
  updated: number;
  /** Files in the folder that couldn't be attributed to a student. */
  unmatched: string[];
}

const IDLE: SyncState = {
  phase: 'idle',
  last_synced_at: null,
  message: null,
  created: 0,
  updated: 0,
  unmatched: [],
};

@Injectable({ providedIn: 'root' })
export class DataStore {
  private readonly repository = inject(Repository);
  private readonly supabase = inject(SupabaseService);

  readonly students = seed.STUDENTS;
  readonly courseRules = seed.COURSE_RULES;
  readonly courseMaterials = seed.COURSE_MATERIALS;
  readonly learnedRuleNotes = seed.LEARNED_RULE_NOTES;

  private readonly folders = signal<Record<UUID, string>>({});
  private readonly _course = signal<Course>(seed.COURSE);
  private readonly _assignment = signal<Assignment>(seed.ASSIGNMENT);
  private readonly _submissions = signal<Submission[]>(seed.SUBMISSIONS);
  private readonly _rounds = signal<SubmissionRound[]>(seed.ROUNDS);
  private readonly _annotations = signal<Annotation[]>(seed.ANNOTATIONS);
  private readonly _feedbackLogs = signal<LearningFeedbackLog[]>(seed.FEEDBACK_LOGS);
  private readonly _styleExamples = signal<TeacherStyleExample[]>(seed.STYLE_EXAMPLES);
  private readonly _sync = signal<SyncState>(IDLE);
  private readonly _hydrated = signal(false);
  private readonly _persistError = signal<string | null>(null);

  /** True once durable records have been layered in. */
  readonly hydrated = this._hydrated.asReadonly();
  readonly persistError = this._persistError.asReadonly();

  readonly submissions = this._submissions.asReadonly();
  readonly rounds = this._rounds.asReadonly();
  readonly annotations = this._annotations.asReadonly();
  readonly sync = this._sync.asReadonly();

  /** Every decision she has made on a drafted comment, newest last. */
  readonly feedbackLogs = this._feedbackLogs.asReadonly();
  readonly styleExamples = this._styleExamples.asReadonly();

  /** Folder ids come from the persisted map when set, else from the record. */
  readonly course = computed<Course>(() => ({
    ...this._course(),
    drive_folder_id: this.folders()[this._course().id] ?? this._course().drive_folder_id,
  }));

  readonly assignment = computed<Assignment>(() => ({
    ...this._assignment(),
    drive_folder_id: this.folders()[this._assignment().id] ?? this._assignment().drive_folder_id,
  }));

  /** The folder the sync actually watches: the assignment's, else the course's. */
  readonly watchedFolderId = computed(
    () => this.assignment().drive_folder_id ?? this.course().drive_folder_id,
  );

  readonly liveAnnotations = computed(() =>
    this._annotations().filter((a) => a.status !== 'dismissed'),
  );

  /**
   * Loads durable records over the seeded ones.
   *
   * Persisted records win by id, so review work done on a seeded submission
   * survives a reload just as work on a synced one does. Called once at
   * startup, before the first screen renders.
   */
  async hydrate(): Promise<void> {
    let snapshot: PersistedSnapshot;
    try {
      snapshot = await this.repository.load();
    } catch (error) {
      this._persistError.set(errorText(error));
      this._hydrated.set(true);
      return;
    }

    this._submissions.update((list) => mergeById(list, snapshot.submissions));
    this._rounds.update((list) => mergeById(list, snapshot.rounds));

    // A round that has been written to owns its comments outright: whatever is
    // persisted for it is the whole set. Merging by id instead would make a
    // seeded comment un-removable — a drafted batch that replaced them would
    // come back alongside them on the next load, and a discarded batch would
    // resurrect them.
    const rewrittenRounds = new Set(snapshot.rounds.map((r) => r.id));
    this._annotations.update((list) =>
      mergeById(
        list.filter((a) => !rewrittenRounds.has(a.round_id)),
        snapshot.annotations,
      ),
    );

    // Merged by id, not round-authoritative: a decision is hers and stands on
    // its own, so a persisted log never removes a seeded one.
    this._feedbackLogs.update((list) => mergeById(list, snapshot.feedbackLogs));
    this._styleExamples.update((list) => mergeById(list, snapshot.styleExamples));

    this.folders.set(snapshot.driveFolders);

    // "Last synced" is not its own record — it is simply the most recent one
    // stamped on a submission, so it comes back with them.
    const latest = snapshot.submissions
      .map((s) => s.last_synced_at)
      .filter((at): at is string => !!at)
      .sort()
      .at(-1);
    if (latest) this._sync.update((state) => ({ ...state, last_synced_at: latest }));

    this._hydrated.set(true);
  }

  studentName(studentId: UUID): string {
    return this.students.find((s) => s.id === studentId)?.full_name ?? '—';
  }

  submission(id: UUID | null | undefined): Submission | undefined {
    if (!id) return undefined;
    return this._submissions().find((s) => s.id === id);
  }

  submissionByDriveFile(fileId: string): Submission | undefined {
    return this._submissions().find((s) => s.drive_file_id === fileId);
  }

  annotation(id: UUID): Annotation | undefined {
    return this._annotations().find((a) => a.id === id);
  }

  roundFor(submissionId: UUID): SubmissionRound | undefined {
    return this._rounds()
      .filter((r) => r.submission_id === submissionId)
      .sort((a, b) => b.round_number - a.round_number)[0];
  }

  annotationsPending(submissionId: UUID): number {
    return this._annotations().filter(
      (a) => a.submission_id === submissionId && a.status === 'pending',
    ).length;
  }

  // -- annotation review ----------------------------------------------------

  setAnnotationStatus(id: UUID, status: AnnotationStatus) {
    const before = this.annotation(id);
    // Re-asserting the status she already chose is not a second decision.
    if (!before || before.status === status) return;

    this.writeAnnotation(id, (a) => ({
      ...a,
      status,
      resolved_in_round:
        status === 'resolved' ? (this.roundFor(a.submission_id)?.round_number ?? 1) : null,
      updated_at: new Date().toISOString(),
    }));

    // `resolved` is about the student's next draft, not about the wording, so
    // it teaches nothing and is deliberately not logged.
    if (status === 'accepted') this.logDecision(before, 'accepted', before.body, null);
    if (status === 'dismissed') this.logDecision(before, 'dismissed', null, null);
  }

  /** The teacher rewrote a comment: her wording wins, the AI's is kept. */
  editAnnotation(id: UUID, body: string) {
    const before = this.annotation(id);
    const text = body.trim();

    this.writeAnnotation(id, (a) => ({
      ...a,
      body: text,
      status: 'edited' as AnnotationStatus,
      edited_by_teacher: true,
      updated_at: new Date().toISOString(),
    }));

    if (!before) return;

    // Opening the editor and saving it untouched is an acceptance. Logging it
    // as a rewrite would teach the model that its own wording was a correction
    // of itself.
    const action: LearningAction = text === before.ai_body ? 'accepted' : 'edited';
    this.logDecision(
      before,
      action,
      text,
      action === 'edited' ? describeEdit(before.ai_body ?? '', text) : null,
    );
  }

  /**
   * Records what she decided about a drafted comment.
   *
   * One log per comment: changing her mind supersedes the previous entry
   * rather than appending, so the log stays a record of where each comment
   * ended up. A trail of superseded decisions would teach the model phrasings
   * she has since moved away from.
   */
  private logDecision(
    annotation: Annotation,
    action: LearningAction,
    finalText: string | null,
    changeNote: string | null,
  ) {
    // Only a drafted comment carries a signal. There is nothing to compare a
    // comment she wrote herself against.
    if (annotation.origin !== 'ai' || !annotation.ai_body) return;

    const existing = this._feedbackLogs().find(
      (l) => l.target_type === 'annotation' && l.target_id === annotation.id,
    );

    const log: LearningFeedbackLog = {
      id: existing?.id ?? newId(),
      teacher_id: this.supabase.teacherId ?? seed.TEACHER_ID,
      course_id: this._course().id,
      target_type: 'annotation',
      target_id: annotation.id,
      action,
      ai_text: annotation.ai_body,
      final_text: finalText,
      change_note: changeNote,
      // The student's own words, so the pair stays interpretable a year later
      // and the model can see what kind of text drew which response.
      context_excerpt: annotation.anchor.quote,
      created_at: new Date().toISOString(),
    };

    this._feedbackLogs.update((list) => [...list.filter((l) => l.id !== log.id), log]);
    this.persist(() => this.repository.saveFeedbackLog(log));
  }

  setSubmissionStatus(id: UUID, status: SubmissionStatus) {
    this.updateSubmission(id, { status });
  }

  // -- Drive configuration --------------------------------------------------

  setDriveFolder(ownerId: UUID, folderId: string | null) {
    this.folders.update((map) => {
      const next = { ...map };
      if (folderId) next[ownerId] = folderId;
      else delete next[ownerId];
      return next;
    });
    this.persist(() => this.repository.saveDriveFolder(ownerId, folderId));
  }

  // -- writes from the sync -------------------------------------------------

  setSyncState(patch: Partial<SyncState>) {
    this._sync.update((state) => ({ ...state, ...patch }));
  }

  /** Inserts a submission the sync has just discovered in the folder. */
  addSubmission(submission: Submission) {
    this._submissions.update((list) => [...list, submission]);
    this.persist(() => this.repository.saveSubmission(submission));
  }

  /** Applies whatever the sync learned about an existing submission. */
  updateSubmission(id: UUID, patch: Partial<Submission>) {
    let written: Submission | undefined;
    this._submissions.update((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        written = { ...s, ...patch, updated_at: new Date().toISOString() };
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveSubmission(written!));
  }

  /**
   * Swaps out every annotation on a round.
   *
   * Used when a drafted batch lands, and when one is thrown away. The removed
   * records are deleted rather than marked dismissed — a batch the teacher
   * never accepted is not a decision she made, and keeping it would pollute
   * the learning signal.
   */
  replaceRoundAnnotations(roundId: UUID, annotations: readonly Annotation[]) {
    const removed = this._annotations()
      .filter((a) => a.round_id === roundId)
      .map((a) => a.id);

    this._annotations.update((list) => [
      ...list.filter((a) => a.round_id !== roundId),
      ...annotations,
    ]);

    if (removed.length) this.persist(() => this.repository.deleteAnnotations(removed));
    for (const annotation of annotations) {
      this.persist(() => this.repository.saveAnnotation(annotation));
    }
  }

  addRound(round: SubmissionRound) {
    this._rounds.update((list) => [...list, round]);
    this.persist(() => this.repository.saveRound(round));
  }

  /**
   * Replaces a round's captured text.
   *
   * Only ever called for a round whose notes have not been sent — once the
   * teacher has sent comments, a further edit by the student opens a *new*
   * round instead, so nothing she has already annotated is overwritten.
   */
  replaceRoundDocument(roundId: UUID, patch: Partial<SubmissionRound>) {
    let written: SubmissionRound | undefined;
    this._rounds.update((list) =>
      list.map((r) => {
        if (r.id !== roundId) return r;
        written = { ...r, ...patch, updated_at: new Date().toISOString() };
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveRound(written!));
  }

  /** Waits for outstanding writes — used by tests, not by the UI. */
  async settled(): Promise<void> {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  // -- plumbing -------------------------------------------------------------

  private pending: Promise<unknown>[] = [];

  private writeAnnotation(id: UUID, apply: (a: Annotation) => Annotation) {
    let written: Annotation | undefined;
    this._annotations.update((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        written = apply(a);
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveAnnotation(written!));
  }

  private persist(write: () => Promise<void>) {
    const promise = write().catch((error: unknown) => {
      this._persistError.set(errorText(error));
    });
    this.pending.push(promise);
  }
}

/** Later records win by id; unknown ones are appended. */
function mergeById<T extends { id: string }>(base: T[], overrides: T[]): T[] {
  if (overrides.length === 0) return base;
  const byId = new Map(base.map((item) => [item.id, item]));
  for (const item of overrides) byId.set(item.id, item);
  return [...byId.values()];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
