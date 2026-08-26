import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
import { ParsedRubric, RubricError, readRubric } from '../../core/import/rubric';
import { isStartingSet } from '../../core/grading/categories';
import { groupByCategory } from '../../core/grading/entries';
import { UUID } from '../../core/models';
import { KIND_LABEL, kindClass } from '../../core/presentation/annotation-kind';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { BidiText } from '../../shared/ui/bidi-text/bidi-text';

/**
 * The teacher's internal grading form.
 *
 * Every line on it is a comment she already stood behind, in the words she
 * left on it. Nothing here is rewritten or summarised by a model: the form is
 * a second view of the review she has already done, sorted into her own
 * headings, which is what makes the Hebrew read like hers.
 *
 * Empty headings stay. "Nothing raised under סקירת ספרות" is a finding about
 * the paper, and tidying it away would hide it.
 */
@Component({
  selector: 'app-grading-forms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, RouterLink, BidiText],
  templateUrl: './grading-forms.html',
  styleUrl: './grading-forms.scss',
})
export class GradingForms {
  private readonly data = inject(DataStore);

  /** Which submission's form is on screen. Defaults to the first with work on it. */
  private readonly selected = signal<UUID | null>(null);

  // -- her rubric -----------------------------------------------------------
  //
  // Seventeen criteria and their point values, read out of the form she
  // already marks against. Typing them by hand is seventeen chances to be
  // quietly wrong, and a rubric that is nearly hers scores every paper off by
  // an amount nobody notices.

  protected readonly reading = signal(false);
  protected readonly rubricError = signal<string | null>(null);
  protected readonly rubric = signal<ParsedRubric | null>(null);
  protected readonly importedCount = signal<number | null>(null);
  protected readonly rubricFile = signal<string | null>(null);

  /** The criteria grouped under her section headings, for the preview. */
  protected readonly rubricSections = computed(() => {
    const parsed = this.rubric();
    if (!parsed) return [];

    const order: string[] = [];
    const bySection = new Map<string, { name: string; points: number }[]>();

    for (const criterion of parsed.criteria) {
      const key = criterion.section || 'ללא פרק';
      if (!bySection.has(key)) {
        bySection.set(key, []);
        order.push(key);
      }
      bySection.get(key)!.push({
        name: `${criterion.code} ${criterion.name}`,
        points: criterion.maxPoints,
      });
    }

    return order.map((name) => ({
      name,
      criteria: bySection.get(name)!,
      points: bySection.get(name)!.reduce((sum, c) => sum + c.points, 0),
    }));
  });

  /** The rubric the course is actually scored against, once one is saved. */
  protected readonly savedRubric = computed(() =>
    this.data.gradingCategories().filter((c) => c.active && c.max_points !== null),
  );

  protected readonly savedTotal = computed(() =>
    this.savedRubric().reduce((sum, c) => sum + (c.max_points ?? 0), 0),
  );

  protected readonly weights = computed(() => this.data.course()?.grade_weights ?? []);

  protected async chooseRubric(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.reading.set(true);
    this.rubricError.set(null);
    this.importedCount.set(null);
    this.rubric.set(null);
    this.rubricFile.set(file.name);

    try {
      this.rubric.set(await readRubric(await file.arrayBuffer()));
    } catch (error) {
      this.rubricError.set(
        error instanceof RubricError ? error.hebrew : 'לא הצלחתי לקרוא את הקובץ.',
      );
    } finally {
      this.reading.set(false);
    }
  }

  protected saveRubric() {
    const parsed = this.rubric();
    if (!parsed) return;

    const added = this.data.importRubric({ criteria: parsed.criteria, weights: parsed.weights });
    if (!added) {
      this.rubricError.set('צריך קורס פתוח לשייך אליו את הטופס.');
      return;
    }

    this.importedCount.set(added);
    this.rubric.set(null);
  }

  protected discardRubric() {
    this.rubric.set(null);
    this.rubricError.set(null);
    this.rubricFile.set(null);
  }

  protected readonly submissions = computed(() =>
    this.data.submissions().map((s) => ({
      id: s.id,
      name: this.data.studentName(s.student_id),
      lines: this.data.gradingEntries().filter((e) => e.submission_id === s.id).length,
    })),
  );

  protected readonly submissionId = computed(() => {
    const chosen = this.selected();
    if (chosen) return chosen;
    const withLines = this.submissions().find((s) => s.lines > 0);
    return withLines?.id ?? this.submissions()[0]?.id ?? null;
  });

  protected readonly student = computed(() => {
    const id = this.submissionId();
    const submission = id ? this.data.submission(id) : undefined;
    return submission ? this.data.studentName(submission.student_id) : '';
  });

  protected readonly groups = computed(() => {
    const id = this.submissionId();
    if (!id) return [];

    const entries = this.data.gradingEntries().filter((e) => e.submission_id === id);
    const annotations = this.data.annotations();

    return groupByCategory(entries, this.data.gradingCategories()).map((group) => ({
      id: group.category.id,
      name: group.category.name,
      description: group.category.description,
      entries: group.entries.map((entry) => {
        const annotation = annotations.find((a) => a.id === entry.annotation_id);
        return {
          id: entry.id,
          body: entry.body,
          // The student's own words the line came from — the form stays
          // anchored to the paper rather than floating free of it.
          quote: annotation?.anchor.quote ?? null,
          kindLabel: annotation ? KIND_LABEL[annotation.kind] : null,
          kindClass: annotation ? kindClass(annotation.kind) : '',
          fromTeacher: entry.origin === 'teacher' || entry.edited_by_teacher,
        };
      }),
    }));
  });

  /**
   * Whether the headings on screen are hers or a starting point.
   *
   * Said out loud, because the alternative is seven constants presented as
   * though they had been derived from her past years' forms. A form that looks
   * learned and isn't is worse than an empty one: it invites her to trust a
   * grouping nobody chose.
   */
  protected readonly startingHeadings = computed(() =>
    isStartingSet(this.data.gradingCategories()),
  );

  protected readonly total = computed(() =>
    this.groups().reduce((sum, group) => sum + group.entries.length, 0),
  );

  protected readonly subtitle = computed(() => {
    const lines = this.total();
    if (!lines) {
      return 'הטופס נבנה מההערות שאישרת בבדיקה. עוד לא אישרת אף אחת בעבודה הזו.';
    }
    return `${lines === 1 ? 'שורה אחת' : `${lines} שורות`} — כולן מההערות שאישרת, בניסוח שלך.`;
  });

  protected select(id: UUID) {
    this.selected.set(id);
  }
}
