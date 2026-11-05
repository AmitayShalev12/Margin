import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../core/data/data-store';
import { dayOf } from '../../core/dates/hebrew-date';
import { Course, UUID } from '../../core/models';
import { LIGHT_LABEL, Light, progressOf } from '../../core/progress/traffic-light';
import { rosterMismatches, writeRoster } from '../../core/roster/roster';
import { PageHeader } from '../../shared/ui/page-header/page-header';

interface Cell {
  light: Light;
  label: string;
  detail: string;
}

/**
 * One line per person, across her courses in the selected year.
 *
 * The rigid table, unlike the soft list inside a course. Columns are data, so
 * statistics can be added as further columns without changing the rows.
 */
@Component({
  selector: 'app-students-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  template: `
    <div class="page">
      <app-page-header title="התלמידות שלי" [subtitle]="'תמונה כוללת, שנת ' + data.year()">
        <button type="button" class="btn btn-ghost btn-sm" (click)="exportRoster()">
          ייצוא לאקסל
        </button>
      </app-page-header>

      @if (mismatches().length) {
        <section class="card checks" aria-label="פרטים שלא תואמים">
          <p class="checks-title">כדאי לבדוק:</p>
          <ul>
            @for (item of mismatches(); track item.id) {
              <li>{{ item.text }}</li>
            }
          </ul>
        </section>
      }

      <div class="table-wrap" tabindex="0" role="region" aria-label="טבלת התלמידות">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col" class="name">שם</th>
              @for (course of courses(); track course.id) {
                <th scope="col">{{ course.name }}</th>
              }
              <th scope="col">סטטוס לימודים</th>
              <th scope="col">נוכחות</th>
              <th scope="col"><span class="sr-only">פעולות</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr>
                <th scope="row" class="name">{{ row.name }}</th>
                @for (cell of row.cells; track $index) {
                  <td>
                    @if (cell; as c) {
                      <span class="light" [class]="'is-' + c.light">{{ c.label }}</span>
                      <span class="detail">{{ c.detail }}</span>
                    } @else {
                      <span class="none" aria-label="לא בקורס">—</span>
                    }
                  </td>
                }
                <td>{{ row.status ?? '—' }}</td>
                <td><span class="none" aria-label="אין נתון">—</span></td>
                <td class="actions">
                  @if (removing() === row.id) {
                    <span class="ask">למחוק את {{ row.name }} מכל הקורסים, עם כל העבודות שלה?</span>
                    <button type="button" class="btn btn-primary btn-sm" (click)="remove(row.id)">
                      מחיקה
                    </button>
                    <button type="button" class="btn btn-plain btn-sm" (click)="removing.set(null)">
                      ביטול
                    </button>
                  } @else {
                    <button type="button" class="btn btn-plain btn-sm" (click)="removing.set(row.id)">
                      מחיקה
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="none" [attr.colspan]="courses().length + 4">
                  עוד אין תלמידות. מוסיפים אותן בתוך קורס, במסך הקורסים.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .checks {
      padding: var(--s-3) var(--s-4);
      margin-block-end: var(--s-3);
    }
    .checks-title {
      margin: 0 0 var(--s-1);
      color: var(--c-attention);
      font-weight: 600;
    }
    .checks ul {
      margin: 0;
      padding-inline-start: var(--s-4);
      font-size: var(--fs-sm);
    }
    .table-wrap {
      overflow-x: auto;
      background: var(--c-surface);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-sm);
    }
    .grid {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--fs-sm);
    }
    th,
    td {
      padding: var(--s-2) var(--s-3);
      border: 1px solid var(--c-line);
      text-align: start;
      vertical-align: top;
      white-space: nowrap;
    }
    thead th {
      background: var(--c-surface-sunk);
      font-weight: 600;
    }
    .name {
      position: sticky;
      inset-inline-start: 0;
      background: var(--c-surface);
      font-weight: 600;
    }
    thead .name {
      background: var(--c-surface-sunk);
    }
    .light {
      display: block;
      font-weight: 600;
    }
    .detail {
      color: var(--c-ink-3);
      font-size: var(--fs-xs);
    }
    .is-red {
      color: var(--c-danger);
    }
    .is-orange,
    .is-yellow {
      color: var(--c-attention);
    }
    .is-green {
      color: var(--c-ok);
    }
    .none {
      color: var(--c-ink-3);
    }
    .ask {
      display: block;
      margin-block-end: var(--s-1);
      white-space: normal;
      min-inline-size: 12rem;
    }
  `,
})
export class StudentsOverview {
  protected readonly data = inject(DataStore);

  protected readonly removing = signal<UUID | null>(null);
  protected readonly courses = this.data.coursesInYear;
  protected readonly mismatches = computed(() => rosterMismatches(this.data.students()));

  protected readonly rows = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const courses = this.courses();
    const papers = this.data.submissions();
    const members = new Map(
      courses.map((c) => [c.id, new Set(this.data.studentsIn(c.id).map((s) => s.id))]),
    );

    const cellFor = (course: Course, studentId: UUID): Cell | null => {
      if (!members.get(course.id)?.has(studentId)) return null;
      const tasks = this.data.assignmentsOf(course.id);
      const handed = new Set(
        papers.filter((p) => p.student_id === studentId).map((p) => p.assignment_id),
      );
      const progress = progressOf(
        tasks.map((t) => ({ id: t.id, due: dayOf(t.due_at) })),
        handed,
        today,
      );
      return {
        light: progress.light,
        label: LIGHT_LABEL[progress.light],
        detail: `${progress.handedIn} מתוך ${tasks.length}`,
      };
    };

    // Everyone: a student in no course this year still has to be findable here.
    return [...this.data.students()]
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'he'))
      .map((student) => ({
        id: student.id,
        name: student.full_name,
        status: student.roster_details?.status ?? null,
        cells: courses.map((course) => cellFor(course, student.id)),
      }));
  });

  protected remove(id: UUID) {
    this.data.deleteStudent(id);
    this.removing.set(null);
  }

  protected exportRoster() {
    const now = new Date();
    const bytes = writeRoster(this.data.students(), now);
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `margin-students-${now.toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
