import { readDocxBlocks } from '../import/docx-blocks';
import { Injectable, inject } from '@angular/core';

import { DataStore } from '../data/data-store';
import { derivedId } from '../ids';
import {
  Assignment,
  Json,
  Student,
  Submission,
  SubmissionRound,
  SubmissionStatus,
} from '../models';
import { blocksToText, countWords, extractDocumentBlocks } from './docs-extract';
import { parseSubmissionName, searchPrefixes } from './file-name';
import { DOCX_MIME, DriveApi, DriveError } from './drive-api';
import {
  DriveFile,
  DriveMetadataSnapshot,
  GOOGLE_DOC_MIME,
  GOOGLE_FOLDER_MIME,
  GOOGLE_SHORTCUT_MIME,
} from './drive-types';
import { GoogleDriveAuth } from './google-auth';

/**
 * Why a file in the folder produced no submission.
 *
 * Carried rather than counted. "1 file was not attributed" tells her something
 * is wrong and nothing about what to do; each of these has a different fix, and
 * she is the only one who can apply it.
 */
export type UnmatchedReason =
  /** No student on the roster matches the name, and the account is unknown. */
  | 'no_student'
  /** A shortcut whose document is not shared with her. */
  | 'shortcut_unreadable'
  /** A second file naming a student who already has one this round. */
  | 'duplicate_student';

export interface UnmatchedFile {
  name: string;
  reason: UnmatchedReason;
}

/**
 * Where a listing came from.
 *
 * Not decoration: it decides whether a file may be attributed by its name and
 * whether failing to attribute it is worth telling her about. A file in the
 * year folder was put there on purpose; a document in "Shared with me" is
 * usually somebody else's paperwork.
 */
export type ListingSource = 'folder' | 'shared';

export interface SyncOutcome {
  created: number;
  updated: number;
  unchanged: number;
  /**
   * How many of those arrived by a student sharing the file directly, rather
   * than by moving it into the year folder.
   *
   * Counted separately because the two paths fail differently: an empty folder
   * and an unshared document look identical from the submissions list, and a
   * teacher who has just told a class "share it with me" needs to see whether
   * that worked.
   */
  shared: number;
  /** Files that produced no submission, and why. */
  unmatched: UnmatchedFile[];
  error: string | null;
}

/**
 * A document in her "Shared with me" that is not yet anyone's submission.
 *
 * Offered for her to point at, never ingested on its own. Nothing about a
 * shared file asserts that it is coursework — the year folder does, which is
 * why files found there may be matched on their name and these may not.
 */
