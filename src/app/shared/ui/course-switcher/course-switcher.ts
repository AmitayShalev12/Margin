import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { yearKey } from '../../../core/dates/hebrew-date';

/**
 * The year, and within it the course, from the top of every page.
 *
 * The year comes first because it decides everything shown below it. Adding a
 * course is on the courses screen: this bar only chooses. Native selects, so a
 * phone gets its own picker and the keyboard works.
 */
@Component({
  selector: 'app-course-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './course-switcher.html',
  styleUrl: './course-switcher.scss',
})
export class CourseSwitcher {
  private readonly data = inject(DataStore);

  protected readonly current = this.data.course;
  protected readonly courses = this.data.coursesInYear;
  protected readonly years = this.data.years;

  protected same(year: string): boolean {
    return yearKey(year) === yearKey(this.data.year());
  }

  protected chooseYear(event: Event) {
    this.data.selectYear((event.target as HTMLSelectElement).value);
  }

  protected chooseCourse(event: Event) {
    this.data.selectCourse((event.target as HTMLSelectElement).value);
  }
}
