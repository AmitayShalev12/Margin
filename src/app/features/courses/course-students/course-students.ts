import { DriveFolder } from '../drive-folder/drive-folder';
import { ProcessFlow } from '../process-flow/process-flow';
import {
  LIGHT_LABEL,
  LIGHT_ORDER,
  Light,
  lateNote,
  latePapers,
  progressOf,
} from '../../../core/progress/traffic-light';
import { dayOf } from '../../../core/dates/hebrew-date';
import { SheetError } from '../../../core/import/xlsx';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AnnotationGenerator } from '../../../core/ai/annotation-generator';
import { DataStore } from '../../../core/data/data-store';
import { normaliseName } from '../../../core/drive/file-name';
import { UUID } from '../../../core/models';
import {
  CONTACT_LABEL,
  RosterPlan,
  planRoster,
  readRoster,
} from '../../../core/roster/roster';

import { CountPipe, count } from '../../../core/presentation/count';
import { QuickActions } from '../../../shared/ui/quick-actions/quick-actions';
/** One row of the roster: everything the row answers without opening anything. */
export interface StudentRow {
  id: UUID;
  name: string;
  folder: string | null;
  /** The courses she is enrolled in, as labels. */
  courses: string[];
  /** Papers of hers the app holds. Not the folder's file count — see the template. */
  files: number;
  /** Of those, the ones she has finished with. */
  checked: number;
  latestId: UUID | null;
  /**
   * Words in her latest paper, as the nearest honest answer to "how long is
   * this". Null when the file has not been read — a Drive row can exist before
   * its document has been fetched, and 0 would read as an empty paper.
   */
  words: number | null;
  comments: number;
  decided: number;
  /** What the student has to go and fix: the comments she stood behind. */
  toFix: number;
  /** Null when there are no comments yet — there is no share of nothing. */
  percent: number | null;
  light: Light;
  /** Tasks she has a paper for, of all the course's tasks. */
  handedIn: number;
  missed: number;
  /** Her late papers, each saying it was handed in and whether it was checked. */
  lateNotes: string[];
  /** One per task, in order: her paper for it, if she handed one in. */
  stages: { title: string; paperId: UUID | null }[];
}

export type StudentSort = 'name' | 'status';

/**
 * The home screen: her class, a row each.
 *
 * It used to list the submissions waiting on her, which answered "what is
 * urgent" and nothing else. What she asked for is the roster — "דף הבית מכיל
 * את רשימת התלמידות וכתובת התיקיות שלהם" — with each girl's folder, how much
 * of her work has come in, how far the marking got and what still needs
 * fixing, and the two buttons reached for most on the same line.
 *
 * The difference matters because her unit of work is a student, not a file. A
 * list of submissions makes her reassemble "where is רבקי up to" out of
 * several rows; a list of students answers it on sight.
 */
@Component({
  selector: 'app-course-students',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountPipe, DecimalPipe, RouterLink, ProcessFlow, DriveFolder],
  templateUrl: './course-students.html',
  styleUrl: './course-students.scss',
})
export class CourseStudents {
  protected readonly data = inject(DataStore);

  constructor() {
    effect(() => {
      const name = this.q();
      if (name) untracked(() => this.search.set(name));
    });
  }

  protected readonly quick = inject(QuickActions);
  protected readonly generator = inject(AnnotationGenerator);

  protected readonly search = signal('');
  /** A student picked in the top bar's search arrives as a name to filter by. */
  readonly q = input<string>();

  // -- how the list is ordered ----------------------------------------------

  protected readonly sort = signal<StudentSort>('name');
  protected readonly filter = signal<Light | ''>('');
  protected readonly lightLabel = LIGHT_LABEL;
  protected readonly lightOrder = LIGHT_ORDER;

  // -- leaving the course ---------------------------------------------------

  /**
   * Several papers, processed one after another.
   *
   * One at a time on purpose: each run is a minute or two against a rate-limited
   * model, and running them together would fail them together.
   */
  protected readonly queue = signal<{
    running: boolean;
    total: number;
    done: number;
    skipped: number;
    current: string;
    failed: string[];
  }>({ running: false, total: 0, done: 0, skipped: 0, current: '', failed: [] });
  private stopRequested = false;

