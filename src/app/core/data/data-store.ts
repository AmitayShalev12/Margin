import { Injectable, computed, inject, signal } from '@angular/core';

import { buildCategories } from '../grading/categories';
import { buildEntries } from '../grading/entries';
import { newId, derivedId } from '../ids';
import { describeEdit } from '../learning/style-profile';
import {
  Annotation,
  AnnotationStatus,
  Assignment,
  Course,
  CourseMaterial,
  CourseRule,
  GradingFormCategory,
  GradingFormEntry,
  LearningAction,
  LearningFeedbackLog,
  LearningTargetType,
  ReliabilityCheck,
  Submission,
  SubmissionRound,
  SubmissionStatus,
  Student,
  StudentEmail,
  StudentGradingForm,
  TeacherStyleExample,
  UUID,
} from '../models';
import { UnmatchedFile } from '../drive/sync';
import { SupabaseService } from '../supabase/supabase';
import { NOT_SIGNED_IN, PersistedSnapshot, Repository } from './repository';

/**
 * The app's record store.
 *
 * It starts out holding the seeded demonstration records, layers anything
 * durable over them on boot, and writes every change straight back out. Field
 * names and shapes are the Supabase tables' exactly, so the repository can
 * upsert records as they are.
 *
 * Writes are fire-and-forget: the signal updates immediately so the screen
 * never waits on the network, and a failure surfaces on `persistError`
 * instead of being swallowed.
 */

/**
 * A read or write that did not reach Postgres.
 *
 * An object rather than a message string, and for a reason that bit: a signal
 * holding the same string twice never emits, so dismissing a failure and then
 * hitting the identical one again would tell her nothing. The count changes
 * every time, so every failure surfaces.
 */
export interface PersistFailure {
  /** `load` means her records never arrived; `save` means work is unsaved. */
  kind: 'load' | 'save';
  /** Failures since she was last told. */
  count: number;
  /** True when the cause is simply that nobody is signed in. */
  signedOut: boolean;
  /**
   * Every distinct raw error since she was last told, not just the newest.
   *
   * One decision queues three writes — the comment, the learning log, the
   * grading-form line — and they fail together when their shared parent is
   * missing. Keeping only the last one to settle named whichever table came
   * last in the queue, which sent a real investigation after the wrong table
   * while the actual failure was one level up.
   */
  details: string[];
}

export type SyncPhase = 'idle' | 'syncing' | 'error';

export interface SyncState {
  phase: SyncPhase;
  last_synced_at: string | null;
  /** Hebrew, teacher-facing. Null when the last sync was clean. */
  message: string | null;
  created: number;
  updated: number;
  /**
   * How many of them a student shared directly, rather than dropping into the
   * year folder. Kept apart because "the folder is empty" and "nobody shared
   * anything" are different problems with different fixes.
   */
  shared: number;
  /** Files that produced no submission, and why — never just how many. */
  unmatched: UnmatchedFile[];
}

const IDLE: SyncState = {
  phase: 'idle',
  last_synced_at: null,
  message: null,
  created: 0,
  updated: 0,
  shared: 0,
  unmatched: [],
};

@Injectable({ providedIn: 'root' })
export class DataStore {
  private readonly repository = inject(Repository);
  private readonly supabase = inject(SupabaseService);

  private readonly folders = signal<Record<UUID, string>>({});
  /**
   * Empty until she makes something.
   *
   * There is no demonstration course any more, and nothing on any screen that
   * she did not create or that did not come out of her Drive. The app used to
   * start holding a fictional teacher's course, roster and marked-up papers,
   * which read as real — the names rendered, the AI prompt quoted them, and
   * the first write against one was refused by RLS for a reason that looked
   * like a permissions bug rather than "this record was never yours".
   */
  private readonly _course = signal<Course | null>(null);
  private readonly _assignment = signal<Assignment | null>(null);
  private readonly _submissions = signal<Submission[]>([]);
  private readonly _rounds = signal<SubmissionRound[]>([]);
  private readonly _students = signal<Student[]>([]);
  private readonly _courseRules = signal<CourseRule[]>([]);
  private readonly _courseMaterials = signal<CourseMaterial[]>([]);
  private readonly _gradingCategories = signal<GradingFormCategory[]>([]);
  private readonly _gradingEntries = signal<GradingFormEntry[]>([]);
  private readonly _studentForms = signal<StudentGradingForm[]>([]);
  private readonly _studentEmails = signal<StudentEmail[]>([]);
  private readonly _reliabilityChecks = signal<ReliabilityCheck[]>([]);
  private readonly _annotations = signal<Annotation[]>([]);
  private readonly _feedbackLogs = signal<LearningFeedbackLog[]>([]);
  private readonly _styleExamples = signal<TeacherStyleExample[]>([]);
  private readonly _sync = signal<SyncState>(IDLE);
  private readonly _hydrated = signal(false);
  private readonly _loadedHers = signal(false);
  private readonly _persistError = signal<PersistFailure | null>(null);

  /** True once durable records have been layered in. */
  readonly hydrated = this._hydrated.asReadonly();

  /**
   * True when the records on screen came from her account.
   *
   * Distinct from `hydrated`, which only means startup finished. After a failed
   * load the screens show the seeded demonstration course, and anything that
   * writes one of those rows is refused — a seeded student carries the
   * demonstration teacher's id, so `students_owner` rejects it every time. The
   * app must not offer actions over records it knows are not hers.
   */
  readonly loadedHerRecords = this._loadedHers.asReadonly();
  readonly persistError = this._persistError.asReadonly();

