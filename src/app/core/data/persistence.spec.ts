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
import { Repository } from './repository';

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