  protected async processSelected() {
    const picked = this.rows().filter((r) => this.selected().has(r.id));
    const work = picked.filter((r) => r.latestId);
    this.stopRequested = false;
    this.queue.set({
      running: true,
      total: work.length,
      done: 0,
      skipped: picked.length - work.length,
      current: '',
      failed: [],
    });

    for (const row of work) {
      if (this.stopRequested) break;
      this.queue.update((q) => ({ ...q, current: row.name }));
      const result = await this.generator.generate(row.latestId!);
      this.queue.update((q) => ({
        ...q,
        done: q.done + 1,
        failed: result
          ? q.failed
          : [...q.failed, `${row.name}: ${this.generator.state().message ?? 'העיבוד לא הצליח.'}`],
      }));
    }

    this.queue.update((q) => ({ ...q, running: false, total: this.stopRequested ? q.done : q.total }));
    this.selected.set(new Set());
  }

  protected stopQueue() {
    this.stopRequested = true;
  }

  protected clearQueue() {
    this.queue.set({ running: false, total: 0, done: 0, skipped: 0, current: '', failed: [] });
  }

  protected readonly selected = signal<ReadonlySet<UUID>>(new Set());
  protected readonly asking = signal(false);

  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((r) => this.selected().has(r.id)),
  );

  protected toggleSelected(id: UUID) {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
    this.asking.set(false);
  }

  protected toggleAll() {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map((r) => r.id)));
    this.asking.set(false);
  }

  protected removeFromCourse(id: UUID) {
    const course = this.data.course();
    if (course) this.data.removeFromCourse(id, course.id);
  }

  protected removeSelected() {
    for (const id of this.selected()) this.removeFromCourse(id);
    this.selected.set(new Set());
    this.asking.set(false);
  }

  protected setSeminar(isSeminar: boolean) {
    this.data.updateCourseKind({
      is_seminar: isSeminar,
      asks_research_question: !!this.data.course()?.asks_research_question,
    });
  }

  protected setAsksQuestion(asks: boolean) {
    this.data.updateCourseKind({ is_seminar: true, asks_research_question: asks });
  }

  /** Students from before courses held their own lists, one press from a home. */
  protected placeHere(id: UUID) {
    const course = this.data.course();
    if (course) this.data.enrollStudent(id, [course.id]);
  }

  // -- the student list as a file -------------------------------------------

  protected readonly contactLabel = CONTACT_LABEL;
  protected readonly rosterPlan = signal<RosterPlan | null>(null);
  protected readonly rosterReplace = signal<ReadonlySet<string>>(new Set());
  protected readonly rosterError = signal<string | null>(null);
  protected readonly rosterDone = signal<string | null>(null);

  protected async pickRoster(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.rosterError.set(null);
    this.rosterDone.set(null);
    if (!file) return;

    try {
      const rows = await readRoster(await file.arrayBuffer());
      if (!rows.length) {
        this.rosterError.set('לא מצאתי תלמידות בקובץ.');
        return;
      }
      this.rosterReplace.set(new Set());
      this.rosterPlan.set(planRoster(rows, this.data.students()));
    } catch (error) {
      this.rosterError.set(
        error instanceof SheetError ? error.hebrew : 'הקובץ לא נקרא. צריך קובץ Excel מסוג .xlsx.',
      );
    }
  }

  protected toggleReplace(id: string) {
    const next = new Set(this.rosterReplace());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.rosterReplace.set(next);
  }

  protected applyRoster() {
    const plan = this.rosterPlan();
    if (!plan) return;
    const { added, existing } = this.data.applyRoster(plan, this.rosterReplace());
    this.rosterPlan.set(null);
    this.rosterDone.set(
      `${count(added, { one: 'נוספה תלמידה אחת', two: 'נוספו שתי תלמידות', many: 'נוספו # תלמידות' })}, ${count(existing, { one: 'אחת עודכנה', two: 'שתיים עודכנו', many: '# עודכנו' })}. הקובץ עצמו לא נשמר במערכת: נקלטו רק הפרטים, והוא נשאר רק במחשב שלך.`,
    );
  }

  /**
   * Every girl's row, before the search box gets at it.
   *
   * The summary line counts off this and not off `rows`, because a count that
   * shrinks as she types is answering "how many matched" while appearing to
   * answer "how many need me".
   */
  private readonly allRows = computed<StudentRow[]>(() => {
    const course = this.data.course();
    if (!course) return [];

    const tasks = this.data.assignmentsOf(course.id);
    const taskIds = new Set(tasks.map((t) => t.id));
    const submissions = this.data.submissions().filter((s) => taskIds.has(s.assignment_id));
    const annotations = this.data.annotations();
    const today = new Date().toISOString().slice(0, 10);

    return this.data.studentsIn(course.id).map((student) => {
      const hers = submissions.filter((s) => s.student_id === student.id);
      const handed = new Set(hers.map((s) => s.assignment_id));
      const dated = tasks.map((t) => ({ id: t.id, due: dayOf(t.due_at) }));
      const late = latePapers(dated, hers);
      const progress = progressOf(dated, handed, today, new Set(late.map((l) => l.taskId)));
      const latest = [...hers].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

      const mine = latest ? annotations.filter((a) => a.submission_id === latest.id) : [];
      /**
       * "Decided" is every comment she has ruled on, either way. Its share is
       * the honest answer to "עד איזה עמוד" — the drafting pass covers the
       * whole paper at once and the app holds paragraphs, not pages, so how
       * far the review got is how far she got through the comments. Claiming
       * a page number would be inventing one.
       */
      const decided = mine.filter((a) => a.status !== 'pending').length;

      return {
        id: student.id,
        name: student.full_name,
        folder: student.drive_folder_id,
        courses: this.data.coursesOf(student.id).map((c) => `${c.name} · ${c.year}`),
        files: hers.length,
        checked: hers.filter((s) => s.status === 'notes_sent' || s.status === 'finalized').length,
        latestId: latest?.id ?? null,
        words: latest?.word_count ?? null,
        comments: mine.length,
        decided,
        toFix: mine.filter((a) => a.status === 'accepted' || a.status === 'edited').length,
        percent: mine.length ? Math.round((decided / mine.length) * 100) : null,
        light: progress.light,
        handedIn: progress.handedIn,
        missed: progress.missed,
        lateNotes: late.map((l) =>
          lateNote(tasks.find((t) => t.id === l.taskId)?.title ?? '', l.checked),
        ),
        stages: tasks.map((t) => ({
          title: t.title,
          paperId: hers.find((p) => p.assignment_id === t.id)?.id ?? null,
        })),
      };
    });
  });

  /** What the list shows: her roster, narrowed by the search box. */
  protected readonly rows = computed<StudentRow[]>(() => {
    const query = normaliseName(this.search());
    const wanted = this.filter();
    const byName = (a: StudentRow, b: StudentRow) => a.name.localeCompare(b.name, 'he');
    // Those furthest behind first; alphabetical within a level.
    const byStatus = (a: StudentRow, b: StudentRow) =>
      LIGHT_ORDER.indexOf(a.light) - LIGHT_ORDER.indexOf(b.light) || byName(a, b);

    return this.allRows()
      .filter((row) => !query || normaliseName(row.name).includes(query))
      .filter((row) => !wanted || row.light === wanted)
      .sort(this.sort() === 'status' ? byStatus : byName);
  });

  protected readonly subtitle = computed(() => {
    const total = this.allRows().length;
    if (!total) return 'עוד אין תלמידות בקורס.';

    const waiting = this.allRows().filter((r) => r.comments > r.decided).length;
    const students = count(total, { one: 'תלמידה אחת', two: 'שתי תלמידות', many: '# תלמידות' });
    if (!waiting) return `${students}. אין כרגע הערות שממתינות להחלטה.`;
    if (waiting === 1) return `${students} · אצל אחת יש הערות שממתינות לך.`;
    return `${students} · אצל ${waiting} יש הערות שממתינות לך.`;
  });
}
