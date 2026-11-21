import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
import { PAPER_LABELS, PaperSize } from '../../core/god/fake-paper';
import { GodMode } from '../../core/god/god-mode';
import { UUID } from '../../core/models';
import { statusLine } from '../../core/presentation/submission-status';

const SIZES: readonly PaperSize[] = ['short', 'medium', 'long', 'full'];

/**
 * The test screen: invented students who hand in invented papers on request.
 *
 * It exists so the whole app can be tried end to end without one real paper.
 * It opens for the owner's account only, and everything it makes is ordinary
 * data in that account, deleted the ordinary way.
 */
@Component({
  selector: 'app-god',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink],
  template: `
    <div class="page">
      <h2 class="title">מצב ניסוי</h2>

      @if (!god.allowed()) {
        <p class="none">המסך הזה לא זמין בחשבון הזה.</p>
      } @else if (!rows().length) {
        <section class="card block">
          <p>
            כאן מקימים קורס ניסוי עם חמש תלמידות מומצאות, וגורמים להן להגיש עבודות מומצאות באורכים
            שונים. שום דבר כאן אינו עבודה אמיתית.
          </p>
          <button type="button" class="btn btn-primary" (click)="setUp()">
            להקים קורס ניסוי עם 5 תלמידות
          </button>
          @if (message(); as text) {
            <p class="error" role="alert">{{ text }}</p>
          }
        </section>
      } @else {
        <section class="card block">
          <p class="lead">
            כל לחיצה על אורך מגישה את השלב הבא של אותה תלמידה. אחר כך בודקים את העבודה במסכים
            הרגילים, בדיוק כמו עבודה אמיתית.
          </p>
          <div class="actions">
            <button type="button" class="btn btn-primary btn-sm" (click)="everyone()">
              כולן מגישות, כל אחת באורך אחר
            </button>
            @if (god.course(); as course) {
              <a class="btn btn-ghost btn-sm" [routerLink]="['/courses', course.id, 'students']">
                לקורס הניסוי
              </a>
              <a class="btn btn-ghost btn-sm" [routerLink]="['/courses', course.id, 'process']">
                סיכום משימות ותהליך
              </a>
            }
            <a class="btn btn-ghost btn-sm" routerLink="/courses">מה מחכה לי</a>
          </div>
          @if (message(); as text) {
            <p class="said" role="status">{{ text }}</p>
          }
        </section>

        @for (row of rows(); track row.id) {
          <section class="card block">
            <div class="head">
              <h3 class="name">{{ row.name }}</h3>
              <span class="next">
                @if (row.next) {
                  השלב הבא: {{ row.next }}
                } @else {
                  הגישה את כל השלבים
                }
              </span>
            </div>

            @if (row.next) {
              <div class="actions">
                <span class="label">מגישה עבודה:</span>
                @for (size of sizes; track size) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="submit(row.id, size)">
                    {{ labels[size] }}
                  </button>
                }
              </div>
            }

            @if (row.papers.length) {
              <ul class="papers">
                @for (paper of row.papers; track paper.id) {
                  <li class="paper">
                    <a class="paper-open" [routerLink]="['/review', paper.id]">
                      <span class="paper-task">{{ paper.task }}</span>
                      <span class="paper-meta">
                        סבב {{ paper.round }} · {{ paper.words | number }} מילים · {{ paper.status }}
                      </span>
                    </a>
                    @if (paper.canResubmit) {
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        (click)="resubmit(paper.id)"
                      >
                        מגישה גרסה מתוקנת
                      </button>
                    }
                  </li>
                }
              </ul>
            }
          </section>
        }

        <section class="card block">
          <h3 class="name">מה אפשר לנסות</h3>
          <ol class="steps">
            <li>להגיש עבודה קצרה ועבודה מלאה, ולבדוק את שתיהן מ״מה מחכה לי״.</li>
            <li>לפתוח עבודה, לאשר, לערוך ולדחות הערות, ולהוסיף הערה משלך.</li>
            <li>לבקש ציון, לשנות מספר ביד, ולהתווכח על סעיף.</li>
            <li>לנסח הודעה לתלמידה ולסמן שנשלחה.</li>
            <li>לחזור לכאן וללחוץ ״מגישה גרסה מתוקנת״, ולבדוק את הסבב השני.</li>
            <li>להגיש עוד שלבים ולראות את התלמידות מתקדמות בתרשים הזרימה.</li>
          </ol>
        </section>

        <div class="leave">
          @if (clearing()) {
            <span>למחוק את חמש התלמידות המומצאות ואת כל מה שהגישו? הקורס נשאר.</span>
            <button type="button" class="btn btn-primary btn-sm" (click)="clear()">כן, למחוק</button>
            <button type="button" class="btn btn-plain btn-sm" (click)="clearing.set(false)">
              ביטול
            </button>
          } @else {
            <button type="button" class="btn btn-plain btn-sm" (click)="clearing.set(true)">
              מחיקת התלמידות המומצאות
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .page {
      display: grid;
      gap: var(--s-4);
      max-inline-size: 60rem;
      margin-inline: auto;
      padding: var(--s-4);
    }
    .title {
      font-size: var(--fs-xl);
    }
    .block {
      display: grid;
      gap: var(--s-3);
      padding: var(--s-4);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--s-2) var(--s-3);
    }
    .name {
      font-size: var(--fs-lg);
    }
    .next,
    .label,
    .paper-meta,
    .lead,
    .none {
      color: var(--c-ink-2);
      font-size: var(--fs-sm);
    }
    .actions,
    .leave {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-2);
    }
    .papers {
      display: grid;
      gap: var(--s-2);
      padding: 0;
      list-style: none;
    }
    .paper {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-2);
      padding: var(--s-2) var(--s-3);
      border: 1px solid var(--c-line);
      border-radius: var(--r-md);
    }
    .paper-open {
      display: grid;
      flex: 1 1 14rem;
      gap: 2px;
      color: inherit;
      text-decoration: none;
    }
    .paper-task {
      font-weight: 600;
    }
    .steps {
      display: grid;
      gap: var(--s-1);
      padding-inline-start: var(--s-5);
      font-size: var(--fs-sm);
    }
    .said {
      font-size: var(--fs-sm);
    }
    .error {
      color: var(--c-danger);
      font-size: var(--fs-sm);
    }
  `,
})
export class God {
  protected readonly god = inject(GodMode);
  private readonly data = inject(DataStore);

