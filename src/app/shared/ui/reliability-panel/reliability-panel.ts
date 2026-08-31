import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { UUID } from '../../../core/models';
import { CitationReport, checkCitations } from '../../../core/reliability/citations';
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
  private readonly data = inject(DataStore);

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

  /**
   * What the paper cites against what it lists.
   *
   * Here rather than in a screen of its own because it answers the question
   * this panel exists for, and answers it with evidence: the paper cites Cohen
   * 2021 and Cohen 2021 is in no reference list. Invented sources are the most
   * reliable trace an AI-written paper leaves — a model that does not know a
   * source produces a plausible one — and unlike a detector's number, this is
   * a fact she can check in ten seconds.
   *
   * Runs on text already on screen. No model, no network, nothing of the
   * student's work leaving the browser.
   */
  protected readonly citations = signal<CitationReport | null>(null);

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

    const round = this.data.roundFor(this.submissionId());
    this.citations.set(round?.document_blocks ? checkCitations(round.document_blocks) : null);

    this.open.set(true);
  }
}
