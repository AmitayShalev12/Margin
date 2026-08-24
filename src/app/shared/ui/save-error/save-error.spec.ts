import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from '../../../app';
import { routes } from '../../../app.routes';
import { DataStore } from '../../../core/data/data-store';
import { LocalRepository } from '../../../core/data/local-repository';
import {
  EMPTY_SNAPSHOT,
  NOT_SIGNED_IN,
  PersistedSnapshot,
  Repository,
} from '../../../core/data/repository';
import { seedId } from '../../../core/mock/seed-data';
import { SupabaseService } from '../../../core/supabase/supabase';
import { SaveError } from './save-error';
import { seedStore } from '../../../core/mock/seed-store';

/** The app starts empty; a spec that reads records installs the fixtures. */
function seeded(store: DataStore): DataStore {
  seedStore(store);
  return store;
}

/**
 * A teacher must never lose review work with no indication anything went
 * wrong. That is the whole of this file: every path that can fail silently is
 * asserted to produce something she can actually see on screen.
 */

/** Fails every write, the way a signed-out or offline session does. */
class FailingRepository extends Repository {
  readonly kind = 'supabase' as const;

  reason = 'TypeError: Failed to fetch';
  loadFails = false;
  /** Flipped by a test to simulate the connection coming back. */
  healed = false;

  saved: string[] = [];

  async load(): Promise<PersistedSnapshot> {
    if (this.loadFails) throw new Error(this.reason);
    return { ...EMPTY_SNAPSHOT };
  }

  private async write(what: string): Promise<void> {
    if (this.healed) {
      this.saved.push(what);
      return;
    }
    throw new Error(this.reason);
  }

  saveCourse = () => this.write('course');
  saveAssignment = () => this.write('assignment');
  saveStudent = () => this.write('student');
  saveCourseRule = () => this.write('course-rule');
  saveCourseMaterial = () => this.write('course-material');
  saveStyleExample = () => this.write('style-example');
  saveGradingCategory = () => this.write('grading-category');
  saveGradingEntry = () => this.write('grading-entry');
  deleteGradingEntries = () => this.write('grading-delete');
  saveStudentForm = () => this.write('student-form');
  saveStudentEmail = () => this.write('student-email');
  saveReliabilityCheck = () => this.write('reliability-check');
  saveSubmission = () => this.write('submission');
  saveRound = () => this.write('round');
  saveAnnotation = () => this.write('annotation');
  saveFeedbackLog = () => this.write('feedback-log');
  deleteAnnotations = () => this.write('delete');
  saveDriveFolder = () => this.write('drive-folder');
}

class FakeSupabase {
  isConfigured = true;
  loading = () => false;
  session = () => ({ access_token: 'jwt' });
  user = () => ({ id: 'teacher-1', email: 'ronit@school.org.il' });
  teacherId = 'teacher-1';
  signOut = async () => undefined;
  onTeacherChange = () => undefined;
  ready = Promise.resolve();
}

function boot(repository: Repository) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: Repository, useValue: repository },
      { provide: SupabaseService, useValue: new FakeSupabase() },
      provideRouter(routes),
    ],
  });
  return seeded(TestBed.inject(DataStore));
}

