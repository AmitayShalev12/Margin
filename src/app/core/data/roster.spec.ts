import { TestBed } from '@angular/core/testing';

import { DataStore } from './data-store';
import { LocalRepository } from './local-repository';
import { Repository } from './repository';
import { TEACHER_ID, seedId } from '../mock/seed-data';
import { seedStore } from '../mock/seed-store';
import { SupabaseService } from '../supabase/supabase';

/**
 * Removing people and papers, and noticing when one arrives twice.
 *
 * Every list in this app could be added to and none could be corrected: a girl
 * who left the course, a duplicate row from a re-sync, a paper picked up from
 * the wrong folder — all of it stayed on screen for the year.
 *
 * The tests that matter are about what a delete takes with it. A student
 * removed while her papers stay leaves submissions belonging to nobody, and
 * every screen resolves a name through the roster: those rows would render
 * with a blank where a girl used to be.
 */

const NOA = seedId('sub-noa');

class FakeSupabase {
  isConfigured = true;
  teacherId = TEACHER_ID;
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
  const store = TestBed.inject(DataStore);
  seedStore(store);
  return store;
}

beforeEach(() => localStorage.clear());

describe('removing a student', () => {
  it('takes her off the roster', () => {
    const store = boot();
    const student = store.students()[0];

    store.deleteStudent(student.id);

    expect(store.students().some((s) => s.id === student.id)).toBe(false);
  });

  /**
   * The cascade. A paper left behind belongs to nobody, and every screen
   * resolves the name through the roster — the row would render with a blank
   * where a girl used to be.
   */
  it('takes her papers, their comments and their scores with her', () => {
    const store = boot();
    const submission = store.submission(NOA)!;
    expect(store.annotations().some((a) => a.submission_id === NOA)).toBe(true);

    store.deleteStudent(submission.student_id);

    expect(store.submission(NOA)).toBeUndefined();
    expect(store.annotations().some((a) => a.submission_id === NOA)).toBe(false);
    expect(store.roundFor(NOA)).toBeUndefined();
    expect(store.criterionScores(NOA)).toEqual([]);
  });

  it('leaves the other students alone', () => {
    const store = boot();
    const [first, second] = store.students();

    store.deleteStudent(first.id);

    expect(store.students().some((s) => s.id === second.id)).toBe(true);
  });

  it('ignores a student who is not there', () => {
    const store = boot();
    const before = store.students().length;

    store.deleteStudent('no-such-student');

    expect(store.students().length).toBe(before);
  });
});

describe('removing one paper', () => {
  it('removes the row and everything hanging off it', () => {
    const store = boot();

    store.deleteSubmission(NOA);

    expect(store.submission(NOA)).toBeUndefined();
    expect(store.roundFor(NOA)).toBeUndefined();
    expect(store.annotations().some((a) => a.submission_id === NOA)).toBe(false);
  });

  /** Deleting a paper is not deleting the girl who wrote it. */
  it('leaves the student on the roster', () => {
    const store = boot();
    const owner = store.submission(NOA)!.student_id;

    store.deleteSubmission(NOA);

    expect(store.students().some((s) => s.id === owner)).toBe(true);
  });
});

describe('noticing that a student is already there', () => {
  /**
   * "המזהה יהיה כפול לא רק המייל אלא גם השם". Keyed on the address alone, the
   * same girl gets in twice under two mail accounts; keyed on the name alone,
   * two genuinely different girls called נועה cannot both be added.
   */
  it('recognises an address already on the roster', () => {
    const store = boot();
    const student = store.students()[0];
    // The fixtures carry no addresses, so one is set through the real setter
    // rather than asserted against a row that never had one.
    store.setStudentDriveAccount(student.id, 'noa@school.org.il');

    const clash = store.findStudentClash('שם אחר לגמרי', 'noa@school.org.il');

    expect(clash?.student.id).toBe(student.id);
    expect(clash?.on).toBe('email');
  });

  it('recognises a name already on the roster', () => {
    const store = boot();
    const student = store.students()[0];

    const clash = store.findStudentClash(student.full_name);

    expect(clash?.student.id).toBe(student.id);
    expect(clash?.on).toBe('name');
  });

  /** ברקוביץ׳ and ברקוביץ' are one surname typed on two keyboards. */
  it('sees past the geresh', () => {
    const store = boot();
    // נועה ברקוביץ׳ is in the fixtures, so this asserts on a real row rather
    // than skipping itself when it finds none.
    const student = store.students().find((s) => s.full_name.includes('׳'));
    expect(student).toBeDefined();

    const typedDifferently = student!.full_name.replace(/׳/g, "'");

    expect(store.findStudentClash(typedDifferently)?.student.id).toBe(student!.id);
  });

  /**
   * The address is the stronger identifier, so it is reported first: two girls
   * can share a name, but a mail account is one person.
   */
  it('reports the address when both would match', () => {
    const store = boot();
    const student = store.students()[0];
    store.setStudentDriveAccount(student.id, 'noa@school.org.il');

    const clash = store.findStudentClash(student.full_name, 'noa@school.org.il');

    expect(clash?.on).toBe('email');
  });

  it('says nothing about a girl who is genuinely new', () => {
    const store = boot();

    expect(store.findStudentClash('תלמידה חדשה לגמרי', 'new@school.org.il')).toBeNull();
  });
});
