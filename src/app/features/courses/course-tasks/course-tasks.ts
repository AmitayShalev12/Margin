import { proposedRubricFor } from '../../../core/grading/stage-rubrics';
import { TaskRubric } from '../task-rubric/task-rubric';
import { SEMINAR_STAGES } from '../../../core/tasks/seminar-map';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { dayOf, dualDateText, gregorianDate, hebrewDate } from '../../../core/dates/hebrew-date';
import { SheetError } from '../../../core/import/xlsx';
import { ImportedTask, MAX_TASKS, readTaskFile } from '../../../core/tasks/task-import';
import { DualDate } from '../../../shared/ui/dual-date/dual-date';

/** A row of the import preview, with the date she settled on. */
interface PreviewRow {
  title: string;
  problem: string | null;
  options: string[];
  chosen: string;
}

function previewOf(task: ImportedTask): PreviewRow {
  const row = { title: task.title, problem: null, options: [], chosen: '' };
  switch (task.date.kind) {
    case 'ok':
      return { ...row, chosen: task.date.iso };
    case 'ambiguous':
      return {
        ...row,
        problem: `"${task.date.raw}" יכול להיות אחד משני תאריכים. צריך לבחור.`,
        options: task.date.options,
      };
    case 'unreadable':
      return { ...row, problem: `לא הצלחתי לקרוא את התאריך "${task.date.raw}". אפשר לבחור ידנית.` };
    default:
      return row;
  }
}

/**
 * Up to sixteen tasks and dates. None are required.
 *
 * Each is an assignment, which already has a title and a due date, and to which
 * a student's paper already belongs. What a task involves or triggers can be
 * added later as more columns on the same row.
 */
