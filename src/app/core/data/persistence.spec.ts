import { TestBed } from '@angular/core/testing';

import { DriveApi } from '../drive/drive-api';
import { DocsDocument, DriveFile } from '../drive/drive-types';
import { GoogleDriveAuth } from '../drive/google-auth';
import { SyncService } from '../drive/sync';
import { seedId } from '../mock/seed-data';
import { COURSE } from '../mock/seed-data';
import { seedStore } from '../mock/seed-store';
import { DataStore } from './data-store';
import { LocalRepository } from './local-repository';
import { EMPTY_SNAPSHOT, Repository } from './repository';

/**
 * A reload is simulated by tearing the whole injector down and building a
 * fresh one over the same durable storage — new `DataStore`, new signals, new
 * everything, exactly as a browser refresh would produce. Anything that comes
 * back did so because it was persisted, not because it survived in memory.
 */

const FOLDER = 'folder-abc';

function driveFile(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: 'file-shira',
    name: 'שירה אלמוג — סמינריון',
    mimeType: 'application/vnd.google-apps.document',
    createdTime: '2026-07-02T08:00:00.000Z',
    modifiedTime: '2026-08-02T08:00:00.000Z',
    owners: [{ emailAddress: 'shira@school.org.il' }],
    ...overrides,
  };
}

