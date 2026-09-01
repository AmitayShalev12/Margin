import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  input,
  signal,
} from '@angular/core';

/**
 * Something is running, and it is going to take a while.
 *
 * The waits in this app are not the half-second kind. A drafting run reads a
 * whole paper, thinks, and writes forty comments; ninety seconds is ordinary
 * and two minutes is within budget. Until now that was a disabled button
 * saying "מנסחת…", which is indistinguishable from a frozen page after about
 * twenty seconds — and the honest reading of a frozen page is that it broke.
 *
 * So this does two jobs, and the second is the one that matters:
 *
 *   1. It moves, continuously, so the page is visibly alive.
 *   2. After ten seconds it starts counting, and after forty it says the run
 *      is a long one by design.
 *
 * Motion alone stops being reassuring surprisingly fast — a spinner that has
 * been turning for a minute reads as stuck, because nothing about it says
 * whether a minute is normal. A number that keeps climbing cannot be mistaken
 * for a hang, and "this usually takes a minute or two" is the sentence that
 * stops her reaching for the reload button and losing the run.
 */
@Component({
  selector: 'app-working',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="working" role="status" aria-live="polite">
      <!--
        Three dots, drifting out of phase. Decorative — the caption beside it
        carries the meaning, so a screen reader is told what is happening
        rather than that there are three dots.
      -->
      <span class="dots" aria-hidden="true">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>

      <span class="said">
        <span class="label">{{ label() }}</span>
        @if (note(); as line) {
          <span class="note">{{ line }}</span>
        }
      </span>
    </div>
  `,
  styleUrl: './working.scss',
})
export class Working implements OnDestroy {
  /** What is happening, in her words: "מנסחת הערות", "מנקדת את העבודה". */
  readonly label = input.required<string>();

  /**
   * Roughly how long this one takes, when it is a long one.
   *
   * Said after forty seconds rather than immediately: most runs finish before
   * then, and telling her to expect a two-minute wait for something that
   * usually takes twenty seconds is its own kind of lie.
   */
  readonly longRunNote = input<string | null>(null);

  private readonly seconds = signal(0);

  private readonly timer = setInterval(() => this.seconds.update((n) => n + 1), 1000);

  protected readonly note = computed(() => {
    const elapsed = this.seconds();

    // Silent at first. A counter on a two-second wait is noise, and worse, it
    // suggests the wait is something to be watched.
    if (elapsed < 10) return null;

    const long = this.longRunNote();
    if (elapsed >= 40 && long) return `${elapsed} שניות · ${long}`;

    return `${elapsed} שניות`;
  });

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
