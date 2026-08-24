import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
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
