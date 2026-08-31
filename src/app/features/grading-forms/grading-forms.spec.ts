import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { DataStore } from '../../core/data/data-store';
import { EMPTY_SNAPSHOT, PersistedSnapshot, Repository } from '../../core/data/repository';
import { LocalRepository } from '../../core/data/local-repository';
import {
  Assignment,
  Course,
  GradingCriterionScore,
  GradingFormCategory,
  Student,
  Submission,
} from '../../core/models';
import { GradingForms } from './grading-forms';

/**
 * The score sheet, rendered.
 *
 * These assert what is on screen rather than what a function returns, because
 * every real failure on this screen so far has been of exactly that shape: the
 * value was computed correctly and never reached the template. A green test on
 * `scoreDisplay` proves nothing about a page that shows none of it.
 *
 * The two that matter most are the ones about absence — an unscored criterion
 * must not render as `0/4`, and a partial grade must not render as a number.
 */

const COURSE_ID = 'c1';
const SUBMISSION_ID = 's1';

function category(over: Partial<GradingFormCategory> = {}): GradingFormCategory {
  return {
    id: 'cat-1',
    course_id: COURSE_ID,
    name: '2.1 סקירת ספרות',
    description: null,
    origin: 'imported',
    section: 'פרק תאורטי',
    max_points: 4,
    manual_only: false,
    active: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...over,
  } as GradingFormCategory;
}

function score(over: Partial<GradingCriterionScore> = {}): GradingCriterionScore {
  return {
    id: 'sc-1',
    submission_id: SUBMISSION_ID,
    category_id: 'cat-1',
    points: 3,
    previous_points: null,
    status: 'final',
    change_note: null,
    round_number: 1,
    origin: 'ai',
    edited_by_teacher: false,
    scored_at: '2026-08-30T09:00:00.000Z',
    created_at: '',
    updated_at: '2026-08-30T09:00:00.000Z',
    ...over,
  } as GradingCriterionScore;
}

function snapshot(over: Partial<PersistedSnapshot> = {}): PersistedSnapshot {
  const course = {
    id: COURSE_ID,
    name: 'סמינריון',
    grade_weights: [
      { name: 'ציון העבודה', percent: 65 },
      { name: 'פרזנטציה', percent: 10 },
      { name: 'מטלות שוטפות', percent: 25 },
    ],
    created_at: '',
    updated_at: '',
  } as unknown as Course;

  const submission = {
    id: SUBMISSION_ID,
    assignment_id: 'a1',
    student_id: 'st-1',
    status: 'in_review',
    current_round: 1,
    title: null,
    drive_file_id: null,
    drive_file_name: null,
    drive_mime_type: null,
    drive_web_view_link: null,
    drive_owner_email: null,
    drive_creator_email: null,
    drive_created_at: null,
    drive_modified_at: null,
    drive_revision_count: null,
    drive_metadata_raw: null,
    last_synced_at: null,
    word_count: 4000,
    presentation_score: null,
    ongoing_score: null,
    created_at: '',
    updated_at: '',
  } as Submission;

  return {
    ...EMPTY_SNAPSHOT,
    courses: [course],
    assignments: [{ id: 'a1', course_id: COURSE_ID } as unknown as Assignment],
    students: [{ id: 'st-1', full_name: 'נועה ברקוביץ׳' } as unknown as Student],
    submissions: [submission],
    gradingCategories: [category()],
    criterionScores: [],
    ...over,
  };
}

function render(rows: Partial<PersistedSnapshot> = {}) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Repository, useClass: LocalRepository }],
  });

  const store = TestBed.inject(DataStore);
  store.applySnapshot(snapshot(rows));

  const fixture = TestBed.createComponent(GradingForms);
  fixture.detectChanges();

  return {
    store,
    fixture,
    text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    click: (selector: string) => {
      const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
      expect(el).not.toBeNull();
      el!.click();
      fixture.detectChanges();
    },
  };
}

describe('the score on the grading form', () => {
  it('shows a criterion as both a fraction and a percentage', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    page.click('.section-head');

    expect(page.text()).toContain('3/4');
    expect(page.text()).toContain('75%');
  });

  /**
   * The one that must not regress. A criterion nobody has read yet is not a
   * criterion worth nothing, and rendering it as 0/4 states the second.
   */
  it('never renders an unscored criterion as a zero', () => {
    const page = render({ criterionScores: [] });

    page.click('.section-head');

    const cell = page.fixture.nativeElement.querySelector('.criterion-score');
    expect(cell.textContent).not.toContain('0/4');
    expect(cell.textContent).not.toContain('0%');
    expect(cell.textContent).toContain('טרם');
  });

  it('marks the criteria she scores herself as hers, not as pending', () => {
    const page = render({ gradingCategories: [category({ manual_only: true })] });

    page.click('.section-head');

    expect(page.text()).toContain('לשיפוטך');
  });

  it('shows a section subtotal without opening it', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    expect(page.text()).toContain('פרק תאורטי');
    expect(page.text()).toContain('3/4');
  });
});

describe('the details behind a section', () => {
  /** "make the front end of it clean but an option to click on a drop down". */
  it('keeps the criteria closed until she opens the section', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    expect(page.fixture.nativeElement.querySelector('.criteria')).toBeNull();

    page.click('.section-head');
    expect(page.fixture.nativeElement.querySelector('.criteria')).not.toBeNull();

    page.click('.section-head');
    expect(page.fixture.nativeElement.querySelector('.criteria')).toBeNull();
  });

  it('shows what moved and why, once open', () => {
    const page = render({
      criterionScores: [
        score({ points: 3, previous_points: 1, status: 'draft', change_note: 'הוסיפה שני מקורות' }),
      ],
    });

    page.click('.section-head');

    expect(page.text()).toContain('עלה ב־2');
    expect(page.text()).toContain('הוסיפה שני מקורות');
    expect(page.text()).toContain('טיוטה');
  });
});

describe('the final grade', () => {
  /**
   * Two thirds of a weighted grade is not a draft of the grade. It is a wrong
   * grade carrying the authority of a number, and a student would be shown it.
   */
  it('shows no grade while a part of it is missing, and says which', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    expect(page.fixture.nativeElement.querySelector('.final-value')).toBeNull();
    expect(page.text()).toContain('פרזנטציה');
    expect(page.text()).toContain('מטלות שוטפות');
  });

  it('composes the grade once she has typed the two parts only she knows', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    page.store.updateSubmission(SUBMISSION_ID, {
      presentation_score: 90,
      ongoing_score: 80,
    });
    page.fixture.detectChanges();

    // 75 × 0.65 + 90 × 0.10 + 80 × 0.25 = 48.75 + 9 + 20 = 77.75 → 77.8
    expect(page.fixture.nativeElement.querySelector('.final-value')?.textContent?.trim()).toBe(
      '77.8',
    );
  });

  /**
   * The paper's own 65% is the whole rubric, so it waits for the whole rubric.
   * A paper marked to 71 of the 78 points read so far is not a 71.
   */
  it('waits for every criterion before calling the paper scored', () => {
    const page = render({
      gradingCategories: [category(), category({ id: 'cat-2', name: '2.2 מקורות' })],
      criterionScores: [score({ points: 3 })],
    });

    page.store.updateSubmission(SUBMISSION_ID, { presentation_score: 90, ongoing_score: 80 });
    page.fixture.detectChanges();

    expect(page.fixture.nativeElement.querySelector('.final-value')).toBeNull();
    expect(page.text()).toContain('סעיפים נוקדו');
  });
});
