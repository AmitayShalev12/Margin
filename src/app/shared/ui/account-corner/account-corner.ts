import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SupabaseService } from '../../../core/supabase/supabase';
import { Icon } from '../icon/icon';

/**
 * Her account, in the bottom-right corner on desktop.
 *
 * Its own component, placed outside the top bar on purpose: the bar's blur makes
 * it the frame for anything fixed inside it, which pinned this to the bar.
 * On a phone the "עוד" sheet holds the account instead.
 */
@Component({
  selector: 'app-account-corner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    @if (email()) {
      <div class="corner">
        <button
          type="button"
          class="account"
          [attr.aria-expanded]="open()"
          aria-label="החשבון"
          title="החשבון"
          (click)="open.set(!open())"
        >
          <app-icon name="user" [size]="22" />
        </button>
        @if (open()) {
          <div class="backdrop" (click)="open.set(false)"></div>
          <div class="menu">
            <p class="menu-head" dir="ltr">{{ email() }}</p>
            <a class="menu-item" routerLink="/settings" (click)="open.set(false)">הגדרות</a>
            <button type="button" class="menu-item" (click)="signOut()">התנתקות</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: none;
    }
    @media (min-width: 64rem) {
      :host {
        display: block;
      }
    }
    .corner {
      position: fixed;
      inset-block-end: var(--s-4);
      right: var(--s-4);
      z-index: 55;
    }
    .account {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 3.25rem;
      block-size: 3.25rem;
      border: 1px solid var(--c-line-strong);
      border-radius: 50%;
      background: var(--c-surface);
      color: var(--c-ink-2);
      box-shadow: var(--sh-3);
      cursor: pointer;
    }
    .account:hover {
      background: var(--c-accent-soft);
      color: var(--c-accent-strong);
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: -1;
    }
    .menu {
      position: absolute;
      inset-block-end: calc(100% + var(--s-2));
      right: 0;
      inline-size: max-content;
      min-inline-size: 12rem;
      padding: var(--s-1);
      background: var(--c-surface);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-md);
      box-shadow: var(--sh-3);
    }
    .menu-head {
      margin: 0;
      padding: var(--s-2);
      color: var(--c-ink-3);
      font-size: var(--fs-sm);
    }
    .menu-item {
      display: block;
      inline-size: 100%;
      padding: var(--s-2);
      border: 0;
      border-radius: var(--r-sm);
      background: none;
      color: var(--c-ink);
      font: inherit;
      text-align: start;
      text-decoration: none;
      cursor: pointer;
    }
    .menu-item:hover {
      background: var(--c-surface-sunk);
    }
  `,
})
export class AccountCorner {
  private readonly supabase = inject(SupabaseService);

  protected readonly open = signal(false);
  protected readonly email = computed(() => this.supabase.user()?.email ?? null);

  protected async signOut() {
    this.open.set(false);
    await this.supabase.signOut();
  }
}
