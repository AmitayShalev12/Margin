import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { DataStore } from '../../core/data/data-store';
import { buildStyleProfile, countDecisions, deriveTraits } from '../../core/learning/style-profile';
import { kindClass } from '../../core/presentation/annotation-kind';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/**
 * "This is how the AI has learned your style."
 *
 * Reassurance first, configuration never: the screen shows what was learned
 * and from what, and offers two actions — add more examples, and take the
 * whole thing away with her.
 *
 * Every number and every observation here is computed from her own decisions.
 * Nothing is stated that the records cannot back, and when there isn't enough
 * yet the screen says so instead of filling the space.
 */
@Component({
  selector: 'app-style-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  templateUrl: './style-settings.html',
  styleUrl: './style-settings.scss',
})
export class StyleSettings {
  private readonly data = inject(DataStore);

  protected readonly counts = computed(() =>
    countDecisions(this.data.feedbackLogs(), this.data.styleExamples()),
  );

  protected readonly traits = computed(() =>
    deriveTraits(this.data.feedbackLogs(), this.data.annotations()).map((t) => ({
      text: t.text,
      evidence: t.evidence,
      class: kindClass(t.kind),
    })),
  );

  /** Counts come from the records themselves, never from a stored number. */
  protected readonly subtitle = computed(() => {
    const { edited, examples } = this.counts();
    if (edited === 0 && examples === 0) {
      return 'עוד לא למדתי ממך מספיק. כל הערה שתערכי או תוותרי עליה נספרת כאן.';
    }
    return `כך למדתי לכתוב כמוך — מתוך ${edited} הערות שערכת ו־${examples} דוגמאות שהוספת.`;
  });

  /** What she did with the drafts, in the order the review screen offers it. */
  protected readonly tally = computed(() => {
    const { accepted, edited, dismissed, emailEdits } = this.counts();
    return [
      { label: 'אישרת כמו שהן', value: accepted },
      { label: 'ערכת', value: edited },
      { label: 'ויתרת', value: dismissed },
      // Counted apart from the comments, and shown only once there is one —
      // a message she rewrote teaches a different thing from a comment she did.
      ...(emailEdits ? [{ label: 'מיילים שערכת', value: emailEdits }] : []),
    ];
  });

  protected readonly hasDecisions = computed(() => this.tally().some((entry) => entry.value > 0));

  /** The most recent rewrites, newest first. */
  protected readonly learned = computed(() =>
    this.data
      .feedbackLogs()
      .filter((l) => l.action === 'edited' && l.final_text)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3)
      .map((l) => ({
        id: l.id,
        before: l.ai_text,
        after: l.final_text as string,
        note: l.change_note,
      })),
  );

  /**
   * Hands the learned style over as a file.
   *
   * The point is that it is hers: readable JSON, named fields, no ids — if she
   * stops using Margin the pairs she spent a year producing are still hers to
   * read and to take somewhere else.
   */
  protected exportProfile() {
    const profile = buildStyleProfile({
      logs: this.data.feedbackLogs(),
      examples: this.data.styleExamples(),
      annotations: this.data.annotations(),
      exportedAt: new Date().toISOString(),
    });

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `margin-style-${profile.exported_at.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
