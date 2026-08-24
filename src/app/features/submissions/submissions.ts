import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
import { GoogleDriveAuth } from '../../core/drive/google-auth';
import { SyncService } from '../../core/drive/sync';
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
  private readonly data = inject(DataStore);
  private readonly sync = inject(SyncService);
  private readonly auth = inject(GoogleDriveAuth);

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

  /**
   * One line of sync status, in the same quiet place the mock-up put it —
   * inside the filter panel, not competing with the list.
   */
  protected readonly lastSynced = computed(() => {
    const state = this.data.sync();

    if (state.phase === 'syncing') return 'מסנכרנת מהדרייב…';
    if (state.message) return state.message;
    if (!this.auth.isConnected()) return 'לא מחוברת לגוגל דרייב';
    if (!state.last_synced_at) return 'טרם סונכרן';

    const minutes = Math.max(
      1,
      Math.round((Date.now() - new Date(state.last_synced_at).getTime()) / 60_000),
    );
    if (minutes < 60) return `סונכרן מהדרייב לפני ${minutes} דקות`;
    return `סונכרן מהדרייב ${relativeDay(state.last_synced_at)}`;
  });

  /**
   * Files that arrived and couldn't be attributed to a student, by name.
   *
   * Names, not the records themselves: this line used to print the array
   * straight into the template, which renders every entry as `[object
   * Object]` — a count and a row of nonsense where the file names should be.
   */
  protected readonly unmatched = computed(() => this.data.sync().unmatched.map((f) => f.name));

  /**
   * Work reaches her two ways now, and either is enough to sync: files in the
   * year folder, and documents students shared with her directly.
   */
  protected readonly canSync = computed(
    () =>
      this.auth.isConnected() &&
      (!!this.data.watchedFolderId() || this.data.confirmedDriveAccounts().length > 0),
  );

  /**
   * A dot on the disclosure button when the sync needs attention. Without it,
   * a failing sync would be invisible to anyone who never opens the panel.
   */
  protected readonly syncFlag = computed<'none' | 'busy' | 'error'>(() => {
    const state = this.data.sync();
    if (state.phase === 'syncing') return 'busy';
    if (state.phase === 'error' || state.message) return 'error';
    return 'none';
  });

  protected toggleFilters() {
    this.filtersOpen.update((open) => !open);
  }

  protected async syncNow() {
    await this.sync.syncNow();
  }
}
