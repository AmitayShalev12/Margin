import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { ModelKey } from '../../core/ai/model-key';
import { BackupError } from '../../core/backup/backup';
import { BackupService, RestorePlan } from '../../core/backup/backup-service';
import { dualDateText } from '../../core/dates/hebrew-date';
import { CountPipe, count } from '../../core/presentation/count';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/** What belongs to all her courses together: the AI key, and backups. */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountPipe, PageHeader],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly backup = inject(BackupService);

  // -- backup ---------------------------------------------------------------

  protected readonly backupBusy = signal(false);
  protected readonly backupError = signal<string | null>(null);
  protected readonly backupDone = signal<string | null>(null);
  /** A file she picked, waiting for her to agree to what it would add. */
  protected readonly restorePlan = signal<RestorePlan | null>(null);

  protected readonly autoBackupLine = computed(() => {
    const auto = this.backup.auto();
    const when = (at: string) => dualDateText(at) ?? '';
    switch (auto.phase) {
      case 'ok':
        return `עותק אוטומטי נשמר בדרייב שלך, בתיקייה "גיבויים של Margin". האחרון: ${when(auto.at)}.`;
      case 'off':
        return 'כדי שיישמר עותק אוטומטי כל יום בדרייב שלך, צריך לחבר את הדרייב.';
      case 'failed':
        return auto.last
          ? `העותק האוטומטי של היום לא נשמר. האחרון שנשמר: ${when(auto.last)}. כדאי להוריד גיבוי ידנית.`
          : 'העותק האוטומטי בדרייב לא נשמר. כדאי להוריד גיבוי ידנית.';
      default:
        return null;
    }
  });

  protected async downloadBackup() {
    await this.backupStep(async () => {
      await this.backup.download();
      this.backupDone.set('הגיבוי ירד למחשב שלך.');
    });
  }

  protected async pickRestore(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.backupStep(async () => {
      const plan = await this.backup.plan(file);
      if (plan.count) this.restorePlan.set(plan);
      else this.backupDone.set('כל מה שבקובץ הזה כבר נמצא כאן. אין מה לשחזר.');
    });
  }

  protected async confirmRestore() {
    const plan = this.restorePlan();
    if (!plan) return;
    await this.backupStep(async () => {
      await this.backup.restore(plan);
      this.restorePlan.set(null);
      this.backupDone.set(
        count(plan.count, { one: 'שוחזר פריט אחד.', two: 'שוחזרו שני פריטים.', many: 'שוחזרו # פריטים.' }),
      );
    });
  }

  private async backupStep(step: () => Promise<void>) {
    this.backupBusy.set(true);
    this.backupError.set(null);
    this.backupDone.set(null);
    try {
      await step();
    } catch (error) {
      this.backupError.set(
        error instanceof BackupError
          ? error.hebrew
          : 'זה לא הצליח, ולפחות חלק מהמידע לא נשמר. אפשר לנסות שוב: מה שכבר שוחזר לא יוכפל.',
      );
    } finally {
      this.backupBusy.set(false);
    }
  }

  protected readonly modelKey = inject(ModelKey);
  protected readonly keyDraft = signal('');
  protected readonly keyEditing = signal(false);
  protected readonly keySaved = signal(false);

  constructor() {
    // Asked once, when the screen appears, so it never claims "no key" before
    // it has looked. Not an effect: it depends on nothing and would only run
    // once anyway, and an effect that writes signals it never reads is a
    // puzzle for whoever reads it next.
    void this.modelKey.refresh();
  }

  protected startKeyEdit() {
    this.keyDraft.set('');
    this.keySaved.set(false);
    this.keyEditing.set(true);
  }

  protected cancelKeyEdit() {
    this.keyDraft.set('');
    this.keyEditing.set(false);
  }

  protected async saveKey() {
    if (!(await this.modelKey.save(this.keyDraft()))) return;

    // Cleared from memory the moment it is saved. Nothing on this screen has
    // any further use for it.
    this.keyDraft.set('');
    this.keyEditing.set(false);
    this.keySaved.set(true);
  }

  protected async clearKey() {
    this.keySaved.set(false);
    await this.modelKey.clear();
  }

  /**
   * The empty option means "whatever the server is configured with", which is
   * a real choice and not a blank — she may well want to come back to it after
   * trying a model that turned out slower or dearer.
   */
  protected async chooseModel(id: string) {
    await this.modelKey.chooseModel(id || null);
  }
}