  readonly students = this._students.asReadonly();
  readonly courseRules = this._courseRules.asReadonly();
  readonly courseMaterials = this._courseMaterials.asReadonly();
  readonly gradingCategories = this._gradingCategories.asReadonly();
  readonly gradingEntries = this._gradingEntries.asReadonly();
  readonly studentForms = this._studentForms.asReadonly();
  readonly studentEmails = this._studentEmails.asReadonly();
  readonly reliabilityChecks = this._reliabilityChecks.asReadonly();
  readonly submissions = this._submissions.asReadonly();
  readonly rounds = this._rounds.asReadonly();
  readonly annotations = this._annotations.asReadonly();
  readonly sync = this._sync.asReadonly();

  /** Every decision she has made on a drafted comment, newest last. */
  readonly feedbackLogs = this._feedbackLogs.asReadonly();
  readonly styleExamples = this._styleExamples.asReadonly();

  /**
   * Her course, or null before she has made one.
   *
   * Nullable on purpose rather than standing in with a placeholder: a
   * placeholder course would be shown, written to and reasoned about exactly
   * as a real one, and every screen would have to know which it was holding
   * without being told. Null makes "there is no course yet" a state the
   * compiler asks about at each of the fourteen places that care.
   *
   * Folder ids come from the persisted map when set, else from the record.
   */
  readonly course = computed<Course | null>(() => {
    const course = this._course();
    if (!course) return null;
    return { ...course, drive_folder_id: this.folders()[course.id] ?? course.drive_folder_id };
  });

  readonly assignment = computed<Assignment | null>(() => {
    const assignment = this._assignment();
    if (!assignment) return null;
    return {
      ...assignment,
      drive_folder_id: this.folders()[assignment.id] ?? assignment.drive_folder_id,
    };
  });

  /** True once she has a course. Everything else waits on it. */
  readonly hasCourse = computed(() => !!this._course());
  /** True once there is an assignment for work to attach to. */
  readonly hasAssignment = computed(() => !!this._assignment());

  /**
   * The authorities she defers to.
   *
   * Stored as course materials of kind `reference`, because that is what they
   * are and the table already holds them — a source with a URL needed no new
   * table, no migration and no third RLS policy to keep in step.
   */
  readonly sources = computed(() =>
    this._courseMaterials().filter((m) => m.kind === 'reference' && m.active),
  );

  /**
   * Student Drive accounts she has confirmed.
   *
   * The whole input to the shared-with-me query: Margin asks Drive for
   * documents owned by these addresses and by nobody else, so an ordinary sync
   * never enumerates the rest of what has been shared with her. It is also
   * what makes a sync possible with no folder chosen at all.
   */
  readonly confirmedDriveAccounts = computed(() =>
    this._students()
      .map((s) => s.drive_account_email?.trim().toLowerCase())
      .filter((email): email is string => !!email),
  );

  /** The folder the sync actually watches: the assignment's, else the course's. */
  readonly watchedFolderId = computed(
    () => this.assignment()?.drive_folder_id ?? this.course()?.drive_folder_id ?? null,
  );

  readonly liveAnnotations = computed(() =>
    this._annotations().filter((a) => a.status !== 'dismissed'),
  );

  /**
   * Loads durable records over the seeded ones.
   *
   * Persisted records win by id, so review work done on a seeded submission
   * survives a reload just as work on a synced one does. Called once at
   * startup, before the first screen renders.
   */
  async hydrate(): Promise<void> {
    let snapshot: PersistedSnapshot;
    try {
      snapshot = await this.loadPastTokenSkew();
    } catch (error) {
      // Nothing loaded means the screens are about to show seeded records.
      // She has to be told, or she reads a demonstration course as her own.
      this.noteFailure('load', error);
      this._hydrated.set(true);
      return;
    }

    this.applySnapshot(snapshot);
    // Reached only when the load came back — the catch above returns early.
    this._loadedHers.set(true);

    // "Last synced" is not its own record — it is simply the most recent one
    // stamped on a submission, so it comes back with them.
    const latest = snapshot.submissions
      .map((s) => s.last_synced_at)
      .filter((at): at is string => !!at)
      .sort()
      .at(-1);
    if (latest) this._sync.update((state) => ({ ...state, last_synced_at: latest }));

    this._hydrated.set(true);
  }

  /**
   * Puts a loaded set of records on screen.
   *
   * Extracted from `hydrate` because it is also how a test installs fixtures:
   * the demonstration records that used to be the app's starting state are now
   * a fixture module nothing in `src/app` imports, and a spec that wants them
   * hands them through this same path rather than through a door of its own.
   * One code path, so a test cannot pass against rules the app does not use.
   */
  applySnapshot(snapshot: PersistedSnapshot): void {
    if (snapshot.courses.length) this._course.set(snapshot.courses[0]);
    if (snapshot.assignments.length) this._assignment.set(snapshot.assignments[0]);
    if (snapshot.students.length) this._students.set(snapshot.students);
    if (snapshot.courseRules.length) this._courseRules.set(snapshot.courseRules);
    if (snapshot.courseMaterials.length) this._courseMaterials.set(snapshot.courseMaterials);

    this._submissions.update((list) => mergeById(list, snapshot.submissions));
    this._rounds.update((list) => mergeById(list, snapshot.rounds));

    /**
     * A round that has been written to owns its comments outright: whatever is
     * persisted for it is the whole set. Merging by id instead would make a
     * comment un-removable — a drafted batch that replaced them would come
     * back alongside them on the next load, and a discarded batch would
     * resurrect them.
     */
    const rewrittenRounds = new Set(snapshot.rounds.map((r) => r.id));
    this._annotations.update((list) =>
      mergeById(
        list.filter((a) => !rewrittenRounds.has(a.round_id)),
        snapshot.annotations,
      ),
    );

    // Merged by id: a decision she made stands on its own.
    this._feedbackLogs.update((list) => mergeById(list, snapshot.feedbackLogs));
    this._styleExamples.update((list) => mergeById(list, snapshot.styleExamples));

    // The grading form's headings come from her own past years when there are
    // any; `buildCategories` falls back to the starting set only for a course
    // with no history at all.
    const courseId = this._course()?.id;
    this._gradingCategories.set(
      courseId ? buildCategories(courseId, snapshot.gradingCategories) : [],
    );
    this._gradingEntries.set(snapshot.gradingEntries);
    this._studentForms.set(snapshot.studentForms);
    this._studentEmails.set(snapshot.studentEmails);
    this._reliabilityChecks.set(snapshot.reliabilityChecks);

    this.folders.set(snapshot.driveFolders);
  }