export interface SharedCandidate {
  id: string;
  name: string;
  ownerEmail: string | null;
  /** Who pressed Share, when Drive says. Often the owner, not always. */
  sharedBy: string | null;
  modifiedAt: string | null;
  webViewLink: string | null;
  /**
   * The student the file name suggests.
   *
   * A suggestion and nothing more: it pre-selects a name in a list she
   * confirms. The same guess is not allowed to create a submission by itself.
   */
  suggestedStudentId: string | null;
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
 * Ownership is the reliable signal, and under the current Drive model it is a
 * strong one: each student keeps her own document and moves it into the year
 * folder, so the file's owner *is* her. A filename can be typed wrong, copied
 * from a friend's, or left as "עותק של…"; an account cannot.
 *
 * Name matching remains the fallback, because the owner's address only helps
 * once it has been recorded against the student — and it is recorded by the
 * teacher confirming it, never by the app assuming that whoever owns a file
 * matching a name must be that girl. Anything matching neither is reported
 * rather than guessed at: attributing a paper to the wrong student is worse
 * than asking.
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
 * Whose work a shared file is — by account only.
 *
 * The stricter half of `matchStudent`, and deliberately without its fallback.
 * A file in the year folder was *put* there: the folder is the teacher's own
 * assertion that everything in it is work for this course, so reading a
 * student's name off the file name is a reasonable last resort.
 *
 * Nothing about a shared document says any such thing. Her "Shared with me"
 * holds memos, colleagues' drafts and years of unrelated paperwork, and a name
 * match there would let a document called "נועה ברקוביץ׳ — הערכת מורה", shared
 * by a colleague, take over that student's submission and overwrite the text
 * her comments are anchored to. So a shared file is attributed only by an
 * address the teacher has confirmed belongs to that girl, and everything else
 * waits for her to say so.
 */
export function matchByAccount(file: DriveFile, students: readonly Student[]): Student | null {
  const owners = new Set(
    (file.owners ?? []).map((o) => o.emailAddress?.toLowerCase()).filter(Boolean),
  );
  if (!owners.size) return null;

  return (
    students.find(
      (s) => s.drive_account_email && owners.has(s.drive_account_email.toLowerCase()),
    ) ?? null
  );
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
  async describeFolder(
    folderId: string,
  ): Promise<{ name: string } | { error: string; detail?: string }> {
    try {
      const folder = await this.api.getFolder(folderId.trim());
      if (folder.mimeType !== GOOGLE_FOLDER_MIME) {
        return { error: 'המזהה הזה מצביע על קובץ, לא על תיקייה.' };
      }
      return { name: folder.name ?? folderId };
    } catch (error) {
      if (!(error instanceof DriveError)) {
        return { error: 'לא הצלחתי לבדוק את התיקייה.' };
      }
      // Google's own words alongside the Hebrew. Every wrong turn in
      // diagnosing this has come from reading a status code and guessing what
      // it meant; the reason string is right there and settles it.
      return { error: error.hebrew, detail: error.message };
    }
  }

  async syncNow(): Promise<SyncOutcome> {
    const empty: SyncOutcome = {
      created: 0,
      updated: 0,
      unchanged: 0,
      shared: 0,
      unmatched: [],
      error: null,
    };

    if (this.running) return { ...empty, error: 'סנכרון כבר רץ.' };

    /**
     * Nowhere to put the work.
     *
     * Every submission carries `assignment_id`, and it is a foreign key — so
     * syncing without one would write rows Postgres refuses, and because the
     * writes are fire-and-forget the files would appear on screen as synced.
     * Refused up front, and named, because the fix is one form on the course
     * screen and she cannot guess that from "משהו השתבש בסנכרון".
     */
    const assignment = this.store.assignment();
    if (!assignment) {
      return this.fail(empty, 'עדיין לא הוגדרה עבודה בקורס, ואין למה לצרף את הקבצים.');
    }

    const folderId = this.store.watchedFolderId();
    const accounts = this.confirmedAccounts();

    /**
     * Two ways in, and either one alone is enough to sync.
     *
     * A student can move her document into the year folder, or she can simply
     * press Share and type the teacher's address. The second produces a file
     * that is in no folder the teacher can see at all — `'folder' in parents`
     * will never find it, because it genuinely has no parent of hers — so it
     * is fetched from the `sharedWithMe` corpus instead.
     *
     * Which means "no folder chosen" is no longer a reason to refuse: a class
     * that only ever shares is a class Margin can read. The refusal now names
     * both sources, because being told to choose a folder when the real
     * problem is that no student's account has been confirmed sends her to fix
     * the wrong thing.
     */
    if (!folderId && !accounts.length && !this.store.students().length) {
      return this.fail(
        empty,
        'עדיין לא הוגדרה תיקייה בדרייב ואין תלמידות ברשימה — בלי אחד מהשניים אין מאיפה למשוך עבודות.',
      );
    }

    // Minting proves the connection is live: the server either has a usable
    // credential for this teacher or it doesn't, and a stale one can't linger
    // in the browser to give a false answer.
    const token = await this.auth.accessToken();
    if (!token) {
      return this.fail(empty, 'לא מחוברת לגוגל דרייב.');
    }

    this.running = true;
    this.store.setSyncState({ phase: 'syncing', message: null });

    const outcome: SyncOutcome = { ...empty };

    try {
      /**
       * Submissions already written to in this pass.
       *
       * Two files can name the same student — a draft and a final, say, or one
       * copy in the folder and another shared. The schema allows her exactly
       * one submission per assignment, so the second file has nowhere to go:
       * without this it would take the first one's row, and every sync would
       * flip the row between them and open a round each time. Reported as
       * unattributed instead, which is a thing she can see and fix.
       */
      const claimed = new Set<string>();
      /** Documents already handled this pass, by their own id. */
      const seen = new Set<string>();

      if (folderId) {
        await this.ingestListing(await this.api.listFolder(folderId), 'folder', {
          claimed,
          seen,
          outcome,
          assignment,
        });
      }

      if (accounts.length) {
        /**
         * Asked account by account, never "everything shared with me".
         *
         * The narrow query returns her students' work and nothing else, so an
         * ordinary sync never enumerates the rest of her shared Drive — which
         * is both far less noise and far less of her private surface read than
         * this app has any business touching.
         */
        await this.ingestListing(await this.api.listSharedByOwners(accounts), 'shared', {
          claimed,
          seen,
          outcome,
          assignment,
        });
      }

      /**
       * And the files named for a student, whoever shared them.
       *
       * The account query above only finds work from an address she has
       * already confirmed, which cannot be true of the first paper any girl
       * shares. This is how that one arrives: students are asked to name the
       * file `שם התלמידה - שם העבודה`, Drive returns the ones whose name
       * begins with a girl's, and `parseSubmissionName` refuses everything
       * that is not exactly that shape.
       */
      const prefixes = searchPrefixes(this.store.students());
      if (prefixes.length) {
        await this.ingestListing(await this.api.listSharedNamedAfter(prefixes), 'shared', {
          claimed,
          seen,
          outcome,
          assignment,
        });
      }

      this.store.setSyncState({
        phase: 'idle',
        last_synced_at: new Date().toISOString(),
        message: null,
        created: outcome.created,
        updated: outcome.updated,
        shared: outcome.shared,
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

  /**
   * Documents she has been shared, for her to point at one and say whose it is.
   *
   * The bootstrap, and the only call in the app that reads her shared surface
   * broadly. It exists because the automatic path above can only find work
   * from an address already confirmed against a student — so the very first
   * document a girl shares, from an account Margin has never seen, would
   * otherwise be invisible with nothing on screen to say why.
   *
   * Files that are already submissions are dropped: they are being synced and
   * there is nothing to attach.
   */
  async listSharedWithMe(): Promise<{ candidates: SharedCandidate[]; error: string | null }> {
    try {
      const files = await this.api.listSharedDocuments();
      const students = this.store.students();

      const candidates = files
        .filter((file) => file.id && !this.store.submissionByDriveFile(file.id))
        .map<SharedCandidate>((file) => ({
          id: file.id,
          name: file.name ?? file.id,
          ownerEmail: file.owners?.[0]?.emailAddress ?? null,
          sharedBy: file.sharingUser?.emailAddress ?? file.owners?.[0]?.emailAddress ?? null,
          modifiedAt: file.modifiedTime ?? null,
          webViewLink: file.webViewLink ?? null,
          suggestedStudentId: matchStudent(file, students)?.id ?? null,
        }));

      return { candidates, error: null };
    } catch (error) {
      const message =
        error instanceof DriveError ? error.hebrew : 'לא הצלחתי לקרוא את המסמכים ששותפו איתך.';
      return { candidates: [], error: message };
    }
  }

  /**
   * She says this shared document is that student's work.
   *
   * The one place a shared file becomes a submission without an account match,
   * and it is her saying so rather than the app guessing. The owner's address
   * is recorded against the student at the same time — which is what turns
   * this into a one-off: from the next sync on, everything that account shares
   * is found automatically.
   *
   * An address already on file is left alone. Overwriting it silently would
   * quietly redirect every future match for that girl, and she may well be
   * handing in from a second account.
   */
  async attachShared(fileId: string, studentId: string): Promise<{ error: string | null }> {
    const student = this.store.students().find((s) => s.id === studentId);
    if (!student) return { error: 'לא מצאתי את התלמידה הזו ברשימה.' };

    const assignment = this.store.assignment();
    if (!assignment) return { error: 'עדיין לא הוגדרה עבודה בקורס.' };

    try {
      const listed = await this.api.getFile(fileId);
      const file = await this.resolveShortcut(listed);
      if (!file) {
        return {
          error: 'זה קיצור דרך למסמך שאין לי גישה אליו. התלמידה צריכה לשתף את המסמך עצמו.',
        };
      }

      const owner = file.owners?.[0]?.emailAddress?.trim();
      if (owner && !student.drive_account_email) {
        this.store.setStudentDriveAccount(studentId, owner);
      }

      await this.ingest(file, new Set(), 'shared', assignment, studentId);
      this.store.setSyncState({ last_synced_at: new Date().toISOString(), message: null });
      return { error: null };
    } catch (error) {
      const message =
        error instanceof DriveError ? error.hebrew : 'לא הצלחתי לצרף את המסמך לתלמידה.';
      this.store.setSyncState({ phase: 'error', message });
      return { error: message };
    }
  }

  /** Student Drive accounts she has confirmed. The shared query's whole input. */
  private confirmedAccounts(): string[] {
    return this.store.confirmedDriveAccounts();
  }

  /**
   * Turns one listing into submissions.
   *
   * Shared by both sources, and told which it is — because what a file's
   * presence *means* differs between them, and two things follow from that.
   * Attribution: a folder file may be matched on its name, a shared one may
   * not (see `matchByAccount`). And reporting: a file in the year folder that
   * produced nothing is a problem she should see, while an unattributable
   * document in her shared list is just someone else's paperwork and belongs
   * in no error list.
   */
  private async ingestListing(
    listing: readonly DriveFile[],
    source: ListingSource,
    context: {
      claimed: Set<string>;
      seen: Set<string>;
      outcome: SyncOutcome;
      assignment: Assignment;
    },
  ): Promise<void> {
    const { claimed, seen, outcome, assignment } = context;

    for (const listed of listing) {
      // Folders nested inside the watched folder are not submissions.
      if (listed.mimeType === GOOGLE_FOLDER_MIME) continue;

      /**
       * A student can hand work in three ways: move the file into the folder,
       * leave a shortcut to it there, or share the document itself. A shortcut
       * is its own file with its own mime type and no text — taken at face
       * value it produces a submission with an empty document and nothing to
       * say why. Followed to the target, it is the work.
       */
      const file = await this.resolveShortcut(listed);
      if (!file) {
        outcome.unmatched.push({
          name: listed.name ?? listed.id ?? '',
          reason: 'shortcut_unreadable',
        });
        continue;
      }

      /**
       * The same document reached both ways.
       *
       * A student who shares her paper *and* drops it in the folder is doing
       * as she was asked, twice. Without this the second sighting would look
       * like a second file for a student who already has one, and be reported
       * to the teacher as a clash she has to go and resolve.
       */
      if (seen.has(file.id)) continue;
      seen.add(file.id);

      const result = await this.ingest(file, claimed, source, assignment);

      if (result === 'created' || result === 'updated') {
        if (result === 'created') outcome.created++;
        else outcome.updated++;
        if (source === 'shared') outcome.shared++;
        continue;
      }

      if (result === 'unchanged') {
        outcome.unchanged++;
        continue;
      }

      /**
       * Nobody claimed this was coursework.
       *
       * The narrow shared query asks by owner, so this should not happen at
       * all — but if Drive ever returns something outside it, the honest
       * response is to leave it alone, not to tell her a colleague's memo
       * failed to attribute. Every other reason is still reported: a shared
       * file that *is* a student's and still produced nothing is exactly the
       * kind of thing she needs to see.
       */
      if (result === 'no_student' && source === 'shared') continue;

      outcome.unmatched.push({ name: file.name ?? file.id, reason: result });
    }
  }

  /**
   * The document a listing entry stands for.
   *
   * Returns the entry itself when it is already a file, the target when it is a
   * shortcut, and null when the target cannot be read — which happens when the
   * student shared the shortcut but not the document behind it. That last case
   * is reported as unattributed rather than stored as an empty submission,
   * because "she shared the wrong thing" is something the teacher can fix and
   * an empty document is not something she can diagnose.
   */
  private async resolveShortcut(file: DriveFile): Promise<DriveFile | null> {
    if (file.mimeType !== GOOGLE_SHORTCUT_MIME) return file;

    const targetId = file.shortcutDetails?.targetId;
    if (!targetId) return null;

    try {
      const target = await this.api.getFile(targetId);
      // The shortcut's name is the one the teacher sees in the folder, and it
      // is what `matchStudent` reads — a student who renamed the shortcut
      // rather than the document should still be found.
      return { ...target, name: target.name ?? file.name };
    } catch (error) {
      if (
        error instanceof DriveError &&
        (error.kind === 'forbidden' || error.kind === 'not_found')
      ) {
        return null;
      }
      throw error;
    }
  }

  // -- one file -------------------------------------------------------------

  private async ingest(
    file: DriveFile,
    claimed: Set<string>,
    source: ListingSource,
    assignment: Assignment,
    assumeStudentId?: string,
  ): Promise<'created' | 'updated' | 'unchanged' | UnmatchedReason> {
    const existing = this.store.submissionByDriveFile(file.id);

    if (existing) claimed.add(existing.id);

    if (!existing) {
      /**
       * Whose work this is, decided differently by where it came from.
       *
       * `assumeStudentId` is the teacher having said so outright, and beats
       * both. Otherwise a file in the year folder may fall back to its name —
       * the folder is her assertion that it is coursework — while a shared
       * document may only be matched on a confirmed account, because nothing
       * about being shared says the document is a paper at all.
       */
      const students = this.store.students();
      const student = assumeStudentId
        ? (students.find((s) => s.id === assumeStudentId) ?? null)
        : source === 'shared'
          ? // The account she confirmed is the stronger signal and is tried
            // first; the naming convention is what carries a girl's very first
            // paper, before any account is on file.
            (matchByAccount(file, students) ??
            parseSubmissionName(file.name, students)?.student ??
            null)
          : matchStudent(file, students);
      if (!student) return 'no_student';

      /**
       * She may already have a row for this girl under a different file.
       *
       * `submissions` is unique on `(assignment_id, student_id)`, and that is
       * the domain rule: one submission per student per assignment. Looking a
       * file up by `drive_file_id` alone misses every row whose file id is not
       * this one — a paper she deleted and re-uploaded, or one that arrived
       * from the folder and is now being shared from a second account. The
       * sync then inserted a second row for the same pair and Postgres refused
       * it; because writes are fire-and-forget the file still appeared on
       * screen as synced, and the round that referenced the submission failed
       * its `owns_submission` check — which reads as a permissions error
       * rather than as a missing parent.
       */
      const hers = this.store.submissionFor(assignment.id, student.id);
      if (hers) {
        // A second file naming the same student. She gets one submission per
        // assignment, so this one is surfaced rather than fought over.
        if (claimed.has(hers.id)) return 'duplicate_student';

        claimed.add(hers.id);
        await this.update(file, hers, { adopting: true });
        return 'updated';
      }

      await this.create(file, student.id, assignment);
      return 'created';
    }

    /**
     * Nothing has moved in Drive since the last look.
     *
     * Drive's `version` bumps on any change, including ones that don't touch
     * the text; `modifiedTime` is the one the teacher would recognise.
     *
     * A row with no round is **not** up to date, though — it is half-written,
     * and saying "unchanged" strands it that way for good. The submission and
     * its first round are two separate writes, and the second can fail on its
     * own: a refused round leaves a submission carrying the file's
     * `modifiedTime` and no text at all, so every later sync would skip it
     * here and the paper would never be readable. This is the only path back.
     */
    const unchanged =
      !!existing.drive_modified_at &&
      !!file.modifiedTime &&
      existing.drive_modified_at === file.modifiedTime &&
      !!this.store.roundFor(existing.id);

    if (unchanged) return 'unchanged';

    await this.update(file, existing);
    return 'updated';
  }

  private async create(file: DriveFile, studentId: string, assignment: Assignment) {
    const { revisions, truncated } = await this.api.listRevisions(file.id);
    const now = new Date().toISOString();
    // A UUID, because `submissions.id` is one. It used to be `sub-<fileId>`,
    // which every write rejected outright — and because writes are
    // fire-and-forget, the record sat on screen looking saved.
    const submissionId = derivedId('submission', file.id);

    const document = await this.readDocument(file);

    const submission: Submission = {
      id: submissionId,
      assignment_id: assignment.id,
      student_id: studentId,
      status: 'new',
      current_round: 1,
      /**
       * What she called the paper, when the file name says.
       *
       * `שם התלמידה - שם העבודה` carries a title the teacher never has to type,
       * and it is the student's own words for her work. A file named any other
       * way leaves this null rather than having a title invented for it.
       */
      title: parseSubmissionName(file.name, this.store.students())?.work ?? null,
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
      // Neither mark exists until she types it. Null, never zero.
      presentation_score: null,
      ongoing_score: null,
      created_at: now,
      updated_at: file.modifiedTime ?? now,
    };

    this.store.addSubmission(submission);
    this.store.addRound(this.buildRound(submissionId, 1, document, file));
  }

  private async update(
    file: DriveFile,
    existing: Submission,
    options: { adopting?: boolean } = {},
  ) {
    const { revisions, truncated } = await this.api.listRevisions(file.id);
    const now = new Date().toISOString();
    const document = await this.readDocument(file);

    const current = this.store.roundFor(existing.id);

    /**
     * When the captured text may not be overwritten.
     *
     * Two cases. Once notes have gone out, a further edit by the student is
     * the next round — the annotated round must stay exactly as she left it.
     *
     * And: anything already anchored to the current round. This used to be
     * assumed rather than checked ("nothing has been annotated against it
     * yet"), which stopped being true the moment comments could be drafted
     * before sending. Replacing the text under a comment does not delete it —
     * it leaves it anchored to character offsets in a document that no longer
     * says that, which is the failure the quote locator exists to refuse. It
     * must not be manufactured here.
     */
    const annotated = !!current && this.store.roundIsAnnotated(current.id);
    const opensNewRound =
      existing.status === 'notes_sent' || existing.status === 'student_revised' || annotated;

    const status: SubmissionStatus = opensNewRound ? 'resubmitted' : existing.status;
    const round = opensNewRound ? existing.current_round + 1 : existing.current_round;

    this.store.updateSubmission(existing.id, {
      status,
      current_round: round,
      /**
       * Stamped when a real file first lands on a row that had none.
       *
       * `drive_created_at` and the mime type belong here rather than in the
       * ordinary update below, which preserves what it already has: an adopted
       * row still carries the previous document's dates, and leaving those on
       * a new file would mislead the reliability work that compares them
       * against the revision history.
       */
      ...(options.adopting
        ? {
            drive_file_id: file.id,
            drive_mime_type: file.mimeType ?? existing.drive_mime_type,
            drive_created_at: file.createdTime ?? existing.drive_created_at,
          }
        : {}),
      /**
       * The name she gave the paper, kept in step with the file.
       *
       * Set here as well as on creation, because a row is just as often
       * adopted as created — she already had a submission and the file has
       * only now arrived. A file renamed away from the convention keeps the
       * title it had rather than losing it.
       */
      title: parseSubmissionName(file.name, this.store.students())?.work ?? existing.title,
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

    // Still on the same round, and nothing anchored to it: refresh the captured
    // text in place. There is no history to protect.
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

    /**
     * An existing round for this number keeps its id.
     *
     * `submission_rounds` is unique on `(submission_id, round_number)`. Minting
     * a derived id without asking produces a *second* row for the same round —
     * which Postgres refuses, taking the document text down with it. The row
     * that already exists is the round; this updates it.
     */
    const existing = this.store.round(submissionId, roundNumber);

    return {
      id: existing?.id ?? derivedId('round', `${submissionId}:${roundNumber}`),
      submission_id: submissionId,
      round_number: roundNumber,
      document_text: document?.text ?? null,
      document_blocks: document?.blocks ?? null,
      drive_revision_id: document?.revisionId ?? null,
      received_at: file.modifiedTime ?? now,
      scoring: null,
      notes_sent_at: null,
      ai_summary: null,
      ai_summary_confirmed_at: null,
      // The round's own age, when it already had one.
      created_at: existing?.created_at ?? now,
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
    if (file.mimeType === GOOGLE_DOC_MIME) {
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

    /**
     * A Word file in her folder.
     *
     * These were always listed — `.docx` is in `DOCUMENT_MIMES` and the row
     * appeared — and then read as nothing, because this method returned null
     * for anything that was not a Google Doc. The paper sat in the list with a
     * name and no text, and every screen downstream needs `document_blocks`:
     * no drafting, no scoring, no review. A student who exports from Word
     * rather than writing in Docs was invisible to the whole app.
     *
     * The Docs API cannot open one, so the bytes are downloaded and parsed
     * here with the same reader the style import uses.
     */
    if (file.mimeType === DOCX_MIME) {
      const blocks = await readDocxBlocks(await this.api.downloadFile(file.id));
      if (blocks.length === 0) return null;

      return {
        blocks,
        text: blocksToText(blocks),
        wordCount: countWords(blocks),
        // Drive versions a binary file, but its revision id is not the Docs
        // one and nothing here compares them. Null rather than a value that
        // looks like the other kind.
        revisionId: null,
      };
    }

    // `.doc` reaches here. It is a different format entirely — not a zip, not
    // XML — and is left unread rather than half-read.
    return null;
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
