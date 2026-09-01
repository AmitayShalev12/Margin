import { GradingCriterionScore, GradingFormCategory, SubmissionRound } from '../models';
import {
  SCORING_MIN_WORDS,
  resolveScores,
  scoreDisplay,
  sectionTotals,
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
    rationale: null,
    rationale_points: null,
    discussion: [],
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

describe('a score as she reads it', () => {
  it('gives both the fraction and the percentage', () => {
    const shown = scoreDisplay(3, 4);

    expect(shown?.label).toBe('3/4');
    expect(shown?.percent).toBe(75);
  });

  it('rounds to whole percent — a grading form is not a laboratory', () => {
    expect(scoreDisplay(7, 13)?.percent).toBe(54);
    expect(scoreDisplay(1, 3)?.percent).toBe(33);
  });

  /**
   * "Cannot be judged yet" and "judged worth nothing" are opposite findings.
   * Rendering the first as 0/4 and 0% states the second.
   */
  it('gives nothing back for a criterion with no score', () => {
    expect(scoreDisplay(null, 4)).toBeNull();
    expect(scoreDisplay(undefined, 4)).toBeNull();
  });

  it('shows a genuine zero as a zero', () => {
    expect(scoreDisplay(0, 4)?.label).toBe('0/4');
    expect(scoreDisplay(0, 4)?.percent).toBe(0);
  });

  it('gives nothing back when the criterion is worth nothing', () => {
    expect(scoreDisplay(3, null)).toBeNull();
    expect(scoreDisplay(3, 0)).toBeNull();
  });
});

describe('the sections of her rubric', () => {
  const rubric = [
    category({ id: 'a', section: 'פרק תאורטי', max_points: 8 }),
    category({ id: 'b', section: 'פרק תאורטי', max_points: 16 }),
    category({ id: 'c', section: 'פרק תאורטי', max_points: 18 }),
    category({ id: 'd', section: 'דרך ההגשה', max_points: 3 }),
  ];

  /**
   * Out of what was scored, not out of the section's full weight. A chapter
   * half written reads 18/24; out of 42 it would look like a failing paper
   * rather than an unfinished one.
   */
  it('totals only the criteria that carry a score', () => {
    const totals = sectionTotals(rubric, [
      score({ category_id: 'a', points: 6 }),
      score({ category_id: 'b', points: 12 }),
    ]);

    const theory = totals.find((t) => t.name === 'פרק תאורטי');
    expect(theory?.display?.label).toBe('18/24');
    expect(theory?.display?.percent).toBe(75);
    expect(theory?.awaiting).toBe(1);
  });

  it('says nothing for a section with no scores at all', () => {
    const totals = sectionTotals(rubric, []);

    expect(totals.every((t) => t.display === null)).toBe(true);
    expect(totals.find((t) => t.name === 'דרך ההגשה')?.awaiting).toBe(1);
  });

  it('keeps her section order', () => {
    expect(sectionTotals(rubric, []).map((t) => t.name)).toEqual(['פרק תאורטי', 'דרך ההגשה']);
  });
});

/**
 * Matching what the model sent to what her form actually holds.
 *
 * This function had no tests, and that is exactly how it came to throw away
 * all seventeen scores of a paper without a sound. A dropped score renders as
 * "טרם נוקד" — identical to a criterion nobody has read — so the failure had
 * no symptom at all beyond an empty form.
 */
describe('matching the model’s scores to her criteria', () => {
  const rubric = [
    category({ id: 'a', name: '2.1 סקירת ספרות', max_points: 8 }),
    category({ id: 'b', name: '3.1 שיטת המחקר', max_points: 6 }),
  ];

  it('matches the key it was given', () => {
    const { matched, unmatched } = resolveScores(rubric, [
      { key: '2.1', points: 6, note: 'סקירה רחבה' },
    ]);

    expect(matched.map((m) => m.category.id)).toEqual(['a']);
    expect(unmatched).toEqual([]);
  });

  /**
   * The forms it actually answers with. It is shown `[2.1]` and asked for
   * `2.1`, and it variously echoes the bracket, the full line, or her full
   * stop. All three are unambiguously criterion 2.1.
   */
  it('matches the key however the model dressed it up', () => {
    for (const key of ['2.1', ' 2.1 ', '[2.1]', '2.1 סקירת ספרות', '2.1.']) {
      const { matched } = resolveScores(rubric, [{ key, points: 6, note: '' }]);
      expect(
        matched.map((m) => m.category.id),
        key,
      ).toEqual(['a']);
    }
  });

  it('does not let one criterion answer for another', () => {
    const { matched, unmatched } = resolveScores(rubric, [{ key: '2.11', points: 6, note: '' }]);

    expect(matched).toEqual([]);
    expect(unmatched).toEqual(['2.11']);
  });

  /** Reported rather than dropped, so the screen can say what it saw. */
  it('hands back the keys that answered to nothing', () => {
    const { matched, unmatched } = resolveScores(rubric, [
      { key: '2.1', points: 6, note: '' },
      { key: 'שיטת המחקר', points: 4, note: '' },
    ]);

    expect(matched).toHaveLength(1);
    expect(unmatched).toEqual(['שיטת המחקר']);
  });

  /**
   * Never sent to the model, so a score for one is a row it invented — not a
   * mismatch to report, and never stored against her judgement.
   */
  it('drops a score for a criterion she reserved for herself, silently', () => {
    const hers = [category({ id: 'h', name: '2.2 מקורות', manual_only: true, max_points: 3 })];
    const { matched, unmatched } = resolveScores(hers, [{ key: '2.2', points: 3, note: '' }]);

    expect(matched).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  it('clamps a score that overruns its criterion', () => {
    const { matched } = resolveScores(rubric, [{ key: '2.1', points: 9, note: '' }]);

    // 9 out of 8 is a misread rubric; storing it would put the form over 100
    // with nothing on screen looking wrong.
    expect(matched[0].points).toBe(8);
  });

  it('keeps a null as a null rather than turning it into a zero', () => {
    const { matched } = resolveScores(rubric, [{ key: '3.1', points: null, note: 'טרם נכתב' }]);

    expect(matched[0].points).toBeNull();
  });
});

/**
 * Whose paper is this score on?
 *
 * Worth pinning rather than assuming. The rubric is shared across the whole
 * course — seventeen criteria, one set — so the criterion id is the same for
 * every student, and a score keyed on the criterion alone would show one
 * girl's mark on every other girl's form. Every score carries its submission.
 */
describe('a score belongs to one paper', () => {
  const rubric = [category({ id: 'a', name: '2.1 סקירת ספרות', max_points: 8 })];

  it('totals only the scores for the paper being looked at', () => {
    const noa = score({ id: 's1', submission_id: 'sub-noa', category_id: 'a', points: 6 });
    const dana = score({ id: 's2', submission_id: 'sub-dana', category_id: 'a', points: 2 });
    const all = [noa, dana];

    const forNoa = scoreTotals(
      rubric,
      all.filter((s) => s.submission_id === 'sub-noa'),
    );
    const forDana = scoreTotals(
      rubric,
      all.filter((s) => s.submission_id === 'sub-dana'),
    );

    expect(forNoa.points).toBe(6);
    expect(forDana.points).toBe(2);
  });

  /** The same criterion, two papers, two different marks — not one shared row. */
  it('keeps two papers scored on the same criterion apart', () => {
    const rows = [
      score({ id: 's1', submission_id: 'sub-noa', category_id: 'a', points: 6 }),
      score({ id: 's2', submission_id: 'sub-dana', category_id: 'a', points: 2 }),
    ];

    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows.filter((r) => r.submission_id === 'sub-noa')).toHaveLength(1);
  });
});
