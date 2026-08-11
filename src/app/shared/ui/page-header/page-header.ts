import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * One title per screen, one optional line of context under it. Anything more
 * than that belongs in the page body — the header is not a place for stats
 * or controls.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h1>{{ title() }}</h1>
      @if (subtitle()) {
        <p class="sub">{{ subtitle() }}</p>
      }
    </header>
  `,
  styles: `
    .head {
      margin-block-end: var(--s-6);
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
