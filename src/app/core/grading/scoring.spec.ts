import { GradingCriterionScore, GradingFormCategory, SubmissionRound } from '../models';
import {
  SCORING_MIN_WORDS,
  deltaLabel,
  finalGrade,
  scoreTotals,
  scoringMode,
  scoringReason,
  wordCount,
} from './scoring';

/**
 * The rule she gave, and mostly the half of it that refuses.
 *
 * The first submission is one paragraph and gets comments and no number. A
 * score on a paragraph is not a small inaccuracy a later round corrects — it
 * is a number a student reads as a verdict on work she has barely started.
 */

function round(overrides: Partial<SubmissionRound> = {}): SubmissionRound {
  return {
    id: 'r1',
    submission_id: 's1',
    round_number: 1,
    document_text: '',
    document_blocks: null,
    drive_revision_id: null,
    received_at: '2026-11-02T09:00:00.000Z',
    scoring: null,
    notes_sent_at: null,
    ai_summary: null,
    ai_summary_confirmed_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `מילה${i}`).join(' ');

function category(overrides: Partial<GradingFormCategory> = {}): GradingFormCategory {
  return {
    id: 'c1',
    course_id: 'course',
    name: '2.1 סקירת מחקר',
    description: null,
    origin: 'imported',
    section: 'פרק תאורטי',
    max_points: 8,
    manual_only: false,
    sort_order: 0,
    active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function score(overrides: Partial<GradingCriterionScore> = {}): GradingCriterionScore {
  return {
    id: 'sc1',
    submission_id: 's1',
    category_id: 'c1',
    points: null,
    previous_points: null,
    status: 'draft',
    change_note: null,
    round_number: 1,
    origin: 'ai',
    edited_by_teacher: false,
    scored_at: '',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('whether a round may be scored', () => {
  it('refuses to score a paragraph', () => {
    expect(scoringMode(round({ document_text: words(90) }))).toBe('comments_only');
  });

  it('scores the first part of a chapter', () => {
    expect(scoringMode(round({ document_text: words(SCORING_MIN_WORDS) }))).toBe('scored');
  });

  /** Her choice beats the estimate in both directions. */
  it('lets her score a short submission anyway', () => {
    const early = round({ document_text: words(90), scoring: 'scored' });
    expect(scoringMode(early)).toBe('scored');
  });

  it('lets her hold back scoring on a long one', () => {
    const long = round({ document_text: words(5000), scoring: 'comments_only' });
    expect(scoringMode(long)).toBe('comments_only');
  });

  it('treats a missing round as unscored rather than guessing', () => {
    expect(scoringMode(undefined)).toBe('comments_only');
  });

  it('treats an empty document as unscored', () => {
    expect(scoringMode(round({ document_text: null }))).toBe('comments_only');
  });

  /**
   * Said, not implied. A form with no numbers looks broken, and "too early"
   * and "she asked for comments only" are different facts.
   */
  it('says which of the two decided', () => {
    expect(scoringReason(round({ document_text: words(90) }))).toContain('90');
    expect(scoringReason(round({ document_text: words(90) }))).toContain('אין ניקוד');

    const chosen = round({ document_text: words(90), scoring: 'comments_only' });
    expect(scoringReason(chosen)).toContain('בחרת');
  });
});

describe('wordCount', () => {
  it('counts words, not characters', () => {
    expect(wordCount('הקשר בין המשתנים היה מובהק')).toBe(5);
  });

  it('is not fooled by runs of whitespace', () => {
    expect(wordCount('  שתי   מילים  ')).toBe(2);
    expect(wordCount('')).toBe(0);
    expect(wordCount(null)).toBe(0);
  });
});

describe('the totals on the form', () => {
  const rubric = [
    category({ id: 'a', max_points: 8 }),
    category({ id: 'b', max_points: 7 }),
    category({ id: 'hers', max_points: 3, manual_only: true, name: '2.2 מקורות חב"ד' }),
  ];

  it('counts only criteria that carry a score', () => {
    const totals = scoreTotals(rubric, [score({ category_id: 'a', points: 6 })]);

    expect(totals.points).toBe(6);
    // Out of 8, not out of 18: the rest have not been scored.
    expect(totals.outOf).toBe(8);
    expect(totals.scored).toBe(1);
  });

  /**
   * "Not scored yet" and "the app will never score this" read identically on
   * screen and mean opposite things, so they are counted apart.
   */
  it('keeps her own criteria apart from the ones still waiting', () => {
    const totals = scoreTotals(rubric, [score({ category_id: 'a', points: 6 })]);

    expect(totals.awaiting).toBe(1);
    expect(totals.hers).toBe(1);
    expect(totals.complete).toBe(false);
  });

  it('never treats a null score as a zero', () => {
    const totals = scoreTotals(rubric, [score({ category_id: 'a', points: null })]);

    expect(totals.points).toBe(0);
    expect(totals.outOf).toBe(0);
    expect(totals.scored).toBe(0);
    expect(totals.awaiting).toBe(2);
  });

  it('is complete only when nothing is left, hers included', () => {
    const totals = scoreTotals(rubric, [
      score({ category_id: 'a', points: 8 }),
      score({ category_id: 'b', points: 5 }),
      score({ category_id: 'hers', points: 3, origin: 'teacher' }),
    ]);

    expect(totals.points).toBe(16);
    expect(totals.outOf).toBe(18);
    expect(totals.complete).toBe(true);
  });
});

describe('how a score moved', () => {
  it('says how much it rose', () => {
    expect(deltaLabel(score({ points: 7, previous_points: 4 }))).toBe('עלה ב־3');
  });

  it('says when it fell', () => {
    expect(deltaLabel(score({ points: 4, previous_points: 7 }))).toBe('ירד ב־3');
  });

  it('says nothing when it did not move, or when there is nothing to compare', () => {
    expect(deltaLabel(score({ points: 7, previous_points: 7 }))).toBeNull();
    expect(deltaLabel(score({ points: 7, previous_points: null }))).toBeNull();
    expect(deltaLabel(score({ points: null, previous_points: 4 }))).toBeNull();
  });
});

describe('the final grade', () => {
  const weights = [
    { name: 'ציון העבודה', percent: 65 },
    { name: 'פרזנטציה', percent: 10 },
    { name: 'מטלות שוטפות', percent: 25 },
  ];

  it('composes it from her three parts', () => {
    const grade = finalGrade({
      weights,
      parts: { 'ציון העבודה': 80, פרזנטציה: 90, 'מטלות שוטפות': 100 },
    });

    // 52 + 9 + 25
    expect(grade).toBe(86);
  });

  /**
   * A final grade computed from two of its three parts is not a draft of the
   * grade. It is a wrong grade carrying the authority of a number, and she was
   * explicit that this arithmetic belongs at the end.
   */
  it('returns nothing at all while a part is missing', () => {
    expect(
      finalGrade({ weights, parts: { 'ציון העבודה': 80, פרזנטציה: 90, 'מטלות שוטפות': null } }),
    ).toBeNull();

    expect(finalGrade({ weights, parts: { 'ציון העבודה': 80 } })).toBeNull();
  });

  it('returns nothing when the course has no weighting', () => {
    expect(finalGrade({ weights: [], parts: {} })).toBeNull();
  });
});
