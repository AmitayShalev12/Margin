import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Tabs } from '../../../core/tabs';
import { Icon } from '../icon/icon';

/**
 * The open places, as a row of tabs above the page.
 *
 * Modelled on Firefox: the tab on screen is lifted onto the page's own
 * surface, the others sit back; each closes with its own ×, and + opens a new
 * one on the home screen. Links, not ARIA tabs — each one goes somewhere, it
 * does not swap a panel in place.
 */
@Component({
  selector: 'app-tab-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <nav class="strip" aria-label="כרטיסיות פתוחות">
      @for (tab of tabs.tabs(); track tab.key) {
        <div class="tab" [class.is-active]="tab.active">
          <a
            class="tab-link"
            [routerLink]="tab.url"
            [attr.aria-current]="tab.active ? 'page' : null"
            [title]="tab.title"
          >
            <app-icon [name]="tab.icon" [size]="16" />
            <span class="tab-title">{{ tab.title }}</span>
          </a>
          <button
            type="button"
            class="tab-close"
            [attr.aria-label]="'סגירת הכרטיסייה ' + tab.title"
            (click)="tabs.close(tab.key)"
          >
            <app-icon name="close" [size]="14" />
          </button>
        </div>
      }
      <button
        type="button"
        class="tab-new"
        aria-label="כרטיסייה חדשה"
        title="כרטיסייה חדשה"
        (click)="tabs.openNew()"
      >
        <app-icon name="plus" [size]="16" />
      </button>
    </nav>
  `,
  styles: `
    :host {
      display: block;
      background: var(--c-surface-sunk);
    }

    /* The baseline is an inset shadow on the strip rather than a border on
       the host, so the active tab's own background can paint over it — and
       nothing has to hang a pixel outside the strip to do so. A -1px margin
       did it before, and made the strip one pixel taller than its box: a
       sideways-scrolling strip then grew a vertical scrollbar as well. */
    .strip {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding: var(--s-2) var(--s-4) 0;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
      box-shadow: inset 0 -1px 0 var(--c-line);
    }

    .tab {
      position: relative;
      display: flex;
      align-items: center;
      flex: 0 1 12rem;
      min-width: 6.5rem;
      border: 1px solid var(--c-accent-line);
      border-block-end: 0;
      border-start-start-radius: var(--r-md);
      border-start-end-radius: var(--r-md);
      background: var(--c-accent-soft);
      color: var(--c-accent-strong);
      transition: background var(--dur-fast) var(--ease);

      &:hover {
        background: var(--c-accent-line);
      }
    }

    /* Lifted onto the page: same surface, no border underneath, so the tab
       and what it shows read as one sheet — the Firefox cue for "this one". */
    .tab.is-active,
    .tab.is-active:hover {
      background: var(--c-paper);
      border-color: var(--c-line);
      color: var(--c-ink);
    }

    .tab-link {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      flex: 1;
      min-width: 0;
      min-height: 2.25rem;
      padding-inline: var(--s-3) var(--s-1);
      color: inherit;
      text-decoration: none;
      font-size: var(--fs-sm);
      font-weight: 500;
    }

    .tab-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tab-close,
    .tab-new {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 1.75rem;
      height: 1.75rem;
      border: 0;
      border-radius: var(--r-sm);
      background: none;
      color: inherit;
      cursor: pointer;

      &:hover {
        background: color-mix(in srgb, var(--c-accent-line) 60%, transparent);
        color: var(--c-ink);
      }
    }

    .tab-close {
      margin-inline-end: var(--s-1);
    }

    .tab-new {
      margin-block-end: var(--s-1);
    }
  `,
})
export class TabStrip {
  protected readonly tabs = inject(Tabs);
}
