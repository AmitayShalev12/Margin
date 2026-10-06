import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AnnotationGenerator } from '../../core/ai/annotation-generator';
import { DataStore } from '../../core/data/data-store';
import { normaliseName } from '../../core/drive/file-name';
import { readDocxBlocks } from '../../core/import/docx-blocks';
import { DocxError } from '../../core/import/docx-comments';
import { UUID } from '../../core/models';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Working } from '../../shared/ui/working/working';

/** One row of the roster: everything the row answers without opening anything. */
export interface StudentRow {
  id: UUID;
  name: string;
  folder: string | null;
  /** Papers of hers the app holds. Not the folder's file count — see the template. */
  files: number;
  /** Of those, the ones she has finished with. */
  checked: number;
  latestId: UUID | null;
  comments: number;
  decided: number;
  /** What the student has to go and fix: the comments she stood behind. */
  toFix: number;
  /** Null when there are no comments yet — there is no share of nothing. */
  percent: number | null;
}

/**
 * The home screen: her class, a row each.
 *
 * It used to list the submissions waiting on her, which answered "what is
 * urgent" and nothing else. What she asked for is the roster — "דף הבית מכיל
 * את רשימת התלמידות וכתובת התיקיות שלהם" — with each girl's folder, how much
 * of her work has come in, how far the marking got and what still needs
 * fixing, and the two buttons reached for most on the same line.
 *
 * The difference matters because her unit of work is a student, not a file. A
 * list of submissions makes her reassemble "where is רבקי up to" out of
 * several rows; a list of students answers it on sight.
 */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, Working],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  protected readonly data = inject(DataStore);
  private readonly router = inject(Router);
  protected readonly generator = inject(AnnotationGenerator);

  protected readonly search = signal('');

  /** Which girl's upload panel is open, and what it is doing. */
  protected readonly uploadFor = signal<UUID | null>(null);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly reading = signal(false);

  /** Which girl's folder address is being edited. */
  protected readonly folderFor = signal<UUID | null>(null);
  protected readonly folderDraft = signal('');
  protected readonly folderError = signal<string | null>(null);

  /**
   * The row whose draft is running, rather than "a draft is running" — the
   * generator's own flag is global, and on a list of twelve girls that would
   * light up all twelve.
   */
  protected readonly draftingId = signal<UUID | null>(null);
  protected readonly draftError = signal<string | null>(null);

  /**
   * Every girl's row, before the search box gets at it.
   *
   * The summary line counts off this and not off `rows`, because a count that
   * shrinks as she types is answering "how many matched" while appearing to
   * answer "how many need me".
   */
  private readonly allRows = computed<StudentRow[]>(() => {
    const submissions = this.data.submissions();
    const annotations = this.data.annotations();

    return this.data.students().map((student) => {
      const hers = submissions.filter((s) => s.student_id === student.id);
      const latest = [...hers].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

      const mine = latest ? annotations.filter((a) => a.submission_id === latest.id) : [];
      /**
       * "Decided" is every comment she has ruled on, either way. Its share is
       * the honest answer to "עד איזה עמוד" — the drafting pass covers the
       * whole paper at once and the app holds paragraphs, not pages, so how
       * far the review got is how far she got through the comments. Claiming
       * a page number would be inventing one.
       */
      const decided = mine.filter((a) => a.status !== 'pending').length;

      return {
        id: student.id,
        name: student.full_name,
        folder: student.drive_folder_id,
        files: hers.length,
        checked: hers.filter((s) => s.status === 'notes_sent' || s.status === 'finalized').length,
        latestId: latest?.id ?? null,
        comments: mine.length,
        decided,
        toFix: mine.filter((a) => a.status === 'accepted' || a.status === 'edited').length,
        percent: mine.length ? Math.round((decided / mine.length) * 100) : null,
      };
    });
  });

  /** What the list shows: her roster, narrowed by the search box. */
  protected readonly rows = computed<StudentRow[]>(() => {
    const query = normaliseName(this.search());
    if (!query) return this.allRows();
    return this.allRows().filter((row) => normaliseName(row.name).includes(query));
  });

  protected readonly subtitle = computed(() => {
    const total = this.data.students().length;
    if (!total) return 'עוד אין תלמידות ברשימה.';

    const waiting = this.allRows().filter((r) => r.comments > r.decided).length;
    if (!waiting) return `${total} תלמידות. אין כרגע הערות שממתינות להחלטה.`;
    if (waiting === 1) return `${total} תלמידות · אצל אחת יש הערות שממתינות לך.`;
    return `${total} תלמידות · אצל ${waiting} יש הערות שממתינות לך.`;
  });

  // -- her folder -----------------------------------------------------------

  protected startFolder(studentId: UUID, current: string | null) {
    this.folderDraft.set(current ?? '');
    this.folderError.set(null);
    this.folderFor.set(studentId);
  }

  protected cancelFolder() {
    this.folderFor.set(null);
    this.folderError.set(null);
  }

  /**
   * A refusal stays on screen with the field still open. Closing the panel on
   * text that was never stored is the shape of bug this project keeps finding:
   * it looks exactly like a save.
   */
  protected saveFolder(studentId: UUID) {
    if (!this.data.setStudentFolder(studentId, this.folderDraft())) {
      this.folderError.set('זה לא נראה כמו קישור לתיקייה בדרייב. אפשר להעתיק את הכתובת מהדפדפן.');
      return;
    }
    this.folderError.set(null);
    this.folderFor.set(null);
  }

  protected folderLink(id: string): string {
    return `https://drive.google.com/drive/folders/${id}`;
  }

  // -- a file for this girl -------------------------------------------------

  protected openUpload(studentId: UUID) {
    this.uploadError.set(null);
    this.uploadFor.set(studentId);
  }

  protected closeUpload() {
    this.uploadFor.set(null);
    this.uploadError.set(null);
  }

  /**
   * "עבור כל תלמידה, אפשרות להוספת קובץ בלחצן" — the file lands on her row, so
   * there is no student to pick and no way to file it under the wrong name.
   */
  protected async chooseFile(studentId: UUID, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.reading.set(true);
    this.uploadError.set(null);

    try {
      const blocks = await readDocxBlocks(await file.arrayBuffer());
      const created = this.data.addUploadedSubmission({
        studentId,
        title: null,
        blocks,
        text: blocks.map((b) => b.text).join('\n'),
        fileName: file.name,
      });

      if (!created) {
        this.uploadError.set('צריך עבודה פתוחה בקורס לפני שאפשר להוסיף אליה קובץ.');
        return;
      }

      this.uploadFor.set(null);
    } catch (error) {
      this.uploadError.set(error instanceof DocxError ? error.hebrew : 'לא הצלחתי לקרוא את הקובץ.');
    } finally {
      this.reading.set(false);
    }
  }

  // -- drafting, from here --------------------------------------------------

  /**
   * Draft the comments for this girl's latest paper, without leaving the list.
   *
   * "צריך אפשרות לגשת לכתיבת הטיוטה ממסך העלאת העבודה וגם ממסך הבית, ליד כל
   * תלמידה." It then opens the review screen, because a draft she cannot see
   * is a draft she has to go and find. A failed run stays here and says so,
   * rather than dropping her onto an unchanged review screen.
   */
  protected async draft(submissionId: UUID) {
    this.draftError.set(null);
    this.draftingId.set(submissionId);
    try {
      const result = await this.generator.generate(submissionId);
      if (!result) {
        this.draftError.set(this.generator.state().message ?? 'ניסוח ההערות לא הצליח.');
        return;
      }
      await this.router.navigate(['/review', submissionId]);
    } finally {
      this.draftingId.set(null);
    }
  }
}
