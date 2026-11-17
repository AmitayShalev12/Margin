import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { dualDateText } from '../../../core/dates/hebrew-date';
import { CardRow, gradeSheetText, scoreText, summarise } from '../../../core/progress/grade-sheet';

/**
 * One student, in a large window over the process table: what she handed in,
 * what is missing, the score of each stage, and a grade sheet to send her.
 */
@Component({
  selector: 'app-student-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <dialog #dialog class="card-dialog" aria-labelledby="card-name" (close)="closed.emit()" (click)="backdrop($event)">
      @if (student(); as who) {
        <div class="card-body">
          <header class="card-head">
            <div>
              <h2 id="card-name" class="card-name">{{ who.full_name }}</h2>
              <p class="card-sub">{{ courseName() }} · {{ stageLine() }}</p>
            </div>
            <button type="button" class="btn btn-plain btn-sm" (click)="close()">סגירה</button>
          </header>

          <ul class="facts">
            <li><strong>{{ summary().handedIn }}</strong> הוגשו</li>
            <li><strong>{{ summary().missing }}</strong> חסרים</li>
            <li>
              @if (summary().average !== null) {
                ממוצע <strong>{{ summary().average }}</strong>
              } @else {
                עוד אין ציונים
              }
            </li>
          </ul>

          <div class="wrap" tabindex="0" role="region" aria-label="השלבים של התלמידה">
            <table>
              <thead>
                <tr>
                  <th scope="col">שלב</th>
                  <th scope="col">הגשה</th>
                  <th scope="col">ציון</th>
                  <th scope="col"><span class="sr-only">פתיחה</span></th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.taskId) {
                  <tr [class.is-missing]="!row.paperId">
                    <th scope="row">{{ row.number }}. {{ row.title }}</th>
                    <td>{{ row.paperId ? (row.handedIn ?? 'הוגש') : 'חסר' }}</td>
                    <td>{{ row.paperId ? scoreText(row.score) : '' }}</td>
                    <td>
                      @if (row.paperId; as id) {
                        <a [routerLink]="['/review', id]" (click)="close()">לעבודה</a>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <section class="sheet" aria-labelledby="sheet-title">
            <h3 id="sheet-title" class="sub-title">גיליון ציונים לשליחה</h3>
            <p class="hint">הגיליון כולל רק את השלבים והציונים שלה. שום דבר לא נשלח עד שאת שולחת.</p>
            <div class="sheet-actions">
              <button type="button" class="btn btn-primary btn-sm" (click)="copy()">
                {{ copied() ? 'הועתק' : 'העתקת הגיליון' }}
              </button>
              @if (mailto(); as link) {
                <a class="btn btn-ghost btn-sm" [href]="link">פתיחה במייל אליה</a>
              } @else {
                <span class="hint">אין לה כתובת מייל ברשימה.</span>
              }
            </div>
            @if (copyFailed()) {
              <textarea class="control sheet-text" readonly rows="8" [value]="sheet()"></textarea>
            }
          </section>

          <footer class="card-foot">
            <a class="btn btn-plain btn-sm" [routerLink]="['/courses', courseId(), 'student', who.id]" (click)="close()">
              לדף המלא של התלמידה
            </a>
            <span class="hint">את השלבים והמחוונים משנים ברשימת המשימות שמתחת לטבלה.</span>
          </footer>
        </div>
      }
    </dialog>
  `,
  styleUrl: './student-card.scss',
})
export class StudentCard {
  private readonly data = inject(DataStore);

  readonly studentId = input.required<string>();
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);
  protected readonly scoreText = scoreText;

  protected readonly student = computed(
    () => this.data.students().find((s) => s.id === this.studentId()) ?? null,
  );
  protected readonly courseId = computed(() => this.data.course()?.id ?? '');
  protected readonly courseName = computed(() => this.data.course()?.name ?? '');

  protected readonly rows = computed<CardRow[]>(() => {
    const papers = this.data.submissions().filter((p) => p.student_id === this.studentId());
    return this.data.tasks().map((task, index) => {
      const paper = papers.find((p) => p.assignment_id === task.id) ?? null;
      return {
        taskId: task.id,
        number: index + 1,
        title: task.title,
        paperId: paper?.id ?? null,
        handedIn: paper ? dualDateText(paper.drive_created_at ?? paper.created_at) : null,
        score: paper ? this.data.paperScore(paper.id) : null,
      };
    });
  });

  protected readonly summary = computed(() => summarise(this.rows()));

  protected readonly stageLine = computed(() => {
    const reached = [...this.rows()].reverse().find((r) => r.paperId);
    return reached ? `נמצאת בשלב ${reached.number}: ${reached.title}` : 'עוד לא הגישה';
  });

  protected readonly sheet = computed(() =>
    gradeSheetText({
      student: this.student()?.full_name ?? '',
      course: this.courseName(),
      rows: this.rows(),
    }),
  );

  /** Opens her own mail program with the sheet written; she presses send there. */
  protected readonly mailto = computed(() => {
    const email = this.student()?.email?.trim();
    if (!email) return null;
    const subject = encodeURIComponent(`גיליון ציונים: ${this.courseName()}`);
    return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${encodeURIComponent(this.sheet())}`;
  });

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (!dialog.open) dialog.showModal?.();
    });
  }

  protected close() {
    const dialog = this.dialog().nativeElement;
    if (dialog.open && dialog.close) dialog.close();
    else this.closed.emit();
  }

  /** A click on the dimmed area around the window closes it. */
  protected backdrop(event: MouseEvent) {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  protected async copy() {
    try {
      await navigator.clipboard.writeText(this.sheet());
      this.copied.set(true);
      this.copyFailed.set(false);
    } catch {
      // No clipboard here: show the text so she can select it herself.
      this.copyFailed.set(true);
    }
  }
}
