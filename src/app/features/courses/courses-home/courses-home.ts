import { waitingFor } from '../../../core/notifications/waiting';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { dayOf } from '../../../core/dates/hebrew-date';
import { nextDeadline } from '../../../core/messages/student-message';
import { count } from '../../../core/presentation/count';
import { DualDate } from '../../../shared/ui/dual-date/dual-date';
import { Icon } from '../../../shared/ui/icon/icon';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { QuickActions } from '../../../shared/ui/quick-actions/quick-actions';

/** The selected year's courses, as cards. Her world starts here. */
@Component({
  selector: 'app-courses-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DualDate, Icon, PageHeader, RouterLink],
  template: `
    <div class="page">
      <app-page-header title="הקורסים שלי" [subtitle]="'שנת ' + data.year()">
        <button type="button" class="btn btn-primary btn-sm" (click)="quick.openAddCourse()">
          <app-icon name="plus" [size]="16" />
          הוספת קורס
        </button>
      </app-page-header>

      @if (waiting().length) {
        <section class="card waiting" aria-labelledby="waiting-title">
          <h2 id="waiting-title" class="sub-title">מחכה לך</h2>
          <ul class="waiting-list">
            @for (item of waiting().slice(0, 5); track item.id) {
              <li><a [routerLink]="item.link">{{ item.text }}</a></li>
            }
          </ul>
          @if (waiting().length > 5) {
            <p class="hint">ועוד {{ waiting().length - 5 }} בפעמון למעלה.</p>
          }
        </section>
      }

      <ul class="cards">
        @for (card of cards(); track card.id) {
          <li>
            <a class="card course-card" [routerLink]="['/courses', card.id]">
              <span class="card-head">
                <span class="card-icon" aria-hidden="true"><app-icon name="book" [size]="22" /></span>
                <span class="card-title">{{ card.name }}</span>
              </span>
              <span class="card-meta">{{ card.students }} · {{ card.papers }}</span>
              @if (card.next; as next) {
                <span class="card-next">
                  <span class="card-next-label">המועד הבא: {{ next.title }}</span>
                  <app-dual-date [date]="next.due" />
                </span>
              }
            </a>
          </li>
        } @empty {
          <li class="empty">עוד אין קורסים בשנת {{ data.year() }}.</li>
        }
      </ul>
    </div>
  `,
  styles: `
    .waiting {
      margin-block-end: var(--s-4);
      padding: var(--s-3) var(--s-4);
      border-color: var(--c-accent-line);
      background: var(--c-accent-soft);
    }
    .waiting-list {
      margin: var(--s-2) 0 0;
      padding-inline-start: var(--s-4);
      display: flex;
      flex-direction: column;
      gap: var(--s-1);
    }
    .cards {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: var(--s-3);
    }
    .course-card {
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
      block-size: 100%;
      padding: var(--s-4);
      color: inherit;
      text-decoration: none;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .course-card:hover {
      border-color: var(--c-accent-line);
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: var(--s-3);
    }
    .card-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      inline-size: 2.5rem;
      block-size: 2.5rem;
      border-radius: var(--r-md);
      background: var(--c-accent-soft);
      color: var(--c-accent);
    }
    .card-title {
      font-size: var(--fs-lg);
      font-weight: 600;
    }
    .card-meta,
    .card-next-label {
      color: var(--c-ink-2);
      font-size: var(--fs-sm);
    }
    .card-next {
      display: flex;
      flex-direction: column;
      gap: var(--s-1);
    }
    .empty {
      color: var(--c-ink-2);
    }
  `,
})
export class CoursesHome {
  protected readonly data = inject(DataStore);
  protected readonly quick = inject(QuickActions);

  /** The same list as the bell, at the top of the home screen. */
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

  protected readonly cards = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const papers = this.data.submissions();
    return this.data.coursesInYear().map((course) => {
      const tasks = this.data.assignmentsOf(course.id);
      const ids = new Set(tasks.map((t) => t.id));
      const next = nextDeadline(tasks, today);
      return {
        id: course.id,
        name: course.name,
        students: count(this.data.studentsIn(course.id).length, {
          one: 'תלמידה אחת',
          two: 'שתי תלמידות',
          many: '# תלמידות',
        }),
        papers: count(papers.filter((p) => ids.has(p.assignment_id)).length, {
          one: 'עבודה אחת',
          two: 'שתי עבודות',
          many: '# עבודות',
        }),
        next: next && { title: next.title, due: dayOf(next.due_at) },
      };
    });
  });
}
