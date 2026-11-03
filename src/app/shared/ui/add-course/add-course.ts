import {
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
  templateUrl: './add-course.html',
})
export class AddCourse {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);
  protected readonly quick = inject(QuickActions);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly name = signal('');
  protected readonly year = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);

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
    this.year.set(this.data.course()?.year ?? '');
    this.error.set(null);
    this.done.set(null);
  }

  protected submit() {
    this.error.set(null);
    const course = this.data.createCourse(this.name(), this.year());
    if (!course) {
      this.error.set(
        this.name().trim() && this.year().trim()
          ? 'לא הצלחתי ליצור את הקורס. ייתכן שצריך להתחבר מחדש.'
          : 'צריך שם קורס ושנה.',
      );
      return;
    }
    this.done.set(`הקורס ${course.name} · ${course.year} נוסף, והוא עכשיו הקורס הפעיל.`);
  }

  protected toCourse() {
    this.quick.close();
    void this.router.navigateByUrl('/courses');
  }

  protected close() {
    this.quick.close();
  }

  protected closed() {
    this.quick.addCourseOpen.set(false);
  }
}
