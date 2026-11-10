import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AnnotationGenerator } from '../../../core/ai/annotation-generator';
import { GoogleDriveAuth } from '../../../core/drive/google-auth';
import { SyncService } from '../../../core/drive/sync';
import { DataStore } from '../../../core/data/data-store';
import { dayOf } from '../../../core/dates/hebrew-date';
import { readDocxBlocks } from '../../../core/import/docx-blocks';
import { DocxError } from '../../../core/import/docx-comments';
import { Submission, UUID } from '../../../core/models';
import { statusLine, submittedAt } from '../../../core/presentation/submission-status';
import {
  LIGHT_LABEL,
  lateNote,
  latePapers,
  progressOf,
} from '../../../core/progress/traffic-light';
import { Working } from '../../../shared/ui/working/working';

const CHECKED = new Set(['notes_sent', 'finalized']);

interface PaperRow {
  id: UUID;
  task: string;
  file: string;
  when: string | null;
  status: string;
  comments: number;
  decided: number;
  words: number | null;
  late: string | null;
}

/**
 * One student in one course: her folder, her papers, and what to do with them.
 *
 * Papers waiting for her come first, then the ones already marked, so she can go
 * back to either. Opens in a tab of its own.
 */
@Component({
  selector: 'app-student-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, NgTemplateOutlet, RouterLink, Working],
  templateUrl: './student-page.html',
  styleUrl: './student-page.scss',
})
export class StudentPage {
  protected readonly data = inject(DataStore);
  private readonly router = inject(Router);
  private readonly generator = inject(AnnotationGenerator);
  private readonly sync = inject(SyncService);
  protected readonly auth = inject(GoogleDriveAuth);

  protected readonly syncing = signal(false);
  protected readonly syncMessage = signal<string | null>(null);

  /** Brings in what is in her folder now. The whole course syncs with it. */
  protected async syncFolder() {
    this.syncing.set(true);
    this.syncMessage.set(null);
    try {
      const outcome = await this.sync.syncNow();
      if (outcome.error) {
        this.syncMessage.set(outcome.error);
        return;
      }
      const name = this.student()?.full_name;
      const unreadable = outcome.unmatched.some(
        (u) => u.reason === 'folder_unreadable' && u.name === name,
      );
      const loose = outcome.unmatched.filter((u) => u.reason === 'no_task').length;
      this.syncMessage.set(
        unreadable
          ? 'לא הצלחתי לפתוח את התיקייה שלה. כדאי לבדוק שהקישור נכון ושהיא משותפת עם החשבון שמחובר לדרייב.'
          : `הסנכרון הסתיים: ${outcome.created} חדשות, ${outcome.updated} עודכנו.` +
              (loose
                ? ` ${loose} קבצים לא שויכו כי בשם שלהם אין שם של משימה.`
                : ''),
      );
    } finally {
      this.syncing.set(false);
    }
  }

  readonly studentId = input<string>('');

  protected readonly student = computed(
    () => this.data.students().find((s) => s.id === this.studentId()) ?? null,
  );
  protected readonly course = this.data.course;

