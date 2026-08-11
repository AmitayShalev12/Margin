import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { MockDataService } from '../../core/mock/mock-data';
import { kindClass } from '../../core/presentation/annotation-kind';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/**
 * "This is how the AI has learned your style."
 *
 * Reassurance first, configuration never: the screen shows what was learned
 * and from what, and offers exactly one action — add more examples.
 */
@Component({
  selector: 'app-style-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  templateUrl: './style-settings.html',
  styleUrl: './style-settings.scss',
})
export class StyleSettings {
  private readonly data = inject(MockDataService);

  protected readonly traits = this.data.styleTraits.map((t) => ({
    text: t.text,
    class: kindClass(t.kind),
  }));

  /** Both counts come from the records themselves, not from a stored number. */
  protected readonly subtitle = computed(() => {
    const edits = this.data.feedbackLogs.filter((l) => l.action === 'edited').length;
    const examples = this.data.styleExamples.filter((e) => e.active).length;
    return `כך למדתי לכתוב כמוך — מתוך ${edits} הערות שערכת ו־${examples} דוגמאות שהוספת.`;
  });

  /** The most recent rewrites, newest first. */
  protected readonly learned = computed(() =>
    this.data.feedbackLogs
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
}