@Component({
  selector: 'app-course-tasks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DualDate, TaskRubric],
  template: `
    <section class="card tasks" aria-labelledby="tasks-title">
      <h2 id="tasks-title" class="sub-title">משימות ומועדים</h2>

      <ol class="task-list">
        @for (task of tasks(); track task.id; let i = $index) {
          <li class="task">
            <span class="task-number">{{ i + 1 }}</span>
            <input
              class="control task-title"
              type="text"
              aria-label="שם המשימה"
              [value]="task.title"
              (change)="rename(task.id, $any($event.target).value)"
            />
            <input
              class="control task-date"
              type="date"
              aria-label="תאריך"
              [value]="due(task.due_at)"
              (change)="setDate(task.id, $any($event.target).value)"
            />
            <app-dual-date class="task-dual" [date]="task.due_at" />
            <button
              type="button"
              class="btn btn-plain btn-sm"
              [attr.aria-expanded]="openRubric() === task.id"
              (click)="toggleRubric(task.id)"
            >
              {{ rubricLabel(task.id) }}
            </button>
            <button type="button" class="btn btn-plain btn-sm" (click)="remove(task.id)">הסרה</button>
            @if (openRubric() === task.id) {
              <app-task-rubric class="task-rubric anim-unfold" [taskId]="task.id" />
            }
          </li>
        } @empty {
          <li class="hint">עוד אין משימות. אפשר להשאיר ריק.</li>
        }
      </ol>

      @if (error(); as message) {
        <p class="task-error" role="alert">{{ message }}</p>
      }

      @if (preview().length) {
        <div class="preview" role="group" aria-label="בדיקת הייבוא">
          <p class="sub-title">כך קראתי את הקובץ. לבדוק ולאשר:</p>
          @if (overflow()) {
            <p class="task-warn">יש בקובץ יותר מדי שורות, ו־{{ overflow() }} האחרונות לא ייובאו.</p>
          }
          <ol class="task-list">
            @for (row of preview(); track $index; let i = $index) {
              <li class="task">
                <span class="task-number">{{ i + 1 }}</span>
                <span class="task-title">{{ row.title }}</span>
                @if (row.options.length) {
                  <select
                    class="control task-date"
                    aria-label="בחירת תאריך"
                    (change)="choose(i, $any($event.target).value)"
                  >
                    <option value="">בלי תאריך</option>
                    @for (option of row.options; track option) {
                      <option [value]="option" [selected]="row.chosen === option">
                        {{ text(option) }}
                      </option>
                    }
                  </select>
                } @else {
                  <input
                    class="control task-date"
                    type="date"
                    aria-label="תאריך"
                    [value]="row.chosen"
                    (change)="choose(i, $any($event.target).value)"
                  />
                }
                <app-dual-date class="task-dual" [date]="row.chosen" />
                @if (row.problem && !row.chosen) {
                  <p class="task-warn task-problem">{{ row.problem }}</p>
                }
              </li>
            }
          </ol>
          <div class="task-actions">
            <button type="button" class="btn btn-primary btn-sm" (click)="confirm()">שמירה</button>
            <button type="button" class="btn btn-plain btn-sm" (click)="cancelPreview()">ביטול</button>
          </div>
        </div>
      } @else {
        <div class="task-actions">
          @if (canLoadMap()) {
            <button type="button" class="btn btn-primary btn-sm" (click)="loadMap()">
              טעינת שלבי הסמינריון
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            [disabled]="tasks().length >= max"
            (click)="add()"
          >
            הוספת משימה
          </button>
          <label class="btn btn-plain btn-sm task-file">
            ייבוא מקובץ Excel
            <input class="sr-only" type="file" accept=".xlsx" (change)="pick($event)" />
          </label>
        </div>

        @if (tasks().length) {
          <div class="rubrics">
            <h3 class="sub-title">מחוון ציונים לכל שלב</h3>
            <p class="hint">
              לכל משימה אפשר לקבוע מחוון משלה: מה נבדק ובכמה נקודות. עבודה שמוגשת למשימה מנוקדת לפי
              המחוון שלה. לוחצים על "מחוון" ליד המשימה כדי לראות ולשנות.
            </p>
            <div class="task-actions">
              @if (canPropose()) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="propose()">
                  טעינת המחוון המוצע לשלבי הסמינריון
                </button>
              }
              @if (data.coursesWithStageRubrics().length) {
                <label class="copy">
                  <span class="sr-only">העתקת מחוונים מקורס אחר</span>
                  <select class="control" (change)="copyFrom($any($event.target))">
                    <option value="">העתקת מחוונים מקורס אחר…</option>
                    @for (course of data.coursesWithStageRubrics(); track course.id) {
                      <option [value]="course.id">{{ course.name }} · {{ course.year }}</option>
                    }
                  </select>
                </label>
              }
            </div>
            @if (rubricNote(); as note) {
              <p class="hint" role="status">{{ note }}</p>
            }
          </div>
        }
      }
    </section>
  `,
  styles: `
    .tasks {
      padding: var(--s-4);
      margin-block-end: var(--s-4);
    }
    .task-list {
      list-style: none;
      margin: var(--s-3) 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
    }
    .task {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-2);
    }
    .task-number {
      inline-size: 1.5rem;
      color: var(--c-ink-3);
      font-size: var(--fs-sm);
      text-align: center;
    }
    .task-title {
      flex: 1 1 12rem;
      min-inline-size: 0;
    }
    .task-date {
      flex: 0 0 auto;
      inline-size: 10.5rem;
    }
    .task-dual {
      flex: 0 0 auto;
      min-inline-size: 8rem;
    }
    .task-problem {
      flex: 1 0 100%;
      margin: 0;
    }
    .task-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--s-2);
    }
    .task-file {
      cursor: pointer;
    }
    .task-rubric {
      flex: 1 0 100%;
    }
    .rubrics {
      margin-block-start: var(--s-4);
      padding-block-start: var(--s-3);
      border-block-start: 1px solid var(--c-line);
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
    }
    .rubrics .sub-title,
    .rubrics .hint {
      margin: 0;
    }
    .task-warn {
      color: var(--c-attention);
      font-size: var(--fs-sm);
    }
    .task-error {
      color: var(--c-danger);
      font-size: var(--fs-sm);
    }
    .preview {
      padding-block-start: var(--s-3);
      border-block-start: 1px solid var(--c-line);
    }
  `,
})
export class CourseTasks {
  protected readonly data = inject(DataStore);

  protected readonly max = MAX_TASKS;

  // -- the rubric of each task ----------------------------------------------

  protected readonly openRubric = signal<string | null>(null);
  protected readonly rubricNote = signal<string | null>(null);

