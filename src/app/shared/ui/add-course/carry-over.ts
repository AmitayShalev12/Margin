import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { DataStore } from '../../../core/data/data-store';
import { Course } from '../../../core/models';
import { count } from '../../../core/presentation/count';

/**
 * "לקחת מהשנה הקודמת?": asked once, right after a new course or year is made.
 *
 * Nothing moves without her ticking it. Copies rather than links, so changing a
 * rule this year leaves last year's record of what she asked for as it was.
 */
@Component({
  selector: 'app-carry-over',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './carry-over.html',
})
export class CarryOver {
  private readonly data = inject(DataStore);

  readonly course = input.required<Course>();

  /** Same course first, newest year first: that is what she almost always wants. */
  protected readonly sources = computed(() => {
    const target = this.course();
    return this.data
      .courses()
      .filter((c) => c.id !== target.id)
      .sort(
        (a, b) =>
          Number(b.name === target.name) - Number(a.name === target.name) ||
          b.year.localeCompare(a.year, 'he'),
      );
  });

  private readonly chosen = signal<string | null>(null);
  protected readonly source = computed(
    () => this.sources().find((c) => c.id === this.chosen()) ?? this.sources()[0] ?? null,
  );

  protected readonly rules = computed(() =>
    this.data.allCourseRules().filter((r) => r.course_id === this.source()?.id),
  );
  protected readonly materials = computed(() =>
    this.data.allCourseMaterials().filter((m) => m.course_id === this.source()?.id),
  );

  /** Ticks she removed; everything starts ticked. Cleared with the source. */
  private readonly unticked = signal<ReadonlySet<string>>(new Set());
  protected readonly gradingForm = signal(true);

  protected readonly busy = signal(false);
  protected readonly finished = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected isTicked(id: string): boolean {
    return !this.unticked().has(id);
  }

  protected toggle(id: string) {
    const next = new Set(this.unticked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.unticked.set(next);
  }

  protected chooseSource(id: string) {
    this.chosen.set(id);
    this.unticked.set(new Set());
  }

  protected skip() {
    this.finished.set('מתחילים נקי. אפשר להוסיף כללים וחומרים במסך הקורסים.');
  }

  protected async take() {
    const source = this.source();
    if (!source) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      const copied = await this.data.carryOver(source.id, this.course().id, {
        ruleIds: this.rules().filter((r) => this.isTicked(r.id)).map((r) => r.id),
        materialIds: this.materials().filter((m) => this.isTicked(m.id)).map((m) => m.id),
        gradingForm: this.gradingForm(),
      });
      const parts = [
        count(copied.rules, { one: 'כלל אחד', two: 'שני כללים', many: '# כללים' }),
        count(copied.materials, { one: 'חומר אחד', two: 'שני חומרים', many: '# חומרים' }),
      ];
      const form = copied.gradingForm ? ' וטופס ההערכה' : '';
      this.finished.set(`הועתקו מ${source.name} · ${source.year}: ${parts.join(', ')}${form}.`);
    } catch {
      this.error.set('ההעתקה לא הצליחה. אפשר לנסות שוב.');
    } finally {
      this.busy.set(false);
    }
  }
}
