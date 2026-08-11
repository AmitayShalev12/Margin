import {
  Annotation,
  LearningFeedbackLog,
  Submission,
  SubmissionRound,
  TeacherStyleExample,
  UUID,
} from '../models';

/**
 * Everything that has to survive a reload.
 *
 * Seeded demonstration records are not in here — they are the store's starting
 * contents, and anything persisted is layered over them by id.
 */
export interface PersistedSnapshot {
  submissions: Submission[];
  rounds: SubmissionRound[];
  annotations: Annotation[];
  /** Watched Drive folder, keyed by the course or assignment it belongs to. */
  driveFolders: Record<UUID, string>;
  /** Her decisions on drafted comments — the signal later drafts learn from. */
  feedbackLogs: LearningFeedbackLog[];
  /** Samples of her own writing. Read-only for now; nothing here writes them. */
  styleExamples: TeacherStyleExample[];
}

export const EMPTY_SNAPSHOT: PersistedSnapshot = {
  submissions: [],
  rounds: [],
  annotations: [],
  driveFolders: {},
  feedbackLogs: [],
  styleExamples: [],
};

/**
 * Where durable records live.
 *
 * Two adapters implement this: Supabase when the project is configured, and a
 * browser-storage one when it isn't, so the app is still usable — and
 * testable — before credentials are filled in. The store never knows which it
 * is talking to.
 */
export abstract class Repository {
  abstract readonly kind: 'supabase' | 'local';

  abstract load(): Promise<PersistedSnapshot>;

  abstract saveSubmission(submission: Submission): Promise<void>;
  abstract saveRound(round: SubmissionRound): Promise<void>;
  abstract saveAnnotation(annotation: Annotation): Promise<void>;
  /** Hard delete — used when a drafted batch is thrown away, not for dismissal. */
  abstract deleteAnnotations(ids: readonly UUID[]): Promise<void>;
  abstract saveDriveFolder(ownerId: UUID, folderId: string | null): Promise<void>;

  /**
   * One log per drafted comment, superseded in place when she changes her mind.
   * The store reuses the existing record's id, so this stays a plain upsert.
   *
   * Deliberately not deleted alongside its annotation: `target_id` carries no
   * foreign key, and the before/after pair is self-contained training data that
   * outlives the comment it came from.
   */
  abstract saveFeedbackLog(log: LearningFeedbackLog): Promise<void>;
}