  protected toggleRubric(taskId: string) {
    this.openRubric.update((open) => (open === taskId ? null : taskId));
  }

  protected rubricLabel(taskId: string): string {
    const lines = this.data.stageRubric(taskId);
    if (!lines.length) return 'מחוון';
    return `מחוון · ${lines.reduce((sum, l) => sum + (l.max_points ?? 0), 0)} נק׳`;
  }

  /** Some task is a stage of the map and has no rubric yet. */
  protected readonly canPropose = computed(() =>
    this.tasks().some(
      (task) => proposedRubricFor(task.title).length && !this.data.stageRubric(task.id).length,
    ),
  );

  protected propose() {
    const filled = this.data.applyProposedRubrics();
    this.rubricNote.set(
      filled === 1
        ? 'נטען מחוון למשימה אחת. זו הצעה: אפשר לשנות כל שורה.'
        : `נטענו מחוונים ל־${filled} משימות. זו הצעה: אפשר לשנות כל שורה.`,
    );
  }

  protected copyFrom(select: HTMLSelectElement) {
    const courseId = select.value;
    select.value = '';
    if (!courseId) return;
    const copied = this.data.copyStageRubrics(courseId);
    this.rubricNote.set(
      copied
        ? copied === 1
          ? 'הועתק מחוון למשימה אחת.'
          : `הועתקו מחוונים ל־${copied} משימות.`
        : 'לא מצאתי מה להעתיק: למשימות כאן כבר יש מחוון, או שאין משימות תואמות.',
    );
  }
  protected readonly tasks = this.data.tasks;
  protected readonly error = signal<string | null>(null);
  protected readonly preview = signal<PreviewRow[]>([]);
  protected readonly overflow = signal(0);

  protected readonly room = computed(() => MAX_TASKS - this.tasks().length);

  protected readonly canLoadMap = computed(
    () => !!this.data.course()?.is_seminar && !this.tasks().length,
  );

  protected loadMap() {
    for (const title of SEMINAR_STAGES) this.data.addTask(title, null);
  }

  protected due(value: string | null): string {
    return dayOf(value) ?? '';
  }

  protected text(iso: string): string {
    return dualDateText(iso) ?? gregorianDate(iso) ?? hebrewDate(iso) ?? iso;
  }

  protected add() {
    this.error.set(null);
    this.data.addTask(`משימה ${this.tasks().length + 1}`, null);
  }

  protected rename(id: string, title: string) {
    if (!this.data.updateTask(id, { title })) this.error.set('צריך שם למשימה.');
    else this.error.set(null);
  }

  protected setDate(id: string, iso: string) {
    this.data.updateTask(id, { due: iso || null });
  }

  protected remove(id: string) {
    this.error.set(
      this.data.deleteTask(id)
        ? null
        : 'יש למשימה הזו עבודות של תלמידות, ולכן אי אפשר להסיר אותה. אפשר לשנות את השם או התאריך.',
    );
  }

  protected async pick(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.error.set(null);
    if (!file) return;

    try {
      const { tasks, overflow } = await readTaskFile(await file.arrayBuffer());
      if (!tasks.length) {
        this.error.set('לא מצאתי משימות בקובץ.');
        return;
      }
      // What there is no room for is reported, never silently dropped.
      const fits = tasks.slice(0, this.room());
      this.overflow.set(overflow + tasks.length - fits.length);
      this.preview.set(fits.map(previewOf));
      if (!fits.length) this.error.set(`כבר יש ${MAX_TASKS} משימות בקורס.`);
    } catch (error) {
      this.error.set(
        error instanceof SheetError ? error.hebrew : 'הקובץ לא נקרא. צריך קובץ Excel מסוג .xlsx.',
      );
    }
  }

  protected choose(index: number, iso: string) {
    this.preview.update((rows) => rows.map((r, i) => (i === index ? { ...r, chosen: iso } : r)));
  }

  protected confirm() {
    for (const row of this.preview()) {
      this.data.addTask(row.title || `משימה ${this.tasks().length + 1}`, row.chosen || null);
    }
    this.cancelPreview();
  }

  protected cancelPreview() {
    this.preview.set([]);
    this.overflow.set(0);
  }
}
