import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Temporary marker for a routed screen that exists but hasn't been built
 * yet. Removed as each screen lands in a later phase.
 */
@Component({
  selector: 'app-placeholder-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="note">
      <span class="badge">{{ phase() }}</span>
      <p>{{ text() }}</p>
    </div>
  `,
  styles: `
    .note {
      border: 1px dashed var(--c-line-strong);
      border-radius: var(--r-lg);
      background: var(--c-surface);
      padding: var(--s-5);
      display: flex;
      flex-direction: column;
      gap: var(--s-3);
      align-items: flex-start;
    }

    .badge {
      font-size: var(--fs-xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--c-accent-strong);
      background: var(--c-accent-soft);
      border-radius: var(--r-full);
      padding: 0.15rem var(--s-3);
    }

    p {
      margin: 0;
      color: var(--c-ink-2);
      max-width: 48ch;
    }
  `,
})
export class PlaceholderNote {
  readonly phase = input.required<string>();
  readonly text = input.required<string>();
}
