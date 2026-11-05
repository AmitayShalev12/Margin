import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { AnnotationGenerator } from '../ai/annotation-generator';
import { DataStore } from '../data/data-store';
import { CommentPoster } from '../drive/comment-poster';
import { GoogleDriveAuth } from '../drive/google-auth';
import { SyncService } from '../drive/sync';
import { writeZip } from '../export/zip-writer';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { SupabaseService } from '../supabase/supabase';
import { AssistantActions } from './actions';

/**
 * Running what the assistant proposed.
 *
 * The second gate, and the one that matters: the model is told to use only
 * ids it was given, and this is where that is enforced. The cases worth the
 * most are the ones where the model is wrong — a stale id, a name that is
 * already on the roster, a delete nobody confirmed — because each of those
 * must change nothing and say so.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function setup(
  generated: { created: number; discarded: number } | null = { created: 3, discarded: 0 },
) {
  const visited: string[] = [];
  const drive = {
    syncs: 0,
    connects: 0,
    posted: [] as string[],
    outcome: { created: 2, updated: 1, unchanged: 0, shared: 0, unmatched: [], error: null } as {
      created: number;
      updated: number;
      unchanged: number;
      shared: number;
      unmatched: { name: string; reason: string }[];
      error: string | null;
    },
    report: null as { posted: number; failed: number; unplaced: unknown[] } | null,
    waiting: [] as unknown[],
  };
  const router = {
    navigateByUrl: async (url: string) => void visited.push(url),
    navigate: async (commands: string[]) => void visited.push(commands.join('/')),
  };
  const generator = {
    generate: async () => generated,
    state: () => ({ message: 'נגמרו הקרדיטים בחשבון ה־Gemini.' }),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
      { provide: Router, useValue: router },
      { provide: AnnotationGenerator, useValue: generator },
      {
        provide: SyncService,
        useValue: {
          syncNow: async () => {
            drive.syncs++;
            return drive.outcome;
          },
        },
      },
      {
        provide: GoogleDriveAuth,
        useValue: {
          connect: async () => void drive.connects++,
        },
      },
      {
        provide: CommentPoster,
        useValue: {
          waiting: () => drive.waiting,
          message: () => 'החיבור לגוגל פג.',
          post: async (id: string) => {
            drive.posted.push(id);
            return drive.report;
          },
        },
      },
    ],
  });

  const store = TestBed.inject(DataStore);
  const methods = store.createCourse('שיטות מחקר', 'תשפ״ז')!;
  const practicum = store.createCourse('עבודה מעשית', 'תשפ״ז')!;
  // Work attaches to an assignment; without one the store refuses an upload.
  store.createAssignment('עבודה סמינריונית');
  return { store, actions: TestBed.inject(AssistantActions), visited, methods, practicum, drive };
}

/** A paper of hers. Asserted, so a test that needs one cannot quietly lack it. */
function paperFor(store: DataStore, studentId: string) {
  const paper = store.addUploadedSubmission({
    studentId,
    title: null,
    blocks: [{ id: 'b1', index: 0, type: 'paragraph', text: 'פסקה' }],
    text: 'פסקה',
    fileName: 'a.docx',
  });
  expect(paper).not.toBeNull();
  return paper!;
}

beforeEach(() => localStorage.clear());

