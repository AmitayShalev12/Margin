import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { CommonNotes } from '../common-notes/common-notes';
import { CourseTasks } from '../course-tasks/course-tasks';
import { ProcessTable } from '../process-table/process-table';
import { StageChart } from '../stage-chart/stage-chart';

const VIEW_KEY = 'margin.processView';
type View = 'table' | 'chart';

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'chart' ? 'chart' : 'table';
  } catch {
    return 'table';
  }
}

/** The process of a course, two ways: a table by student, or a flow by stage. */
@Component({
  selector: 'app-course-process',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonNotes, CourseTasks, ProcessTable, StageChart],
  template: `
    <div class="views" role="group" aria-label="תצוגה">
      <button type="button" class="view" [attr.aria-pressed]="view() === 'table'" (click)="show('table')">
        טבלה
      </button>
      <button type="button" class="view" [attr.aria-pressed]="view() === 'chart'" (click)="show('chart')">
        תרשים זרימה
      </button>
    </div>

    @if (view() === 'table') {
      <app-process-table />
    } @else {
      <app-stage-chart />
    }
    <app-common-notes />
    <app-course-tasks />
  `,
  styles: `
    .views {
      display: inline-flex;
      gap: var(--s-1);
      margin-block: var(--s-3);
      padding: var(--s-1);
      border-radius: var(--r-full);
      background: var(--c-surface-sunk);
    }
    .view {
      min-block-size: 2.25rem;
      padding-inline: var(--s-4);
      border: 0;
      border-radius: var(--r-full);
      background: transparent;
      color: var(--c-ink-2);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: background var(--dur-fast) var(--ease);
    }
    .view[aria-pressed='true'] {
      background: var(--c-surface);
      color: var(--c-accent-strong);
      box-shadow: var(--sh-1);
    }
  `,
})
export class CourseProcess {
  protected readonly view = signal<View>(savedView());

  protected show(view: View) {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Remembering the choice is a convenience; the switch still works.
    }
  }
}
