import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { isolateForDisplay } from '../../../core/presentation/document-render';

/**
 * Renders a string with its Latin/numeric runs bidi-isolated.
 *
 * The document already gets this treatment run-by-run in the review screen.
 * Everything *about* the document — comment bodies, quoted spans, the batch
 * summary — needs it too: a drafted comment saying `בלי גודל אפקט (r = .42,
 * p < .01) קשה לדעת` renders with its brackets reversed as a plain
 * interpolation.
 */
@Component({
  selector: 'app-bidi-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (run of runs(); track $index) {
    @if (run.ltr) {
      <span class="ltr">{{ run.text }}</span>
    } @else {
      <span>{{ run.text }}</span>
    }
  }`,
  styles: `
    :host {
      display: inline;
    }
  `,
})
export class BidiText {
  readonly value = input.required<string>();

  protected readonly runs = computed(() => isolateForDisplay(this.value()));
}
