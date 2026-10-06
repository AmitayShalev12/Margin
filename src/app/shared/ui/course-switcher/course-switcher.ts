import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';

/**
 * Which course is on screen, chosen from the top of every page.
 *
 * "בתפריט למעלה בוחרים את הקורס, ממנו נגזרים הנתונים המוצגים בהמשך."
 *
 * The store has had several courses and a `selectCourse` since the multi-course
 * work, but the only way to switch was a picker buried inside the courses
 * screen — so a teacher who wanted last year's seminar had to go and find the
 * screen that happened to own the control. A selector that lives in the shell
 * is the difference between the course being a *setting* and the course being
 * the thing the whole app is currently about.
 *
 * Adding a course lives here too, for the same reason: she reported it missing
 * when it existed, which is what being unfindable amounts to.
 */
@Component({
  selector: 'app-course-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './course-switcher.html',
  styleUrl: './course-switcher.scss',
})
export class CourseSwitcher {
  private readonly data = inject(DataStore);

  protected readonly open = signal(false);
  protected readonly adding = signal(false);
  protected readonly draftName = signal('');
  protected readonly draftYear = signal('');
  protected readonly error = signal<string | null>(null);

  protected readonly current = this.data.course;

  /** Shown on the button: the course, with its year when she has more than one. */
  protected readonly label = computed(() => {
    const course = this.current();
    if (!course) return 'אין קורס';

    const sameName = this.data.courses().filter((c) => c.name === course.name);
    return sameName.length > 1 ? `${course.name} · ${course.year}` : course.name;
  });

  /**
   * Her courses, one entry per name with its years underneath.
   *
   * Grouped because "סמינריון תשפ״ו" and "סמינריון תשפ״ז" are the same course
   * in her head and two rows in the table — flattening them would make the menu
   * read as twice as many courses as she teaches.
   */
  protected readonly groups = computed(() => {
    const here = this.current()?.id;
    const order: string[] = [];
    const byName = new Map<string, { id: string; year: string; current: boolean }[]>();

    for (const course of this.data.courses()) {
      if (!byName.has(course.name)) {
        order.push(course.name);
        byName.set(course.name, []);
      }
      byName.get(course.name)!.push({
        id: course.id,
        year: course.year,
        current: course.id === here,
      });
    }

    return order.map((name) => ({ name, years: byName.get(name)! }));
  });

  protected toggle() {
    this.open.update((value) => !value);
    if (!this.open()) this.adding.set(false);
  }

  protected close() {
    this.open.set(false);
    this.adding.set(false);
  }

  protected choose(id: string) {
    this.data.selectCourse(id);
    this.close();
  }

  protected startAdd() {
    // Prefilled with the course she is in: by far the commonest reason to add
    // one is the same course a year later.
    this.draftName.set(this.current()?.name ?? '');
    this.draftYear.set('');
    this.error.set(null);
    this.adding.set(true);
  }

  protected cancelAdd() {
    this.adding.set(false);
    this.error.set(null);
  }

  protected create() {
    const created = this.data.createCourse(this.draftName(), this.draftYear());
    if (!created) {
      this.error.set('צריך שם קורס ושנה.');
      return;
    }

    this.draftName.set('');
    this.draftYear.set('');
    this.close();
  }
}
