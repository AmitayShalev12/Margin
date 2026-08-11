import { Annotation, Submission, SubmissionRound, UUID } from '../models';

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
}

export const EMPTY_SNAPSHOT: PersistedSnapshot = {
  submissions: [],
  rounds: [],
  annotations: [],
  driveFolders: {},
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
  abstract saveDriveFolder(ownerId: UUID, folderId: string | null): Promise<void>;
}
