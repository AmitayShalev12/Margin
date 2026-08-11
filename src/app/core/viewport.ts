import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Tracks whether there is room for the desktop layout.
 *
 * Most responsive work in this app is plain CSS. This exists for the one case
 * CSS can't cover: the review screen renders genuinely different markup on
 * each side of the breakpoint — margin bubbles beside the document on
 * desktop, a grouped list plus bottom sheet on mobile — and rendering both
 * and hiding one would duplicate every comment in the accessibility tree.
 *
 * The breakpoint matches `$bp-lg` in `_tokens.scss`.
 */
@Injectable({ providedIn: 'root' })
export class Viewport {
  private readonly query = window.matchMedia('(min-width: 64rem)');
  private readonly _isDesktop = signal(this.query.matches);

  readonly isDesktop = this._isDesktop.asReadonly();

  constructor() {
    const onChange = (e: MediaQueryListEvent) => this._isDesktop.set(e.matches);
    this.query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.query.removeEventListener('change', onChange));
  }
}
