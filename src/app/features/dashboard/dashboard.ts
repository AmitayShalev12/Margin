import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MockDataService } from '../../core/mock/mock-data';
import {
  needsTeacher,
  relativeDay,
  statusClass,
  statusSummary,
} from '../../core/presentation/submission-status';
import { PageHeader } from '../../shared/ui/page-header/page-header';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly data = inject(MockDataService);

  /**
   * The only thing this screen shows: submissions currently sitting with the
   * teacher, newest first. Everything else lives one tap away under "עבודות".
   */
  protected readonly waiting = computed(() =>
    this.data
      .submissions()
      .filter((s) => needsTeacher(s.status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((s) => ({
        id: s.id,
        student: this.data.studentName(s.student_id),
        when: relativeDay(s.updated_at),
        line: statusSummary(s.status, this.data.annotationsPending(s.id)),
        course: `${this.data.course.name} · ${this.data.assignment.title}`,
        statusClass: statusClass(s.status),
      })),
  );

  protected readonly subtitle = computed(() => {
    const n = this.waiting().length;
    if (n === 0) return 'רגע של שקט.';
    if (n === 1) return 'עבודה אחת דורשת את תשומת ליבך עכשיו.';
    if (n === 2) return 'שתי עבודות דורשות את תשומת ליבך עכשיו.';
    return `${n} עבודות דורשות את תשומת ליבך עכשיו.`;
  });
}
