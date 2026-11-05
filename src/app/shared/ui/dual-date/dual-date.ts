import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { dayOf, gregorianDate, hebrewDate } from '../../../core/dates/hebrew-date';

/** A date, Hebrew first and prominent, Gregorian small beneath it. */
@Component({
  selector: 'app-dual-date',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hebrew(); as text) {
      <span class="hebrew">{{ text }}</span>
      <span class="gregorian" dir="ltr">{{ gregorian() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      line-height: 1.25;
    }
    .hebrew {
      font-weight: 600;
    }
    .gregorian {
      align-self: flex-start;
      color: var(--c-ink-3);
      font-size: var(--fs-xs);
    }
  `,
})
export class DualDate {
  readonly date = input<string | null | undefined>(null);

  private readonly day = computed(() => dayOf(this.date()));
  protected readonly hebrew = computed(() => {
    const day = this.day();
    return day && hebrewDate(day);
  });
  protected readonly gregorian = computed(() => {
    const day = this.day();
    return day && gregorianDate(day);
  });
}
