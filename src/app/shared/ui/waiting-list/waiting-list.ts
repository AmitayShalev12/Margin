import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { WaitingList } from '../../../core/notifications/waiting-list';
import { Icon } from '../icon/icon';

/**
 * What is waiting for her, one line per task. A task opens to show whose
 * papers they are, and can check all its unread papers in one go.
 *
 * The same component on the home screen, in the sidebar and under the bell.
 */
@Component({
  selector: 'app-waiting-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  host: { '[class.compact]': 'compact()' },
  template: `
    <ul class="groups">
      @for (group of list.groups(); track group.id) {
        <li class="group">
          <button
            type="button"
            class="group-head"
            [attr.aria-expanded]="isOpen(group.id)"
            (click)="toggle(group.id)"
          >
            <span class="chev" [class.open]="isOpen(group.id)" aria-hidden="true">
              <app-icon name="chevron" [size]="16" />
            </span>
            <span class="group-name">
              <span class="group-title">{{ group.title }}</span>
              @if (list.showCourse()) {
                <span class="group-course">{{ group.course }}</span>
              }
            </span>
            <span class="group-count">{{ group.items.length }}</span>
          </button>

          @if (isOpen(group.id)) {
            <div class="group-body anim-unfold">
              <ul class="items">
                @for (item of group.items; track item.id) {
                  <li>
                    <a class="item" [routerLink]="item.link" (click)="picked.emit()">
                      <span class="item-name">{{ item.student }}</span>
                      <span class="item-state" [class.ready]="item.kind === 'send'">{{ item.short }}</span>
                    </a>
                  </li>
                }
              </ul>

              @if (list.run(); as run) {
                @if (run.taskId === group.id) {
                  <div class="run" role="status">
                    @if (run.running) {
                      <span>בודקת {{ run.done + 1 }} מתוך {{ run.total }}: {{ run.current }}</span>
                      <button type="button" class="btn btn-plain btn-sm" (click)="list.stop()">עצירה</button>
                    } @else {
                      <span>
                        @if (run.done - run.failed.length === 1) {
                          עבודה אחת נבדקה.
                        } @else {
                          {{ run.done - run.failed.length }} עבודות נבדקו.
                        }
                      </span>
                      <button type="button" class="btn btn-plain btn-sm" (click)="list.clear()">סגירה</button>
                    }
                    @for (line of run.failed; track line) {
                      <span class="run-failed">{{ line }}</span>
                    }
                  </div>
                }
              }

              @if (list.canCheck && group.unchecked.length && !list.run()?.running) {
                <button type="button" class="check-all" (click)="list.checkAll(group)">
                  <app-icon name="sparkle" [size]="16" />
                  @if (group.unchecked.length === 1) {
                    לבדוק את העבודה החדשה
                  } @else {
                    לבדוק את כל {{ group.unchecked.length }} העבודות החדשות
                  }
                </button>
              }
            </div>
          }
        </li>
      } @empty {
        <li class="none">שום דבר לא מחכה כרגע.</li>
      }
    </ul>
  `,
  styleUrl: './waiting-list.scss',
})
export class WaitingListView {
  protected readonly list = inject(WaitingList);

  /** Tighter, for the sidebar and the bell. */
  readonly compact = input(false);
  /** She chose a paper: whatever holds this list can close. */
  readonly picked = output<void>();

  private readonly openIds = signal<ReadonlySet<string>>(new Set());

  protected isOpen(id: string): boolean {
    return this.openIds().has(id);
  }

  protected toggle(id: string) {
    this.openIds.update((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
}
