import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { TEMPLATE_SLOTS } from '../../../core/messages/student-message';
import { waitingFor } from '../../../core/notifications/waiting';

/** Who is ready to hear back, and the templates she writes for them. */
@Component({
  selector: 'app-course-messages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="card block" aria-labelledby="ready-title">
      <h2 id="ready-title" class="sub-title">מוכנות לשליחה</h2>
      <ul class="plain">
        @for (item of ready(); track item.id) {
          <li><a [routerLink]="item.link">{{ item.text }}</a></li>
        } @empty {
          <li class="hint">אין כרגע עבודה שמחכה לשליחה.</li>
        }
      </ul>
    </section>

    <section class="card block" aria-labelledby="templates-title">
      <h2 id="templates-title" class="sub-title">התבניות שלך</h2>
      <p class="hint">
        הטקסט שלך לתלמידה. בעת השליחה בוחרים תבנית, והיא נכנסת להודעה יחד עם השם, המועד הבא והתהליך.
      </p>
      @for (slot of slots(); track slot.slot) {
        <div class="slot">
          <label class="field">
            <span class="label">שם התבנית {{ slot.slot }}</span>
            <input
              class="control"
              type="text"
              [value]="slot.title"
              (change)="save(slot.slot, $any($event.target).value, slot.body)"
            />
          </label>
          <label class="field">
            <span class="label">הטקסט</span>
            <textarea
              class="control"
              rows="3"
              [value]="slot.body"
              (change)="save(slot.slot, slot.title, $any($event.target).value)"
            ></textarea>
          </label>
        </div>
      }
    </section>
  `,
  styles: `
    .block {
      padding: var(--s-4);
      margin-block-end: var(--s-4);
    }
    .plain {
      list-style: none;
      margin: var(--s-2) 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
    }
    .slot {
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
      margin-block-start: var(--s-3);
      padding-block-start: var(--s-3);
      border-block-start: 1px solid var(--c-line);
    }
  `,
})
export class CourseMessages {
  private readonly data = inject(DataStore);

  protected readonly ready = computed(() =>
    waitingFor(this.data.courseSubmissions(), this.data.annotations(), (id) =>
      this.data.studentName(id),
    ).filter((item) => item.id.startsWith('send:')),
  );

  protected readonly slots = computed(() =>
    Array.from({ length: TEMPLATE_SLOTS }, (_, i) => {
      const saved = this.data.messageTemplates().find((t) => t.slot === i + 1);
      return { slot: i + 1, title: saved?.title ?? '', body: saved?.body ?? '' };
    }),
  );

  protected save(slot: number, title: string, body: string) {
    this.data.saveMessageTemplate(slot, title, body);
  }
}