function docsDocument(body: string): DocsDocument {
  return {
    documentId: 'file-shira',
    revisionId: 'rev-9',
    body: {
      content: [
        {
          startIndex: 1,
          paragraph: {
            elements: [{ textRun: { content: 'ממצאים ודיון\n' } }],
            paragraphStyle: { namedStyleType: 'HEADING_2' },
          },
        },
        {
          startIndex: 20,
          paragraph: {
            elements: [{ textRun: { content: `${body}\n` } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    },
  };
}

class FakeDriveApi {
  files: DriveFile[] = [driveFile()];
  body = 'הקשר בין המשתנים היה מובהק (r = .42, p < .01).';

  listFolder = async () => this.files;
  getFolder = async () => ({ id: FOLDER, mimeType: 'application/vnd.google-apps.folder' });
  listRevisions = async () => ({
    revisions: [
      { id: 'rev-1', modifiedTime: '2026-07-02T08:00:00.000Z' },
      { id: 'rev-9', modifiedTime: '2026-08-02T08:00:00.000Z' },
    ],
    truncated: false,
  });
  getDocument = async () => docsDocument(this.body);
}

class FakeAuth {
  isConnected = () => true;
  accessToken = async () => 'minted-access-token';
  invalidate = () => {};
}

/** Builds a fresh injector over the same durable storage. */
function boot(api: FakeDriveApi) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DriveApi, useValue: api },
      { provide: GoogleDriveAuth, useValue: new FakeAuth() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  const store = TestBed.inject(DataStore);
  // Stands in for what a real reload finds: the app itself starts empty, and
  // these are the records the persisted rows are merged over.
  seedStore(store);

  return { store, sync: TestBed.inject(SyncService) };
}

/**
 * A repository that answers slowly, and says when each write started.
 *
 * The bug this exists to catch is invisible against a fake that resolves
 * immediately: two writes issued in the same tick both "succeed" in order
 * because nothing ever interleaves. Real PostgREST does interleave, and the
 * loser is refused.
 */
class OrderedRepository extends LocalRepository {
  /** `start:table` and `end:table`, in the order they happened. */
  readonly events: string[] = [];

  /** Set to make every round insert fail, as RLS would. */
  refuseRounds = false;

  private async trace<T>(table: string, run: () => Promise<T>): Promise<T> {
    this.events.push(`start:${table}`);
    // Two microtask turns, so a second write issued in the same tick has every
    // chance to slip in front if nothing is holding it back.
    await Promise.resolve();
    await Promise.resolve();
    const result = await run();
    this.events.push(`end:${table}`);
    return result;
  }

  override saveSubmission(row: never) {
    return this.trace('submission', () => super.saveSubmission(row));
  }

  override saveRound(row: never) {
    return this.trace('round', async () => {
      if (this.refuseRounds) {
        throw new Error('new row violates row-level security policy');
      }
      return super.saveRound(row);
    });
  }
}

const COURSE_ID = 'c1111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = 'a1111111-1111-4111-8111-111111111111';

/**
 * What a real account actually holds: her course, one assignment, one student.
 *
 * Deliberately not the fixtures. Every fixture student already has a
 * submission, so a sync adopts her row instead of inserting one — and the path
 * that inserts a submission *and* its first round together, which is the one
 * that raced, would never run. An empty account takes that path for every
 * paper that arrives.
 */
function realAccount() {
  return {
    ...EMPTY_SNAPSHOT,
    courses: [
      { id: COURSE_ID, teacher_id: 'teacher-1', name: 'שיטות מחקר', year: 'תשפ״ו' } as never,
    ],
    assignments: [{ id: ASSIGNMENT_ID, course_id: COURSE_ID, title: 'עבודת גמר' } as never],
    students: [
      { id: 's1111111-1111-4111-8111-111111111111', full_name: 'מאיה לוין', active: true } as never,
    ],
  };
}

/**
 * The parent has to land before the child, and the app is what guarantees it.
 *
 * `submission_rounds_owner` is `with check (owns_submission(submission_id))`,
 * and `owns_submission` is an `exists` against `submissions`. A round that
 * reaches Postgres before its submission commits is refused — and refused as a
 * *permissions* error, "new row violates row-level security policy", which
 * reads as a policy or grant problem rather than as a missing parent.
 *
 * It stayed hidden while the app shipped demonstration data: those submissions
 * were written at startup and awaited in foreign-key order, so a sync almost
 * always adopted a row that already existed instead of inserting a submission
 * and its first round together. An empty account takes that path every time.
 */
describe('writes leave in the order they were made', () => {
  let api: FakeDriveApi;
  let repository: OrderedRepository;

  function boot() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DriveApi, useValue: api },
        { provide: GoogleDriveAuth, useValue: new FakeAuth() },
        { provide: Repository, useValue: repository },
      ],
    });
    return { store: TestBed.inject(DataStore), sync: TestBed.inject(SyncService) };
  }

  beforeEach(() => {
    localStorage.clear();
    api = new FakeDriveApi();
    repository = new OrderedRepository();
    api.files = [driveFile({ id: 'file-maya', name: 'מאיה לוין — סמינריון' })];
  });

  afterEach(() => localStorage.clear());

  it('never starts a round before its submission has come back', async () => {
    const { store, sync } = boot();
    store.applySnapshot(realAccount());
    store.setDriveFolder(COURSE_ID, FOLDER);

    await sync.syncNow();
    await store.settled();

    const submissionEnd = repository.events.indexOf('end:submission');
    const roundStart = repository.events.indexOf('start:round');

    expect(repository.events.indexOf('start:submission')).toBeGreaterThanOrEqual(0);
    expect(roundStart).toBeGreaterThanOrEqual(0);
    // The whole assertion: the round had not even been issued yet.
    expect(roundStart).toBeGreaterThan(submissionEnd);
  });

  /**
   * One refusal must not strand every later save behind it. The chain is built
   * from the caught promise precisely so it cannot deadlock.
   */
  it('keeps writing after one write fails', async () => {
    repository.refuseRounds = true;

    const { store, sync } = boot();
    store.applySnapshot(realAccount());
    store.setDriveFolder(COURSE_ID, FOLDER);

    await sync.syncNow();
    await store.settled();

    expect(store.persistError()).not.toBeNull();
    // Attempted rather than left waiting on a chain that never resolved.
    expect(repository.events).toContain('start:round');
  });

  /**
   * The way back from a half-written paper.
   *
   * The submission and its first round are two writes, and the second can fail
   * on its own. What is left is a submission stamped with the file's
   * `modifiedTime` and no text — and the next sync used to read that stamp,
   * call the file unchanged and skip it, so the paper stayed unreadable
   * however many times she pressed sync.
   */
  it('fills in a round that failed to save, on the next sync', async () => {
    repository.refuseRounds = true;

    const first = boot();
    first.store.applySnapshot(realAccount());
    first.store.setDriveFolder(COURSE_ID, FOLDER);

    await first.sync.syncNow();
    await first.store.settled();
    expect(first.store.persistError()).not.toBeNull();

    // Reload: the submission came back, its round did not.
    repository.refuseRounds = false;
    const second = boot();
    // The course and assignment are hers and persisted; this stands in for
    // the rows a real account already holds.
    second.store.applySnapshot(realAccount());
    await second.store.hydrate();

    const submission = second.store.submissionByDriveFile('file-maya');
    expect(submission).toBeDefined();
    expect(second.store.roundFor(submission!.id)).toBeUndefined();

    // Drive reports the very same modifiedTime — nothing about the file moved.
    await second.sync.syncNow();
    await second.store.settled();

    const round = second.store.roundFor(submission!.id);
    expect(round).toBeDefined();
    expect(round?.document_text ?? '').toContain('מובהק');
  });
});

