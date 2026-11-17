import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';

/**
 * One task's rubric, as lines she can change: what is judged and for how many
 * points. A paper handed in for this task is scored against these lines; a
 * task with none is scored against the course's general rubric.
 */
@Component({
  selector: 'app-task-rubric',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rubric">
      @if (lines().length) {
        <ul class="lines">
          @for (line of lines(); track line.id) {
            <li class="line">
              <input
                class="control line-name"
                type="text"
                aria-label="מה נבדק"
                [value]="line.name"
                (change)="rename(line.id, $any($event.target).value)"
              />
              <label class="line-points">
                <input
                  class="control"
                  type="number"
                  min="0"
                  max="100"
                  inputmode="numeric"
                  aria-label="נקודות"
                  [value]="line.max_points ?? 0"
                  (change)="setPoints(line.id, $any($event.target).value)"
                />
                <span>נק׳</span>
              </label>
              <button
                type="button"
                class="line-remove"
                aria-label="הסרת השורה"
                title="הסרת השורה"
                (click)="data.removeStageCriterion(line.id)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                </svg>
              </button>
              @if (line.description) {
                <span class="line-source">מקור במחוון המנחה: {{ line.description }}</span>
              }
            </li>
          }
        </ul>
        <p class="total" [class.off]="total() !== 100">
          סה״כ {{ total() }} נקודות
          @if (total() !== 100) {
            <span>· כדאי שיסתכם ב־100</span>
          }
        </p>
      } @else {
        <p class="hint">
          אין למשימה הזו מחוון משלה, ולכן עבודות שלה מנוקדות לפי המחוון הכללי של הקורס.
        </p>
      }

      <form class="add" (submit)="$event.preventDefault(); add()">
        <input
          class="control line-name"
          type="text"
          placeholder="שורה חדשה: מה נבדק"
          aria-label="שורה חדשה: מה נבדק"
          [value]="draftName()"
          (input)="draftName.set($any($event.target).value)"
        />
        <label class="line-points">
          <input
            class="control"
            type="number"
            min="0"
            max="100"
            inputmode="numeric"
            aria-label="נקודות לשורה החדשה"
            [value]="draftPoints()"
            (input)="draftPoints.set($any($event.target).value)"
          />
          <span>נק׳</span>
        </label>
        <button type="submit" class="btn btn-ghost btn-sm" [disabled]="!draftName().trim()">הוספה</button>
      </form>
    </div>
  `,
  styles: `
    .rubric {
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
      padding: var(--s-3);
      border-radius: var(--r-md);
      background: var(--c-paper);
    }
    .lines {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
    }
    .line,
    .add {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-1) var(--s-2);
    }
    .line-name {
      flex: 1 1 14rem;
      min-inline-size: 0;
    }
    .line-points {
      display: inline-flex;
      align-items: center;
      gap: var(--s-1);
      color: var(--c-ink-3);
      font-size: var(--fs-sm);
    }
    .line-points .control {
      inline-size: 4.5rem;
      text-align: center;
    }
    .line-source {
      flex: 1 0 100%;
      color: var(--c-ink-3);
      font-size: var(--fs-xs);
    }
    .line-remove {
      display: inline-grid;
      place-items: center;
      inline-size: 2.25rem;
      block-size: 2.25rem;
      border: 0;
      border-radius: var(--r-md);
      background: transparent;
      color: var(--c-ink-3);
      cursor: pointer;
    }
    .line-remove:hover {
      background: var(--c-danger-soft);
      color: var(--c-danger);
    }
    .total {
      margin: 0;
      font-weight: 600;
    }
    .total.off {
      color: var(--c-attention);
    }
    .total span {
      font-weight: 400;
    }
    .add {
      padding-block-start: var(--s-2);
      border-block-start: 1px solid var(--c-line);
    }
  `,
})
export class TaskRubric {
  protected readonly data = inject(DataStore);

  readonly taskId = input.required<string>();

  protected readonly lines = computed(() => this.data.stageRubric(this.taskId()));
  protected readonly total = computed(() =>
    this.lines().reduce((sum, line) => sum + (line.max_points ?? 0), 0),
  );

  protected readonly draftName = signal('');
  protected readonly draftPoints = signal('10');

  protected rename(id: string, name: string) {
    this.data.editStageCriterion(id, { name });
  }

  protected setPoints(id: string, value: string) {
    this.data.editStageCriterion(id, { points: Number(value) });
  }

  protected add() {
    if (this.data.addStageCriterion(this.taskId(), this.draftName(), Number(this.draftPoints()))) {
      this.draftName.set('');
    }
  }
}