async function render<T>(component: Type<T>) {
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('a failed save is visible', () => {
  let repository: FailingRepository;
  let store: DataStore;

  beforeEach(() => {
    localStorage.clear();
    repository = new FailingRepository();
    store = boot(repository);
  });

  afterEach(() => localStorage.clear());

  it('says so on screen when a review decision does not reach the database', async () => {
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    const fixture = await render(SaveError);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('משהו לא נשמר');
    // The specific thing she needs to know, in as many words.
    expect(text).toContain('לא נשמרו');
    expect(text).toContain('יאבדו');
  });

  it('announces itself assertively, so it is not queued behind the screen', async () => {
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    const fixture = await render(SaveError);
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');

    expect(alert).toBeTruthy();
    expect(alert!.getAttribute('aria-live')).toBe('assertive');
  });

  /**
   * The shell renders it once, which is what makes it cover screens nobody
   * remembered to wire up — including any added later.
   */
  it('appears through the app shell, not only where it was wired in by hand', async () => {
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    const fixture = await render(App);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('משהו לא נשמר');
  });

  it('is silent when saves are going through', async () => {
    repository.healed = true;
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    const fixture = await render(SaveError);
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('names being signed out as the cause, because the fix is different', async () => {
    repository.reason = NOT_SIGNED_IN;
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    const fixture = await render(SaveError);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('ההתחברות פגה');
    expect(text).toContain('להתחבר שוב');
  });

  /**
   * Worse than a failed save, and easy to miss: with nothing loaded the
   * screens behind this banner show the seeded demonstration course, which is
   * indistinguishable from a real account with no work in it yet.
   */
  it('warns that the visible records are not hers when the load failed', async () => {
    repository.loadFails = true;
    await store.hydrate();

    const fixture = await render(SaveError);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('לא הצלחתי לטעון');
    expect(text).toContain('תוכן הדגמה');
  });

  // -- recovery -------------------------------------------------------------

  it('saves the work that failed once the connection is back', async () => {
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    store.editAnnotation(seedId('an-5'), 'האם באמת אקראי, או נוחות?');
    await store.settled();

    expect(store.persistError()).not.toBeNull();
    expect(store.unsavedCount()).toBeGreaterThan(0);

    repository.healed = true;
    const saved = await store.retryFailedWrites();

    expect(saved).toBe(true);
    expect(store.persistError()).toBeNull();
    expect(store.unsavedCount()).toBe(0);
    // Both halves of the decision reached the repository, not just the latest.
    expect(repository.saved).toContain('annotation');
    expect(repository.saved).toContain('feedback-log');
  });

  it('keeps the work queued when the retry fails too', async () => {
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    const saved = await store.retryFailedWrites();

    expect(saved).toBe(false);
    expect(store.unsavedCount()).toBeGreaterThan(0);
    expect(store.persistError()).not.toBeNull();
  });

  /**
   * One decision queues three writes — the comment, the learning log, the
   * grading-form line — and a missing shared parent fails all three. Reporting
   * only the last to settle named whichever table happened to be queued last,
   * which is how a real investigation went after `grading_form_entries` when
   * every write on that submission was being refused.
   */
  it('names every table that failed, not just the last one to come back', async () => {
    repository.reason = 'new row violates row-level security policy';
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    const failure = store.persistError()!;
    // Three writes went out; they share one cause, so one line is right here.
    expect(failure.details.length).toBe(1);
    expect(failure.count).toBeGreaterThan(1);

    // A second, different failure is added rather than replacing the first.
    repository.reason = 'permission denied for table annotations';
    store.setAnnotationStatus(seedId('an-6'), 'accepted');
    await store.settled();

    expect(store.persistError()!.details.length).toBe(2);
  });

  it('keeps the graver load wording when a save fails on top of it', async () => {
    repository.loadFails = true;
    await store.hydrate();
    expect(store.persistError()!.kind).toBe('load');

    repository.loadFails = false;
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    // Still the load message: her records never arrived, which is worse than
    // one unsaved change and is what she needs to act on.
    expect(store.persistError()!.kind).toBe('load');
  });

  /**
   * The reason `persistError` is an object and not a message string: a signal
   * holding the same string twice never emits, so dismissing and then failing
   * identically would leave her with no banner and unsaved work.
   */
  it('comes back after she dismisses it and the identical failure happens again', async () => {
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();
    expect(store.persistError()).not.toBeNull();

    store.dismissPersistError();
    expect(store.persistError()).toBeNull();

    store.setAnnotationStatus(seedId('an-6'), 'accepted');
    await store.settled();

    const failure = store.persistError();
    expect(failure).not.toBeNull();
    expect(failure!.details).toEqual(['TypeError: Failed to fetch']);
  });
});

/**
 * The local adapter is what an unconfigured checkout runs on, and it must not
 * start crying wolf: nothing here fails, so nothing should be reported.
 */
describe('the browser-storage adapter', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reports no failure for an ordinary decision', async () => {
    const store = boot(new LocalRepository());
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();

    expect(store.persistError()).toBeNull();
  });
});

/**
 * A token the validator thinks came from the future.
 *
 * Not her clock and not her account: Supabase mints the token in one service
 * and validates it in another, and a fraction of a second between them is
 * enough. It clears immediately — but giving up on it drops every screen to the
 * seeded demonstration course, and the first thing she touches is then refused
 * by RLS for a reason that looks nothing like the cause.
 */
describe('a token that is momentarily too new', () => {
  class SkewedRepository extends FailingRepository {
    attempts = 0;
    /** How many loads fail before one succeeds. */
    failures = 1;
    message = 'assignments: JWT issued at future';

    override async load(): Promise<PersistedSnapshot> {
      this.attempts += 1;
      if (this.attempts <= this.failures) throw new Error(this.message);
      return { ...EMPTY_SNAPSHOT };
    }
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('waits it out instead of dropping to the demonstration course', async () => {
    const repository = new SkewedRepository();
    const store = boot(repository);

    await store.hydrate();

    expect(repository.attempts).toBe(2);
    // The load itself is not reported — the second attempt was fine.
    expect(store.persistError()?.kind).not.toBe('load');
    expect(store.loadedHerRecords()).toBe(true);
  });

  it('reports it when it is not a race', async () => {
    const repository = new SkewedRepository();
    repository.failures = 2;
    const store = boot(repository);

    await store.hydrate();

    expect(repository.attempts).toBe(2);
    expect(store.persistError()?.kind).toBe('load');
    expect(store.loadedHerRecords()).toBe(false);
  });

  /** An expired or malformed token is genuinely wrong and must not be retried. */
  it('does not retry a token that is simply invalid', async () => {
    const repository = new SkewedRepository();
    repository.failures = 1;
    repository.message = 'assignments: JWT expired';
    const store = boot(repository);

    await store.hydrate();

    expect(repository.attempts).toBe(1);
    expect(store.persistError()?.kind).toBe('load');
  });

  /**
   * The second half of the cascade. With the demonstration course on screen,
   * every student belongs to the demonstration teacher — so confirming one's
   * Drive account is a write RLS will refuse, and it must not be offered.
   */
  it('offers nothing to confirm while the records are not hers', async () => {
    const repository = new SkewedRepository();
    repository.failures = 5;
    const store = boot(repository);

    await store.hydrate();

    expect(store.loadedHerRecords()).toBe(false);
    expect(store.observedAccounts()).toEqual([]);
  });
});