describe('durability across a reload', () => {
  let api: FakeDriveApi;

  beforeEach(() => {
    localStorage.clear();
    api = new FakeDriveApi();
  });

  afterEach(() => localStorage.clear());

  it('brings synced submissions back without re-syncing', async () => {
    const first = boot(api);
    first.store.setDriveFolder(COURSE.id, FOLDER);
    await first.sync.syncNow();
    await first.store.settled();

    const before = first.store.submissionByDriveFile('file-shira');
    expect(before).toBeTruthy();

    // --- reload ---
    const second = boot(api);
    expect(second.store.submissionByDriveFile('file-shira')).toBeUndefined();
    await second.store.hydrate();

    const after = second.store.submissionByDriveFile('file-shira');
    expect(after?.id).toBe(before!.id);
    expect(after?.status).toBe('new');
    expect(after?.drive_file_name).toBe('שירה אלמוג — סמינריון');
  });

  it('brings the captured document and its metadata back', async () => {
    const first = boot(api);
    first.store.setDriveFolder(COURSE.id, FOLDER);
    await first.sync.syncNow();
    await first.store.settled();

    const submissionId = first.store.submissionByDriveFile('file-shira')!.id;
    const beforeText = first.store.roundFor(submissionId)!.document_text;

    const second = boot(api);
    await second.store.hydrate();

    const round = second.store.roundFor(submissionId);
    expect(round?.document_text).toBe(beforeText);
    expect(round?.document_blocks?.map((b) => b.text)).toEqual([
      'ממצאים ודיון',
      'הקשר בין המשתנים היה מובהק (r = .42, p < .01).',
    ]);

    const submission = second.store.submission(submissionId)!;
    expect(submission.drive_created_at).toBe('2026-07-02T08:00:00.000Z');
    expect(submission.drive_revision_count).toBe(2);
    expect(submission.drive_metadata_raw).toBeTruthy();
  });

  it('keeps review work done on a submission', async () => {
    const first = boot(api);
    const target = seedId('an-4');

    // Accept one comment, rewrite another, throw a third away.
    first.store.setAnnotationStatus(target, 'accepted');
    first.store.editAnnotation(seedId('an-5'), 'האם באמת אקראי, או נוחות?');
    first.store.setAnnotationStatus(seedId('an-7'), 'dismissed');
    await first.store.settled();

    const second = boot(api);
    await second.store.hydrate();

    const annotations = second.store.annotations();
    expect(annotations.find((a) => a.id === target)?.status).toBe('accepted');

    const edited = annotations.find((a) => a.id === seedId('an-5'))!;
    expect(edited.status).toBe('edited');
    expect(edited.body).toBe('האם באמת אקראי, או נוחות?');
    expect(edited.edited_by_teacher).toBe(true);
    // The AI's original is still there — the learning loop needs both halves.
    expect(edited.ai_body).toBeTruthy();
    expect(edited.ai_body).not.toBe(edited.body);

    expect(annotations.find((a) => a.id === seedId('an-7'))?.status).toBe('dismissed');
  });

  it('keeps a submission moved on to notes_sent', async () => {
    const first = boot(api);
    first.store.setSubmissionStatus(seedId('sub-noa'), 'notes_sent');
    await first.store.settled();

    const second = boot(api);
    await second.store.hydrate();

    expect(second.store.submission(seedId('sub-noa'))?.status).toBe('notes_sent');
  });

  it('keeps the watched folder', async () => {
    const first = boot(api);
    first.store.setDriveFolder(COURSE.id, FOLDER);
    await first.store.settled();

    const second = boot(api);
    await second.store.hydrate();

    expect(second.store.watchedFolderId()).toBe(FOLDER);
  });

  it('restores the last sync time, so the list does not claim it never ran', async () => {
    const first = boot(api);
    first.store.setDriveFolder(COURSE.id, FOLDER);
    await first.sync.syncNow();
    await first.store.settled();

    const second = boot(api);
    await second.store.hydrate();

    expect(second.store.sync().last_synced_at).toBeTruthy();
  });

  it('does not duplicate a submission when the same folder is synced again', async () => {
    const first = boot(api);
    first.store.setDriveFolder(COURSE.id, FOLDER);
    await first.sync.syncNow();
    await first.store.settled();

    const second = boot(api);
    await second.store.hydrate();
    await second.sync.syncNow();
    await second.store.settled();

    const matches = second.store.submissions().filter((s) => s.drive_file_id === 'file-shira');
    expect(matches.length).toBe(1);
  });

  it('preserves an earlier round after a resubmission survives a reload', async () => {
    const first = boot(api);
    first.store.setDriveFolder(COURSE.id, FOLDER);
    await first.sync.syncNow();
    await first.store.settled();

    const submissionId = first.store.submissionByDriveFile('file-shira')!.id;
    const firstRoundText = first.store.roundFor(submissionId)!.document_text;
    first.store.setSubmissionStatus(submissionId, 'notes_sent');

    api.body = 'תיקנתי את הניסוח לפי ההערות.';
    api.files = [driveFile({ modifiedTime: '2026-08-08T08:00:00.000Z' })];
    await first.sync.syncNow();
    await first.store.settled();

    const second = boot(api);
    await second.store.hydrate();

    const rounds = second.store.rounds().filter((r) => r.submission_id === submissionId);
    expect(rounds.length).toBe(2);
    expect(rounds.find((r) => r.round_number === 1)?.document_text).toBe(firstRoundText);
    expect(second.store.submission(submissionId)?.status).toBe('resubmitted');
  });

  it('boots cleanly when durable storage holds nothing', async () => {
    const store = boot(api).store;
    await store.hydrate();

    expect(store.hydrated()).toBe(true);
    expect(store.persistError()).toBeNull();
    // The seeded demonstration records are still the starting point.
    expect(store.submissions().length).toBeGreaterThan(0);
  });
});
