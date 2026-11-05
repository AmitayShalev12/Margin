import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { dayOf } from '../../../core/dates/hebrew-date';
import { DualDate } from '../../../shared/ui/dual-date/dual-date';

/** The course's tasks as stages of one piece of work, and who has reached each. */
@Component({
  selector: 'app-process-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DualDate],
  template: `
    @if (stages().length) {
      <section class="card flow" aria-labelledby="flow-title">
        <h2 id="flow-title" class="sub-title">התהליך</h2>
        <ol class="stages">
          @for (stage of stages(); track stage.id; let i = $index) {
            <li class="stage" [class.is-past]="stage.past">
              <span class="stage-number" aria-hidden="true">{{ i + 1 }}</span>
              <span class="stage-title">{{ stage.title }}</span>
              <app-dual-date [date]="stage.due" />
              <span class="stage-count">הגישו {{ stage.handedIn }} מתוך {{ total() }}</span>
            </li>
          }
        </ol>

        <div class="people" tabindex="0" role="region" aria-label="ההתקדמות של כל תלמידה">
          <table>
            <thead>
              <tr>
                <th scope="col">תלמידה</th>
                @for (stage of stages(); track stage.id; let i = $index) {
                  <th scope="col" [title]="stage.title">{{ i + 1 }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (person of people(); track person.id) {
                <tr>
                  <th scope="row">{{ person.name }}</th>
                  @for (done of person.stages; track $index) {
                    <td [attr.aria-label]="done ? 'הוגש' : 'לא הוגש'">{{ done ? '✓' : '·' }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  styles: `
    .flow {
      padding: var(--s-4);
      margin-block-end: var(--s-4);
    }
    .stages {
      list-style: none;
      margin: var(--s-3) 0 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--s-2);
    }
    .stage {
      flex: 1 1 10rem;
      display: flex;
      flex-direction: column;
      gap: var(--s-1);
      padding: var(--s-3);
      border: 1px solid var(--c-line);
      border-block-start: 3px solid var(--c-line-strong);
      border-radius: var(--r-md);
      background: var(--c-surface);
    }
    .stage.is-past {
      border-block-start-color: var(--c-accent);
    }
    .stage-number {
      color: var(--c-ink-3);
      font-size: var(--fs-xs);
    }
    .stage-title {
      font-weight: 600;
    }
    .people {
      margin-block-start: var(--s-3);
      overflow-x: auto;
      font-size: var(--fs-sm);
    }
    .people table {
      border-collapse: collapse;
    }
    .people th,
    .people td {
      padding: var(--s-1) var(--s-2);
      text-align: center;
      white-space: nowrap;
    }
    .people tbody th {
      text-align: start;
      font-weight: 500;
    }
    .stage-count {
      color: var(--c-ink-2);
      font-size: var(--fs-sm);
    }
  `,
})
export class ProcessFlow {
  private readonly data = inject(DataStore);

  protected readonly total = computed(() => {
    const course = this.data.course();
    return course ? this.data.studentsIn(course.id).length : 0;
  });

  protected readonly people = computed(() => {
    const course = this.data.course();
    if (!course) return [];
    const papers = this.data.submissions();
    return [...this.data.studentsIn(course.id)]
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'he'))
      .map((student) => ({
        id: student.id,
        name: student.full_name,
        stages: this.data
          .tasks()
          .map((t) => papers.some((p) => p.assignment_id === t.id && p.student_id === student.id)),
      }));
  });

  protected readonly stages = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const papers = this.data.submissions();
    return this.data.tasks().map((task) => {
      const due = dayOf(task.due_at);
      return {
        id: task.id,
        title: task.title,
        due,
        past: !!due && due < today,
        handedIn: new Set(papers.filter((p) => p.assignment_id === task.id).map((p) => p.student_id))
          .size,
      };
    });
  });
}
