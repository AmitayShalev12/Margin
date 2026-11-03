import { TestBed } from '@angular/core/testing';

import { DataStore } from './data-store';
import { LocalRepository } from './local-repository';
import { Repository } from './repository';
import { SupabaseService } from '../supabase/supabase';

/**
 * Enrolling a student in courses.
 *
 * "Allow multiple courses to be selected, create the student once, and enroll
 * her in all selected courses." The failure worth guarding is the obvious way
 * to build it: one `addStudent` per ticked course, which puts the same girl on
 * the roster three times — and every later screen resolves a name through the
 * roster, so her work would split three ways.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function boot(): DataStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  return TestBed.inject(DataStore);
}

function twoCourses(store: DataStore) {
  const methods = store.createCourse('שיטות מחקר', 'תשפ״ז')!;
  const practicum = store.createCourse('עבודה מעשית', 'תשפ״ז')!;
  return { methods, practicum };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('adding a student to several courses', () => {
  it('creates her once and enrolls her in every course ticked', () => {
    const store = boot();
    const { methods, practicum } = twoCourses(store);

    const noa = store.addStudent('נועה ברקוביץ׳', 'noa@school.org.il', [methods.id, practicum.id]);

    expect(store.students().filter((s) => s.full_name === 'נועה ברקוביץ׳')).toHaveLength(1);
    expect(
      store
        .coursesOf(noa!.id)
        .map((c) => c.id)
        .sort(),
    ).toEqual([methods.id, practicum.id].sort());
    expect(store.courseStudents()).toHaveLength(2);
  });

  it('puts her on the roster even with no course ticked', () => {
    const store = boot();
    twoCourses(store);

    const noa = store.addStudent('נועה ברקוביץ׳', undefined, []);

    expect(noa).not.toBeNull();
    expect(store.coursesOf(noa!.id)).toEqual([]);
  });

  /**
   * The database refuses a course she does not own (RLS checks both ends).
   * Writing it anyway would surface as a save error she can do nothing about.
   */
  it('skips a course id that is not one of hers', () => {
    const store = boot();
    const { methods } = twoCourses(store);

    const noa = store.addStudent('נועה ברקוביץ׳', undefined, [methods.id, 'not-a-course']);

    expect(store.coursesOf(noa!.id).map((c) => c.id)).toEqual([methods.id]);
  });

  /** The table is unique on the pair; a second row would be refused. */
  it('does not enroll her twice in the same course', () => {
    const store = boot();
    const { methods, practicum } = twoCourses(store);
    const noa = store.addStudent('נועה ברקוביץ׳', undefined, [methods.id]);

    const added = store.enrollStudent(noa!.id, [methods.id, practicum.id, practicum.id]);

    expect(added.map((c) => c.id)).toEqual([practicum.id]);
    expect(store.courseStudents()).toHaveLength(2);
  });

  it('can take her out of one course and leave her on the roster', () => {
    const store = boot();
    const { methods, practicum } = twoCourses(store);
    const noa = store.addStudent('נועה ברקוביץ׳', undefined, [methods.id, practicum.id]);

    expect(store.unenrollStudent(noa!.id, methods.id)).toBe(true);

    expect(store.coursesOf(noa!.id).map((c) => c.id)).toEqual([practicum.id]);
    expect(store.students().some((s) => s.id === noa!.id)).toBe(true);
  });

  it('drops her enrollments when she is removed', () => {
    const store = boot();
    const { methods, practicum } = twoCourses(store);
    const noa = store.addStudent('נועה ברקוביץ׳', undefined, [methods.id, practicum.id]);

    store.deleteStudent(noa!.id);

    expect(store.courseStudents()).toEqual([]);
  });

  it('keeps the enrollments across a reload', async () => {
    const first = boot();
    const { methods, practicum } = twoCourses(first);
    const noa = first.addStudent('נועה ברקוביץ׳', undefined, [methods.id, practicum.id]);
    await first.settled();

    const second = boot();
    expect(second.courseStudents()).toEqual([]);
    await second.hydrate();

    expect(
      second
        .coursesOf(noa!.id)
        .map((c) => c.id)
        .sort(),
    ).toEqual([methods.id, practicum.id].sort());
  });
});
