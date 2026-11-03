import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { Student, UUID } from '../../../core/models';
import { count } from '../../../core/presentation/count';
import { QuickActions } from '../quick-actions/quick-actions';

/**
 * Adding a student, from anywhere.
 *
 * "Users should not have to navigate into a course to add a student." The
 * form takes her details and a checkbox per course; she is created once and
 * enrolled in every course ticked. The course on screen is ticked to start
 * with, because that is almost always the one she is being added to.
 *
 * A native `<dialog>`: focus is trapped, Escape closes it, and the backdrop is
 * the browser's own — all of which a hand-built overlay gets subtly wrong.
 */
@Component({
  selector: 'app-add-student',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './add-student.html',
})
export class AddStudent {
  private readonly data = inject(DataStore);
  protected readonly quick = inject(QuickActions);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly picked = signal<ReadonlySet<UUID>>(new Set());

  /** A student already on the roster with this name or address. */
  protected readonly clash = signal<{ student: Student; on: 'name' | 'email' } | null>(null);
  protected readonly error = signal<string | null>(null);
  /** What happened, said once it has — the form gives way to this. */
  protected readonly done = signal<string | null>(null);

  /** Every course, with its year: the same seminar can run in two years. */
  protected readonly courses = computed(() =>
    this.data.courses().map((c) => ({ id: c.id, label: `${c.name} · ${c.year}` })),
  );

  constructor() {
    effect(() => {
      const open = this.quick.addStudentOpen();
      const element = this.dialog()?.nativeElement;
      if (!element) return;

      if (open && !element.open) {
        untracked(() => this.reset());
        // Where `showModal` is missing (older browsers, test DOMs) the dialog
        // still opens — without the modal backdrop, but usable.
        if (typeof element.showModal === 'function') element.showModal();
        else element.setAttribute('open', '');
      } else if (!open && element.open) {
        if (typeof element.close === 'function') element.close();
        else element.removeAttribute('open');
      }
    });
  }

  private reset() {
    const current = this.data.course()?.id;
    this.name.set('');
    this.email.set('');
    this.picked.set(new Set(current ? [current] : []));
    this.clash.set(null);
    this.error.set(null);
    this.done.set(null);
  }

  protected isPicked(id: UUID): boolean {
    return this.picked().has(id);
  }

  protected toggle(id: UUID) {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
  }

  protected submit() {
    this.error.set(null);
    if (!this.name().trim()) {
      this.error.set('צריך שם מלא של התלמידה.');
      return;
    }

    // Asked before writing anything: a second row for the same girl splits
    // her work in two on every screen that resolves a name.
    const clash = this.data.findStudentClash(this.name(), this.email());
    if (clash) {
      this.clash.set(clash);
      return;
    }
    this.create();
  }

  /** "She is a different girl" — two real students can share a name. */
  protected addAnyway() {
    this.clash.set(null);
    this.create();
  }

  /** The girl already on the roster, put in the courses ticked here. */
  protected enrollExisting() {
    const clash = this.clash();
    if (!clash) return;

    const added = this.data.enrollStudent(clash.student.id, [...this.picked()]);
    this.clash.set(null);
    this.done.set(
      added.length
        ? `${clash.student.full_name} כבר הייתה ברשימה, ועכשיו היא רשומה גם ל${count(added.length, {
            one: 'קורס אחד נוסף',
            two: 'שני קורסים נוספים',
            many: '־# קורסים נוספים',
          })}.`
        : `${clash.student.full_name} כבר רשומה לכל הקורסים שסומנו. לא שיניתי כלום.`,
    );
  }

  private create() {
    const student = this.data.addStudent(this.name(), this.email(), [...this.picked()]);
    if (!student) {
      // addStudent refuses only without a signed-in teacher or a name.
      this.error.set('לא הצלחתי להוסיף. ייתכן שצריך להתחבר מחדש.');
      return;
    }

    const enrolled = this.data.coursesOf(student.id).length;
    this.done.set(
      enrolled
        ? `${student.full_name} נוספה לרשימה ונרשמה ל${count(enrolled, {
            one: 'קורס אחד',
            two: 'שני קורסים',
            many: '־# קורסים',
          })}.`
        : `${student.full_name} נוספה לרשימה, בלי קורס. אפשר לרשום אותה לקורס בכל שלב.`,
    );
  }

  /** Straight on to the next one — a class is rarely added one girl at a time. */
  protected another() {
    this.reset();
  }

  protected close() {
    this.quick.close();
  }

  /** Escape, or the dialog closing for any other reason. */
  protected closed() {
    this.quick.addStudentOpen.set(false);
  }
}
