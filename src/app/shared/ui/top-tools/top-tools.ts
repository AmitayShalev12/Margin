import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { waitingFor } from '../../../core/notifications/waiting';
import { SearchResult, search } from '../../../core/search/search';
import { Icon } from '../icon/icon';

/** Search beside the year, and on a phone the bell. */
@Component({
  selector: 'app-top-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <div class="search" [class.is-open]="searchOpen()">
      <button
        type="button"
        class="bell search-toggle"
        aria-label="חיפוש (Ctrl+K)"
        title="חיפוש (Ctrl+K)"
        [attr.aria-expanded]="searchOpen()"
        (click)="openSearch()"
      >
        <app-icon name="search" [size]="18" />
      </button>
      <label class="sr-only" for="top-search">חיפוש תלמידה או קורס</label>
      <input
        #searchBox
        id="top-search"
        class="control"
        type="search"
        placeholder="חיפוש תלמידה או קורס"
        autocomplete="off"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        (keydown.escape)="closeSearch()"
        (blur)="collapseIfEmpty()"
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
    .search-toggle {
      display: none;
    }
    /* From tablet up the box folds into an icon until it is wanted. */
    @media (min-width: 48rem) {
      :host {
        flex: 0 0 auto;
      }
      .search {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
      }
      .search-toggle {
        display: inline-flex;
      }
      .search .control {
        inline-size: 0;
        padding-inline: 0;
        border-width: 0;
        opacity: 0;
        transition:
          inline-size var(--dur) var(--ease),
          opacity var(--dur) var(--ease);
      }
      .search.is-open .search-toggle {
        display: none;
      }
      .search.is-open .control {
        inline-size: 16rem;
        padding-inline: var(--s-3);
        border-width: 1px;
        opacity: 1;
      }
      /* The box is at the far left, so its results open towards the page. */
      .search .menu {
        inset-inline-start: auto;
        inset-inline-end: 0;
      }
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
    /* On desktop the sidebar shows what is waiting, so the bell is for phones. */
    @media (min-width: 64rem) {
      .bell-wrap {
        display: none;
      }
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
  protected readonly searchOpen = signal(false);
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  protected openSearch() {
    this.searchOpen.set(true);
    queueMicrotask(() => this.searchBox()?.nativeElement.focus());
  }

  protected closeSearch() {
    this.query.set('');
    this.searchOpen.set(false);
    this.searchBox()?.nativeElement.blur();
  }

  /** Leaving an empty box folds it away; one with a query stays open. */
  protected collapseIfEmpty() {
    if (!this.query().trim()) this.searchOpen.set(false);
  }

  /** Ctrl+K anywhere, or "/" when she is not already typing in a field. */
  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing =
      !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
    const ctrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (ctrlK || (event.key === '/' && !typing)) {
      event.preventDefault();
      this.openSearch();
    }
  }
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
    this.searchOpen.set(false);
    void this.router.navigate([result.link], { queryParams: result.queryParams });
  }
}
