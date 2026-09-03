import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
import { normaliseName } from '../../core/drive/file-name';
import { DocxError } from '../../core/import/docx-comments';
import { readDocxBlocks } from '../../core/import/docx-blocks';
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

  /** Filters the list by student or file name. Empty shows everything. */
  protected readonly search = signal('');

  protected readonly rows = computed(() => {
    const query = normaliseName(this.search());

    return this.data
      .submissions()
      .filter((s) => matches(this.filter(), s.status))
      .map((s) => ({
        id: s.id,
        student: this.data.studentName(s.student_id),
        file: s.drive_file_name ?? '',
        line: statusLine(s.status, this.data.annotationsPending(s.id)),
        statusClass: statusClass(s.status),
        updatedAt: s.updated_at,
      }))
      .filter(
        (row) =>
          !query ||
          normaliseName(row.student).includes(query) ||
          normaliseName(row.file).includes(query),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  // -- a paper put in by hand -----------------------------------------------
  //
  // "חלון להכנסת עבודה כקובץ באופן מידי ללא שיתוף ממייל או דרייב." Everything
  // else arrives through the sync, which needs the girl to have shared a
  // folder and the teacher to have connected Drive — a chain with several
  // places to be stuck waiting on somebody else. Sometimes she just has the
  // file, and wants it marked now.

  protected readonly uploading = signal(false);
  protected readonly uploadFor = signal<string>('');
  protected readonly uploadTitle = signal('');
  protected readonly uploadError = signal<string | null>(null);
  protected readonly reading = signal(false);

  protected readonly roster = computed(() => this.data.students());

  protected openUpload() {
    this.uploadError.set(null);
    this.uploadTitle.set('');
    this.uploadFor.set(this.data.students()[0]?.id ?? '');
    this.uploading.set(true);
  }

  protected closeUpload() {
    this.uploading.set(false);
    this.uploadError.set(null);
  }

  /**
   * Reads the file and files it under the student she picked.
   *
   * The paper has to belong to somebody: attribution is what every later
   * screen resolves a name through, and a submission with no student is a row
   * that renders blank everywhere it appears.
   */
  protected async chooseUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const studentId = this.uploadFor();
    if (!studentId) {
      this.uploadError.set('צריך לבחור תלמידה — עבודה בלי שם היא שורה ריקה בכל מסך.');
      return;
    }

    this.reading.set(true);
    this.uploadError.set(null);

    try {
      const blocks = await readDocxBlocks(await file.arrayBuffer());
      const created = this.data.addUploadedSubmission({
        studentId,
        title: this.uploadTitle(),
        blocks,
        text: blocks.map((b) => b.text).join('\n'),
        fileName: file.name,
      });

      if (!created) {
        this.uploadError.set('צריך עבודה פתוחה בקורס לפני שאפשר להוסיף אליה קובץ.');
        return;
      }

      this.uploading.set(false);
    } catch (error) {
      // The same wording as everywhere else a file is refused, with the step
      // that fixes it — a PDF is one "save as" away from something readable.
      this.uploadError.set(error instanceof DocxError ? error.hebrew : 'לא הצלחתי לקרוא את הקובץ.');
    } finally {
      this.reading.set(false);
    }
  }

  // -- removing a row -------------------------------------------------------
  //
  // "אופצייה למחיקת שורה כשהוא לוקח מידע מהדרייב". A sync brings in whatever
  // is in the folder: a draft she does not want marked, a duplicate, a file
  // from the wrong place. None of it could be taken off the list.

  protected readonly removing = signal<string | null>(null);

  protected askRemove(id: string, event: Event) {
    // The row is a link to the review screen; asking to delete it is not a
    // request to open it.
    event.preventDefault();
    event.stopPropagation();
    this.removing.set(id);
  }

  protected cancelRemove() {
    this.removing.set(null);
  }

  protected remove(id: string) {
    this.data.deleteSubmission(id);
    this.removing.set(null);
  }

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
