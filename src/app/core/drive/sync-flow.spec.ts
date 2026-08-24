import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { COURSE, seedId } from '../mock/seed-data';
import { seedStore } from '../mock/seed-store';
import { DriveApi, DriveError } from './drive-api';
import {
  DocsDocument,
  DriveFile,
  DriveMetadataSnapshot,
  DriveRevision,
  GOOGLE_DOC_MIME,
} from './drive-types';
import { GoogleDriveAuth } from './google-auth';
import { SyncService } from './sync';

const FOLDER = 'folder-123';

function docFile(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: 'file-noa',
    name: 'נועה ברקוביץ׳ — סמינריון',
    mimeType: 'application/vnd.google-apps.document',
    webViewLink: 'https://docs.google.com/document/d/file-noa/edit',
    createdTime: '2026-07-01T08:00:00.000Z',
    modifiedTime: '2026-08-01T08:00:00.000Z',
    owners: [{ emailAddress: 'noa@school.org.il', displayName: 'נועה' }],
    ...overrides,
  };
}

/**
 * A file for a student whose seeded round carries no comments.
 *
 * Only נועה has seeded annotations, and a round with comments anchored to
 * it is deliberately never overwritten — so the in-place-refresh behaviour has
 * to be exercised on someone else.
 */
function shiraFile(overrides: Partial<DriveFile> = {}): DriveFile {
  return docFile({
    id: 'file-shira',
    name: 'שירה אלמוג — סמינריון',
    webViewLink: 'https://docs.google.com/document/d/file-shira/edit',
    ...overrides,
  });
}

const REVISIONS: DriveRevision[] = [
  {
    id: 'rev1',
    modifiedTime: '2026-07-01T08:00:00.000Z',
    lastModifyingUser: { emailAddress: 'noa@school.org.il' },
  },
  {
    id: 'rev2',
    modifiedTime: '2026-08-01T08:00:00.000Z',
    lastModifyingUser: { emailAddress: 'noa@school.org.il' },
  },
];

