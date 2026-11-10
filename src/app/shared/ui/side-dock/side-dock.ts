import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';

import { DataStore } from '../../../core/data/data-store';
import { waitingFor } from '../../../core/notifications/waiting';
import { Icon } from '../icon/icon';

/**
 * The dynamic sidebar: a handle in the middle of the right edge that opens a
 * panel sized to what is in it. Each heading goes to its own screen; the lines
 * under it go straight to one item.
 */
@Component({
  selector: 'app-side-dock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, RouterLinkActive],
  template: `
    @if (open()) {
      <div class="dock-backdrop" (click)="open.set(false)"></div>
    }
    <div class="dock" [class.is-open]="open()" (keydown.escape)="open.set(false)">
      <button
        type="button"
        class="handle"
        [attr.aria-expanded]="open()"
        aria-controls="side-dock-panel"
        [attr.aria-label]="open() ? 'סגירת התפריט' : 'פתיחת התפריט'"
        (click)="open.set(!open())"
      >
        <app-icon name="chevron" [size]="16" />
        <span class="handle-label">תפריט</span>
        @if (waiting().length) {
          <span class="handle-badge">{{ waiting().length }}</span>
        }
      </button>

      @if (open()) {
        <nav id="side-dock-panel" class="panel" aria-label="ניווט ראשי">
          <a class="head" routerLink="/courses" routerLinkActive="is-active" [routerLinkActiveOptions]="{ exact: true }">
            <app-icon name="home" [size]="18" />
            <span>בית</span>
          </a>

          <a class="head" routerLink="/students" routerLinkActive="is-active">
            <app-icon name="users" [size]="18" />
            <span>התלמידות שלי</span>
          </a>

          <section class="group">
            <a class="head" routerLink="/courses">
              <app-icon name="bell" [size]="18" />
              <span>מה מחכה לי</span>
              @if (waiting().length) {
                <span class="count">{{ waiting().length }}</span>
              }
            </a>
            <ul class="items">
              @for (item of waiting().slice(0, 6); track item.id) {
                <li><a class="item" [routerLink]="item.link">{{ item.text }}</a></li>
              } @empty {
                <li class="none">שום דבר כרגע.</li>
              }
            </ul>
          </section>

          <section class="group">
            <a class="head" routerLink="/courses">
              <app-icon name="book" [size]="18" />
              <span>הקורסים · {{ data.year() }}</span>
            </a>
            <ul class="items">
              @for (course of data.coursesInYear(); track course.id) {
                <li>
                  <a class="item" [routerLink]="['/courses', course.id]" routerLinkActive="is-active">
                    {{ course.name }}
                  </a>
                </li>
              } @empty {
                <li class="none">אין קורסים בשנה הזו.</li>
              }
            </ul>
          </section>
        </nav>
      }
    </div>
  `,
  styleUrl: './side-dock.scss',
})
export class SideDock {
  protected readonly data = inject(DataStore);
  protected readonly open = signal(false);

  /** Across the selected year's courses: the same list as the home screen's. */
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

  constructor() {
    // Wherever she went, she got there: the panel gets out of the way.
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.open.set(false));
  }
}
