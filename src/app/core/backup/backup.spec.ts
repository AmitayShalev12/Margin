import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { EMPTY_SNAPSHOT, PersistedSnapshot, Repository } from '../data/repository';
import { DriveBackup, isBackupCreation } from '../drive/drive-backup';
import { GoogleDriveAuth } from '../drive/google-auth';
import { herWriting, voiceSamples } from '../learning/voice';
import { SupabaseService } from '../supabase/supabase';
import { BackupError, RESTORE_ORDER, buildBackup, missingFrom, parseBackup } from './backup';
import { BackupService } from './backup-service';

/**
 * The safety nets, and what the AI learns from.
 *
 * A backup is only worth what comes back out of it, so the test that matters
 * most is the full circle: real work, written to a file, the data lost, and
 * every record back after restoring.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId: string | null = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  user = () => ({ email: 'x' });
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function setup(driveStub: Partial<DriveBackup> = {}, connected = true) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
      {
        provide: GoogleDriveAuth,
        useValue: { refreshStatus: async () => 'connected', isConnected: () => connected },
      },
      { provide: DriveBackup, useValue: driveStub },
    ],
  });
  return {
    store: TestBed.inject(DataStore),
    backup: TestBed.inject(BackupService),
    repository: TestBed.inject(Repository),
  };
}

/** A course with a student, a paper and a comment of her own. */
function someWork(store: DataStore) {
  store.createCourse('שיטות מחקר', 'תשפ״ז');
  store.createAssignment('עבודה סמינריונית');
  const student = store.addStudent('נועה כהן')!;
  const paper = store.addUploadedSubmission({
    studentId: student.id,
    title: null,
    blocks: [{ id: 'b1', index: 0, type: 'paragraph', text: 'פסקה' }],
    text: 'פסקה',
    fileName: 'a.docx',
  })!;
  expect(paper).not.toBeNull();
  store.importStyleExamples([{ quote: 'ציטוט', body: 'כדאי לחדד את הטענה' }]);
  return { student, paper };
}

/** Lets the store's fire-and-forget writes reach the repository. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => localStorage.clear());

describe('the full circle', () => {
  it('brings everything back after the data is lost', async () => {
    const { store, backup, repository } = setup();
    someWork(store);
    await settled();

    const saved = buildBackup(await repository.load(), '2026-11-05T10:00:00Z');
    const file = new File([JSON.stringify(saved)], 'margin-backup.json');
    localStorage.clear();
    expect((await repository.load()).students).toHaveLength(0);

    const plan = await backup.plan(file);
    expect(plan.count).toBeGreaterThan(0);
    await backup.restore(plan);

    const after = await repository.load();
    for (const table of RESTORE_ORDER) {
      expect((after[table] as unknown[]).length, table).toBe(saved.counts[table]);
    }
    expect(after.students[0].full_name).toBe('נועה כהן');
    expect(after.styleExamples[0].teacher_text).toBe('כדאי לחדד את הטענה');
  });

  /** A backup is older than what is on screen. It must not undo newer work. */
  it('never overwrites what still exists', async () => {
    const { store, backup, repository } = setup();
    const { student } = someWork(store);
    await settled();
    const saved = buildBackup(await repository.load(), '2026-11-05T10:00:00Z');

    await repository.saveStudent({ ...student, full_name: 'שם חדש' });
    const plan = await backup.plan(new File([JSON.stringify(saved)], 'b.json'));

    expect(plan.count).toBe(0);
    expect((await repository.load()).students[0].full_name).toBe('שם חדש');
  });
});

describe('what restoring writes', () => {
  /** After a move to a new project, RLS would refuse the old account's rows. */
  it('writes rows as the teacher who is signed in', () => {
    const student = { id: 's1', teacher_id: 'old-account', full_name: 'א' };
    const backup = { ...EMPTY_SNAPSHOT, students: [student] } as unknown as PersistedSnapshot;

    const missing = missingFrom(backup, EMPTY_SNAPSHOT, 'new-account');

    expect(missing.students[0].teacher_id).toBe('new-account');
  });

  it('covers every table of the snapshot', () => {
    const tables = Object.keys(EMPTY_SNAPSHOT).filter((k) => k !== 'driveFolders');
    expect([...RESTORE_ORDER].sort()).toEqual(tables.sort());
  });
});

