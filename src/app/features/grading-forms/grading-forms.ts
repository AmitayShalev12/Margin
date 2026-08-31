import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataStore } from '../../core/data/data-store';
import { ParsedRubric, RubricError, readRubric } from '../../core/import/rubric';
import { GradeSheet, buildGradeDocx, gradeDocxName } from '../../core/export/grade-docx';
import { isStartingSet } from '../../core/grading/categories';
import { groupByCategory } from '../../core/grading/entries';
import {
  ScoreDisplay,
  criterionKey,
  deltaLabel,
  finalGrade,
  scoreDisplay,
  scoreTotals,
  sectionTotals,
} from '../../core/grading/scoring';
import { GradingFormCategory, UUID } from '../../core/models';
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
  imports: [PageHeader, RouterLink, BidiText, DatePipe],
  templateUrl: './grading-forms.html',
  styleUrl: './grading-forms.scss',
})
export class GradingForms {
  private readonly data = inject(DataStore);

  /** Which submission's form is on screen. Defaults to the first with work on it. */
  private readonly selected = signal<UUID | null>(null);

  /**
   * Which sections she has opened.
   *
   * Closed by default, and that is the request: "make the front end of it
   * clean but an option to click on a drop down to show the details". What she
   * needs at a glance is four section totals and a final grade; seventeen
   * criteria and their comments are what she opens when she disagrees with
   * one of them.
   */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

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
          // What the line was derived from, so she can get back to where it
          // sits in the paper. Null for a line she wrote herself, which came
          // from no comment and has nowhere to go.
          annotationId: annotation?.id ?? null,
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

  // -- the score ------------------------------------------------------------
  //
  // Everything below was computed already and never shown. She asked for the
  // two numbers she reads off a marked form — "3/4 or 75%" — and the total at
  // the bottom of it.

  private readonly scores = computed(() => {
    const id = this.submissionId();
    return id ? this.data.criterionScores(id) : [];
  });

  /** Her rubric criteria in her own order, section by section. */
  private readonly scored = computed(() =>
    this.data.gradingCategories().filter((c) => c.max_points !== null),
  );

  protected readonly totals = computed(() => scoreTotals(this.scored(), this.scores()));

  /**
   * The form as she reads it: sections that show a subtotal, opening onto the
   * criteria underneath.
   *
   * Both a fraction and a percentage on every line, because they answer
   * different questions — `3/4` is what she writes down and what a student
   * argues with, `75%` is what makes criteria worth 3 and 18 comparable.
   */
  protected readonly sections = computed(() => {
    const scores = this.scores();
    const byCategory = new Map(scores.map((s) => [s.category_id, s]));
    const groups = new Map(this.groups().map((g) => [g.id, g]));
    const subtotals = new Map(sectionTotals(this.scored(), scores).map((t) => [t.name, t]));
    const open = this.opened();

    const order: string[] = [];
    const rows = new Map<string, ReturnType<typeof criterionRow>[]>();

    const criterionRow = (category: GradingFormCategory) => {
      const score = byCategory.get(category.id);
      const group = groups.get(category.id);

      return {
        id: category.id,
        key: criterionKey(category),
        name: category.name,
        maxPoints: category.max_points,
        /** Null renders as "טרם", never as 0/4 — those mean opposite things. */
        display: scoreDisplay(score?.points ?? null, category.max_points),
        /**
         * A score the model proposed and she has not confirmed. Her own
         * suggestion was a colour; it is a word as well, because a colour
         * alone is a thing you have to be told the meaning of once.
         */
        draft: score?.status === 'draft',
        updatedAt: score?.updated_at ?? null,
        /** What moved since the round before, and why. */
        delta: score ? deltaLabel(score) : null,
        changeNote: score?.change_note ?? null,
        /** 2.2 and 4.2 — hers to judge, never the model's. */
        mine: category.manual_only,
        entries: group?.entries ?? [],
      };
    };

    for (const category of this.scored()) {
      const name = category.section ?? 'ללא פרק';
      if (!rows.has(name)) {
        order.push(name);
        rows.set(name, []);
      }
      rows.get(name)!.push(criterionRow(category));
    }

    return order.map((name) => ({
      name,
      open: open.has(name),
      subtotal: subtotals.get(name)?.display ?? null,
      awaiting: subtotals.get(name)?.awaiting ?? 0,
      criteria: rows.get(name)!,
    }));
  });

  protected toggle(section: string) {
    this.opened.update((open) => {
      const next = new Set(open);
      if (!next.delete(section)) next.add(section);
      return next;
    });
  }

  // -- the final grade ------------------------------------------------------

