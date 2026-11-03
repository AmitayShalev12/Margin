import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { AnnotationGenerator } from '../ai/annotation-generator';
import { DataStore } from '../data/data-store';
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
    ],
  });

  const store = TestBed.inject(DataStore);
  const methods = store.createCourse('שיטות מחקר', 'תשפ״ז')!;
  const practicum = store.createCourse('עבודה מעשית', 'תשפ״ז')!;
  // Work attaches to an assignment; without one the store refuses an upload.
  store.createAssignment('עבודה סמינריונית');
  return { store, actions: TestBed.inject(AssistantActions), visited, methods, practicum };
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
