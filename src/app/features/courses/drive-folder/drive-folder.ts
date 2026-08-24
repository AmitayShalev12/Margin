import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { GoogleDriveAuth } from '../../../core/drive/google-auth';
import { SharedCandidate, SyncService, UnmatchedReason } from '../../../core/drive/sync';
import { relativeDay } from '../../../core/presentation/submission-status';

/**
 * What to do about a file the sync could not turn into a submission.
 *
 * Three different problems that all used to arrive as the same number. The
 * wording says what to change, because none of these is something the app can
 * resolve on her behalf without guessing whose work a paper is.
 */
const UNMATCHED_REASON: Record<UnmatchedReason, string> = {
  no_student:
    'לא זיהיתי לפי שם הקובץ לאיזו תלמידה הוא שייך. אפשר לשנות את שם הקובץ כך שיכיל את שמה המלא, או לאשר את חשבון הדרייב שלה כאן למעלה.',
  shortcut_unreadable:
    'זה קיצור דרך למסמך שאין לי גישה אליו. התלמידה צריכה לשתף את המסמך עצמו, או להעביר אותו לתיקייה במקום קיצור דרך.',
  duplicate_student:
    'כבר שויך קובץ אחר לאותה תלמידה בסבב הזה — אולי אחד בתיקייה ואחד בשיתוף. אפשר להשאיר רק אחד, או לשנות שם כדי שיהיה ברור מי כתבה מה.',
};

/**
 * Connecting Google Drive and pointing the course at a folder.
 *
 * It sits on the course screen because that is where the rest of "what this
 * course is made of" lives, and it stays one card: connect, name a folder,
 * and a line saying when work last came in.
 */
@Component({
  selector: 'app-drive-folder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drive-folder.html',
  styleUrl: './drive-folder.scss',
})
export class DriveFolder {
  private readonly store = inject(DataStore);
  private readonly sync = inject(SyncService);
  protected readonly auth = inject(GoogleDriveAuth);

  protected readonly folderId = computed(() => this.store.course()?.drive_folder_id ?? null);

  /**
   * Addresses seen on submissions, waiting for her to say whose they are.
   *
   * Each student now owns the document she hands in, so her Drive account is
   * the one thing about a file that cannot be mistyped. Recording it turns
   * every later sync from a filename guess into a certainty — but only she can
   * say the address is really that girl's, so it is asked rather than assumed.
   */
  protected readonly unconfirmedAccounts = computed(() => this.store.observedAccounts());

  /**
   * The files that produced nothing, named and explained.
   *
   * A count on its own — "1 קבצים לא שויכו" — reports that something is wrong
   * and withholds everything needed to fix it. Each reason has a different
   * remedy and only she can apply any of them.
   */
  protected readonly unmatched = computed(() =>
    this.syncState().unmatched.map((file) => ({
      name: file.name,
      why: UNMATCHED_REASON[file.reason],
    })),
  );

  /** Hebrew agreement: one file is not "1 קבצים". */
  protected readonly unmatchedLabel = computed(() => {
    const n = this.syncState().unmatched.length;
    if (n === 1) return 'קובץ אחד לא שויך לתלמידה';
    if (n === 2) return 'שני קבצים לא שויכו לתלמידה';
    return `${n} קבצים לא שויכו לתלמידה`;
  });
  protected readonly syncState = this.store.sync;

  /**
   * The second way work arrives: a student presses Share instead of moving her
   * file into the year folder.
   *
   * Kept behind a button rather than run on load. This is the one call that
   * reads her shared documents broadly rather than asking about named
   * accounts, and a thing like that should happen because she asked for it,
   * from a screen that says what it is about to look at.
   */
  protected readonly sharedOpen = signal(false);
  protected readonly sharedLoading = signal(false);
  protected readonly sharedError = signal<string | null>(null);
  protected readonly sharedFiles = signal<SharedCandidate[]>([]);
  /** File id → the student she picked for it, before she presses attach. */
  protected readonly chosen = signal<Record<string, string>>({});
  protected readonly attaching = signal<string | null>(null);
  protected readonly attachError = signal<string | null>(null);

  /** Who a document can be attributed to. */
  protected readonly roster = computed(() => this.store.students().filter((s) => s.active));

  /** Syncing needs a folder or a confirmed account — either one will do. */
  protected readonly canSync = computed(
    () => !!this.folderId() || this.store.confirmedDriveAccounts().length > 0,
  );

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly checking = signal(false);
  protected readonly checkError = signal<string | null>(null);
  /** Google's raw reason, shown small — what makes a failure diagnosable. */
  protected readonly checkDetail = signal<string | null>(null);
  /** The id actually read out of whatever she pasted. */
  protected readonly checkedId = signal<string | null>(null);

  protected readonly supabaseReady = this.auth.canConnect;
  protected readonly connecting = this.auth.busy;
  protected readonly googleEmail = this.auth.googleEmail;