  /**
   * The paper's own score, out of 100.
   *
   * Only once every criterion is in. A paper scored to 71 of the 78 points so
   * far marked is not "71" — showing it as the paper's grade would understate
   * a good paper by whatever is still unread.
   */
  protected readonly paperScore = computed(() => {
    const totals = this.totals();
    return totals.complete ? scoreDisplay(totals.points, totals.outOf) : null;
  });

  /**
   * Her weighting, read out of the same document as the rubric: 65 / 10 / 25.
   *
   * Matched to a part by keyword rather than by position, with position as the
   * fallback — a form that lists them in another order should still compose
   * the right grade.
   */
  protected readonly gradeParts = computed(() => {
    const id = this.submissionId();
    const submission = id ? this.data.submission(id) : undefined;
    const paper = this.paperScore();

    return this.weights().map((weight, index) => {
      const name = weight.name;
      const isPaper = name.includes('עבוד') || (index === 0 && !name.includes('פרזנט'));
      const isPresentation = name.includes('פרזנט') || name.includes('מצגת');

      /**
       * The paper enters the weighting as a percentage, not as its raw points.
       *
       * Her own rubric totals exactly 100, so the two coincide and this looks
       * like a distinction without a difference — until a form that totals
       * anything else is imported, at which point raw points would compose a
       * grade out of nowhere. A test on a 4-point rubric caught it.
       */
      const value = isPaper
        ? (paper?.percent ?? null)
        : isPresentation
          ? (submission?.presentation_score ?? null)
          : (submission?.ongoing_score ?? null);

      return {
        name,
        percent: weight.percent,
        value,
        /** Margin can only know the paper. The other two she types. */
        field: isPaper ? null : isPresentation ? ('presentation' as const) : ('ongoing' as const),
      };
    });
  });

  /**
   * The grade, or nothing.
   *
   * `finalGrade` returns null while any part is missing, and that null is
   * shown as a list of what is still open rather than as a number — two
   * thirds of a weighted grade is a wrong grade, not a draft of one.
   */
  protected readonly final = computed(() =>
    finalGrade({
      weights: this.weights(),
      parts: Object.fromEntries(this.gradeParts().map((p) => [p.name, p.value])),
    }),
  );

  protected readonly missingParts = computed(() =>
    this.gradeParts().filter((p) => p.value === null),
  );

  protected setPart(field: 'presentation' | 'ongoing', raw: string) {
    const id = this.submissionId();
    if (!id) return;

    const trimmed = raw.trim();
    // Cleared, not zeroed. Emptying the box must put it back to "not entered".
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)) return;

    this.data.updateSubmission(id, {
      [field === 'presentation' ? 'presentation_score' : 'ongoing_score']: parsed,
    });
  }

  // -- the export -----------------------------------------------------------

  /**
   * The filled form as a `.docx` she can edit.
   *
   * Asked whether the Word file mattered or the screen would do, she said the
   * file: "ברור שהכי טוב שיהיה הטופס מוכן ורק אני אערוך על הטופס ואני אוכל
   * להוריד אותו". So the export produces a document, not a print stylesheet —
   * the point is that she can change a number in it and send it on.
   */
  protected exportForm() {
    const bytes = buildGradeDocx(this.sheet());

    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = gradeDocxName(this.sheet());
    link.click();
    // Freed on the next turn of the loop; revoking immediately races the
    // download in Safari and the file arrives empty.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /**
   * Everything the document needs, and nothing from the DOM.
   *
   * Built here rather than inside the export so the shape the writer takes is
   * plain data — a test can hand it a half-scored paper without standing up a
   * component, which is how the "never print a zero" rule is actually pinned
   * down.
   */
  private sheet(): GradeSheet {
    const id = this.submissionId();
    const submission = id ? this.data.submission(id) : undefined;
    const paper = this.paperScore();

    return {
      student: this.student() || 'עבודה',
      work: submission?.title ?? null,
      exportedAt: new Date(),
      sections: this.sections().map((section) => ({
        name: section.name,
        points: section.subtotal?.points ?? null,
        outOf: section.subtotal?.outOf ?? null,
        percent: section.subtotal?.percent ?? null,
        criteria: section.criteria.map((criterion) => ({
          name: criterion.name,
          maxPoints: criterion.maxPoints,
          points: criterion.display?.points ?? null,
          percent: criterion.display?.percent ?? null,
          mine: criterion.mine,
          note: criterion.changeNote,
        })),
      })),
      paper: paper ? { points: paper.points, outOf: paper.outOf, percent: paper.percent } : null,
      parts: this.gradeParts().map((part) => ({
        name: part.name,
        percent: part.percent,
        value: part.value,
      })),
      final: this.final(),
    };
  }

  protected select(id: UUID) {
    this.selected.set(id);
  }
}
