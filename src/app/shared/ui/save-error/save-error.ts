import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';

/**
 * Says out loud that something did not save.
 *
 * This exists because the failure mode it covers is the worst one in the app:
 * a write that fails leaves the change on screen exactly as though it had
 * been saved, so an afternoon of review can be lost with the screen still
 * showing every decision she made. Nothing about the interface contradicted
 * her until she reloaded.
 *
 * Rendered once in the shell rather than per screen, so it covers every write
 * — the review decisions, the drafted batches, the Drive folder, the sync —
 * including the ones added later that nobody remembers to wire up.
 */
@Component({
  selector: 'app-save-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './save-error.html',
  styleUrl: './save-error.scss',
})
export class SaveError {
  private readonly data = inject(DataStore);

  protected readonly failure = this.data.persistError;
  protected readonly retrying = signal(false);
  /** Set when a retry runs and fails again, so the second attempt isn't silent. */
  protected readonly retryFailed = signal(false);

  protected readonly headline = computed(() => {
    const failure = this.failure();
    if (!failure) return '';
    if (failure.signedOut) return 'ההתחברות פגה — מה שסימנת לא נשמר';
    return failure.kind === 'load' ? 'לא הצלחתי לטעון את העבודות שלך' : 'משהו לא נשמר';
  });

  protected readonly body = computed(() => {
    const failure = this.failure();
    if (!failure) return '';

    if (failure.kind === 'load') {
      // The dangerous case: the screens behind this banner are showing the
      // seeded demonstration course, which looks like a real empty account.
      return 'מה שמופיע כאן הוא תוכן הדגמה, לא העבודות שלך. כדאי לרענן את הדף לפני שממשיכים.';
    }

    if (failure.signedOut) {
      return 'צריך להתחבר שוב, ואז ללחוץ ״לנסות שוב״ — מה שסימנת עדיין כאן ויישמר.';
    }

    return 'השינויים האחרונים עדיין על המסך אבל לא נשמרו. אם תסגרי את הדף עכשיו הם יאבדו.';
  });

  protected readonly isSave = computed(() => this.failure()?.kind === 'save');

  protected async retry() {
    this.retrying.set(true);
    this.retryFailed.set(false);

    const saved = await this.data.retryFailedWrites();

    this.retrying.set(false);
    if (!saved) this.retryFailed.set(true);
  }

  protected dismiss() {
    this.data.dismissPersistError();
  }
}
