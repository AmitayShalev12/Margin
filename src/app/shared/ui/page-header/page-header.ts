import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * One title per screen, one optional line of context under it, and — at the
 * inline end — the page's quick actions ("הוספת תלמידה" on My Students,
 * "הוספת קורס" on Courses), projected in by the page. Actions only: stats
 * and settings still belong in the page body.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <div class="text">
        <h1>{{ title() }}</h1>
        @if (subtitle()) {
          <p class="sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
  styles: `
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--s-3) var(--s-4);
      margin-block-end: var(--s-6);
    }

    .text {
      min-width: 0;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--s-2);
    }

    .actions:empty {
      display: none;
    }

    h1 {
      font-size: var(--fs-xl);
    }

    .sub {
      margin: var(--s-2) 0 0;
      color: var(--c-ink-3);
      font-size: var(--fs-base);
      max-width: 42ch;
    }

    @media (min-width: 64rem) {
      h1 {
        font-size: var(--fs-2xl);
      }
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}
