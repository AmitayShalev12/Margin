import { Injectable, inject } from '@angular/core';

import { DataStore } from '../data/data-store';
import { Json, Student, Submission, SubmissionRound, SubmissionStatus } from '../models';
import { blocksToText, countWords, extractDocumentBlocks } from './docs-extract';
import { DriveApi, DriveError } from './drive-api';
import { DriveFile, DriveMetadataSnapshot, GOOGLE_DOC_MIME } from './drive-types';
import { GoogleDriveAuth } from './google-auth';

export interface SyncOutcome {
  created: number;
  updated: number;
  unchanged: number;
  /** File names that could not be attributed to a student on the roster. */
  unmatched: string[];
  error: string | null;
}

/**
 * Strips punctuation and Hebrew geresh variants so `נועה ברקוביץ׳` and
 * `Noa_Berkovich` style file names can both be compared on their word parts.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’׳״"']/g, '')
    .replace(/[._\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Works out whose work a file is.
 *
 * Ownership is the reliable signal — the file's owner is the account that
 * created it in the shared folder. Name matching is the fallback for the
 * common case where students hand in from an account the teacher hasn't
 * recorded yet. Anything that matches neither is reported rather than guessed
 * at: attributing a paper to the wrong student is worse than asking.
 */
export function matchStudent(file: DriveFile, students: readonly Student[]): Student | null {
  const ownerEmails = new Set(
    (file.owners ?? []).map((o) => o.emailAddress?.toLowerCase()).filter(Boolean),
  );

  const byAccount = students.find(
    (s) => s.drive_account_email && ownerEmails.has(s.drive_account_email.toLowerCase()),
  );
  if (byAccount) return byAccount;

  const haystack = normalise(file.name ?? '');
  if (!haystack) return null;

  const candidates = students.filter((s) => {
    const parts = normalise(s.full_name).split(' ').filter(Boolean);
    // Every part of the name has to appear, so "יעל" alone can't claim a file
    // belonging to "יעל דהן" when both are on the roster.
    return parts.length > 0 && parts.every((p) => haystack.includes(p));
  });

  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Builds the metadata blob stored on the submission.
 *
 * Round-tripped through JSON so what lands in the `jsonb` column is exactly
 * what a Postgres round trip would return — `undefined` fields dropped rather
 * than silently becoming nulls later.
 */
function snapshot(
  file: DriveFile,
  revisions: DriveMetadataSnapshot['revisions'],
  truncated: boolean,
): Json {
  const raw: DriveMetadataSnapshot = {
    captured_at: new Date().toISOString(),
    file,
    revisions,
    revisions_truncated: truncated,
  };
  return JSON.parse(JSON.stringify(raw)) as Json;
}

/**
 * Pulls the watched Drive folder into `Submission` records.
 *
 * What it does not do: interpret any of it. Creator, owner, timestamps and
 * revision history are captured verbatim onto the submission for Phase 5 to
 * analyse — this service draws no conclusions from them.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(DriveApi);
  private readonly auth = inject(GoogleDriveAuth);
  private readonly store = inject(DataStore);

  private running = false;

  /** Confirms a folder id before it is saved, returning its name. */
  async describeFolder(folderId: string): Promise<{ name: string } | { error: string }> {
    try {
      const folder = await this.api.getFolder(folderId.trim());
      if (folder.mimeType !== 'application/vnd.google-apps.folder') {
        return { error: 'המזהה הזה מצביע על קובץ, לא על תיקייה.' };
      }
      return { name: folder.name ?? folderId };
    } catch (error) {
      return { error: error instanceof DriveError ? error.hebrew : 'לא הצלחתי לבדוק את התיקייה.' };
    }
  }

  async syncNow(): Promise<SyncOutcome> {
    const empty: SyncOutcome = { created: 0, updated: 0, unchanged: 0, unmatched: [], error: null };

    if (this.running) return { ...empty, error: 'סנכרון כבר רץ.' };

    const folderId = this.store.watchedFolderId();
    if (!folderId) {
      return this.fail(empty, 'עדיין לא הוגדרה תיקייה בדרייב.');
    }
    // Expiry is evaluated lazily, so re-read the clock before trusting the
    // token — otherwise a tab left open all morning reports itself connected.
    this.auth.refreshClock();
    if (!this.auth.isConnected()) {
      return this.fail(
        empty,
        this.auth.isExpired() ? 'החיבור לגוגל פג. צריך להתחבר מחדש.' : 'לא מחוברת לגוגל דרייב.',
      );
    }

    this.running = true;
    this.store.setSyncState({ phase: 'syncing', message: null });

    const outcome: SyncOutcome = { ...empty };

    try {
      const files = await this.api.listFolder(folderId);

      for (const file of files) {
        // Folders nested inside the watched folder are not submissions.
        if (file.mimeType === 'application/vnd.google-apps.folder') continue;

        const result = await this.ingest(file);
        if (result === 'created') outcome.created++;
        else if (result === 'updated') outcome.updated++;
        else if (result === 'unmatched') outcome.unmatched.push(file.name ?? file.id);
        else outcome.unchanged++;
      }

      this.store.setSyncState({
        phase: 'idle',
        last_synced_at: new Date().toISOString(),
        message: null,
        created: outcome.created,
        updated: outcome.updated,
        unmatched: outcome.unmatched,
      });
      return outcome;
    } catch (error) {
      const message = error instanceof DriveError ? error.hebrew : 'משהו השתבש בסנכרון מהדרייב.';
      return this.fail(outcome, message);
    } finally {
      this.running = false;
    }
  }

  // -- one file -------------------------------------------------------------

  private async ingest(
    file: DriveFile,
  ): Promise<'created' | 'updated' | 'unchanged' | 'unmatched'> {
    const existing = this.store.submissionByDriveFile(file.id);

    if (!existing) {
      const student = matchStudent(file, this.store.students);
      if (!student) return 'unmatched';
      await this.create(file, student.id);
      return 'created';
    }

    // Drive's `version` bumps on any change, including ones that don't touch
    // the text; `modifiedTime` is the one the teacher would recognise.
    const unchanged =
      !!existing.drive_modified_at &&
      !!file.modifiedTime &&
      existing.drive_modified_at === file.modifiedTime;

    if (unchanged) return 'unchanged';

    await this.update(file, existing);
    return 'updated';
  }

  private async create(file: DriveFile, studentId: string) {
    const { revisions, truncated } = await this.api.listRevisions(file.id);
    const now = new Date().toISOString();
    const submissionId = `sub-${file.id}`;

    const document = await this.readDocument(file);

    const submission: Submission = {
      id: submissionId,
      assignment_id: this.store.assignment().id,
      student_id: studentId,
      status: 'new',
      current_round: 1,
      title: null,
      drive_file_id: file.id,
      drive_file_name: file.name ?? null,
      drive_mime_type: file.mimeType ?? null,
      drive_web_view_link: file.webViewLink ?? null,
      drive_owner_email: file.owners?.[0]?.emailAddress ?? null,
      // Drive has no "created by" field; the earliest revision's editor is the
      // closest honest stand-in, and the raw history is stored either way.
      drive_creator_email: revisions[0]?.lastModifyingUser?.emailAddress ?? null,
      drive_created_at: file.createdTime ?? null,
      drive_modified_at: file.modifiedTime ?? null,
      drive_revision_count: revisions.length || null,
      drive_metadata_raw: snapshot(file, revisions, truncated),
      last_synced_at: now,
      word_count: document?.wordCount ?? null,
      created_at: now,
      updated_at: file.modifiedTime ?? now,
    };

    this.store.addSubmission(submission);
    this.store.addRound(this.buildRound(submissionId, 1, document, file));
  }

  private async update(file: DriveFile, existing: Submission) {
    const { revisions, truncated } = await this.api.listRevisions(file.id);
    const now = new Date().toISOString();
    const document = await this.readDocument(file);

    // Once notes have gone out, a further edit by the student is the next
    // round — the annotated round must stay exactly as she left it.
    const opensNewRound = existing.status === 'notes_sent' || existing.status === 'student_revised';
    const status: SubmissionStatus = opensNewRound ? 'resubmitted' : existing.status;
    const round = opensNewRound ? existing.current_round + 1 : existing.current_round;

    this.store.updateSubmission(existing.id, {
      status,
      current_round: round,
      drive_file_name: file.name ?? existing.drive_file_name,
      drive_web_view_link: file.webViewLink ?? existing.drive_web_view_link,
      drive_owner_email: file.owners?.[0]?.emailAddress ?? existing.drive_owner_email,
      drive_creator_email:
        revisions[0]?.lastModifyingUser?.emailAddress ?? existing.drive_creator_email,
      drive_modified_at: file.modifiedTime ?? existing.drive_modified_at,
      drive_revision_count: revisions.length || existing.drive_revision_count,
      drive_metadata_raw: snapshot(file, revisions, truncated),
      last_synced_at: now,
      word_count: document?.wordCount ?? existing.word_count,
    });

    if (opensNewRound) {
      this.store.addRound(this.buildRound(existing.id, round, document, file));
      return;
    }

    // Still on the same round: refresh the captured text in place. Nothing has
    // been annotated against it yet, so there is no history to protect.
    const current = this.store.roundFor(existing.id);
    if (current && document) {
      this.store.replaceRoundDocument(current.id, {
        document_text: document.text,
        document_blocks: document.blocks,
        drive_revision_id: revisions.at(-1)?.id ?? current.drive_revision_id,
        received_at: file.modifiedTime ?? current.received_at,
      });
    } else if (!current) {
      this.store.addRound(this.buildRound(existing.id, round, document, file));
    }
  }

  private buildRound(
    submissionId: string,
    roundNumber: number,
    document: ExtractedDocument | null,
    file: DriveFile,
  ): SubmissionRound {
    const now = new Date().toISOString();
    return {
      id: `round-${submissionId}-${roundNumber}`,
      submission_id: submissionId,
      round_number: roundNumber,
      document_text: document?.text ?? null,
      document_blocks: document?.blocks ?? null,
      drive_revision_id: document?.revisionId ?? null,
      received_at: file.modifiedTime ?? now,
      notes_sent_at: null,
      ai_summary: null,
      ai_summary_confirmed_at: null,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Reads the document's text, but only for Google Docs.
   *
   * A `.docx` sitting in Drive has metadata worth capturing but no structure
   * we can read without converting it, so its submission is created with the
   * text left null rather than with a mangled approximation of it.
   */
  private async readDocument(file: DriveFile): Promise<ExtractedDocument | null> {
    if (file.mimeType !== GOOGLE_DOC_MIME) return null;

    const doc = await this.api.getDocument(file.id);
    const blocks = extractDocumentBlocks(doc);
    if (blocks.length === 0) return null;

    return {
      blocks,
      text: blocksToText(blocks),
      wordCount: countWords(blocks),
      revisionId: doc.revisionId ?? null,
    };
  }

  private fail(outcome: SyncOutcome, message: string): SyncOutcome {
    this.store.setSyncState({ phase: 'error', message });
    return { ...outcome, error: message };
  }
}

interface ExtractedDocument {
  blocks: ReturnType<typeof extractDocumentBlocks>;
  text: string;
  wordCount: number;
  revisionId: string | null;
}
