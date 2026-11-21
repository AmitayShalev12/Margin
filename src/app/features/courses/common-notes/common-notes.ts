import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { countsTowardGrade } from '../../../core/grading/entries';
import { AnnotationKind } from '../../../core/models';
import { KIND_LABEL, kindClass } from '../../../core/presentation/annotation-kind';

/**
 * What the whole class gets wrong most, by the kind of note she kept.
 *
 * Counted from her own decisions, with no model behind it: a note she removed
 * is not counted, and praise is left out because it is not something to teach
 * again. It answers "what should I go over in class" without opening a paper.
 */
@Component({
  selector: 'app-common-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <section class="card common" aria-labelledby="common-title">
        <h2 id="common-title" class="sub-title">על מה הערת הכי הרבה בקורס הזה</h2>
        <p class="hint">
          לפי ההערות שאישרת או כתבת, בכל העבודות של הקורס. כדאי לחזור על זה בכיתה.
        </p>
        <ul class="bars">
          @for (row of rows(); track row.label) {
            <li class="bar" [class]="row.class">
              <span class="bar-label">{{ row.label }}</span>
              <span class="bar-track" aria-hidden="true">
                <span class="bar-fill" [style.inline-size.%]="row.share"></span>
              </span>
              <span class="bar-count">{{ row.count }} הערות, אצל {{ row.students }} תלמידות</span>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    .common {
      padding: var(--s-4);
      margin-block-end: var(--s-4);
    }
    .bars {
      display: grid;
      gap: var(--s-2);
      margin-block-start: var(--s-3);
      padding: 0;
      list-style: none;
    }
    .bar {
      display: grid;
      grid-template-columns: 5rem minmax(4rem, 1fr) auto;
      align-items: center;
      gap: var(--s-3);
    }
    .bar-label {
      font-weight: 600;
    }
    .bar-track {
      display: flex;
      justify-content: flex-start;
      block-size: 0.75rem;
      border-radius: var(--r-full);
      background: var(--c-surface-sunk);
      overflow: hidden;
    }
    .bar-fill {
      display: block;
      block-size: 100%;
      border-radius: var(--r-full);
      background: var(--k-ink, var(--c-accent));
    }
    .bar-count {
      color: var(--c-ink-2);
      font-size: var(--fs-sm);
    }
    @media (max-width: 428px) {
      .bar {
        grid-template-columns: 4rem 1fr;
      }
      .bar-count {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class CommonNotes {
  private readonly data = inject(DataStore);

  protected readonly rows = computed(() => {
    const papers = new Map(this.data.courseSubmissions().map((p) => [p.id, p.student_id]));
    const byKind = new Map<AnnotationKind, { count: number; students: Set<string> }>();

    for (const a of this.data.annotations()) {
      const student = papers.get(a.submission_id);
      if (!student || a.kind === 'praise' || !countsTowardGrade(a.status)) continue;
      const entry = byKind.get(a.kind) ?? { count: 0, students: new Set<string>() };
      entry.count++;
      entry.students.add(student);
      byKind.set(a.kind, entry);
    }

    const most = Math.max(0, ...[...byKind.values()].map((e) => e.count));
    return [...byKind.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([kind, entry]) => ({
        label: KIND_LABEL[kind],
        class: kindClass(kind),
        count: entry.count,
        students: entry.students.size,
        share: most ? Math.round((entry.count / most) * 100) : 0,
      }));
  });
}
