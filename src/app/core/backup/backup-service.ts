import { Injectable, inject, signal } from '@angular/core';

import { DataStore } from '../data/data-store';
import { PersistedSnapshot, Repository } from '../data/repository';
import { DriveBackup } from '../drive/drive-backup';
import { GoogleDriveAuth } from '../drive/google-auth';
import { SupabaseService } from '../supabase/supabase';
import { MarginBackup, buildBackup, missingFrom, parseBackup, rowCount } from './backup';

/** About a day, less a margin, so a teacher opening it at 9 each day gets one. */
const AUTO_INTERVAL_MS = 20 * 60 * 60 * 1000;

export type AutoBackupState =
  | { phase: 'unknown' }
  | { phase: 'off' }
  | { phase: 'ok'; at: string }
  | { phase: 'failed'; last: string | null };

export interface RestorePlan {
  /** The rows this account no longer has. */
  missing: PersistedSnapshot;
  count: number;
}

/** The three ways out of the database: a download, her Drive, and back in. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly repository = inject(Repository);
  private readonly store = inject(DataStore);
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(GoogleDriveAuth);
  private readonly drive = inject(DriveBackup);

  readonly auto = signal<AutoBackupState>({ phase: 'unknown' });
  private autoStarted = false;

  private async current(): Promise<MarginBackup> {
    return buildBackup(await this.repository.load(), new Date().toISOString());
  }

  /** Everything, as a file on her computer. */
  async download(): Promise<void> {
    const backup = await this.current();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `margin-backup-${backup.exported_at.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * A copy to her Drive at most once a day, without her doing anything.
   *
   * Never throws and never interrupts her. A failure is shown beside the backup
   * controls, since a safety net that fails silently is not one.
   */
  async runAuto(): Promise<void> {
    if (this.autoStarted || this.repository.kind !== 'supabase' || !this.supabase.teacherId) return;
    this.autoStarted = true;

    let last: string | null = null;
    try {
      await this.auth.refreshStatus();
      if (!this.auth.isConnected()) {
        this.auto.set({ phase: 'off' });
        return;
      }

      last = await this.drive.latest();
      if (last && Date.now() - new Date(last).getTime() < AUTO_INTERVAL_MS) {
        this.auto.set({ phase: 'ok', at: last });
        return;
      }

      const backup = await this.current();
      // A failed or empty load must not look like a good copy of her work.
      if (!backup.data.courses.length) {
        this.auto.set(last ? { phase: 'ok', at: last } : { phase: 'off' });
        return;
      }

      await this.drive.upload(`margin-backup-${backup.exported_at.slice(0, 10)}.json`, JSON.stringify(backup));
      this.auto.set({ phase: 'ok', at: backup.exported_at });
    } catch {
      this.auto.set({ phase: 'failed', last });
    }
  }

  /** Reads a backup and says what restoring it would add. Changes nothing. */
  async plan(file: File): Promise<RestorePlan> {
    const backup = parseBackup(await file.text());
    const missing = missingFrom(
      backup.data,
      await this.repository.load(),
      this.supabase.teacherId,
    );
    return { missing, count: rowCount(missing) };
  }

  /**
   * Writes back what was missing, parents first.
   *
   * Stops at the first refusal: a child written after its parent failed would
   * only fail too. Whatever got in stays, and running it again picks up the rest
   * because those rows are then no longer missing.
   */
  async restore({ missing }: RestorePlan): Promise<void> {
    const r = this.repository;
    for (const row of missing.courses) await r.saveCourse(row);
    for (const row of missing.assignments) await r.saveAssignment(row);
    for (const row of missing.students) await r.saveStudent(row);
    for (const row of missing.courseStudents) await r.saveCourseStudent(row);
    for (const row of missing.courseRules) await r.saveCourseRule(row);
    for (const row of missing.courseMaterials) await r.saveCourseMaterial(row);
    for (const row of missing.gradingCategories) await r.saveGradingCategory(row);
    for (const row of missing.submissions) await r.saveSubmission(row);
    for (const row of missing.rounds) await r.saveRound(row);
    for (const row of missing.annotations) await r.saveAnnotation(row);
    for (const row of missing.criterionScores) await r.saveCriterionScore(row);
    for (const row of missing.gradingEntries) await r.saveGradingEntry(row);
    for (const row of missing.studentForms) await r.saveStudentForm(row);
    for (const row of missing.studentEmails) await r.saveStudentEmail(row);
    for (const row of missing.reliabilityChecks) await r.saveReliabilityCheck(row);
    for (const row of missing.feedbackLogs) await r.saveFeedbackLog(row);
    for (const row of missing.styleExamples) await r.saveStyleExample(row);
    for (const row of missing.messageTemplates) await r.saveMessageTemplate(row);
    for (const [owner, folder] of Object.entries(missing.driveFolders)) {
      await r.saveDriveFolder(owner, folder);
    }

    await this.store.hydrate();
  }
}
