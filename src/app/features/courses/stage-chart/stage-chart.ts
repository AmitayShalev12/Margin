import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { studentsByStage } from '../../../core/progress/stage-of';

/**
 * The process as a flow: one box per stage, an arrow to the next, and in each
 * box the students who are there now. The same facts as the table, by stage
 * instead of by student.
 */
@Component({
  selector: 'app-stage-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="card chart" aria-labelledby="chart-title">
      <h2 id="chart-title" class="sub-title">מי נמצאת באיזה שלב</h2>
      @if (stages().length) {
        <p class="hint">כל תלמידה מופיעה בשלב האחרון שהגישה.</p>
        <ol class="flow">
          @for (stage of stages(); track stage.taskId ?? 'none') {
            <li class="stage" [class.is-empty]="!stage.students.length" [class.is-start]="!stage.number">
              <div class="stage-head">
                @if (stage.number) {
                  <span class="stage-number" aria-hidden="true">{{ stage.number }}</span>
                }
                <span class="stage-title">{{ stage.title }}</span>
                <span class="stage-count">{{ stage.students.length }}</span>
              </div>
              @if (stage.students.length) {
                <ul class="names">
                  @for (student of stage.students; track student.id) {
                    <li>
                      <a class="name" [routerLink]="['/courses', courseId(), 'student', student.id]">
                        {{ student.full_name }}
                      </a>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ol>
      } @else {
        <p class="hint">עוד אין משימות בקורס. אפשר להוסיף אותן למטה.</p>
      }
    </section>
  `,
  styleUrl: './stage-chart.scss',
})
export class StageChart {
  private readonly data = inject(DataStore);

  protected readonly courseId = computed(() => this.data.course()?.id ?? '');

  protected readonly stages = computed(() => {
    const course = this.data.course();
    if (!course) return [];
    const tasks = this.data.tasks();
    if (!tasks.length) return [];
    const ids = new Set(tasks.map((t) => t.id));
    return studentsByStage(
      tasks,
      this.data.studentsIn(course.id),
      this.data.submissions().filter((p) => ids.has(p.assignment_id)),
    );
  });
}
