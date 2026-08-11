import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { seedId } from '../mock/seed-data';
import { DriveApi } from './drive-api';
import { DocsDocument, DriveFile, DriveMetadataSnapshot, DriveRevision } from './drive-types';
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
  revisions: DriveRevision[] = REVISIONS;
  body = 'הקשר בין המשתנים היה מובהק (r = .42, p < .01).';
  revisionsTruncated = false;

  listFolder = async () => this.files;
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
    sync = TestBed.inject(SyncService);
    store.setDriveFolder(store.course().id, FOLDER);
  });

  afterEach(() => localStorage.clear());

  it('refuses to sync before a folder is chosen', async () => {
    store.setDriveFolder(store.course().id, null);
    const result = await sync.syncNow();

    expect(result.error).toBe('עדיין לא הוגדרה תיקייה בדרייב.');
    expect(store.sync().phase).toBe('error');
  });

  it('creates a submission for a file it has not seen before', async () => {
    api.files = [docFile()];
    const result = await sync.syncNow();

    expect(result.created).toBe(1);
    const submission = store.submissionByDriveFile('file-noa');
    expect(submission?.status).toBe('new');
    expect(submission?.current_round).toBe(1);
    expect(submission?.student_id).toBe(seedId('s1'));
    expect(submission?.drive_file_name).toBe('נועה ברקוביץ׳ — סמינריון');
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

  it('refreshes the current round in place while notes have not gone out', async () => {
    api.files = [docFile()];
    await sync.syncNow();
    const submission = store.submissionByDriveFile('file-noa')!;
    const roundId = store.roundFor(submission.id)!.id;

    api.body = 'הקשר נותר מובהק גם לאחר פיקוח.';
    api.files = [docFile({ modifiedTime: '2026-08-05T08:00:00.000Z' })];
    await sync.syncNow();

    const rounds = store.rounds().filter((r) => r.submission_id === submission.id);
    expect(rounds.length).toBe(1);
    expect(rounds[0].id).toBe(roundId);
    expect(rounds[0].document_blocks!.at(-1)!.text).toBe('הקשר נותר מובהק גם לאחר פיקוח.');
    expect(store.submission(submission.id)!.status).toBe('new');
  });

  it('opens a new round once notes have been sent, keeping the annotated one', async () => {
    api.files = [docFile()];
    await sync.syncNow();
    const submission = store.submissionByDriveFile('file-noa')!;
    const firstRound = store.roundFor(submission.id)!;
    const originalText = firstRound.document_text;

    store.setSubmissionStatus(submission.id, 'notes_sent');

    api.body = 'תיקנתי את הניסוח לפי ההערות.';
    api.files = [docFile({ modifiedTime: '2026-08-09T08:00:00.000Z' })];
    await sync.syncNow();

    const updated = store.submission(submission.id)!;
    const rounds = store.rounds().filter((r) => r.submission_id === submission.id);

    expect(updated.status).toBe('resubmitted');
    expect(updated.current_round).toBe(2);
    expect(rounds.length).toBe(2);
    // The round she annotated is untouched.
    expect(rounds.find((r) => r.id === firstRound.id)!.document_text).toBe(originalText);
    expect(store.roundFor(submission.id)!.round_number).toBe(2);
  });

  it('reports a file it cannot attribute rather than guessing a student', async () => {
    api.files = [docFile({ id: 'file-x', name: 'scan_0042' })];
    const result = await sync.syncNow();

    expect(result.created).toBe(0);
    expect(result.unmatched).toEqual(['scan_0042']);
    expect(store.submissionByDriveFile('file-x')).toBeUndefined();
    expect(store.sync().unmatched).toEqual(['scan_0042']);
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
