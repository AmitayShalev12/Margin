import { yearKey } from '../../../core/dates/hebrew-date';
import { Course } from '../../../core/models';
import { CarryOver } from './carry-over';
import { computed,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { QuickActions } from '../quick-actions/quick-actions';

/**
 * Adding a course, from anywhere.
 *
 * The year starts as the year she is working in: the commonest new course is
 * a second one running alongside this year's, not one in another year. A
 * course she has just created becomes the one on screen (the store does that).
 */
@Component({
  selector: 'app-add-course',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CarryOver],
  templateUrl: './add-course.html',
})
export class AddCourse {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);
  protected readonly quick = inject(QuickActions);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly name = signal('');
  protected readonly isSeminar = signal<boolean | null>(null);
  protected readonly asksQuestion = signal(true);
  /** The year at the top: a new course belongs to the year she is looking at. */
  protected readonly year = computed(() => this.data.year());
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly created = signal<Course | null>(null);

  constructor() {
    effect(() => {
      const open = this.quick.addCourseOpen();
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
    this.name.set('');
    this.isSeminar.set(null);
    this.asksQuestion.set(true);
    this.created.set(null);
    this.error.set(null);
    this.done.set(null);
  }

  protected submit() {
    this.error.set(null);
    // Whether last year's course exists is asked before creating this one.
    const name = this.name().trim();
    const hadSameName = this.data
      .courses()
      .some((c) => c.name === name && yearKey(c.year) !== yearKey(this.year()));

    if (this.isSeminar() === null) {
      this.error.set('צריך לבחור אם זה קורס סמינריון.');
      return;
    }

    const course = this.data.createCourse(name, this.year(), {
      isSeminar: !!this.isSeminar(),
      asksQuestion: this.asksQuestion(),
    });
    if (!course) {
      this.error.set(name ? 'לא הצלחתי ליצור את הקורס. ייתכן שצריך להתחבר מחדש.' : 'צריך שם לקורס.');
      return;
    }
    // A new course starts clean. Only a course that ran before has anything to ask.
    if (!hadSameName) {
      this.close();
      void this.router.navigate(['/courses', course.id]);
      return;
    }
    this.created.set(course);
    this.done.set(`הקורס ${course.name} נוסף לשנת ${course.year}.`);
  }

  protected toCourse() {
    const id = this.created()?.id;
    this.quick.close();
    void this.router.navigateByUrl(id ? `/courses/${id}` : '/courses');
  }

  protected close() {
    this.quick.close();
  }

  protected closed() {
    this.quick.addCourseOpen.set(false);
  }
}