  protected readonly sizes = SIZES;
  protected readonly labels = PAPER_LABELS;
  protected readonly message = signal<string | null>(null);
  protected readonly clearing = signal(false);

  protected readonly rows = computed(() => {
    const tasks = this.god.tasks();
    const annotations = this.data.annotations();

    return this.god.students().map((student) => ({
      id: student.id,
      name: student.full_name,
      next: this.god.nextTask(student.id)?.title ?? null,
      papers: this.god.papersOf(student.id).map((paper) => {
        const pending = annotations.filter(
          (a) => a.submission_id === paper.id && a.status === 'pending',
        ).length;
        return {
          id: paper.id,
          task: tasks.find((t) => t.id === paper.assignment_id)?.title ?? 'עבודה',
          round: paper.current_round,
          words: paper.word_count ?? 0,
          status: statusLine(paper.status, pending),
          canResubmit: this.god.canResubmit(paper),
        };
      }),
    }));
  });

  protected setUp() {
    this.message.set(
      this.god.setUp() && this.god.students().length
        ? null
        : 'לא הצלחתי להקים את קורס הניסוי. צריך להיות מחוברת לחשבון.',
    );
  }

  protected submit(studentId: UUID, size: PaperSize) {
    const paper = this.god.submit(studentId, size);
    this.message.set(
      paper
        ? `${this.data.studentName(studentId)} הגישה עבודה (${paper.word_count} מילים).`
        : 'ההגשה לא הצליחה.',
    );
  }

  /** One press, five papers, four lengths: the quick way to fill the course. */
  protected everyone() {
    const made = this.god
      .students()
      .map((student, index) => this.god.submit(student.id, SIZES[index % SIZES.length]))
      .filter(Boolean).length;
    this.message.set(made ? `${made} תלמידות הגישו עבודה.` : 'אין למי להגיש: כולן הגישו את כל השלבים.');
  }

  protected resubmit(paperId: UUID) {
    this.message.set(
      this.god.resubmit(paperId) ? 'הוגשה גרסה מתוקנת, ונפתח סבב חדש.' : 'ההגשה המתוקנת לא הצליחה.',
    );
  }

  protected clear() {
    const removed = this.god.clear();
    this.clearing.set(false);
    this.message.set(`נמחקו ${removed} תלמידות מומצאות.`);
  }
}