  /** She confirms the address belongs to that student. */
  protected confirmAccount(studentId: string, email: string) {
    this.store.setStudentDriveAccount(studentId, email);
  }

  protected readonly lastSyncedLabel = computed(() => {
    const at = this.syncState().last_synced_at;
    if (!at) return 'עדיין לא סונכרן';
    const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
    if (minutes < 1) return 'סונכרן הרגע';
    if (minutes < 60) return `סונכרן לפני ${minutes} דקות`;
    return `סונכרן ${relativeDay(at)}`;
  });

  constructor() {
    // The connection lives on the server, so the card asks rather than
    // reading anything local. Also picks up the ?drive=connected redirect
    // Google sends us back with.
    void this.auth.refreshStatus().then(() => this.clearRedirectParams());
  }

  protected connect() {
    void this.auth.connect();
  }

  protected disconnect() {
    void this.auth.disconnect();
  }

  protected startEdit() {
    this.draft.set(this.folderId() ?? '');
    this.checkError.set(null);
    this.editing.set(true);
  }

  protected cancelEdit() {
    this.editing.set(false);
    this.checkError.set(null);
  }

  /**
   * Checks the folder exists before saving it. A mistyped id that silently
   * saved would look identical to an empty folder, and she would have no way
   * to tell which it was.
   */
  protected async save() {
    const id = extractFolderId(this.draft());
    if (!id) {
      this.checkError.set('צריך להדביק כאן קישור לתיקייה בדרייב, או את המזהה שלה.');
      return;
    }

    this.checking.set(true);
    this.checkError.set(null);
    this.checkDetail.set(null);
    this.checkedId.set(null);

    const result = await this.sync.describeFolder(id);
    this.checking.set(false);

    if ('error' in result) {
      this.checkError.set(result.error);
      this.checkDetail.set(result.detail ?? null);
      // Which id came out of the link matters: a URL copied from a browser
      // signed into a second Google account points at a folder this
      // connection cannot see, and looks identical to a permissions problem.
      this.checkedId.set(id);
      return;
    }

    const course = this.store.course();
    if (!course) return;

    this.store.setDriveFolder(course.id, id);
    this.editing.set(false);
    void this.sync.syncNow();
  }

  protected async syncNow() {
    await this.sync.syncNow();
  }

  protected toggleShared() {
    const open = !this.sharedOpen();
    this.sharedOpen.set(open);
    if (open && !this.sharedFiles().length) void this.loadShared();
  }

  protected async loadShared() {
    this.sharedLoading.set(true);
    this.attachError.set(null);

    const { candidates, error } = await this.sync.listSharedWithMe();

    this.sharedLoading.set(false);
    this.sharedError.set(error);
    this.sharedFiles.set(candidates);

    // The name match pre-selects, and does nothing else. It is a starting
    // point for her to correct, never an attribution in its own right.
    this.chosen.update((current) => {
      const next = { ...current };
      for (const candidate of candidates) {
        if (!next[candidate.id] && candidate.suggestedStudentId) {
          next[candidate.id] = candidate.suggestedStudentId;
        }
      }
      return next;
    });
  }

  protected choose(fileId: string, studentId: string) {
    this.chosen.update((current) => ({ ...current, [fileId]: studentId }));
  }

  protected studentFor(fileId: string): string {
    return this.chosen()[fileId] ?? '';
  }

  /** She has said whose document this is; Margin records it and reads it in. */
  protected async attach(candidate: SharedCandidate) {
    const studentId = this.studentFor(candidate.id);
    if (!studentId) return;

    this.attaching.set(candidate.id);
    this.attachError.set(null);

    const { error } = await this.sync.attachShared(candidate.id, studentId);

    this.attaching.set(null);
    if (error) {
      this.attachError.set(error);
      return;
    }

    // Gone from the list because it is now a submission, not because the list
    // was refreshed and it happened not to come back.
    this.sharedFiles.update((files) => files.filter((f) => f.id !== candidate.id));
  }

  /** Tidies `?drive=connected` out of the address bar after the round trip. */
  private clearRedirectParams() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('drive')) return;
    url.searchParams.delete('drive');
    url.searchParams.delete('drive_error');
    window.history.replaceState({}, '', url.toString());
  }
}

/**
 * Accepts either a bare folder id or a pasted Drive URL. Teachers copy the
 * address bar, not the id — asking them to extract it themselves is the kind
 * of small cruelty that makes a tool feel hostile.
 */
export function extractFolderId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const fromUrl = /\/folders\/([a-zA-Z0-9_-]+)/.exec(text);
  if (fromUrl) return fromUrl[1];

  const fromQuery = /[?&]id=([a-zA-Z0-9_-]+)/.exec(text);
  if (fromQuery) return fromQuery[1];

  // A bare id: Drive ids are long, opaque and have no spaces or slashes.
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;

  return null;
}
