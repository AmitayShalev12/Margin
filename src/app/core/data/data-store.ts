import { Injectable, computed, signal } from '@angular/core';

import * as seed from '../mock/seed-data';
import {
  Annotation,
  AnnotationStatus,
  Assignment,
  Course,
  Submission,
  SubmissionRound,
  SubmissionStatus,
  UUID,
} from '../models';

/**
 * The app's in-memory store.
 *
 * It starts out holding the seeded demonstration records and takes real ones
 * from `SyncService` as they arrive from Drive. Field names and shapes are the
 * Supabase tables' exactly, so making this durable is a matter of writing the
 * same records through `SupabaseService` rather than reshaping anything.
 *
 * Folder configuration is the one thing persisted to `localStorage` — losing
 * it on every reload would make the integration unusable while Supabase is
 * still holding placeholder credentials.
 */

const FOLDER_STORAGE_KEY = 'margin.drive_folders';

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

function readFolders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FOLDER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeFolders(map: Record<string, string>) {
  try {
    localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable; the folder just won't survive a reload.
  }
}

@Injectable({ providedIn: 'root' })
export class DataStore {
  readonly students = seed.STUDENTS;
  readonly courseRules = seed.COURSE_RULES;
  readonly courseMaterials = seed.COURSE_MATERIALS;
  readonly learnedRuleNotes = seed.LEARNED_RULE_NOTES;
  readonly styleExamples = seed.STYLE_EXAMPLES;
  readonly styleTraits = seed.STYLE_TRAITS;
  readonly feedbackLogs = seed.FEEDBACK_LOGS;

  private readonly folders = signal<Record<string, string>>(readFolders());

  private readonly _course = signal<Course>(seed.COURSE);
  private readonly _assignment = signal<Assignment>(seed.ASSIGNMENT);
  private readonly _submissions = signal<Submission[]>(seed.SUBMISSIONS);
  private readonly _rounds = signal<SubmissionRound[]>(seed.ROUNDS);
  private readonly _annotations = signal<Annotation[]>(seed.ANNOTATIONS);
  private readonly _sync = signal<SyncState>(IDLE);

  /** Folder ids come from storage when set, falling back to the record. */
  readonly course = computed<Course>(() => ({
    ...this._course(),
    drive_folder_id: this.folders()[this._course().id] ?? this._course().drive_folder_id,
  }));

  readonly assignment = computed<Assignment>(() => ({
    ...this._assignment(),
    drive_folder_id: this.folders()[this._assignment().id] ?? this._assignment().drive_folder_id,
  }));

  readonly submissions = this._submissions.asReadonly();
  readonly rounds = this._rounds.asReadonly();
  readonly annotations = this._annotations.asReadonly();
  readonly sync = this._sync.asReadonly();

  /** The folder the sync actually watches: the assignment's, else the course's. */
  readonly watchedFolderId = computed(
    () => this.assignment().drive_folder_id ?? this.course().drive_folder_id,
  );

  readonly liveAnnotations = computed(() =>
    this._annotations().filter((a) => a.status !== 'dismissed'),
  );

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

  roundFor(submissionId: UUID): SubmissionRound | undefined {
    const rounds = this._rounds().filter((r) => r.submission_id === submissionId);
    return rounds.sort((a, b) => b.round_number - a.round_number)[0];
  }

  annotationsPending(submissionId: UUID): number {
    return this._annotations().filter(
      (a) => a.submission_id === submissionId && a.status === 'pending',
    ).length;
  }

  // -- annotation review ----------------------------------------------------

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

  // -- Drive configuration --------------------------------------------------

  setDriveFolder(ownerId: UUID, folderId: string | null) {
    this.folders.update((map) => {
      const next = { ...map };
      if (folderId) next[ownerId] = folderId;
      else delete next[ownerId];
      writeFolders(next);
      return next;
    });
  }

  // -- writes from the sync -------------------------------------------------

  setSyncState(patch: Partial<SyncState>) {
    this._sync.update((state) => ({ ...state, ...patch }));
  }

  /** Inserts a submission the sync has just discovered in the folder. */
  addSubmission(submission: Submission) {
    this._submissions.update((list) => [...list, submission]);
  }

  /** Applies whatever the sync learned about an existing submission. */
  updateSubmission(id: UUID, patch: Partial<Submission>) {
    this._submissions.update((list) =>
      list.map((s) => (s.id === id ? { ...s, ...patch, updated_at: new Date().toISOString() } : s)),
    );
  }

  addRound(round: SubmissionRound) {
    this._rounds.update((list) => [...list, round]);
  }

  /**
   * Replaces a round's captured text.
   *
   * Only ever called for a round whose notes have not been sent — once the
   * teacher has sent comments, a further edit by the student opens a *new*
   * round instead, so nothing she has already annotated is overwritten.
   */
  replaceRoundDocument(roundId: UUID, patch: Partial<SubmissionRound>) {
    this._rounds.update((list) =>
      list.map((r) =>
        r.id === roundId ? { ...r, ...patch, updated_at: new Date().toISOString() } : r,
      ),
    );
  }
}
