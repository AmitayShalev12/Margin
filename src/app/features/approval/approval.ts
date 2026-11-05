import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
import {
  SAFE_MAILTO_LENGTH,
  buildMessage,
  mailtoLink,
} from '../../core/messages/student-message';
import { PageHeader } from '../../shared/ui/page-header/page-header';

const STEPS = ['ההערות', 'התבנית', 'ההודעה', 'אישור ושליחה'] as const;

/**
 * From a checked paper to the student, one step at a time.
 *
 * She can jump between steps in any order. The send button exists only on the
 * last, only after she has approved, and it opens her own mail app with the text
 * in front of her: nothing here reaches a student on its own.
 */
@Component({
  selector: 'app-approval',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, RouterLink],
  template: `
    <div class="page">
      @if (paper(); as current) {
        <app-page-header [title]="'אישור ושליחה: ' + name()" />

        <ol class="steps">
          @for (label of steps; track label; let i = $index) {
            <li>
              <button
                type="button"
                class="step"
                [class.is-here]="step() === i"
                [attr.aria-current]="step() === i ? 'step' : null"
                (click)="step.set(i)"
              >
                {{ i + 1 }}. {{ label }}
              </button>
            </li>
          }
        </ol>

        <section class="card pane">
          @switch (step()) {
            @case (0) {
              <p class="sub-title">{{ approved().length }} הערות יעברו לתלמידה</p>
              @if (pendingCount()) {
                <p class="warn">{{ pendingCount() }} הערות עדיין ממתינות להחלטה שלך.</p>
              }
              <ul class="comments">
                @for (comment of approved(); track comment.id) {
                  <li>{{ comment.body }}</li>
                } @empty {
                  <li class="hint">אין עדיין הערות מאושרות.</li>
                }
              </ul>
              <a class="btn btn-ghost btn-sm" [routerLink]="['/review', current.id]">לעריכת ההערות</a>
            }
            @case (1) {
              <p class="sub-title">בחירת תבנית</p>
              <div class="choices">
                @for (template of templates(); track template.id) {
                  <label class="check">
                    <input
                      type="radio"
                      name="template"
                      [checked]="templateId() === template.id"
                      (change)="choose(template.id, template.body)"
                    />
                    <span>{{ template.title }}</span>
                  </label>
                } @empty {
                  <p class="hint">עוד אין תבניות. כותבים אותן בלשונית "הודעות" של הקורס.</p>
                }
              </div>
            }
            @case (2) {
              <label class="field">
                <span class="label">הטקסט שלך</span>
                <textarea
                  class="control"
                  rows="5"
                  [value]="body()"
                  (input)="body.set($any($event.target).value)"
                ></textarea>
              </label>
              <label class="check link-toggle">
                <input
                  type="checkbox"
                  [checked]="withLink()"
                  [disabled]="!fileLink()"
                  (change)="withLink.set($any($event.target).checked)"
                />
                <span>לצרף קישור לעבודה{{ fileLink() ? '' : ' (אין קישור לעבודה הזו)' }}</span>
              </label>
              <p class="sub-title">כך ההודעה תיראה</p>
              <pre class="preview">{{ message() }}</pre>
            }
            @default {
              <pre class="preview">{{ message() }}</pre>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="approvedByHer()"
                  (change)="approvedByHer.set($any($event.target).checked)"
                />
                <span>קראתי ואני מאשרת</span>
              </label>
              @if (!email()) {
                <p class="warn">אין כתובת מייל לתלמידה הזו. אפשר להוסיף אותה ברשימה של הקורס.</p>
              }
              @if (tooLong()) {
                <p class="warn">
                  ההודעה ארוכה, ותוכנת המייל עלולה לקצר אותה. כדאי להעתיק ולהדביק.
                </p>
              }
              <div class="actions">
                @if (approvedByHer() && email()) {
                  <a class="btn btn-primary" [href]="link()" (click)="opened.set(true)">
                    פתיחה בתוכנת המייל
                  </a>
                }
                <button type="button" class="btn btn-ghost" [disabled]="!approvedByHer()" (click)="copy()">
                  {{ copied() ? 'הועתק' : 'העתקה' }}
                </button>
              </div>
              @if (opened() || copied()) {
                @if (sent()) {
                  <p class="done" role="status">סומן שנשלח.</p>
                } @else {
                  <button type="button" class="btn btn-plain btn-sm" (click)="markSent()">
                    שלחתי. לסמן שנשלח
                  </button>
                }
              }
            }
          }
        </section>

        <div class="actions">
          <button type="button" class="btn btn-plain" [disabled]="step() === 0" (click)="move(-1)">הקודם</button>
          <button type="button" class="btn btn-ghost" [disabled]="step() === steps.length - 1" (click)="move(1)">
            הבא
          </button>
          <a class="btn btn-plain" [routerLink]="['/communication', current.id]">
            להוספת ההערות למסמך, או לניסוח בעזרת AI
          </a>
        </div>
      } @else {
        <app-page-header title="אישור ושליחה" subtitle="לא מצאתי את העבודה הזו." />
      }
    </div>
  `,
  styles: `
    .steps {
      list-style: none;
      margin: 0 0 var(--s-3);
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--s-2);
    }
    .step {
      min-block-size: 2.5rem;
      padding: var(--s-1) var(--s-3);
      border: 1px solid var(--c-line-strong);
      border-radius: var(--r-md);
      background: var(--c-surface);
      font: inherit;
      cursor: pointer;
    }
    .step.is-here {
      border-color: var(--c-accent);
      background: var(--c-accent-soft);
      color: var(--c-accent-strong);
      font-weight: 600;
    }
    .pane {
      padding: var(--s-4);
      margin-block-end: var(--s-3);
      display: flex;
      flex-direction: column;
      gap: var(--s-3);
    }
    .comments {
      margin: 0;
      padding-inline-start: var(--s-4);
    }
    .choices {
      display: flex;
      flex-direction: column;
      gap: var(--s-2);
    }
    .preview {
      margin: 0;
      padding: var(--s-3);
      border: 1px solid var(--c-line);
      border-radius: var(--r-md);
      background: var(--c-surface-sunk);
      font: inherit;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--s-2);
    }
    .warn {
      margin: 0;
      color: var(--c-attention);
    }
    .done {
      margin: 0;
      color: var(--c-ok);
    }
  `,
})
export class Approval {
  private readonly data = inject(DataStore);