function document(bodyText: string): DocsDocument {
  return {
    documentId: 'file-noa',
    revisionId: 'rev2',
    body: {
      content: [
        {
          startIndex: 1,
          paragraph: {
            elements: [{ textRun: { content: 'כותרת העבודה\n' } }],
            paragraphStyle: { namedStyleType: 'TITLE' },
          },
        },
        {
          startIndex: 20,
          paragraph: {
            elements: [{ textRun: { content: 'ממצאים ודיון\n' } }],
            paragraphStyle: { namedStyleType: 'HEADING_2' },
          },
        },
        {
          startIndex: 40,
          paragraph: {
            elements: [{ textRun: { content: `${bodyText}\n` } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    },
  };
}

class FakeDriveApi {
  files: DriveFile[] = [];
  /** What Drive returns from the `sharedWithMe` corpus. */
  shared: DriveFile[] = [];
  /** The addresses each shared query was scoped to, in order. */
  sharedQueries: string[][] = [];
  /** Files reachable by id, for the attach-by-hand path. */
  byId: Record<string, DriveFile> = {};
  revisions: DriveRevision[] = REVISIONS;
  body = 'הקשר בין המשתנים היה מובהק (r = .42, p < .01).';
  revisionsTruncated = false;

  /** False when the shortcut's target is shared with nobody but its owner. */
  targetReadable = true;

  listFolder = async () => this.files;

  listSharedByOwners = async (emails: readonly string[]) => {
    this.sharedQueries.push([...emails]);
    // The real query returns only files owned by those addresses; this fake
    // returns whatever the test set, so a test can hand back something the
    // real query never would and prove the guard holds anyway.
    return this.shared;
  };

  listSharedDocuments = async () => this.shared;

  getFile = async (fileId: string) => {
    if (!this.targetReadable) throw new DriveError('not_found', 'target not visible', 404);
    return this.byId[fileId] ?? docFile({ id: fileId });
  };
  getFolder = async () => ({ id: FOLDER, mimeType: 'application/vnd.google-apps.folder' });
  listRevisions = async () => ({
    revisions: this.revisions,
    truncated: this.revisionsTruncated,
  });
  getDocument = async () => document(this.body);
}

class FakeAuth {
  connected = true;
  isConnected = () => this.connected;
  /** Mirrors the real one: a token is minted per call, never stored. */
  accessToken = async () => (this.connected ? 'minted-access-token' : null);
  invalidate = () => {};
}

describe('SyncService', () => {
  let api: FakeDriveApi;
  let store: DataStore;
  let sync: SyncService;

  beforeEach(() => {
    localStorage.clear();
    api = new FakeDriveApi();

    TestBed.configureTestingModule({
      providers: [
        { provide: DriveApi, useValue: api },
        { provide: GoogleDriveAuth, useValue: new FakeAuth() },
        { provide: Repository, useClass: LocalRepository },
      ],
    });

    store = TestBed.inject(DataStore);
    // The app starts empty now; a sync test needs a course, an
    // assignment and a roster to attribute work to.
    seedStore(store);
    sync = TestBed.inject(SyncService);
    store.setDriveFolder(COURSE.id, FOLDER);
  });

  afterEach(() => localStorage.clear());

  /**
   * Both sources named, because either one alone would do.
   *
   * The old wording sent her to choose a folder, which is the wrong fix for a
   * class that hands work in by sharing it: there the folder is beside the
   * point and the missing piece is a confirmed account.
   */
  it('refuses to sync with neither a folder nor a confirmed account', async () => {
    store.setDriveFolder(COURSE.id, null);
    const result = await sync.syncNow();

    expect(result.error).toContain('עדיין לא הוגדרה תיקייה בדרייב');
    expect(result.error).toContain('חשבון הדרייב');
    expect(store.sync().phase).toBe('error');
  });

  /**
   * The whole point of the feature.
   *
   * A student who presses Share instead of moving her file into the folder
   * produces a document with no parent the teacher can see — no folder query
   * will ever find it. With her account confirmed it arrives anyway, and with
   * no folder configured at all.
   */
  it('reads a document a confirmed student shared, with no folder set', async () => {
    store.setStudentDriveAccount(seedId('s1'), 'noa@school.org.il');
    store.setDriveFolder(COURSE.id, null);
    api.shared = [docFile({ id: 'shared-noa' })];

    const result = await sync.syncNow();

    expect(result.error).toBeNull();
    expect(store.submissionByDriveFile('shared-noa')?.student_id).toBe(seedId('s1'));
    // Asked about her account and nothing else.
    expect(api.sharedQueries).toEqual([['noa@school.org.il']]);
  });

  /** Counted apart, so "the folder is empty" and "nobody shared" differ. */
  it('reports how much of the sync arrived by sharing', async () => {
    store.setStudentDriveAccount(seedId('s1'), 'noa@school.org.il');
    api.shared = [docFile({ id: 'shared-noa' })];

    const result = await sync.syncNow();

    expect(result.shared).toBe(1);
    expect(store.sync().shared).toBe(1);
  });

  /**
   * The attribution rule that separates the two sources.
   *
   * A file in the year folder may be matched on its name: the folder is the
   * teacher's own assertion that everything in it is work for this course.
   * Her "Shared with me" asserts nothing — it holds memos, colleagues' drafts
   * and years of unrelated paperwork — so a document named after a student but
   * owned by a stranger must not become her submission and overwrite the text
   * her comments are anchored to.
   */
  it('refuses to attribute a shared file by its name alone', async () => {
    store.setStudentDriveAccount(seedId('s1'), 'noa@school.org.il');
    api.shared = [
      shiraFile({
        id: 'shared-stranger',
        name: 'שירה אלמוג — הערכת מורה',
        owners: [{ emailAddress: 'rina@school.org.il' }],
      }),
    ];

    const result = await sync.syncNow();

    expect(store.submissionByDriveFile('shared-stranger')).toBeUndefined();
    // And it is not reported as a problem either: nobody said it was coursework.
    expect(result.unmatched).toEqual([]);
  });

  /**
   * A student doing as she was asked, twice.
   *
   * Sharing the document *and* dropping it in the folder used to read as two
   * files for one student, which is reported to the teacher as a clash she has
   * to go and resolve.
   */
  it('treats a file that is both in the folder and shared as one document', async () => {
    store.setStudentDriveAccount(seedId('s1'), 'noa@school.org.il');
    api.files = [docFile()];
    api.shared = [docFile()];

    const result = await sync.syncNow();

    expect(result.unmatched).toEqual([]);
    const hers = store.submissions().filter((s) => s.student_id === seedId('s1'));
    expect(hers.length).toBe(1);
  });

  /**
   * The bootstrap, and the reason the automatic path is safe to keep strict.
   *
   * The very first document a girl shares comes from an account Margin has
   * never seen, so nothing can attribute it. She says whose it is once; the
   * address is recorded, and everything shared from it afterwards is found by
   * the ordinary sync.
   */
  it('attaches a shared document she attributes herself, and remembers the account', async () => {
    const file = shiraFile({
      id: 'shared-shira',
      name: 'עבודה סופית.docx',
      owners: [{ emailAddress: 'shira.almog@gmail.com' }],
    });
    api.byId = { 'shared-shira': file };

    const { error } = await sync.attachShared('shared-shira', seedId('s2'));

    expect(error).toBeNull();
    expect(store.submissionByDriveFile('shared-shira')?.student_id).toBe(seedId('s2'));
    expect(store.students().find((s) => s.id === seedId('s2'))?.drive_account_email).toBe(
      'shira.almog@gmail.com',
    );

    // And from now on it is automatic.
    expect(store.confirmedDriveAccounts()).toContain('shira.almog@gmail.com');
  });

  /**
   * An address already on file is left alone. Overwriting it silently would
   * redirect every future match for that girl, and she may well be handing in
   * from a second account.
   */
  it('does not overwrite an account she has already confirmed', async () => {
    store.setStudentDriveAccount(seedId('s2'), 'shira@school.org.il');
    api.byId = {
      'shared-shira': shiraFile({
        id: 'shared-shira',
        owners: [{ emailAddress: 'shira.personal@gmail.com' }],
      }),
    };

    await sync.attachShared('shared-shira', seedId('s2'));

    expect(store.students().find((s) => s.id === seedId('s2'))?.drive_account_email).toBe(
      'shira@school.org.il',
    );
    // The document is still hers, which is what she asked for.
    expect(store.submissionByDriveFile('shared-shira')?.student_id).toBe(seedId('s2'));
  });

  /** Already a submission means nothing to attach; it is being synced. */
  it('leaves documents that are already submissions out of the picker', async () => {
    store.setStudentDriveAccount(seedId('s1'), 'noa@school.org.il');
    api.shared = [docFile({ id: 'shared-noa' })];
    await sync.syncNow();

    const { candidates } = await sync.listSharedWithMe();
    expect(candidates.map((c) => c.id)).not.toContain('shared-noa');
  });

  /**
   * The name match survives here and only here: as a pre-selection in a list
   * she confirms, never as an attribution in its own right.
   */
  it('suggests a student for a shared file without attributing it', async () => {
    api.shared = [
      shiraFile({ id: 'shared-shira', owners: [{ emailAddress: 'unknown@gmail.com' }] }),
    ];

    const { candidates } = await sync.listSharedWithMe();

    expect(candidates.length).toBe(1);
    expect(candidates[0].suggestedStudentId).toBe(seedId('s2'));
    // Suggested, not applied.
    expect(store.submissionByDriveFile('shared-shira')).toBeUndefined();
  });

  it('attaches a new file to the row that student already has', async () => {
    api.files = [docFile()];
    await sync.syncNow();

    const submission = store.submissionByDriveFile('file-noa');
    expect(submission?.student_id).toBe(seedId('s1'));
    expect(submission?.drive_file_name).toBe('נועה ברקוביץ׳ — סמינריון');
    // Adopted, not duplicated: the id is the one she already had.
    expect(submission?.id).toBe(seedId('sub-noa'));
  });

  /**
   * The bug this pins, in as many words.
   *
   * `submissions` is unique on `(assignment_id, student_id)`, and the sync used
   * to look a file up by `drive_file_id` alone — which is null on every row
   * provisioning writes. So it minted a second row for the same student, and
   * Postgres refused it with `submissions_assignment_id_student_id_key`. The
   * round then referenced a submission that did not exist, and its
   * `owns_submission` check reported that absence as an RLS violation.
   */
  it('never opens a second submission for the same student and assignment', async () => {
    api.files = [docFile()];
    await sync.syncNow();

    const hers = store
      .submissions()
      .filter((s) => s.student_id === seedId('s1') && s.assignment_id === store.assignment()!.id);

    expect(hers.length).toBe(1);
    expect(hers[0].drive_file_id).toBe('file-noa');

    // And one round per number, which is the constraint one table down.
    const rounds = store.rounds().filter((r) => r.submission_id === hers[0].id);
    expect(new Set(rounds.map((r) => r.round_number)).size).toBe(rounds.length);
  });

  it('surfaces a second file naming the same student rather than fighting over her row', async () => {
    // Both names match her: a transliterated second file would simply fail to
    // match at all, and the guard under test would never be reached — which is
    // how this test previously passed while asserting nothing about it.
    api.files = [docFile(), docFile({ id: 'file-noa-2', name: 'נועה ברקוביץ׳ — סופי' })];
    const result = await sync.syncNow();

    const hers = store.submissions().filter((s) => s.student_id === seedId('s1'));
    expect(hers.length).toBe(1);
    // Named on screen with the reason, so she can rename one — not silently
    // dropped and not silently swapped for the other on the next sync.
    expect(result.unmatched.length).toBe(1);
    expect(result.unmatched[0].reason).toBe('duplicate_student');
  });

  /** A re-upload gets a new Drive file id, and is still the same submission. */
  it('follows a student who deleted the file and uploaded it again', async () => {
    api.files = [docFile()];
    await sync.syncNow();

    api.files = [docFile({ id: 'file-noa-again', modifiedTime: '2026-08-09T08:00:00.000Z' })];
    await sync.syncNow();

    const hers = store.submissions().filter((s) => s.student_id === seedId('s1'));
    expect(hers.length).toBe(1);
    expect(hers[0].drive_file_id).toBe('file-noa-again');
  });

  /**
   * The ids the sync mints have to be writable. `sub-<driveFileId>` was unique
   * and readable and rejected by every insert — and since writes are
   * fire-and-forget, the submission sat on screen as though it had saved.
   */
  it('gives the records ids Postgres will accept', async () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    api.files = [docFile()];
    await sync.syncNow();

    const submission = store.submissionByDriveFile('file-noa')!;
    expect(submission.id).toMatch(uuid);
    expect(store.roundFor(submission.id)!.id).toMatch(uuid);
  });

  it('captures the raw Drive metadata without interpreting it', async () => {
    api.files = [docFile()];
    await sync.syncNow();

    const submission = store.submissionByDriveFile('file-noa')!;
    const raw = submission.drive_metadata_raw as unknown as DriveMetadataSnapshot;

    expect(submission.drive_created_at).toBe('2026-07-01T08:00:00.000Z');
    expect(submission.drive_modified_at).toBe('2026-08-01T08:00:00.000Z');
    expect(submission.drive_owner_email).toBe('noa@school.org.il');
    expect(submission.drive_revision_count).toBe(2);
    // Stored verbatim — Phase 5 reads this, Phase 3 draws no conclusions.
    expect(raw.revisions.map((r) => r.id)).toEqual(['rev1', 'rev2']);
    expect(raw.file.webViewLink).toBe('https://docs.google.com/document/d/file-noa/edit');
    expect(raw.revisions_truncated).toBe(false);
  });

  it('records when Drive gave only a partial revision history', async () => {
    api.files = [docFile()];
    api.revisionsTruncated = true;
    await sync.syncNow();

    const raw = store.submissionByDriveFile('file-noa')!
      .drive_metadata_raw as unknown as DriveMetadataSnapshot;
    expect(raw.revisions_truncated).toBe(true);
  });

  it('extracts the document into anchorable blocks', async () => {
    api.files = [docFile()];
    await sync.syncNow();

    const submission = store.submissionByDriveFile('file-noa')!;
    const round = store.roundFor(submission.id)!;
    const blocks = round.document_blocks!;

    expect(blocks.map((b) => b.text)).toEqual([
      'כותרת העבודה',
      'ממצאים ודיון',
      'הקשר בין המשתנים היה מובהק (r = .42, p < .01).',
    ]);

    // The offsets a comment would be anchored at still resolve.
    const body = blocks[2];
    const quote = 'הקשר בין המשתנים היה מובהק';
    const start = body.text.indexOf(quote);
    expect(body.text.slice(start, start + quote.length)).toBe(quote);
  });

  it('leaves the text alone for a file it cannot read structurally', async () => {
    api.files = [docFile({ mimeType: 'application/vnd.openxmlformats-officedocument' })];
    await sync.syncNow();

    const submission = store.submissionByDriveFile('file-noa')!;
    const round = store.roundFor(submission.id)!;

    // Metadata is still worth having; a mangled approximation of the text is not.
    expect(submission.drive_revision_count).toBe(2);
    expect(round.document_blocks).toBeNull();
    expect(round.document_text).toBeNull();
  });

  it('does nothing on a second sync when the file has not changed', async () => {
    api.files = [docFile()];
    await sync.syncNow();
    const second = await sync.syncNow();

    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(store.submissions().filter((s) => s.drive_file_id === 'file-noa').length).toBe(1);
  });

  it('refreshes the current round in place while nothing is anchored to it', async () => {
    api.files = [shiraFile()];
    await sync.syncNow();
    const submission = store.submissionByDriveFile('file-shira')!;
    const roundId = store.roundFor(submission.id)!.id;
    const before = store.rounds().filter((r) => r.submission_id === submission.id).length;

    api.body = 'הקשר נותר מובהק גם לאחר פיקוח.';
    api.files = [shiraFile({ modifiedTime: '2026-08-05T08:00:00.000Z' })];
    await sync.syncNow();

    const rounds = store.rounds().filter((r) => r.submission_id === submission.id);
    expect(rounds.length).toBe(before);
    const current = store.roundFor(submission.id)!;
    expect(current.id).toBe(roundId);
    expect(current.document_blocks!.at(-1)!.text).toBe('הקשר נותר מובהק גם לאחר פיקוח.');
  });

  /**
   * The second bug found while fixing the first, and the more dangerous one.
   *
   * Refreshing a round in place was justified by "nothing has been annotated
   * against it yet" — an assumption, never a check, and false from the moment
   * comments could be drafted before notes were sent. Overwriting the text does
   * not delete those comments; it leaves them anchored to offsets in a document
   * that no longer says that.
   */
  it('never moves the text under a comment that is already anchored to it', async () => {
    api.files = [docFile()];
    await sync.syncNow();

    const submission = store.submissionByDriveFile('file-noa')!;
    const annotated = store
      .annotations()
      .filter((a) => a.submission_id === submission.id)
      .map((a) => a.round_id);
    expect(annotated.length).toBeGreaterThan(0);

    const textBefore = new Map(
      store
        .rounds()
        .filter((r) => annotated.includes(r.id))
        .map((r) => [r.id, r.document_text]),
    );

    api.body = 'שיניתי את כל הפרק מחדש.';
    api.files = [docFile({ modifiedTime: '2026-08-05T08:00:00.000Z' })];
    await sync.syncNow();

    for (const [roundId, text] of textBefore) {
      expect(store.rounds().find((r) => r.id === roundId)!.document_text).toBe(text);
    }
    // The new text arrived, on a round of its own.
    expect(store.roundFor(submission.id)!.document_blocks!.at(-1)!.text).toBe(
      'שיניתי את כל הפרק מחדש.',
    );
  });

  it('opens a new round once notes have been sent, keeping the reviewed one', async () => {
    api.files = [shiraFile()];
    await sync.syncNow();
    const submission = store.submissionByDriveFile('file-shira')!;
    const firstRound = store.roundFor(submission.id)!;
    const originalText = firstRound.document_text;
    const before = store.rounds().filter((r) => r.submission_id === submission.id).length;

    store.setSubmissionStatus(submission.id, 'notes_sent');

    api.body = 'תיקנתי את הניסוח לפי ההערות.';
    api.files = [shiraFile({ modifiedTime: '2026-08-09T08:00:00.000Z' })];
    await sync.syncNow();

    const updated = store.submission(submission.id)!;
    const rounds = store.rounds().filter((r) => r.submission_id === submission.id);

    expect(updated.status).toBe('resubmitted');
    expect(updated.current_round).toBe(firstRound.round_number + 1);
    expect(rounds.length).toBe(before + 1);
    // The round she reviewed is untouched.
    expect(rounds.find((r) => r.id === firstRound.id)!.document_text).toBe(originalText);
    expect(store.roundFor(submission.id)!.round_number).toBe(firstRound.round_number + 1);
  });

  it('reports a file it cannot attribute rather than guessing a student', async () => {
    api.files = [docFile({ id: 'file-x', name: 'scan_0042' })];
    const result = await sync.syncNow();

    expect(result.created).toBe(0);
    // Named with the reason, so she knows to rename it rather than to
    // go looking for a permissions problem.
    expect(result.unmatched).toEqual([{ name: 'scan_0042', reason: 'no_student' }]);
    expect(store.submissionByDriveFile('file-x')).toBeUndefined();
    expect(store.sync().unmatched).toEqual([{ name: 'scan_0042', reason: 'no_student' }]);
  });

  it('skips folders nested inside the watched folder', async () => {
    api.files = [
      { id: 'sub-folder', name: 'טיוטות', mimeType: 'application/vnd.google-apps.folder' },
    ];
    const result = await sync.syncNow();

    expect(result.created).toBe(0);
    expect(result.unmatched).toEqual([]);
  });

  it('records the sync time when it finishes cleanly', async () => {
    api.files = [docFile()];
    await sync.syncNow();

    expect(store.sync().phase).toBe('idle');
    expect(store.sync().last_synced_at).toBeTruthy();
    expect(store.sync().message).toBeNull();
  });
});

/**
 * Work the teacher does not own.
 *
 * Each student keeps her own document and moves it into the year folder, so the
 * listing is mostly other people's files — and a student can just as easily put
 * a *shortcut* there instead, which looks identical in a listing and carries no
 * text at all.
 */
describe('student-owned files', () => {
  let api: FakeDriveApi;
  let store: DataStore;
  let sync: SyncService;

  beforeEach(() => {
    localStorage.clear();
    api = new FakeDriveApi();

    TestBed.configureTestingModule({
      providers: [
        { provide: DriveApi, useValue: api },
        { provide: GoogleDriveAuth, useValue: new FakeAuth() },
        { provide: Repository, useClass: LocalRepository },
      ],
    });

    store = TestBed.inject(DataStore);
    // The app starts empty now; a sync test needs a course, an
    // assignment and a roster to attribute work to.
    seedStore(store);
    sync = TestBed.inject(SyncService);
    store.setDriveFolder(COURSE.id, FOLDER);
  });

  afterEach(() => localStorage.clear());

  it('takes in a document the teacher does not own', async () => {
    api.files = [
      docFile({
        ownedByMe: false,
        owners: [{ emailAddress: 'noa.b@school.org.il', displayName: 'נועה' }],
      }),
    ];

    await sync.syncNow();

    const submission = store.submissionByDriveFile('file-noa');
    expect(submission).toBeTruthy();
    expect(submission!.drive_owner_email).toBe('noa.b@school.org.il');
  });

  /**
   * The hazard the new model introduces. A shortcut has its own mime type and
   * no body — ingested as-is it becomes a submission with an empty document and
   * nothing on screen to explain it.
   */
  it('follows a shortcut to the document it points at', async () => {
    api.files = [
      {
        id: 'shortcut-1',
        name: 'נועה ברקוביץ׳ — סמינריון',
        mimeType: 'application/vnd.google-apps.shortcut',
        shortcutDetails: { targetId: 'file-noa', targetMimeType: GOOGLE_DOC_MIME },
      },
    ];

    await sync.syncNow();

    // The target, not the pointer — and with its text extracted.
    const submission = store.submissionByDriveFile('file-noa');
    expect(submission).toBeTruthy();
    expect(store.roundFor(submission!.id)?.document_blocks?.length).toBeGreaterThan(0);
    expect(store.submissionByDriveFile('shortcut-1')).toBeUndefined();
  });

  it('reports a shortcut whose document it cannot read, rather than storing an empty one', async () => {
    api.targetReadable = false;
    api.files = [
      {
        id: 'shortcut-2',
        name: 'נועה ברקוביץ׳ — סמינריון',
        mimeType: 'application/vnd.google-apps.shortcut',
        shortcutDetails: { targetId: 'file-hidden' },
      },
    ];

    const result = await sync.syncNow();

    expect(result.unmatched).toEqual([
      { name: 'נועה ברקוביץ׳ — סמינריון', reason: 'shortcut_unreadable' },
    ]);
    expect(store.submissions().some((s) => s.drive_file_id === 'file-hidden')).toBe(false);
  });
});
