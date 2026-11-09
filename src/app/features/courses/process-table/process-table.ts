import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { dayOf } from '../../../core/dates/hebrew-date';
import { normaliseName } from '../../../core/drive/file-name';
import { UUID } from '../../../core/models';
import { lateNote, latePapers } from '../../../core/progress/traffic-light';

type ColumnFilter = '' | 'yes' | 'no';

/** Who handed in what: a row per student, a column per task, filtered from the headers. */
@Component({
  selector: 'app-process-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="card summary" aria-labelledby="summary-title">
      <h2 id="summary-title" class="sub-title">איפה כל תלמידה אוחזת</h2>

      @if (tasks().length) {
        <div class="wrap" tabindex="0" role="region" aria-label="סיכום משימות">
          <table>
            <thead>
              <tr>
                <th scope="col" class="name">
                  <label class="sr-only" for="summary-name">סינון לפי שם</label>
                  <input
                    id="summary-name"
                    class="control filter"
                    type="search"
                    placeholder="שם"
                    [value]="nameFilter()"
                    (input)="nameFilter.set($any($event.target).value)"
                  />
                </th>
                @for (task of tasks(); track task.id; let i = $index) {
                  <th scope="col">
                    <span class="title">{{ i + 1 }}. {{ task.title }}</span>
                    <select
                      class="control filter"
                      [attr.aria-label]="'סינון לפי ' + task.title"
                      (change)="setFilter(task.id, $any($event.target).value)"
                    >
                      <option value="">הכל</option>
                      <option value="yes">הגישו</option>
                      <option value="no">חסר</option>
                    </select>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr>
                  <th scope="row" class="name">{{ row.name }}</th>
                  @for (cell of row.cells; track $index) {
                    <td>
                      @if (cell.paperId; as id) {
                        <a [routerLink]="['/review', id]" [title]="cell.note ?? 'לעבודה'">
                          {{ cell.note ? 'באיחור' : 'הוגש' }}
                        </a>
                      } @else {
                        <span class="missing">חסר</span>
                      }
                    </td>
                  }
                </tr>
              } @empty {
                <tr>
                  <td class="missing" [attr.colspan]="tasks().length + 1">אין תלמידות שמתאימות לסינון.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="hint">עוד אין משימות. מוסיפים אותן כאן למטה.</p>
      }
    </section>
  `,
  styles: `
    .summary {
      padding: var(--s-4);
      margin-block-end: var(--s-4);
    }
    .wrap {
      margin-block-start: var(--s-3);
      overflow-x: auto;
    }
    table {
      border-collapse: collapse;
      font-size: var(--fs-sm);
    }
    th,
    td {
      padding: var(--s-2);
      border: 1px solid var(--c-line);
      text-align: start;
      vertical-align: top;
      white-space: nowrap;
    }
    thead th {
      background: var(--c-surface-sunk);
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
    .title {
      display: block;
      margin-block-end: var(--s-1);
    }
    .filter {
      min-height: 2rem;
      block-size: 2rem;
      padding-block: 0;
      min-inline-size: 5.5rem;
      font-size: var(--fs-xs);
    }
    .missing {
      color: var(--c-ink-3);
    }
  `,
})
export class ProcessTable {
  private readonly data = inject(DataStore);

  protected readonly tasks = this.data.tasks;
  protected readonly nameFilter = signal('');
  private readonly filters = signal<Record<UUID, ColumnFilter>>({});

  protected setFilter(taskId: UUID, value: ColumnFilter) {
    this.filters.update((all) => ({ ...all, [taskId]: value }));
  }

  private readonly allRows = computed(() => {
    const course = this.data.course();
    if (!course) return [];
    const tasks = this.tasks();
    const dated = tasks.map((t) => ({ id: t.id, due: dayOf(t.due_at) }));
    const papers = this.data.submissions();

    return [...this.data.studentsIn(course.id)]
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'he'))
      .map((student) => {
        const hers = papers.filter((p) => p.student_id === student.id);
        const late = latePapers(dated, hers);
        return {
          id: student.id,
          name: student.full_name,
          cells: tasks.map((task) => {
            const paper = hers.find((p) => p.assignment_id === task.id);
            const lateOne = late.find((l) => l.taskId === task.id);
            return {
              taskId: task.id,
              paperId: paper?.id ?? null,
              note: lateOne ? lateNote(task.title, lateOne.checked) : null,
            };
          }),
        };
      });
  });

  protected readonly rows = computed(() => {
    const name = normaliseName(this.nameFilter());
    const filters = this.filters();
    return this.allRows().filter(
      (row) =>
        (!name || normaliseName(row.name).includes(name)) &&
        row.cells.every((cell) => {
          const wanted = filters[cell.taskId];
          return !wanted || (wanted === 'yes') === !!cell.paperId;
        }),
    );
  });
}
