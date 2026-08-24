import { TestBed } from '@angular/core/testing';

import { SupabaseService } from '../supabase/supabase';
import { DataStore } from './data-store';
import { EMPTY_SNAPSHOT, PersistedSnapshot, Repository } from './repository';
import { SessionData } from './session-data';

/**
 * Startup ordering, which is the part that was actually broken.
 *
 * Hydration used to run as a plain app initializer, racing Supabase's restore
 * of the stored session. It lost: the reads went out with no JWT, RLS returned
 * nothing rather than an error, and the screens showed the seeded course as
 * though it were a real account with no work in it.
 */

class RecordingRepository extends Repository {
  readonly kind = 'supabase' as const;

  loads = 0;
  rows: PersistedSnapshot = { ...EMPTY_SNAPSHOT };

  async load(): Promise<PersistedSnapshot> {
    this.loads += 1;
    return { ...this.rows };
  }

  /** Every write, in the order it was made — the order the FKs demand. */
  written: string[] = [];

  saveCourse = async () => void this.written.push('course');
  saveAssignment = async () => void this.written.push('assignment');
  saveStudent = async () => void this.written.push('student');
  saveCourseRule = async () => void this.written.push('course-rule');
  saveCourseMaterial = async () => void this.written.push('course-material');
  saveStyleExample = async () => void this.written.push('style-example');
  saveGradingCategory = async () => void this.written.push('grading-category');
  saveGradingEntry = async () => undefined;
  deleteGradingEntries = async () => undefined;
  saveStudentForm = async () => undefined;
  saveStudentEmail = async () => undefined;
  saveReliabilityCheck = async () => undefined;
  saveSubmission = async () => void this.written.push('submission');
  saveRound = async () => void this.written.push('round');
  saveAnnotation = async () => void this.written.push('annotation');
  saveFeedbackLog = async () => undefined;
  deleteAnnotations = async () => undefined;
  saveDriveFolder = async () => undefined;
}

/** Stands in for supabase-js, with the session restore held open on purpose. */
class FakeSupabase {
  isConfigured = true;
  teacherId: string | null = null;

  private settle!: () => void;
  readonly ready = new Promise<void>((resolve) => (this.settle = resolve));
  private listeners: ((id: string | null) => void)[] = [];

  onTeacherChange(handler: (id: string | null) => void) {
    this.listeners.push(handler);
  }

  /** The stored session comes back. */
  restore(teacherId: string | null) {
    this.teacherId = teacherId;
    if (teacherId) for (const l of this.listeners) l(teacherId);
    this.settle();
  }

  signIn(teacherId: string) {
    this.teacherId = teacherId;
    for (const l of this.listeners) l(teacherId);
  }

  signOut() {
    this.teacherId = null;
    for (const l of this.listeners) l(null);
  }
}

function boot(supabase: FakeSupabase, repository: Repository) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: supabase },
      { provide: Repository, useValue: repository },
    ],
  });
  return {
    store: TestBed.inject(DataStore),
    session: TestBed.inject(SessionData),
  };
}

