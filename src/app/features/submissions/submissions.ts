import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MockDataService } from '../../core/mock/mock-data';
import { SubmissionStatus } from '../../core/models';
import {
  needsTeacher,
  relativeDay,
  statusClass,
  statusLine,
} from '../../core/presentation/submission-status';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/** The filters are named after who holds the work, not after status codes. */
type FilterKey = 'all' | 'mine' | 'student' | 'done';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'הכול' },
  { key: 'mine', label: 'מחכה לי' },
  { key: 'student', label: 'אצל התלמידה' },
  { key: 'done', label: 'הסתיים' },
];

function matches(filter: FilterKey, status: SubmissionStatus): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'mine':
      return needsTeacher(status);
    case 'student':
      return status === 'notes_sent' || status === 'student_revised';
    case 'done':
      return status === 'finalized';
  }
}

@Component({
  selector: 'app-submissions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader],
  templateUrl: './submissions.html',
  styleUrl: './submissions.scss',
})
export class Submissions {
  private readonly data = inject(MockDataService);

  protected readonly filters = FILTERS;
  protected readonly filter = signal<FilterKey>('all');

  /** Filtering and sync detail stay folded away until she asks for them. */
  protected readonly filtersOpen = signal(false);

  protected readonly rows = computed(() =>
    this.data
      .submissions()
      .filter((s) => matches(this.filter(), s.status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((s) => ({
        id: s.id,
        student: this.data.studentName(s.student_id),
        file: s.drive_file_name ?? '',
        line: statusLine(s.status, this.data.annotationsPending(s.id)),
        statusClass: statusClass(s.status),
      })),
  );

  protected readonly lastSynced = computed(() => {
    const synced = this.data.submissions()[0]?.last_synced_at;
    if (!synced) return 'טרם סונכרן';
    const minutes = Math.max(1, Math.round((Date.now() - new Date(synced).getTime()) / 60_000));
    if (minutes < 60) return `סונכרן מהדרייב לפני ${minutes} דקות`;
    return `סונכרן מהדרייב ${relativeDay(synced)}`;
  });

  protected toggleFilters() {
    this.filtersOpen.update((open) => !open);
  }
}
