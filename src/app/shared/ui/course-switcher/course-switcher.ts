import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Router } from '@angular/router';

import { DataStore } from '../../../core/data/data-store';
import { yearKey } from '../../../core/dates/hebrew-date';

/**
 * The year, first in the top bar. It decides everything shown below it. A native
 * select, so a phone gets its own picker and the keyboard works.
 */
@Component({
  selector: 'app-course-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './course-switcher.html',
  styleUrl: './course-switcher.scss',
})
export class CourseSwitcher {
  private readonly data = inject(DataStore);
  private readonly router = inject(Router);

  protected readonly years = this.data.years;

  protected same(year: string): boolean {
    return yearKey(year) === yearKey(this.data.year());
  }

  /** A course or paper on screen belongs to the old year, so she returns to the cards. */
  protected chooseYear(event: Event) {
    this.data.selectYear((event.target as HTMLSelectElement).value);
    if (!this.router.url.startsWith('/students')) void this.router.navigateByUrl('/courses');
  }
}