  /** Her papers in this course, newest first. */
  private readonly papers = computed<Submission[]>(() => {
    const course = this.course();
    if (!course) return [];
    const tasks = new Set(this.data.assignmentsOf(course.id).map((t) => t.id));
    return this.data
      .submissions()
      .filter((p) => p.student_id === this.studentId() && tasks.has(p.assignment_id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  });

  protected readonly progress = computed(() => {
    const course = this.course();
    if (!course) return null;
    const tasks = this.data.assignmentsOf(course.id);
    const dated = tasks.map((t) => ({ id: t.id, due: dayOf(t.due_at) }));
    const late = latePapers(dated, this.papers());
    const result = progressOf(
      dated,
      new Set(this.papers().map((p) => p.assignment_id)),
      new Date().toISOString().slice(0, 10),
      new Set(late.map((l) => l.taskId)),
    );
    return { ...result, label: LIGHT_LABEL[result.light], total: tasks.length };
  });

  private readonly rows = computed<PaperRow[]>(() => {
    const course = this.course();
    if (!course) return [];
    const tasks = this.data.assignmentsOf(course.id);
    const late = latePapers(
      tasks.map((t) => ({ id: t.id, due: dayOf(t.due_at) })),
      this.papers(),
    );
    const annotations = this.data.annotations();

    return this.papers().map((paper) => {
      const task = tasks.find((t) => t.id === paper.assignment_id);
      const mine = annotations.filter((a) => a.submission_id === paper.id);
      const pending = mine.filter((a) => a.status === 'pending').length;
      const lateOne = late.find((l) => l.taskId === paper.assignment_id);
      return {
        id: paper.id,
        task: task?.title ?? 'עבודה',
        file: paper.drive_file_name ?? paper.title ?? '',
        when: submittedAt(paper.drive_created_at ?? paper.created_at),
        status: statusLine(paper.status, pending),
        comments: mine.length,
        decided: mine.length - pending,
        words: paper.word_count,
        late: lateOne ? lateNote(task?.title ?? '', lateOne.checked) : null,
      };
    });
  });

  protected readonly waiting = computed(() =>
    this.rows().filter((r) => !CHECKED.has(this.statusOf(r.id))),
  );
  protected readonly checked = computed(() =>
    this.rows().filter((r) => CHECKED.has(this.statusOf(r.id))),
  );

  /** Tasks she has not handed in, which is where a new file goes. */
  protected readonly openTasks = computed(() => {
    const handed = new Set(this.papers().map((p) => p.assignment_id));
    return this.data.tasks().filter((t) => !handed.has(t.id));
  });

  private statusOf(id: UUID): string {
    return this.papers().find((p) => p.id === id)?.status ?? '';
  }

  // -- her folder -----------------------------------------------------------

  protected readonly editingFolder = signal(false);
  protected readonly folderDraft = signal('');
  protected readonly folderError = signal<string | null>(null);

  protected folderLink(id: string): string {
    return `https://drive.google.com/drive/folders/${id}`;
  }

  protected startFolder() {
    this.folderDraft.set(this.student()?.drive_folder_id ?? '');
    this.folderError.set(null);
    this.editingFolder.set(true);
  }

  /** A refusal stays on screen with the field still open, so nothing looks saved. */
  protected saveFolder() {
    if (!this.data.setStudentFolder(this.studentId(), this.folderDraft())) {
      this.folderError.set('זה לא נראה כמו קישור לתיקייה בדרייב. אפשר להעתיק את הכתובת מהדפדפן.');
      return;
    }
    this.folderError.set(null);
    this.editingFolder.set(false);
    // A new folder is a reason to look in it straight away.
    if (this.auth.isConnected() && this.student()?.drive_folder_id) void this.syncFolder();
  }

  // -- a file by hand -------------------------------------------------------

  protected readonly uploading = signal(false);
  protected readonly reading = signal(false);
  protected readonly uploadTask = signal<UUID | null>(null);
  protected readonly uploadError = signal<string | null>(null);

  protected async chooseFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.reading.set(true);
    this.uploadError.set(null);
    try {
      const blocks = await readDocxBlocks(await file.arrayBuffer());
      const assignment = this.data.ensureAssignment();
      const created = this.data.addUploadedSubmission({
        assignmentId: this.uploadTask() ?? this.openTasks()[0]?.id ?? assignment?.id,
        studentId: this.studentId(),
        title: null,
        blocks,
        text: blocks.map((b) => b.text).join('\n'),
        fileName: file.name,
      });
      if (!created) {
        this.uploadError.set(
          'לכל המשימות בקורס כבר יש לה עבודה, או שהקובץ ריק. אפשר להוסיף משימה בסיכום משימות ותהליך.',
        );
        return;
      }
      this.uploading.set(false);
    } catch (error) {
      this.uploadError.set(error instanceof DocxError ? error.hebrew : 'לא הצלחתי לקרוא את הקובץ.');
    } finally {
      this.reading.set(false);
    }
  }

  // -- processing -----------------------------------------------------------

  protected readonly processingId = signal<UUID | null>(null);
  protected readonly processError = signal<string | null>(null);

  /** Drafts the comments, then opens them, since a draft she cannot see is lost. */
  protected async process(id: UUID) {
    this.processError.set(null);
    this.processingId.set(id);
    try {
      const result = await this.generator.generate(id);
      if (!result) {
        this.processError.set(this.generator.state().message ?? 'העיבוד לא הצליח.');
        return;
      }
      await this.router.navigate(['/review', id]);
    } finally {
      this.processingId.set(null);
    }
  }

  // -- her details ----------------------------------------------------------

  protected question(): string {
    const course = this.course();
    return (course && this.data.researchQuestion(this.studentId(), course.id)) ?? '';
  }

  protected saveQuestion(text: string) {
    const course = this.course();
    if (course) this.data.setResearchQuestion(this.studentId(), course.id, text);
  }

  protected readonly removing = signal(false);

  protected async remove() {
    const course = this.course();
    if (!course) return;
    this.data.removeFromCourse(this.studentId(), course.id);
    await this.router.navigate(['/courses', course.id, 'students']);
  }
}