describe('startup and the session', () => {
  let supabase: FakeSupabase;
  let repository: RecordingRepository;

  beforeEach(() => {
    localStorage.clear();
    supabase = new FakeSupabase();
    repository = new RecordingRepository();
  });

  afterEach(() => localStorage.clear());

  it('does not read anything before the stored session has been restored', async () => {
    const { session } = boot(supabase, repository);

    const started = session.start();
    // The restore has not resolved yet — this is the window the old code read in.
    expect(repository.loads).toBe(0);

    supabase.restore('teacher-1');
    await started;

    expect(repository.loads).toBe(1);
  });

  it('finishes startup with her records already in place', async () => {
    repository.rows = {
      ...EMPTY_SNAPSHOT,
      submissions: [{ id: 'sub-real', status: 'new' } as never],
    };

    const { store, session } = boot(supabase, repository);
    const started = session.start();
    supabase.restore('teacher-1');
    await started;

    expect(store.hydrated()).toBe(true);
    expect(store.submissions().some((s) => s.id === 'sub-real')).toBe(true);
  });

  it('reads nothing at all when she arrives signed out', async () => {
    const { store, session } = boot(supabase, repository);

    const started = session.start();
    supabase.restore(null);
    await started;

    expect(repository.loads).toBe(0);
    expect(store.hydrated()).toBe(false);
  });

  /**
   * The restore fires the change handler and startup then checks the session
   * itself. Keyed on anything less than "who did I load for", the second of
   * those starts a duplicate load while the first is still in flight.
   */
  it('loads once, not twice, when the restore and startup both see her', async () => {
    const { session } = boot(supabase, repository);

    const started = session.start();
    supabase.restore('teacher-1');
    await started;

    expect(repository.loads).toBe(1);
  });

  it('loads her records the moment she signs in', async () => {
    const { store, session } = boot(supabase, repository);
    const started = session.start();
    supabase.restore(null);
    await started;

    supabase.signIn('teacher-1');
    // A macrotask, not a fixed number of microtask turns: the load now also
    // provisions her baseline rows, so the chain is longer than it was.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repository.loads).toBe(1);
    expect(store.hydrated()).toBe(true);
  });

  /**
   * Two teachers sharing a staffroom laptop is an ordinary thing. Whatever the
   * first one loaded must not still be on screen for the second.
   */
  it('clears everything loaded on sign-out', async () => {
    repository.rows = {
      ...EMPTY_SNAPSHOT,
      submissions: [{ id: 'sub-hers', status: 'new' } as never],
    };

    const { store, session } = boot(supabase, repository);
    const started = session.start();
    supabase.restore('teacher-1');
    await started;

    expect(store.submissions().some((s) => s.id === 'sub-hers')).toBe(true);

    supabase.signOut();

    expect(store.submissions().some((s) => s.id === 'sub-hers')).toBe(false);
    expect(store.hydrated()).toBe(false);
  });

  /**
   * Nothing is created for her, and that is the change.
   *
   * Margin used to provision a demonstration course, a class of invented
   * students and their marked-up papers into every new account, so that the
   * screens had something to show and the foreign keys had something to point
   * at. It solved a real problem — records that exist only in memory are
   * refused by every key and by RLS `exists` checks — but it solved it by
   * writing fiction into her database under her own id, where it was
   * indistinguishable from her work.
   *
   * The account now stays empty until she makes something, and each thing she
   * makes is written the moment she makes it. Same guarantee, no fiction.
   */
  describe('the first sign-in', () => {
    it('writes nothing at all into an empty account', async () => {
      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore('teacher-1');
      await started;

      expect(repository.written).toEqual([]);
      expect(store.hasCourse()).toBe(false);
      expect(store.students()).toEqual([]);
      expect(store.submissions()).toEqual([]);
    });

    it('adopts the course she already has, without touching it', async () => {
      repository.rows = {
        ...EMPTY_SNAPSHOT,
        courses: [{ id: 'c-hers', teacher_id: 'teacher-1', name: 'הקורס שלי' } as never],
        students: [{ id: 's-hers', teacher_id: 'teacher-1', full_name: 'דנה' } as never],
      };

      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore('teacher-1');
      await started;

      expect(repository.written).toEqual([]);
      expect(store.course()?.name).toBe('הקורס שלי');
      expect(store.students().map((s) => s.full_name)).toEqual(['דנה']);
    });

    /**
     * Written immediately, not held and saved later.
     *
     * Everything else carries a foreign key to the course, and RLS checks like
     * `owns_submission` are `exists` clauses — so a course that exists only on
     * screen makes every later write read as a permissions error rather than
     * as an absence. That cost this project four separate debugging sessions.
     */
    it('writes the course the moment she makes one', async () => {
      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore('teacher-1');
      await started;

      const course = store.createCourse('שיטות מחקר', 'תשפ״ו');
      await store.settled();

      expect(course?.teacher_id).toBe('teacher-1');
      expect(repository.written).toEqual(['course']);
      expect(store.hasCourse()).toBe(true);
    });

    it('writes the assignment against the course she just made', async () => {
      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore('teacher-1');
      await started;

      const course = store.createCourse('שיטות מחקר', 'תשפ״ו');
      const assignment = store.createAssignment('עבודת גמר');
      await store.settled();

      expect(assignment?.course_id).toBe(course?.id);
      // The parent first, which is the order the foreign key demands.
      expect(repository.written).toEqual(['course', 'assignment']);
    });

    it('puts a student she adds on the roster and writes her', async () => {
      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore('teacher-1');
      await started;

      store.createCourse('שיטות מחקר', 'תשפ״ו');
      const student = store.addStudent('נועה ברקוביץ׳', 'noa@example.org');
      await store.settled();

      expect(student?.teacher_id).toBe('teacher-1');
      expect(store.students().map((s) => s.full_name)).toEqual(['נועה ברקוביץ׳']);
      expect(repository.written).toEqual(['course', 'student']);
    });

    /**
     * `courses_owner` compares `teacher_id` to `auth.uid()`, so a course minted
     * without her id is refused by Postgres — and because writes are
     * fire-and-forget it would sit on screen looking saved.
     */
    it('refuses to make anything with nobody signed in', async () => {
      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore(null);
      await started;

      expect(store.createCourse('שיטות מחקר', 'תשפ״ו')).toBeNull();
      expect(store.addStudent('נועה')).toBeNull();
      expect(repository.written).toEqual([]);
    });

    it('refuses a course with no name or no year', async () => {
      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore('teacher-1');
      await started;

      expect(store.createCourse('   ', 'תשפ״ו')).toBeNull();
      expect(store.createCourse('שיטות מחקר', '  ')).toBeNull();
      expect(repository.written).toEqual([]);
    });

    /** An assignment with no course would point at nothing. */
    it('refuses an assignment before there is a course', async () => {
      const { store, session } = boot(supabase, repository);
      const started = session.start();
      supabase.restore('teacher-1');
      await started;

      expect(store.createAssignment('עבודת גמר')).toBeNull();
      expect(repository.written).toEqual([]);
    });
  });

  /**
   * An unconfigured project used to boot onto the demonstration course, which
   * is how a broken setup came to look like a working one with no work in it.
   */
  it('boots empty when the project is not configured', async () => {
    supabase.isConfigured = false;
    const { store, session } = boot(supabase, repository);

    await session.start();

    expect(store.hydrated()).toBe(true);
    expect(store.submissions()).toEqual([]);
    expect(store.hasCourse()).toBe(false);
  });
});
