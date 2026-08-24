import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { UUID } from '../../../core/models';
import { CheckResult, NOT_CHECKED } from '../../../core/reliability/checks';
import { ReliabilityService } from '../../../core/reliability/reliability';

/**
 * What Margin can and cannot say about whether a paper is the student's own.
 *
 * Three rules, all of them about restraint.
 *
 * **It is asked, not volunteered.** Nothing runs until she presses the button.
 * A panel that assesses every girl who hands work in, unprompted, is a
 * surveillance tool wearing a teaching tool's clothes.
 *
 * **Silence is never a clean bill of health.** Every check reports one of three
 * outcomes — raised, clear, or *could not be checked* — and the checks Margin
 * refuses to perform at all are listed underneath with the reason. Without that
 * an empty panel reads as "she wrote it", which is a claim nothing here can
 * make.
 *
 * **Nothing is a verdict.** Flags carry their evidence, name no conclusion, and
 * never render as an alarm.
 */
@Component({
  selector: 'app-reliability-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reliability-panel.html',
  styleUrl: './reliability-panel.scss',
})
export class ReliabilityPanel {
  private readonly reliability = inject(ReliabilityService);

  readonly submissionId = input.required<UUID>();
  readonly studentName = input<string>('');

  protected readonly notChecked = NOT_CHECKED;
  protected readonly open = signal(false);
  protected readonly results = signal<CheckResult[] | null>(null);

  protected readonly raised = computed(() =>
    (this.results() ?? []).filter((r) => r.outcome === 'raised'),
  );
  protected readonly clear = computed(() =>
    (this.results() ?? []).filter((r) => r.outcome === 'clear'),
  );
  /** The ones that could not run — as prominent as the ones that did. */
  protected readonly unavailable = computed(() =>
    (this.results() ?? []).filter((r) => r.outcome === 'no_data'),
  );

  protected readonly headline = computed(() => {
    const results = this.results();
    if (!results) return null;

    const raised = this.raised().length;
    if (!raised) return 'לא עלה שום דבר מהבדיקות שנעשו.';
    return raised === 1 ? 'דבר אחד שכדאי להסתכל עליו.' : `${raised} דברים שכדאי להסתכל עליהם.`;
  });

  protected toggle() {
    this.open.update((was) => !was);
  }

  protected run() {
    const output = this.reliability.run(this.submissionId());
    this.results.set(output?.results ?? []);
    this.open.set(true);
  }
}
