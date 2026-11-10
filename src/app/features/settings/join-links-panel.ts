import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../core/data/data-store';
import { dualDateText } from '../../core/dates/hebrew-date';
import { JoinDuration, JoinLinks, expiryFor, isActive } from '../../core/join/join-links';

/** Making, copying and closing the links students use to join a course. */
@Component({
  selector: 'app-join-links-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card panel" aria-labelledby="join-title">
      <h2 id="join-title" class="section-title">קישורי הצטרפות לקורס</h2>
      <p class="hint">
        תלמידה שפותחת את הקישור ממלאת טופס קצר, בלי חשבון, ונוספת לקורס עם התיקייה שלה. הקישור עובד רק
        עד המועד שבחרת, ועד 100 הרשמות.
      </p>

      @if (!links.available) {
        <p class="hint">צריך חיבור לשרת כדי ליצור קישורים.</p>
      } @else {
        <div class="make">
          <label class="field">
            <span class="label">קורס</span>
            <select class="control" (change)="courseId.set($any($event.target).value)">
              @for (course of data.courses(); track course.id) {
                <option [value]="course.id" [selected]="course.id === courseId()">
                  {{ course.name }} · {{ course.year }}
                </option>
              }
            </select>
          </label>
          <label class="field">
            <span class="label">פתוח למשך</span>
            <select class="control" (change)="duration.set($any($event.target).value)">
              <option value="day">יום</option>
              <option value="week" selected>שבוע</option>
              <option value="month">חודש</option>
              <option value="date">עד תאריך</option>
            </select>
          </label>
          @if (duration() === 'date') {
            <label class="field">
              <span class="label">עד</span>
              <input class="control" type="date" (change)="date.set($any($event.target).value)" />
            </label>
          }
          <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="create()">
            יצירת קישור
          </button>
        </div>

        @if (message() ?? links.error(); as text) {
          <p class="hint" role="status">{{ text }}</p>
        }

        <ul class="list">
          @for (link of active(); track link.id) {
            <li class="row">
              <span class="row-course">{{ courseName(link.course_id) }}</span>
              <span class="row-meta">
                פתוח עד {{ until(link.expires_at) }} · {{ link.submissions }} נרשמו
              </span>
              <input class="control row-url" dir="ltr" readonly [value]="links.url(link)" (focus)="$any($event.target).select()" />
              <div class="row-actions">
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(link.id)">
                  {{ copied() === link.id ? 'הועתק' : 'העתקה' }}
                </button>
                <button type="button" class="btn btn-plain btn-sm" (click)="links.close(link.id)">
                  סגירה
                </button>
              </div>
            </li>
          } @empty {
            <li class="hint">אין קישורים פתוחים.</li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--s-3);
      padding: var(--s-4);
      margin-block-end: var(--s-4);
    }
    .make {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--s-2);
    }
    .make .field {
      flex: 1 1 10rem;
      margin: 0;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-1) var(--s-3);
      padding: var(--s-2) var(--s-3);
      border: 1px solid var(--c-line);
      border-radius: var(--r-md);
    }
    .row-course {
      font-weight: 600;
    }
    .row-meta {
      color: var(--c-ink-3);
      font-size: var(--fs-sm);
    }
    .row-url {
      flex: 1 0 100%;
      font-size: var(--fs-sm);
    }
    .row-actions {
      display: flex;
      gap: var(--s-2);
    }
  `,
})
export class JoinLinksPanel {
  protected readonly data = inject(DataStore);
  protected readonly links = inject(JoinLinks);

  protected readonly courseId = signal(this.data.course()?.id ?? this.data.courses()[0]?.id ?? '');
  protected readonly duration = signal<JoinDuration>('week');
  protected readonly date = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly copied = signal<string | null>(null);

  protected readonly active = computed(() => this.links.links().filter((l) => isActive(l)));

  constructor() {
    void this.links.load();
  }

  protected courseName(id: string): string {
    const course = this.data.courses().find((c) => c.id === id);
    return course ? `${course.name} · ${course.year}` : 'קורס';
  }

  protected until(iso: string): string {
    return dualDateText(iso) ?? '';
  }

  protected async create() {
    const expires = expiryFor(this.duration(), this.date());
    if (!this.courseId()) {
      this.message.set('צריך לבחור קורס.');
      return;
    }
    if (!expires) {
      this.message.set('צריך לבחור תאריך עתידי.');
      return;
    }
    this.busy.set(true);
    this.message.set(null);
    const link = await this.links.create(this.courseId(), expires);
    this.busy.set(false);
    if (link) await this.copy(link.id, 'הקישור נוצר והועתק.');
  }

  protected async copy(id: string, done = 'הקישור הועתק.') {
    const link = this.links.links().find((l) => l.id === id);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(this.links.url(link));
      this.copied.set(id);
      this.message.set(done);
    } catch {
      this.message.set('לא הצלחתי להעתיק. אפשר לסמן את הקישור ולהעתיק ידנית.');
    }
  }
}
