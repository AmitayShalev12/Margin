import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { waitingFor } from '../../../core/notifications/waiting';
import { SearchResult, search } from '../../../core/search/search';
import { Icon } from '../icon/icon';

/** The search box and "מה מחכה לי?", beside the year in the top bar. */
@Component({
  selector: 'app-top-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <div class="search">
      <label class="sr-only" for="top-search">חיפוש תלמידה או קורס</label>
      <input
        id="top-search"
        class="control"
        type="search"
        placeholder="חיפוש תלמידה או קורס"
        autocomplete="off"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        (keydown.escape)="query.set('')"
      />
      @if (query().trim()) {
        <div class="backdrop" (click)="query.set('')"></div>
        <ul class="menu" aria-label="תוצאות חיפוש">
          @for (result of results(); track result.id) {
            <li>
              <button type="button" class="menu-item" (click)="go(result)">
                <span class="menu-title">{{ result.title }}</span>
                <span class="menu-detail">{{ result.detail }}</span>
              </button>
            </li>
          } @empty {
            <li class="menu-none">לא נמצא.</li>
          }
        </ul>
      }
    </div>

    <div class="bell-wrap">
      <button
        type="button"
        class="bell"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'מה מחכה לי? ' + waiting().length"
        title="מה מחכה לי?"
        (click)="open.set(!open())"
      >
        <app-icon name="bell" [size]="20" />
        @if (waiting().length) {
          <span class="badge">{{ waiting().length }}</span>
        }
      </button>
      @if (open()) {
        <div class="backdrop" (click)="open.set(false)"></div>
        <div class="menu menu-bell">
          <p class="menu-head">מה מחכה לי?</p>
          <ul>
            @for (item of waiting(); track item.id) {
              <li>
                <a class="menu-item" [routerLink]="item.link" (click)="open.set(false)">{{ item.text }}</a>
              </li>
            } @empty {
              <li class="menu-none">שום דבר כרגע.</li>
            }
          </ul>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      flex: 1 1 auto;
      min-width: 0;
    }
    .search {
      position: relative;
      flex: 0 1 22rem;
      min-width: 0;
    }
    .search .control {
      min-height: 2.25rem;
      block-size: 2.25rem;
      padding-block: 0;
    }
    .bell-wrap {
      position: relative;
      flex: 0 0 auto;
      margin-inline-start: auto;
    }
    .bell {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 2.25rem;
      block-size: 2.25rem;
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-md);
      background: var(--c-surface);
      color: var(--c-ink-2);
      cursor: pointer;
    }
    .badge {
      position: absolute;
      inset-block-start: -0.35rem;
      inset-inline-end: -0.35rem;
      min-inline-size: 1.1rem;
      padding-inline: 0.2rem;
      border-radius: var(--r-full);
      background: var(--c-accent);
      color: var(--c-on-accent);
      font-size: var(--fs-xs);
      line-height: 1.1rem;
      text-align: center;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
    }
    .menu {
      position: absolute;
      z-index: 41;
      inset-block-start: calc(100% + var(--s-1));
      inset-inline-start: 0;
      inline-size: min(22rem, calc(100vw - 2rem));
      max-block-size: 60vh;
      overflow-y: auto;
      margin: 0;
      padding: var(--s-1);
      list-style: none;
      background: var(--c-surface);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-md);
      box-shadow: var(--sh-3);
    }
    .menu-bell {
      inset-inline-start: auto;
      inset-inline-end: 0;
    }
    .menu-bell ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .menu-head {
      margin: 0;
      padding: var(--s-2);
      font-weight: 600;
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
    .menu-title {
      display: block;
      font-weight: 600;
    }
    .menu-detail {
      color: var(--c-ink-3);
      font-size: var(--fs-xs);
    }
    .menu-none {
      padding: var(--s-2);
      color: var(--c-ink-3);
    }
  `,
})
export class TopTools {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly open = signal(false);

  protected readonly results = computed(() =>
    search(this.query(), {
      courses: this.data.courses(),
      students: this.data.students(),
      coursesInYear: this.data.coursesInYear(),
      studentsIn: (id) => this.data.studentsIn(id),
    }),
  );

  /** Across the selected year's courses, not only the one on screen. */
  protected readonly waiting = computed(() => {
    const tasks = new Set(
      this.data.coursesInYear().flatMap((c) => this.data.assignmentsOf(c.id).map((a) => a.id)),
    );
    return waitingFor(
      this.data.submissions().filter((p) => tasks.has(p.assignment_id)),
      this.data.annotations(),
      (id) => this.data.studentName(id),
    );
  });

  protected go(result: SearchResult) {
    this.query.set('');
    void this.router.navigate([result.link], { queryParams: result.queryParams });
  }
}