describe('adding a student', () => {
  it('creates her once, enrolled in every course named', async () => {
    const { store, actions, methods, practicum } = setup();

    const outcome = await actions.run({
      name: 'add_student',
      args: { full_name: 'נועה כהן', course_ids: [methods.id, practicum.id] },
    });

    expect(outcome.status).toBe('done');
    const noa = store.students().filter((s) => s.full_name === 'נועה כהן');
    expect(noa).toHaveLength(1);
    expect(store.coursesOf(noa[0].id)).toHaveLength(2);
  });

  it('says so when a course it named does not exist, and adds her to the rest', async () => {
    const { store, actions, methods } = setup();

    const outcome = await actions.run({
      name: 'add_student',
      args: { full_name: 'נועה כהן', course_ids: [methods.id, 'invented-id'] },
    });

    expect(outcome.status).toBe('done');
    expect(outcome.detail).toContain('לא נמצא');
    expect(store.coursesOf(store.students()[0].id).map((c) => c.id)).toEqual([methods.id]);
  });

  /** The assistant never makes a second row for a girl already there. */
  it('refuses a name already on the roster, and adds nobody', async () => {
    const { store, actions } = setup();
    store.addStudent('נועה כהן');

    const outcome = await actions.run({ name: 'add_student', args: { full_name: 'נועה כהן' } });

    expect(outcome.status).toBe('failed');
    expect(store.students()).toHaveLength(1);
  });

  it('refuses an address already on the roster', async () => {
    const { store, actions } = setup();
    store.addStudent('נועה כהן', 'noa@school.org.il');

    const outcome = await actions.run({
      name: 'add_student',
      args: { full_name: 'נ. כהן', email: 'NOA@school.org.il' },
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('המייל');
    expect(store.students()).toHaveLength(1);
  });
});

describe('acting on a student', () => {
  it('enrolls her in more courses', async () => {
    const { store, actions, methods, practicum } = setup();
    const noa = store.addStudent('נועה כהן', undefined, [methods.id])!;

    const outcome = await actions.run({
      name: 'enroll_student',
      args: { student_id: noa.id, course_ids: [practicum.id] },
    });

    expect(outcome.status).toBe('done');
    expect(store.coursesOf(noa.id)).toHaveLength(2);
  });

  /** A stale or invented id: nothing changes, and she is told. */
  it('does nothing with a student id that is not hers', async () => {
    const { store, actions, methods } = setup();

    const outcome = await actions.run({
      name: 'enroll_student',
      args: { student_id: 'not-a-student', course_ids: [methods.id] },
    });

    expect(outcome.status).toBe('failed');
    expect(store.courseStudents()).toEqual([]);
  });

  it('takes her out of a course and leaves her on the roster', async () => {
    const { store, actions, methods, practicum } = setup();
    const noa = store.addStudent('נועה כהן', undefined, [methods.id, practicum.id])!;

    const outcome = await actions.run({
      name: 'unenroll_student',
      args: { student_id: noa.id, course_ids: [methods.id] },
    });

    expect(outcome.status).toBe('done');
    expect(store.coursesOf(noa.id).map((c) => c.id)).toEqual([practicum.id]);
  });

  it('opens her latest paper', async () => {
    const { store, actions, visited } = setup();
    const noa = store.addStudent('נועה כהן')!;
    const paper = paperFor(store, noa.id);

    const outcome = await actions.run({ name: 'open_student_work', args: { student_id: noa.id } });

    expect(outcome.status).toBe('done');
    expect(visited).toEqual([`/review/${paper.id}`]);
  });

  it('says so when she has no paper yet, and goes nowhere', async () => {
    const { store, actions, visited } = setup();
    const noa = store.addStudent('נועה כהן')!;

    const outcome = await actions.run({ name: 'open_student_work', args: { student_id: noa.id } });

    expect(outcome.status).toBe('failed');
    expect(visited).toEqual([]);
  });
});

describe('deleting a student', () => {
  /** The one action that cannot be taken back waits for her. */
  it('asks first and deletes nothing', async () => {
    const { store, actions } = setup();
    const noa = store.addStudent('נועה כהן')!;

    const outcome = await actions.run({ name: 'delete_student', args: { student_id: noa.id } });

    expect(outcome.status).toBe('confirm');
    expect(outcome.detail).toContain('אי אפשר לבטל');
    expect(store.students()).toHaveLength(1);
  });

  it('deletes once she confirms', async () => {
    const { store, actions } = setup();
    const noa = store.addStudent('נועה כהן')!;

    const outcome = await actions.run(
      { name: 'delete_student', args: { student_id: noa.id } },
      true,
    );

    expect(outcome.status).toBe('done');
    expect(store.students()).toEqual([]);
  });
});

describe('the course and the screen', () => {
  it('creates a course and makes it the current one', async () => {
    const { store, actions } = setup();

    const outcome = await actions.run({
      name: 'create_course',
      args: { course_name: 'סמינריון', year: 'תשפ״ח' },
    });

    expect(outcome.status).toBe('done');
    expect(store.course()?.name).toBe('סמינריון');
  });

  it('sets the tone, and refuses a tone that is not one of the three', async () => {
    const { store, actions } = setup();

    expect((await actions.run({ name: 'set_comment_tone', args: { tone: 'harsh' } })).status).toBe(
      'failed',
    );
    expect((await actions.run({ name: 'set_comment_tone', args: { tone: 'gentle' } })).status).toBe(
      'done',
    );
    expect(store.course()?.comment_tone).toBe('gentle');
  });

  it('opens a screen it knows, and refuses one it does not', async () => {
    const { actions, visited } = setup();

    expect((await actions.run({ name: 'open_screen', args: { screen: 'courses' } })).status).toBe(
      'done',
    );
    expect((await actions.run({ name: 'open_screen', args: { screen: 'admin' } })).status).toBe(
      'failed',
    );
    expect(visited).toEqual(['/courses']);
  });

  it('adds a rule to the current course', async () => {
    const { store, actions } = setup();

    const outcome = await actions.run({
      name: 'add_course_rule',
      args: { text: 'כל טענה צריכה מקור' },
    });

    expect(outcome.status).toBe('done');
    expect(store.courseRules().some((r) => r.body === 'כל טענה צריכה מקור')).toBe(true);
  });
});

describe('drafting comments', () => {
  it('reports the drafting failure in the words the app uses for it', async () => {
    const { store, actions } = setup(null);
    const noa = store.addStudent('נועה כהן')!;
    paperFor(store, noa.id);

    const outcome = await actions.run({ name: 'draft_comments', args: { student_id: noa.id } });

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('קרדיטים');
  });

  it('reports how many comments it drafted, with the way to them', async () => {
    const { store, actions } = setup({ created: 3, discarded: 0 });
    const noa = store.addStudent('נועה כהן')!;
    const paper = paperFor(store, noa.id);

    const outcome = await actions.run({ name: 'draft_comments', args: { student_id: noa.id } });

    expect(outcome.status).toBe('done');
    expect(outcome.detail).toContain('3 הערות');
    expect(outcome.link).toBe(`/review/${paper.id}`);
  });
});

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A real `.docx`, built with the app's own zip writer. */
function docxFile(name: string, comments: { author: string; body: string }[] = []): File {
  const marks = comments
    .map((_, i) => `<w:commentRangeStart w:id="${i}"/><w:r><w:t>ציטוט</w:t></w:r><w:commentRangeEnd w:id="${i}"/>`)
    .join('');
  const entries = [
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${NS}"><w:body><w:p><w:r><w:t>פסקה מהקובץ</w:t></w:r></w:p><w:p>${marks}</w:p></w:body></w:document>`,
    },
  ];
  if (comments.length) {
    entries.push({
      name: 'word/comments.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="${NS}">` +
        comments
          .map(
            (c, i) =>
              `<w:comment w:id="${i}" w:author="${c.author}"><w:p><w:r><w:t>${c.body}</w:t></w:r></w:p></w:comment>`,
          )
          .join('') +
        `</w:comments>`,
    });
  }
  const bytes = writeZip(entries, new Date('2026-09-02T09:00:00Z'));
  return new File([bytes.buffer as ArrayBuffer], name);
}

describe('Drive', () => {
  it('syncs and reports what arrived and what it could not place', async () => {
    const { actions, drive } = setup();
    drive.outcome.unmatched = [{ name: 'x.docx', reason: 'no match' }];

    const outcome = await actions.run({ name: 'sync_drive', args: {} });

    expect(drive.syncs).toBe(1);
    expect(outcome.status).toBe('done');
    expect(outcome.detail).toContain('2 עבודות חדשות');
    expect(outcome.detail).toContain('קובץ אחד לא שויך');
  });

  it('reports a failed sync as failed, in the words of the failure', async () => {
    const { actions, drive } = setup();
    drive.outcome.error = 'החיבור לגוגל פג.';

    const outcome = await actions.run({ name: 'sync_drive', args: {} });

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toBe('החיבור לגוגל פג.');
  });

  it('sets the course folder from a link, then syncs it', async () => {
    const { store, actions, drive, practicum } = setup();

    const outcome = await actions.run({
      name: 'set_course_folder',
      args: { folder_url: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp' },
    });

    expect(outcome.status).toBe('done');
    expect(store.course()!.id).toBe(practicum.id);
    expect(store.watchedFolderId()).toBe('1AbCdEfGhIjKlMnOp');
    expect(drive.syncs).toBe(1);
  });

  it('refuses something that is not a folder link, and syncs nothing', async () => {
    const { store, actions, drive } = setup();

    const outcome = await actions.run({ name: 'set_course_folder', args: { folder_url: 'שלום' } });

    expect(outcome.status).toBe('failed');
    expect(store.watchedFolderId()).toBeFalsy();
    expect(drive.syncs).toBe(0);
  });

  it('starts the Google connection', async () => {
    const { actions, drive } = setup();

    await actions.run({ name: 'connect_drive', args: {} });

    expect(drive.connects).toBe(1);
  });
});

describe('what waits for her', () => {
  /** A comment in a student's document is something the student can read. */
  it('does not post to a document until she confirms', async () => {
    const { store, actions, drive } = setup();
    const noa = store.addStudent('נועה כהן')!;
    const paper = paperFor(store, noa.id);
    drive.waiting = [{}, {}];
    drive.report = { posted: 2, failed: 0, unplaced: [] };
    const action = { name: 'post_comments_to_document', args: { student_id: noa.id } } as const;

    const first = await actions.run(action);

    expect(first.status).toBe('confirm');
    expect(first.confirmLabel).toBe('כן, להוסיף');
    expect(first.detail).toContain('2');
    expect(drive.posted).toEqual([]);

    const second = await actions.run(action, true);

    expect(drive.posted).toEqual([paper.id]);
    expect(second.status).toBe('done');
    expect(second.detail).toContain('נוספו 2 הערות');
  });

  it('reports a post that did not go through as failed', async () => {
    const { store, actions, drive } = setup();
    const noa = store.addStudent('נועה כהן')!;
    paperFor(store, noa.id);
    drive.waiting = [{}];
    drive.report = null;

    const outcome = await actions.run(
      { name: 'post_comments_to_document', args: { student_id: noa.id } },
      true,
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toBe('החיבור לגוגל פג.');
  });

  it('does not delete a paper until she confirms, and keeps the student', async () => {
    const { store, actions } = setup();
    const noa = store.addStudent('נועה כהן')!;
    const paper = paperFor(store, noa.id);
    const action = { name: 'delete_paper', args: { student_id: noa.id } } as const;

    expect((await actions.run(action)).status).toBe('confirm');
    expect(store.submissions().map((p) => p.id)).toContain(paper.id);

    expect((await actions.run(action, true)).status).toBe('done');
    expect(store.submissions().map((p) => p.id)).not.toContain(paper.id);
    expect(store.students().map((s) => s.id)).toContain(noa.id);
  });

  it('does not replace the rubric until she confirms', async () => {
    const { actions } = setup();

    const outcome = await actions.run({
      name: 'add_rubric_from_file',
      args: { file_name: 'טופס.docx' },
    });

    expect(outcome.status).toBe('confirm');
    expect(outcome.confirmLabel).toBe('כן, לטעון');
  });
});

describe('attached files', () => {
  it('adds a Word file as the paper of the student named', async () => {
    const { store, actions } = setup();
    const noa = store.addStudent('נועה כהן')!;

    const outcome = await actions.run(
      { name: 'add_paper_from_file', args: { student_id: noa.id, file_name: 'עבודה.docx' } },
      false,
      [docxFile('אחר.docx'), docxFile('עבודה.docx')],
    );

    expect(outcome.status).toBe('done');
    const paper = store.submissions().find((p) => p.student_id === noa.id)!;
    expect(paper.drive_file_name).toBe('עבודה.docx');
    expect(outcome.link).toBe(`/review/${paper.id}`);
  });

  it('takes the only file attached when the name does not match exactly', async () => {
    const { store, actions } = setup();
    const noa = store.addStudent('נועה כהן')!;

    const outcome = await actions.run(
      { name: 'add_paper_from_file', args: { student_id: noa.id, file_name: 'עבודה' } },
      false,
      [docxFile('עבודה סופית.docx')],
    );

    expect(outcome.status).toBe('done');
  });

  it('will not guess between two files', async () => {
    const { store, actions } = setup();
    const noa = store.addStudent('נועה כהן')!;

    const outcome = await actions.run(
      { name: 'add_paper_from_file', args: { student_id: noa.id, file_name: 'עבודה' } },
      false,
      [docxFile('א.docx'), docxFile('ב.docx')],
    );

    expect(outcome.status).toBe('failed');
    expect(store.submissions()).toHaveLength(0);
  });

  it('says a broken file could not be read, and adds nothing', async () => {
    const { store, actions } = setup();
    const noa = store.addStudent('נועה כהן')!;

    const outcome = await actions.run(
      { name: 'add_paper_from_file', args: { student_id: noa.id, file_name: 'x.docx' } },
      false,
      [new File(['this is not a zip'], 'x.docx')],
    );

    expect(outcome.status).toBe('failed');
    expect(store.submissions()).toHaveLength(0);
  });

  it('adds course material from a text file, under the kind asked for', async () => {
    const { store, actions } = setup();

    const outcome = await actions.run(
      {
        name: 'add_material_from_file',
        args: { file_name: 'סילבוס.txt', material_kind: 'syllabus' },
      },
      false,
      [new File(['תוכן הסילבוס'], 'סילבוס.txt')],
    );

    expect(outcome.status).toBe('done');
    const added = store.courseMaterials().find((m) => m.title === 'סילבוס');
    expect(added?.kind).toBe('syllabus');
    expect(added?.content).toBe('תוכן הסילבוס');
  });

  it('learns her style from a file whose comments have one author', async () => {
    const { store, actions } = setup();
    const before = store.styleExamples().length;

    const outcome = await actions.run(
      { name: 'add_style_from_file', args: { file_name: 'מסומן.docx' } },
      false,
      [docxFile('מסומן.docx', [{ author: 'ליאורה', body: 'כדאי לחדד את הטענה' }])],
    );

    expect(outcome.status).toBe('done');
    expect(store.styleExamples().length).toBe(before + 1);
  });

  /** Someone else's comments would teach the model someone else's voice. */
  it('learns nothing from a file with several authors, and points to where she can choose', async () => {
    const { store, actions } = setup();
    const before = store.styleExamples().length;

    const outcome = await actions.run(
      { name: 'add_style_from_file', args: { file_name: 'מסומן.docx' } },
      false,
      [
        docxFile('מסומן.docx', [
          { author: 'ליאורה', body: 'כדאי לחדד' },
          { author: 'מרצה אחרת', body: 'לא ברור' },
        ]),
      ],
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('הסגנון שלי');
    expect(store.styleExamples().length).toBe(before);
  });
});