describe('reading a backup file', () => {
  const refuses = (text: string) => expect(() => parseBackup(text)).toThrow(BackupError);

  it('refuses anything that is not one', () => {
    refuses('not json');
    refuses('{"format":"margin.style-profile","data":{}}');
    refuses('{"format":"margin.backup","version":2,"data":{}}');
    refuses('{"format":"margin.backup","version":1,"data":{"students":[]}}');
  });

  it('reads one it wrote', () => {
    const text = JSON.stringify(buildBackup(EMPTY_SNAPSHOT, '2026-11-05T10:00:00Z'));
    expect(parseBackup(text).format).toBe('margin.backup');
  });
});

describe('what a backup holds', () => {
  it('has what was learned as well as the raw records', async () => {
    const { store, repository } = setup();
    someWork(store);
    await settled();

    const saved = buildBackup(await repository.load(), '2026-11-05T10:00:00Z');

    expect(saved.learned.style_examples[0].teacher_text).toBe('כדאי לחדד את הטענה');
    expect(saved.data.students).toHaveLength(1);
  });

  it('holds no credential', async () => {
    const { store, repository } = setup();
    someWork(store);
    await settled();

    const text = JSON.stringify(buildBackup(await repository.load(), '2026-11-05T10:00:00Z'));

    expect(text).not.toMatch(/refresh_token|access_token|api_key|credential/i);
  });
});

describe('the daily copy in her Drive', () => {
  function drive(latest: string | null) {
    const uploads: string[] = [];
    return {
      uploads,
      stub: {
        latest: async () => latest,
        upload: async (name: string) => void uploads.push(name),
      } as unknown as Partial<DriveBackup>,
    };
  }

  /** A stand-in for Supabase: `runAuto` only runs against the real database. */
  function asSupabase(repository: Repository) {
    Object.defineProperty(repository, 'kind', { value: 'supabase' });
  }

  it('uploads when the last copy is over a day old', async () => {
    const { uploads, stub } = drive('2020-01-01T00:00:00Z');
    const { store, backup, repository } = setup(stub);
    asSupabase(repository);
    someWork(store);
    await settled();

    await backup.runAuto();

    expect(uploads).toHaveLength(1);
    expect(backup.auto().phase).toBe('ok');
  });

  it('does nothing when today already has one', async () => {
    const { uploads, stub } = drive(new Date().toISOString());
    const { store, backup, repository } = setup(stub);
    asSupabase(repository);
    someWork(store);
    await settled();

    await backup.runAuto();

    expect(uploads).toHaveLength(0);
  });

  it('says so when Drive is not connected, and uploads nothing', async () => {
    const { uploads, stub } = drive(null);
    const { backup, repository } = setup(stub, false);
    asSupabase(repository);

    await backup.runAuto();

    expect(uploads).toHaveLength(0);
    expect(backup.auto().phase).toBe('off');
  });

  it('reports a failure rather than swallowing it', async () => {
    const { backup, repository } = setup({
      latest: async () => {
        throw new Error('403');
      },
    });
    asSupabase(repository);

    await backup.runAuto();

    expect(backup.auto().phase).toBe('failed');
  });

  /** An empty account must not produce a file that looks like a good copy. */
  it('does not upload when there is nothing to keep', async () => {
    const { uploads, stub } = drive(null);
    const { backup, repository } = setup(stub);
    asSupabase(repository);

    await backup.runAuto();

    expect(uploads).toHaveLength(0);
  });
});