  /**
   * Loads, retrying once past a token that is momentarily too new.
   *
   * `JWT issued at future` is not a fault in her account or her clock — it is
   * a race inside Supabase, between the service that mints the token and the
   * one that validates it. A fraction of a second apart is enough, and it
   * clears immediately.
   *
   * Worth retrying rather than reporting because of what giving up costs:
   * hydration falls back to the seeded demonstration course, every screen then
   * shows records that are not hers, and the first thing she touches is
   * refused by RLS for an unrelated-looking reason. One retry avoids the whole
   * cascade; a second failure is reported, because then it is not a race.
   */
  private async loadPastTokenSkew(): Promise<PersistedSnapshot> {
    try {
      return await this.repository.load();
    } catch (error) {
      if (!isTokenTooNew(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, TOKEN_SKEW_RETRY_MS));
      return this.repository.load();
    }
  }

  // -- the things she makes -------------------------------------------------

  /**
   * Her course. The first thing that has to exist.
   *
   * Written immediately rather than held in memory and saved later, because a
   * course that exists only on screen is the exact shape of bug this app spent
   * a phase chasing: everything else carries a foreign key to it, and RLS
   * checks like `owns_submission` are `exists` clauses, so a parent that was
   * never written reads as a permissions error rather than as an absence.
   *
   * Refused when nobody is signed in. `courses_owner` compares `teacher_id` to
   * `auth.uid()`, so a course minted without her id is refused by Postgres —
   * and it would sit on screen looking saved, because writes are
   * fire-and-forget.
   */
  createCourse(name: string, year: string): Course | null {
    const teacherId = this.supabase.teacherId;
    if (!teacherId) return null;

    const title = name.trim();
    const term = year.trim();
    if (!title || !term) return null;

    const now = new Date().toISOString();
    const course: Course = {
      id: newId(),
      teacher_id: teacherId,
      name: title,
      year: term,
      description: null,
      drive_course_folder_id: null,
      drive_folder_id: null,
      archived: false,
      created_at: now,
      updated_at: now,
    };

    this._course.set(course);
    this.persist(() => this.repository.saveCourse(course));
    return course;
  }

  /** The assignment work attaches to. One per course, for now. */
  createAssignment(title: string): Assignment | null {
    const course = this._course();
    const name = title.trim();
    if (!course || !name) return null;

    const now = new Date().toISOString();
    const assignment: Assignment = {
      id: newId(),
      course_id: course.id,
      title: name,
      brief: null,
      due_at: null,
      drive_folder_id: null,
      expected_min_words: null,
      archived: false,
      created_at: now,
      updated_at: now,
    };

    this._assignment.set(assignment);
    this.persist(() => this.repository.saveAssignment(assignment));
    return assignment;
  }

  /**
   * An authority she wants the drafting to follow.
   *
   * `url` is a pointer for her, not a fetch instruction: nothing in Margin
   * opens it. What reaches the model is the name and whatever she wrote in
   * `notes` — which is why the field beside it asks what to take from the
   * source rather than treating the link as self-explanatory.
   */
  addSource(title: string, url: string, notes: string): CourseMaterial | null {
    const course = this._course();
    const name = title.trim();
    if (!course || !name) return null;

    const now = new Date().toISOString();
    const source: CourseMaterial = {
      id: newId(),
      course_id: course.id,
      kind: 'reference',
      title: name,
      notes: notes.trim() || null,
      content: null,
      drive_file_id: null,
      external_url: url.trim() || null,
      active: true,
      created_at: now,
      updated_at: now,
    };

    this._courseMaterials.update((list) => [...list, source]);
    this.persist(() => this.repository.saveCourseMaterial(source));
    return source;
  }