  readonly submissionId = input<string>();

  protected readonly steps = STEPS;
  protected readonly step = signal(0);
  protected readonly templateId = signal<string | null>(null);
  protected readonly body = signal('');
  protected readonly withLink = signal(true);
  protected readonly approvedByHer = signal(false);
  protected readonly opened = signal(false);
  protected readonly copied = signal(false);

  protected readonly paper = computed(() => this.data.submission(this.submissionId()) ?? null);
  protected readonly name = computed(() => {
    const paper = this.paper();
    return paper ? this.data.studentName(paper.student_id) : '';
  });
  protected readonly email = computed(
    () => this.data.students().find((s) => s.id === this.paper()?.student_id)?.email ?? null,
  );
  protected readonly sent = computed(() => this.paper()?.status === 'notes_sent');
  protected readonly templates = computed(() =>
    this.data.messageTemplates().filter((t) => t.body.trim()),
  );
  protected readonly fileLink = computed(() => this.paper()?.drive_web_view_link ?? null);

  private readonly comments = computed(() =>
    this.data.annotations().filter((a) => a.submission_id === this.paper()?.id),
  );
  protected readonly approved = computed(() =>
    this.comments().filter((c) => c.status === 'accepted' || c.status === 'edited'),
  );
  protected readonly pendingCount = computed(
    () => this.comments().filter((c) => c.status === 'pending').length,
  );

  protected readonly message = computed(() => {
    const paper = this.paper();
    if (!paper) return '';
    const task = this.data.assignmentById(paper.assignment_id);
    const tasks = task ? this.data.assignmentsOf(task.course_id) : [];
    return buildMessage({
      name: this.name(),
      templateBody: this.body(),
      tasks,
      handedIn: new Set(
        this.data
          .submissions()
          .filter((s) => s.student_id === paper.student_id)
          .map((s) => s.assignment_id),
      ),
      currentTaskId: paper.assignment_id,
      today: new Date().toISOString().slice(0, 10),
      link: this.withLink() ? this.fileLink() : null,
    });
  });

  protected readonly link = computed(() =>
    mailtoLink(this.email() ?? '', 'העבודה שלך נבדקה', this.message()),
  );
  protected readonly tooLong = computed(() => this.link().length > SAFE_MAILTO_LENGTH);

  protected move(by: number) {
    this.step.update((step) => step + by);
  }

  protected choose(id: string, body: string) {
    this.templateId.set(id);
    this.body.set(body);
  }

  protected async copy() {
    try {
      await navigator.clipboard.writeText(this.message());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  protected markSent() {
    const paper = this.paper();
    if (paper) this.data.setSubmissionStatus(paper.id, 'notes_sent');
  }
}
