import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../core/data/data-store';
import { dayOf, yearKey } from '../../core/dates/hebrew-date';
import { Course, UUID } from '../../core/models';
import {
  LIGHT_LABEL,
  Light,
  lateNote,
  latePapers,
  progressOf,
} from '../../core/progress/traffic-light';
import { rosterMismatches, writeRoster } from '../../core/roster/roster';
import { PageHeader } from '../../shared/ui/page-header/page-header';

interface Cell {
  light: Light;
  label: string;
  detail: string;
  late: string[];
  question: string | null;
}

/**
 * One line per person, across her courses in the selected year.
 *
 * Only students of that year: a student belongs to a year through a course, so a
 * year with no courses is an empty table. The rigid table, unlike the soft list
 * inside a course. Columns are data, so statistics can be added as further
 * columns without changing the rows.
 */
@Component({
  selector: 'app-students-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  template: `
    <div class="page">
      <app-page-header
        title="התלמידות שלי"
        [subtitle]="comparing() ? 'תלמידות שלומדות יותר משנה אחת' : 'תמונה כוללת, שנת ' + data.year()"
      >
        <button type="button" class="btn btn-ghost btn-sm" (click)="comparing.set(!comparing())">
          {{ comparing() ? 'חזרה לשנה הנוכחית' : 'השוואה בין שנים' }}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" (click)="exportRoster()">
          ייצוא לאקסל
        </button>
      </app-page-header>

      @if (comparing()) {
        <div class="table-wrap" tabindex="0" role="region" aria-label="השוואה בין שנים">
          <table class="grid">
            <thead>
              <tr>
                <th scope="col" class="name">שם</th>
                @for (year of compared().years; track year) {
                  <th scope="col">{{ year }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of compared().rows; track row.id) {
                <tr>
                  <th scope="row" class="name">{{ row.name }}</th>
                  @for (cell of row.cells; track $index) {
                    <td>{{ cell || '—' }}</td>
                  }
                </tr>
              } @empty {
                <tr>
                  <td class="none" [attr.colspan]="compared().years.length + 1">
                    אין תלמידות שלומדות יותר משנה אחת.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
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

        @if (selected().size) {
          <section class="card bulk" role="group" aria-label="מחיקת תלמידות">
            @if (asking()) {
              <p class="ask">
                למחוק {{ selected().size }} תלמידות מכל הקורסים ומכל השנים, עם כל העבודות שלהן? אי אפשר
                לבטל את זה.
              </p>
              <button type="button" class="btn btn-primary btn-sm" (click)="deleteSelected()">
                כן, למחוק
              </button>
              <button type="button" class="btn btn-plain btn-sm" (click)="asking.set(false)">ביטול</button>
            } @else {
              <span>נבחרו {{ selected().size }}</span>
              <button type="button" class="btn btn-ghost btn-sm" (click)="asking.set(true)">
                מחיקת הנבחרות
              </button>
            }
          </section>
        }

        <div class="table-wrap" tabindex="0" role="region" aria-label="טבלת התלמידות">
          <table class="grid">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="בחירת כולן"
                    [checked]="allSelected()"
                    (change)="toggleAll()"
                  />
                </th>
                <th scope="col" class="name">שם</th>
                <th scope="col">סלולרי</th>
                <th scope="col">דוא"ל</th>
                <th scope="col">סטטוס</th>
                <th scope="col">שנה פדגוגית</th>
                <th scope="col">מסלול</th>
                @for (course of courses(); track course.id) {
                  <th scope="col">{{ course.name }}</th>
                }
                <th scope="col">נוכחות</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      [attr.aria-label]="'בחירת ' + row.name"
                      [checked]="selected().has(row.id)"
                      (change)="toggle(row.id)"
                    />
                  </td>
                  <th scope="row" class="name">{{ row.name }}</th>
                  <td dir="ltr" class="ltr">{{ row.mobile ?? '—' }}</td>
                  <td dir="ltr" class="ltr">{{ row.email ?? '—' }}</td>
                  <td>{{ row.status ?? '—' }}</td>
                  <td>{{ row.year ?? '—' }}</td>
                  <td>{{ row.track ?? '—' }}</td>
                  @for (cell of row.cells; track $index) {
                    <td>
                      @if (cell; as c) {
                        <span class="light" [class]="'is-' + c.light">{{ c.label }}</span>
                        <span class="detail">{{ c.detail }}</span>
                        @for (note of c.late; track note) {
                          <span class="detail detail-late">{{ note }}</span>
                        }
                        @if (c.question) {
                          <span class="detail">שאלת המחקר: {{ c.question }}</span>
                        }
                      } @else {
                        <span class="none" aria-label="לא בקורס">—</span>
                      }
                    </td>
                  }
                  <td><span class="none" aria-label="אין נתון">—</span></td>
                </tr>
              } @empty {
                <tr>
                  <td class="none" [attr.colspan]="courses().length + 8">
                    אין תלמידות בשנת {{ data.year() }}. מוסיפים אותן בתוך קורס.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
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
    .bulk {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-2);
      padding: var(--s-2) var(--s-4);
      margin-block-end: var(--s-3);
    }
    .ask {
      flex: 1 0 100%;
      margin: 0;
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
    .ltr {
      text-align: end;
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
      display: block;
      max-inline-size: 18rem;
      color: var(--c-ink-3);
      font-size: var(--fs-xs);
      white-space: normal;
    }
    .detail-late {
      color: var(--c-attention);
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
  `,
})
export class StudentsOverview {
  protected readonly data = inject(DataStore);

  protected readonly comparing = signal(false);
  protected readonly selected = signal<ReadonlySet<UUID>>(new Set());
  protected readonly asking = signal(false);
  protected readonly courses = this.data.coursesInYear;

  /** Everyone in at least one of this year's courses. */
  private readonly yearStudents = computed(() => {
    const ids = new Set(
      this.courses().flatMap((c) => this.data.studentsIn(c.id).map((s) => s.id)),
    );
    return this.data
      .students()
      .filter((s) => ids.has(s.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'he'));
  });

  protected readonly mismatches = computed(() => rosterMismatches(this.yearStudents()));

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
      const ids = new Set(tasks.map((t) => t.id));
      const hers = papers.filter((p) => p.student_id === studentId && ids.has(p.assignment_id));
      const handed = new Set(hers.map((p) => p.assignment_id));
      const dated = tasks.map((t) => ({ id: t.id, due: dayOf(t.due_at) }));
      const late = latePapers(dated, hers);
      const progress = progressOf(dated, handed, today, new Set(late.map((l) => l.taskId)));
      return {
        light: progress.light,
        label: LIGHT_LABEL[progress.light],
        detail: `${progress.handedIn} מתוך ${tasks.length}`,
        late: late.map((l) => lateNote(tasks.find((t) => t.id === l.taskId)?.title ?? '', l.checked)),
        question: course.asks_research_question
          ? this.data.researchQuestion(studentId, course.id)
          : null,
      };
    };

    return this.yearStudents().map((student) => ({
      id: student.id,
      name: student.full_name,
      status: student.roster_details?.status ?? null,
      year: student.roster_details?.pedagogic_year ?? null,
      track: student.roster_details?.track ?? null,
      mobile: student.mobile ?? student.phone ?? null,
      email: student.email,
      cells: courses.map((course) => cellFor(course, student.id)),
    }));
  });

  /** Students of more than one year, and what they took in each. */
  protected readonly compared = computed(() => {
    const byYear = new Map<string, { label: string; courses: Course[] }>();
    for (const course of this.data.courses()) {
      const key = yearKey(course.year);
      const entry = byYear.get(key) ?? { label: course.year, courses: [] };
      entry.courses.push(course);
      byYear.set(key, entry);
    }
    const years = [...byYear.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));

    const rows = [...this.data.students()]
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'he'))
      .map((student) => ({
        id: student.id,
        name: student.full_name,
        cells: years.map((year) =>
          year.courses
            .filter((c) => this.data.studentsIn(c.id).some((s) => s.id === student.id))
            .map((c) => c.name)
            .join(', '),
        ),
      }))
      .filter((row) => row.cells.filter(Boolean).length > 1);

    return { years: years.map((y) => y.label), rows };
  });

  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((r) => this.selected().has(r.id)),
  );

  protected toggle(id: UUID) {
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

  protected deleteSelected() {
    for (const id of this.selected()) this.data.deleteStudent(id);
    this.selected.set(new Set());
    this.asking.set(false);
  }

  protected exportRoster() {
    const now = new Date();
    const bytes = writeRoster(this.yearStudents(), now);
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