  /**
   * Switches a source off without losing it.
   *
   * Deactivated rather than deleted: a source she turns off mid-year is a
   * decision she may reverse, and the comments already written under it stay
   * explicable if the thing they deferred to is still on record.
   */
  setSourceActive(id: UUID, active: boolean) {
    let written: CourseMaterial | undefined;
    this._courseMaterials.update((list) =>
      list.map((m) => {
        if (m.id !== id || m.active === active) return m;
        written = { ...m, active };
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveCourseMaterial(written!));
  }

  /**
   * Comments she wrote by hand, years before this app existed.
   *
   * A teacher who has been marking papers for a decade already has what Margin
   * otherwise spends a year learning: hundreds of notes in her own words, in
   * old Word documents. Read back in, each one paired with the sentence it was
   * written about, they are style examples of exactly the kind the drafting
   * prompt already takes — so nothing downstream has to know they came from a
   * file rather than from this year's review screen.
   *
   * The id is derived from the pair's own text, which makes re-importing the
   * same document a no-op instead of a second copy of her voice. Returns how
   * many were new, because "0 added" and "48 added" are different answers to
   * the same click and she should not have to guess which happened.
   */
  importStyleExamples(pairs: readonly { quote: string | null; body: string }[]): number {
    const teacherId = this.supabase.teacherId;
    if (!teacherId) return 0;

    const courseId = this._course()?.id ?? null;
    const seen = new Set(this._styleExamples().map((e) => e.id));
    const now = new Date().toISOString();
    const written: TeacherStyleExample[] = [];

    for (const pair of pairs) {
      const teacherText = pair.body.trim();
      if (!teacherText) continue;

      const studentText = pair.quote?.trim() || null;
      const id = derivedId('style-example', `${studentText ?? ''}\u00bb${teacherText}`);
      if (seen.has(id)) continue;
      seen.add(id);

      written.push({
        id,
        teacher_id: teacherId,
        course_id: courseId,
        source: 'past_feedback',
        student_text: studentText,
        teacher_text: teacherText,
        tags: [],
        active: true,
        created_at: now,
        updated_at: now,
      });
    }

    if (!written.length) return 0;

    this._styleExamples.update((list) => [...list, ...written]);
    for (const row of written) this.persist(() => this.repository.saveStyleExample(row));
    return written.length;
  }

  /**
   * A student on the roster.
   *
   * The roster is what work is attributed to — by the Drive account she
   * confirms, or failing that by the file name — so it has to be possible to
   * put a real girl on it. It used to exist only because the app shipped with
   * a fictional class already in it.
   */
  addStudent(fullName: string, email?: string): Student | null {
    const teacherId = this.supabase.teacherId;
    const name = fullName.trim();
    if (!teacherId || !name) return null;

    const now = new Date().toISOString();
    const student: Student = {
      id: newId(),
      teacher_id: teacherId,
      full_name: name,
      email: email?.trim() || null,
      class_name: null,
      drive_account_email: null,
      notes: null,
      active: true,
      created_at: now,
      updated_at: now,
    };

    this._students.update((list) => [...list, student]);
    this.persist(() => this.repository.saveStudent(student));
    return student;
  }

  /**
   * Drops everything loaded and returns to empty.
   *
   * Called on sign-out. Without it the next person to sign in on this machine
   * would see the previous teacher's submissions until hydration finished
   * replacing them — and would see hers permanently for any record the new
   * account has none of.
   */
  reset(): void {
    this._course.set(null);
    this._assignment.set(null);
    this._submissions.set([]);
    this._rounds.set([]);
    this._students.set([]);
    this._courseRules.set([]);
    this._courseMaterials.set([]);
    this._gradingCategories.set([]);
    this._gradingEntries.set([]);
    this._studentForms.set([]);
    this._studentEmails.set([]);
    this._reliabilityChecks.set([]);
    this._annotations.set([]);
    this._feedbackLogs.set([]);
    this._styleExamples.set([]);
    this.folders.set({});
    this._sync.set(IDLE);
    this._hydrated.set(false);
    this._loadedHers.set(false);
    this._persistError.set(null);
    this.failedWrites = [];
  }

  studentName(studentId: UUID): string {
    return this._students().find((s) => s.id === studentId)?.full_name ?? '—';
  }

  submission(id: UUID | null | undefined): Submission | undefined {
    if (!id) return undefined;
    return this._submissions().find((s) => s.id === id);
  }

  submissionByDriveFile(fileId: string): Submission | undefined {
    return this._submissions().find((s) => s.drive_file_id === fileId);
  }

  /**
   * The one submission a student can have on an assignment.
   *
   * `submissions` is unique on `(assignment_id, student_id)` — that constraint
   * is the domain rule, not an implementation detail, and anything that writes
   * a submission has to resolve against it. The sync used to look a file up by
   * `drive_file_id` alone, so a student who already had a row with no file on
   * it got a second insert that Postgres refused outright.
   */
  submissionFor(assignmentId: UUID, studentId: UUID): Submission | undefined {
    return this._submissions().find(
      (s) => s.assignment_id === assignmentId && s.student_id === studentId,
    );
  }

  /** A specific round, for writers that must not mint a rival to an existing one. */
  round(submissionId: UUID, roundNumber: number): SubmissionRound | undefined {
    return this._rounds().find(
      (r) => r.submission_id === submissionId && r.round_number === roundNumber,
    );
  }

  /** True when anything is anchored to this round — so its text must not move. */
  roundIsAnnotated(roundId: UUID): boolean {
    return this._annotations().some((a) => a.round_id === roundId);
  }

  annotation(id: UUID): Annotation | undefined {
    return this._annotations().find((a) => a.id === id);
  }

  roundFor(submissionId: UUID): SubmissionRound | undefined {
    return this._rounds()
      .filter((r) => r.submission_id === submissionId)
      .sort((a, b) => b.round_number - a.round_number)[0];
  }

  /**
   * Comments still waiting for a decision on the round she would open.
   *
   * The round rather than the submission, so the dashboard and the list agree
   * with the review screen. Counting every round's leftovers promised her work
   * that opening the submission would not show.
   */
  annotationsPending(submissionId: UUID): number {
    const roundId = this.roundFor(submissionId)?.id;
    if (!roundId) return 0;
    return this._annotations().filter((a) => a.round_id === roundId && a.status === 'pending')
      .length;
  }

  // -- annotation review ----------------------------------------------------

  setAnnotationStatus(id: UUID, status: AnnotationStatus) {
    const before = this.annotation(id);
    // Re-asserting the status she already chose is not a second decision.
    if (!before || before.status === status) return;

    this.writeAnnotation(id, (a) => ({
      ...a,
      status,
      resolved_in_round:
        status === 'resolved' ? (this.roundFor(a.submission_id)?.round_number ?? 1) : null,
      updated_at: new Date().toISOString(),
    }));

    // `resolved` is about the student's next draft, not about the wording, so
    // it teaches nothing and is deliberately not logged.
    if (status === 'accepted') this.logDecision(before, 'accepted', before.body, null);
    if (status === 'dismissed') this.logDecision(before, 'dismissed', null, null);

    this.rebuildGradingForm(before.submission_id);
  }

  /** The teacher rewrote a comment: her wording wins, the AI's is kept. */
  editAnnotation(id: UUID, body: string) {
    const before = this.annotation(id);
    const text = body.trim();

    this.writeAnnotation(id, (a) => ({
      ...a,
      body: text,
      status: 'edited' as AnnotationStatus,
      edited_by_teacher: true,
      updated_at: new Date().toISOString(),
    }));

    if (!before) return;

    // Opening the editor and saving it untouched is an acceptance. Logging it
    // as a rewrite would teach the model that its own wording was a correction
    // of itself.
    const action: LearningAction = text === before.ai_body ? 'accepted' : 'edited';
    this.logDecision(
      before,
      action,
      text,
      action === 'edited' ? describeEdit(before.ai_body ?? '', text) : null,
    );

    this.rebuildGradingForm(before.submission_id);
  }

  /** The year-end form for one student, generated and then hers to edit. */
  saveStudentForm(form: StudentGradingForm) {
    this._studentForms.update((list) => [...list.filter((f) => f.id !== form.id), form]);
    this.persist(() => this.repository.saveStudentForm(form));
  }

  // -- the message to the student -------------------------------------------

  /** The drafted message for a submission, if one has been written. */
  studentEmail(submissionId: UUID): StudentEmail | undefined {
    return this._studentEmails().find((e) => e.submission_id === submissionId);
  }

  /** A freshly drafted message, replacing any earlier draft for the round. */
  saveStudentEmail(email: StudentEmail) {
    this.writeEmail(email);
  }

  /**
   * She picked one of the options.
   *
   * The chosen text becomes both the working copy and `ai_body` — the baseline
   * every later edit is measured against. Picking is not itself a decision
   * worth logging: what she does to the text afterwards is.
   */
  chooseEmailVariant(emailId: UUID, key: string) {
    const email = this._studentEmails().find((e) => e.id === emailId);
    const variant = email?.variants.find((v) => v.key === key);
    if (!email || !variant || email.selected_variant_key === key) return;

    this.writeEmail({
      ...email,
      selected_variant_key: key,
      subject: variant.subject,
      body: variant.body,
      ai_body: variant.body,
      edited_by_teacher: false,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Her rewrite of the drafted message.
   *
   * Logged as it happens rather than at the point of sending, so the pair
   * survives even if she never sends this one — and superseded in place, so a
   * dozen small saves stay one record of where the message ended up.
   */
  editStudentEmail(emailId: UUID, patch: { subject?: string; body?: string }) {
    const email = this._studentEmails().find((e) => e.id === emailId);
    if (!email) return;

    const subject = patch.subject?.trim() ?? email.subject;
    const body = patch.body?.trim() ?? email.body;
    if (subject === email.subject && body === email.body) return;

    const next: StudentEmail = {
      ...email,
      subject,
      body,
      edited_by_teacher: body !== email.ai_body,
      updated_at: new Date().toISOString(),
    };
    this.writeEmail(next);
    this.logEmailDecision(next);
  }

  /**
   * She confirmed the message went out.
   *
   * Confirmed, not assumed: Margin hands the message to her own mail client and
   * has no way of knowing what happened next. Marking it sent because a button
   * was pressed would be the same fiction the review screen used to tell.
   */
  markStudentEmailSent(emailId: UUID) {
    const email = this._studentEmails().find((e) => e.id === emailId);
    if (!email || email.status === 'sent') return;

    const now = new Date().toISOString();
    const next: StudentEmail = {
      ...email,
      status: 'sent',
      sent_at: now,
      error_message: null,
      updated_at: now,
    };
    this.writeEmail(next);
    // Supersedes the edit log with the text she actually stood behind.
    this.logEmailDecision(next);
    this.setSubmissionStatus(email.submission_id, 'notes_sent');
  }

  /** The authenticity observations for one round, replaced when re-run. */
  saveReliabilityCheck(check: ReliabilityCheck) {
    this._reliabilityChecks.update((list) => [...list.filter((c) => c.id !== check.id), check]);
    this.persist(() => this.repository.saveReliabilityCheck(check));
  }

  reliabilityCheck(submissionId: UUID, roundId: UUID | null): ReliabilityCheck | undefined {
    return this._reliabilityChecks().find(
      (c) => c.submission_id === submissionId && c.round_id === roundId,
    );
  }

  /**
   * Accounts seen on submissions for students whose account is not yet known.
   *
   * The bridge between the two matching signals. A file matched by name still
   * carries the address it was submitted from, and once the teacher confirms
   * that address belongs to that girl, every later file from her is matched on
   * the account instead — which cannot be typed wrong.
   *
   * Deliberately a suggestion rather than an inference: the app has just
   * guessed at this student from a filename, and promoting that guess into a
   * permanent identity without asking would make one bad match permanent.
   */
  observedAccounts(): { student: Student; email: string; submissionId: UUID }[] {
    // Nothing to confirm against demonstration records: the write would be
    // refused, and offering it invites her to hit an RLS error for a row that
    // was never hers.
    if (!this._loadedHers()) return [];

    const seen = new Map<UUID, { student: Student; email: string; submissionId: UUID }>();

    for (const submission of this._submissions()) {
      const email = submission.drive_owner_email?.trim();
      if (!email) continue;

      const student = this._students().find((s) => s.id === submission.student_id);
      // Nothing to confirm once she has an account on file.
      if (!student || student.drive_account_email) continue;
      if (seen.has(student.id)) continue;

      seen.set(student.id, { student, email, submissionId: submission.id });
    }

    return [...seen.values()];
  }

  /**
   * The teacher confirms an address belongs to a student.
   *
   * Refuses a student who is not hers. `students_owner` compares `teacher_id`
   * to `auth.uid()`, and a seeded student carries the demonstration teacher's
   * id — so writing one is refused every time, and the refusal reads as a
   * permissions problem rather than as "these are not your records".
   */
  setStudentDriveAccount(studentId: UUID, email: string) {
    const teacherId = this.supabase.teacherId;
    const student = this._students().find((s) => s.id === studentId);
    if (!student || (teacherId && student.teacher_id !== teacherId)) return;

    const address = email.trim().toLowerCase() || null;
    let written: Student | undefined;

    this._students.update((list) =>
      list.map((s) => {
        if (s.id !== studentId || s.drive_account_email === address) return s;
        written = { ...s, drive_account_email: address, updated_at: new Date().toISOString() };
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveStudent(written!));
  }

  /** Her address for the student, filled in when the roster had none. */
  setStudentEmailAddress(studentId: UUID, address: string) {
    const email = address.trim() || null;
    let written: Student | undefined;
    this._students.update((list) =>
      list.map((s) => {
        if (s.id !== studentId || s.email === email) return s;
        written = { ...s, email, updated_at: new Date().toISOString() };
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveStudent(written!));
  }

  private writeEmail(email: StudentEmail) {
    this._studentEmails.update((list) => [...list.filter((e) => e.id !== email.id), email]);
    this.persist(() => this.repository.saveStudentEmail(email));
  }

  /**
   * What she made of the drafted message.
   *
   * The same record the annotation loop writes, with the same one-per-target
   * rule — so the email path teaches the model through exactly the channel the
   * comments already do, and the next draft is conditioned on both.
   */
  private logEmailDecision(email: StudentEmail) {
    if (!email.ai_body) return;

    const edited = email.body.trim() !== email.ai_body.trim();
    const label = email.variants.find((v) => v.key === email.selected_variant_key)?.label;

    this.logLearning({
      targetType: 'student_email',
      targetId: email.id,
      action: edited ? 'edited' : 'accepted',
      aiText: email.ai_body,
      finalText: email.body,
      changeNote: edited ? describeEdit(email.ai_body, email.body) : null,
      // Which register she asked for. For a message there is no student
      // sentence to quote, and the option she started from is what makes the
      // pair readable a year later.
      contextExcerpt: label ? `ניסוח: ${label}` : null,
    });
  }

  /**
   * Rebuilds one submission's grading form from its comments.
   *
   * Recomputed rather than appended to, so the form follows her decisions in
   * both directions: a comment she dismisses after resolving it leaves the
   * form, and one she reinstates comes back. Lines she wrote herself are not
   * derived from anything and are carried through untouched.
   */
  private rebuildGradingForm(submissionId: UUID) {
    const categories = this._gradingCategories();
    if (!categories.length) return;

    // Each comment is categorised against the round it was written on. Using
    // the current round for all of them put every earlier-round comment into
    // the fallback heading, on a form that still looked complete.
    const blocksFor = (roundId: UUID) =>
      this._rounds().find((r) => r.id === roundId)?.document_blocks ?? [];
    const mine = this._gradingEntries().filter(
      (e) => e.submission_id === submissionId && e.origin === 'teacher',
    );

    const next = buildEntries(submissionId, this._annotations(), blocksFor, categories, mine);
    const nextIds = new Set(next.map((e) => e.id));

    const removed = this._gradingEntries()
      .filter((e) => e.submission_id === submissionId && !nextIds.has(e.id))
      .map((e) => e.id);

    this._gradingEntries.update((list) => [
      ...list.filter((e) => e.submission_id !== submissionId),
      ...next,
    ]);

    if (removed.length) this.persist(() => this.repository.deleteGradingEntries(removed));
    for (const entry of next) this.persist(() => this.repository.saveGradingEntry(entry));
  }

  /**
   * Records what she decided about a drafted comment.
   *
   * One log per comment: changing her mind supersedes the previous entry
   * rather than appending, so the log stays a record of where each comment
   * ended up. A trail of superseded decisions would teach the model phrasings
   * she has since moved away from.
   */
  private logDecision(
    annotation: Annotation,
    action: LearningAction,
    finalText: string | null,
    changeNote: string | null,
  ) {
    // Only a drafted comment carries a signal. There is nothing to compare a
    // comment she wrote herself against.
    if (annotation.origin !== 'ai' || !annotation.ai_body) return;

    this.logLearning({
      targetType: 'annotation',
      targetId: annotation.id,
      action,
      aiText: annotation.ai_body,
      finalText,
      changeNote,
      // The student's own words, so the pair stays interpretable a year later
      // and the model can see what kind of text drew which response.
      contextExcerpt: annotation.anchor.quote,
    });
  }

  /**
   * Writes one decision, whatever it was about.
   *
   * Every kind of drafted text goes through here, and the supersede rule is
   * the reason it is one function rather than one per screen: keyed on
   * (`target_type`, `target_id`), so a second thought about the same comment —
   * or the same message — replaces the first instead of stacking beside it.
   * Two implementations of that rule would drift, and the drift would only
   * show up a year later as a model learning phrasings she had abandoned.
   */
  private logLearning(input: {
    targetType: LearningTargetType;
    targetId: UUID;
    action: LearningAction;
    aiText: string;
    finalText: string | null;
    changeNote: string | null;
    contextExcerpt: string | null;
  }) {
    /**
     * Nothing to attribute the decision to, so it is not recorded.
     *
     * `learning_feedback_log` carries her id and her course, and both are
     * checked by RLS. A log minted with a placeholder for either would be
     * refused by Postgres — and because writes are fire-and-forget, it would
     * look on screen exactly like a decision that had been remembered.
     */
    const teacherId = this.supabase.teacherId;
    const course = this._course();
    if (!teacherId || !course) return;

    const existing = this._feedbackLogs().find(
      (l) => l.target_type === input.targetType && l.target_id === input.targetId,
    );

    const log: LearningFeedbackLog = {
      id: existing?.id ?? newId(),
      teacher_id: teacherId,
      course_id: course.id,
      target_type: input.targetType,
      target_id: input.targetId,
      action: input.action,
      ai_text: input.aiText,
      final_text: input.finalText,
      change_note: input.changeNote,
      context_excerpt: input.contextExcerpt,
      created_at: new Date().toISOString(),
    };

    this._feedbackLogs.update((list) => [...list.filter((l) => l.id !== log.id), log]);
    this.persist(() => this.repository.saveFeedbackLog(log));
  }

  setSubmissionStatus(id: UUID, status: SubmissionStatus) {
    this.updateSubmission(id, { status });
  }

  /**
   * Records that a comment reached the student's document.
   *
   * Written the instant Drive confirms it, before anything else can fail. If
   * the database write behind this one fails, the retry re-saves the record it
   * already holds rather than posting a second comment — which is why the
   * signal is updated first and the id comes from Drive rather than from us.
   */
  markAnnotationPosted(id: UUID, commentId: string) {
    const now = new Date().toISOString();
    this.writeAnnotation(id, (a) => ({
      ...a,
      posted_comment_id: commentId,
      posted_at: now,
      updated_at: now,
    }));
  }

  /**
   * Records the marker number placed in the document for a comment.
   *
   * Written the moment Drive accepts the insertion. Non-null is what makes a
   * re-send leave that glyph alone: the alternative is a second number beside
   * the same sentence, or the same sentence renumbered between rounds.
   */
  markAnnotationNumbered(id: UUID, markerNumber: number) {
    this.writeAnnotation(id, (a) => ({
      ...a,
      marker_number: markerNumber,
      updated_at: new Date().toISOString(),
    }));
  }

  /** Forgets a marker, once it has been taken out of the document. */
  clearAnnotationMarker(id: UUID) {
    this.writeAnnotation(id, (a) => ({
      ...a,
      marker_number: null,
      updated_at: new Date().toISOString(),
    }));
  }

  /**
   * Runs an outward action with the same failure handling as a database write.
   *
   * Posting a comment to Drive is a write like any other from the teacher's
   * side — she pressed a button and expects it to have happened — so it earns
   * the same banner and the same working "try again" rather than a private
   * error on one screen. The queued thunk must be safe to run twice; the
   * comment poster's is, because it re-checks `posted_comment_id` first.
   */
  queueWrite(work: () => Promise<void>) {
    this.persist(work);
  }

  // -- Drive configuration --------------------------------------------------

  setDriveFolder(ownerId: UUID, folderId: string | null) {
    this.folders.update((map) => {
      const next = { ...map };
      if (folderId) next[ownerId] = folderId;
      else delete next[ownerId];
      return next;
    });
    this.persist(() => this.repository.saveDriveFolder(ownerId, folderId));
  }

  // -- writes from the sync -------------------------------------------------

  setSyncState(patch: Partial<SyncState>) {
    this._sync.update((state) => ({ ...state, ...patch }));
  }

  /** Inserts a submission the sync has just discovered in the folder. */
  addSubmission(submission: Submission) {
    this._submissions.update((list) => [...list, submission]);
    this.persist(() => this.repository.saveSubmission(submission));
  }

  /** Applies whatever the sync learned about an existing submission. */
  updateSubmission(id: UUID, patch: Partial<Submission>) {
    let written: Submission | undefined;
    this._submissions.update((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        written = { ...s, ...patch, updated_at: new Date().toISOString() };
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveSubmission(written!));
  }

  /**
   * Swaps out a round's *drafted, undecided* comments.
   *
   * Deliberately narrow. It used to clear the round outright, which meant a
   * second pass destroyed every decision she had already made on the first —
   * accepted, rewritten and dismissed alike — with no warning and nothing to
   * undo. What a regeneration may replace is only what she has not yet looked
   * at: comments the model drafted that are still `pending`.
   *
   * Anything she wrote herself, and anything she has decided, survives. So an
   * empty list is no longer a way to wipe the round; it removes the untouched
   * drafts and leaves her work standing.
   *
   * One consequence, deliberately left alone: a new pass can draft a comment
   * on words she has already decided about, and both will be listed. Dropping
   * the overlap would mean silently discarding model output, which is a
   * judgement about her review rather than a mechanical de-duplication.
   */
  replaceDraftedAnnotations(roundId: UUID, annotations: readonly Annotation[]) {
    const isUntouchedDraft = (a: Annotation) =>
      a.round_id === roundId && a.origin === 'ai' && a.status === 'pending';

    const removed = this._annotations()
      .filter(isUntouchedDraft)
      .map((a) => a.id);

    this._annotations.update((list) => [
      ...list.filter((a) => !isUntouchedDraft(a)),
      ...annotations,
    ]);

    if (removed.length) this.persist(() => this.repository.deleteAnnotations(removed));
    for (const annotation of annotations) {
      this.persist(() => this.repository.saveAnnotation(annotation));
    }
  }

  /**
   * Adds a round, or replaces the one already holding that id.
   *
   * Appending blindly would put two rows for the same round in the signal when
   * the sync resolves an existing round rather than minting a rival id — the
   * database upserts on the primary key and would have been right while the
   * screen showed a duplicate.
   */
  addRound(round: SubmissionRound) {
    this._rounds.update((list) => [...list.filter((r) => r.id !== round.id), round]);
    this.persist(() => this.repository.saveRound(round));
  }

  /**
   * Replaces a round's captured text.
   *
   * Only ever called for a round whose notes have not been sent — once the
   * teacher has sent comments, a further edit by the student opens a *new*
   * round instead, so nothing she has already annotated is overwritten.
   */
  replaceRoundDocument(roundId: UUID, patch: Partial<SubmissionRound>) {
    let written: SubmissionRound | undefined;
    this._rounds.update((list) =>
      list.map((r) => {
        if (r.id !== roundId) return r;
        written = { ...r, ...patch, updated_at: new Date().toISOString() };
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveRound(written!));
  }

  /** Waits for outstanding writes — used by tests, not by the UI. */
  async settled(): Promise<void> {
    /**
     * Drained in rounds, because a write can start another one.
     *
     * Posting a comment to Drive is queued like any other write, and when it
     * comes back it records the comment id — a second write, added to the
     * queue while the first is still running. A single `allSettled` snapshots
     * the array as it was and returns without ever seeing it.
     *
     * That hole was invisible while writes were issued eagerly: the nested one
     * started in the same microtask and had finished long before anyone
     * looked. Ordering the queue moved it behind everything ahead of it, and
     * `settled()` began returning while the id was still unwritten — which is
     * "the reload forgot what it had already sent", and worse, a
     * `retryFailedWrites` that reports success early.
     */
    while (this.pending.length) {
      const batch = this.pending;
      this.pending = [];
      await Promise.allSettled(batch);
    }
  }

  // -- failed writes --------------------------------------------------------

  /**
   * Re-runs everything that failed to save.
   *
   * The point of holding the failed writes rather than only their error: a
   * banner she can only dismiss tells her the work is lost, which is a worse
   * outcome than the one this exists to prevent. Reconnecting and pressing
   * "try again" has to actually save the afternoon's review.
   */
  async retryFailedWrites(): Promise<boolean> {
    const queued = this.failedWrites;
    this.failedWrites = [];
    this._persistError.set(null);

    for (const write of queued) this.persist(write);
    await this.settled();

    return this._persistError() === null;
  }

  /** She has read it. A further failure raises it again. */
  dismissPersistError() {
    this._persistError.set(null);
  }

  /** How many changes are sitting unsaved. */
  readonly unsavedCount = () => this.failedWrites.length;

  // -- plumbing -------------------------------------------------------------

  private pending: Promise<unknown>[] = [];
  /** The last write issued. The next one waits on it. Never rejects. */
  private tail: Promise<unknown> = Promise.resolve();
  private failedWrites: (() => Promise<void>)[] = [];

  private writeAnnotation(id: UUID, apply: (a: Annotation) => Annotation) {
    let written: Annotation | undefined;
    this._annotations.update((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        written = apply(a);
        return written;
      }),
    );
    if (written) this.persist(() => this.repository.saveAnnotation(written!));
  }

  /**
   * Fire-and-forget, but **in order**.
   *
   * The screen never waits on the network — that has not changed. What has is
   * that each write leaves only after the one before it has come back, and
   * that ordering is load-bearing rather than tidiness.
   *
   * Every caller here adds a parent before its children: the sync writes the
   * submission and then its first round, the review writes the round and then
   * its comments. Issued concurrently, those two requests race, and Postgres
   * decides the winner. When the child wins, its RLS policy — `owns_submission`
   * and its siblings are `exists` clauses — finds no parent and refuses the
   * insert as a *permissions* violation:
   *
   *   new row violates row-level security policy for table "submission_rounds"
   *
   * which sends anyone reading it to check grants, roles and policies for a
   * bug that is none of those things.
   *
   * The race was always here and was hidden by the demonstration data: the
   * seed's submissions were written at startup, awaited in foreign-key order,
   * so a sync nearly always *adopted* a row that already existed and never
   * took the path that inserts a submission and its round together. An empty
   * account takes that path for every paper that arrives.
   *
   * A failed write does not break the chain — the catch is inside it — so one
   * refusal cannot strand every later save behind it.
   */
  private persist(write: () => Promise<void>) {
    const promise = this.tail.then(write).catch((error: unknown) => {
      // Kept, not dropped: this is the change she just made on screen, and it
      // exists nowhere else once this promise settles.
      this.failedWrites.push(write);
      this.noteFailure('save', error);
    });

    this.tail = promise;
    this.pending.push(promise);
  }

  private noteFailure(kind: PersistFailure['kind'], error: unknown) {
    const detail = errorText(error);

    this._persistError.update((current) => {
      const details = current?.details ?? [];
      return {
        // A failed load is the graver of the two and keeps the wording.
        kind: current?.kind === 'load' ? 'load' : kind,
        count: (current?.count ?? 0) + 1,
        signedOut: current?.signedOut || detail.includes(NOT_SIGNED_IN),
        // Distinct, and capped: three tables failing the same way is the
        // useful signal, a hundred repeats of one is noise.
        details: details.includes(detail) ? details : [...details, detail].slice(-4),
      };
    });
  }
}

/** Later records win by id; unknown ones are appended. */
function mergeById<T extends { id: string }>(base: T[], overrides: T[]): T[] {
  if (overrides.length === 0) return base;
  const byId = new Map(base.map((item) => [item.id, item]));
  for (const item of overrides) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * What the banner shows for one failed write.
 *
 * Some errors already know how to say themselves to a teacher — a Drive
 * refusal can tell a permission she never granted apart from a folder she
 * cannot see, and that wording exists precisely because the raw one is a wall
 * of Google JSON. Lead with it and keep the raw line after, so the banner is
 * readable without becoming less useful to whoever debugs it.
 *
 * Duck-typed rather than imported: the store has no business depending on the
 * Drive layer, and anything that carries teacher-facing wording qualifies.
 */
/** How long to wait out a token the validator thinks is from the future. */
const TOKEN_SKEW_RETRY_MS = 1500;

/**
 * A token rejected for being fractionally too new.
 *
 * Matched on the wording because there is no code for it: PostgREST answers
 * with a message and nothing else. Deliberately narrow — an expired token, a
 * malformed one and a missing one are all genuinely wrong and must not be
 * retried into looking fine.
 */
function isTokenTooNew(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /issued at future|iat.*future/i.test(text);
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const hebrew = (error as { hebrew?: unknown }).hebrew;
  return typeof hebrew === 'string' && hebrew.trim()
    ? `${hebrew} — ${error.message}`
    : error.message;
}