describe('what the backup may write to Drive', () => {
  const FILES = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const marked = { name: 'x', appProperties: { marginBackup: 'file' } };

  it('allows creating a new marked file', () => {
    expect(isBackupCreation(UPLOAD, marked)).toBe(true);
    expect(isBackupCreation(FILES, marked)).toBe(true);
  });

  /** The app holds full Drive access over students' papers. */
  it('refuses anything addressing an existing file', () => {
    expect(isBackupCreation(`${FILES}/abc123`, marked)).toBe(false);
    expect(isBackupCreation(`${FILES}/abc123/comments`, marked)).toBe(false);
    expect(isBackupCreation(`${UPLOAD.split('?')[0]}/abc123?uploadType=multipart`, marked)).toBe(false);
    expect(isBackupCreation(FILES, { ...marked, id: 'abc123' })).toBe(false);
  });

  it('refuses a file without the mark', () => {
    expect(isBackupCreation(UPLOAD, { name: 'x' })).toBe(false);
  });
});

describe('what the AI learns her voice from', () => {
  const base = { created_at: '2026-01-01', updated_at: '2026-01-01' };
  const annotation = (over: object) =>
    ({ ...base, origin: 'teacher', status: 'accepted', body: 'הערה שלי', anchor: { quote: 'ציטוט' }, ...over }) as never;
  const none = { examples: [], annotations: [], scores: [], emails: [] };

  it('takes a comment she wrote herself, with the sentence it was on', () => {
    const [sample] = herWriting({ ...none, annotations: [annotation({})] });
    expect(sample.teacher_text).toBe('הערה שלי');
    expect(sample.student_text).toBe('ציטוט');
  });

  it('leaves out a drafted comment, and one of hers she dismissed', () => {
    const samples = herWriting({
      ...none,
      annotations: [annotation({ origin: 'ai' }), annotation({ status: 'dismissed' })],
    });
    expect(samples).toEqual([]);
  });

  it('takes her side of the discussion on a grade, not the side of the model', () => {
    const samples = herWriting({
      ...none,
      scores: [
        {
          ...base,
          discussion: [
            { role: 'model', text: 'הורדתי נקודה כי אין מקור', at: '2026-01-01' },
            { role: 'teacher', text: 'לא מסכימה, יש כאן טיעון', at: '2026-01-02' },
          ],
        },
      ] as never,
    });
    expect(samples.map((s) => s.teacher_text)).toEqual(['לא מסכימה, יש כאן טיעון']);
  });

  it('takes a message she wrote from scratch, not a drafted one', () => {
    const samples = herWriting({
      ...none,
      emails: [{ ...base, ai_body: null, body: 'שלום נועה' }, { ...base, ai_body: 'טיוטה', body: 'טיוטה' }] as never,
    });
    expect(samples.map((s) => s.teacher_text)).toEqual(['שלום נועה']);
  });

  it('puts the newest first and repeats nothing', () => {
    const samples = herWriting({
      ...none,
      annotations: [
        annotation({ body: 'ישנה', updated_at: '2026-01-01' }),
        annotation({ body: 'חדשה', updated_at: '2026-06-01' }),
        annotation({ body: 'חדשה', updated_at: '2026-02-01' }),
      ],
    });
    expect(samples.map((s) => s.teacher_text)).toEqual(['חדשה', 'ישנה']);
  });
});

describe('what the assistant sees of her voice', () => {
  const sample = (teacher_text: string, student_text: string | null = null) => ({
    source: 'own_comment',
    student_text,
    teacher_text,
    at: '2026-01-01',
  });

  /** Its promise: no paper content and no address leaves through it. */
  it('sends her words without the student sentence', () => {
    const texts = voiceSamples([sample('שלי', 'משפט מהעבודה של התלמידה')], []);
    expect(texts).toEqual(['שלי']);
    expect(JSON.stringify(texts)).not.toContain('משפט מהעבודה');
  });

  it('leaves out anything holding an email address', () => {
    expect(voiceSamples([sample('כתבי ל noa@example.com')], [])).toEqual([]);
  });

  it('includes what she rewrote, and is capped', () => {
    const logs = [
      { action: 'edited', final_text: 'הניסוח שלי', created_at: '2026-02-01' },
      { action: 'dismissed', final_text: null, created_at: '2026-02-01' },
    ] as never;
    expect(voiceSamples([], logs)).toEqual(['הניסוח שלי']);

    const many = Array.from({ length: 50 }, (_, i) => sample(`דוגמה ${i}`));
    expect(voiceSamples(many, []).length).toBeLessThanOrEqual(12);
  });
});
