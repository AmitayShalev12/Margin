import { signal } from '@angular/core';
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
  SubmissionRound,
} from '../../core/models';
import { AnnotationGenerator } from '../../core/ai/annotation-generator';
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
    rationale: null,
    rationale_points: null,
    teacher_note: null,
    model_reply: null,
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

  const round = {
    id: 'r1',
    submission_id: SUBMISSION_ID,
    round_number: 1,
    // Short on purpose: under SCORING_MIN_WORDS, so the estimate says
    // comments-only and the screen has to account for itself.
    document_text: 'פסקה קצרה בלבד.',
    document_blocks: null,
    drive_revision_id: null,
    received_at: '2026-08-30T09:00:00.000Z',
    scoring: null,
    created_at: '',
    updated_at: '',
  } as SubmissionRound;

  return {
    ...EMPTY_SNAPSHOT,
    rounds: [round],
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
  const generated: string[] = [];
  const generator = {
    isGenerating: signal(false),
    canGenerate: true,
    // The screen reads this to tell a failure apart from a clean run that
    // produced no numbers, so the double has to carry it.
    state: signal({
      phase: 'idle' as const,
      message: null,
      detail: null,
      discarded: 0,
      scoring: null,
    }),
    generate: async (id: string) => {
      generated.push(id);
      return null;
    },
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Repository, useClass: LocalRepository },
      { provide: AnnotationGenerator, useValue: generator },
    ],
  });

  const store = TestBed.inject(DataStore);
  store.applySnapshot(snapshot(rows));

  const fixture = TestBed.createComponent(GradingForms);
  fixture.detectChanges();

  return {
    store,
    fixture,
    generated,
    generator,
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

/**
 * The gap this screen actually had.
 *
 * `setRoundScoring` and `scoringReason` both existed, were both tested, and no
 * screen in the app called either. What she saw was seventeen rows of
 * "טרם נוקד" — which is indistinguishable from a broken page — and no way
 * forward from it.
 */
describe('a form with nothing scored on it', () => {
  it('says why, rather than leaving an empty column to be interpreted', () => {
    const page = render();

    expect(page.text()).toContain('מילים');
    expect(page.text()).toContain('אין ניקוד');
  });

  it('offers the way out in the same breath', () => {
    const page = render();

    expect(page.fixture.nativeElement.querySelector('.unscored-actions button')).not.toBeNull();
  });

  /**
   * Both halves, because either alone leaves her exactly where she started:
   * the toggle without the run changes nothing on screen, and the run without
   * the toggle sends an empty rubric and comes back with nothing.
   */
  it('turns scoring on for the round and then actually runs the pass', async () => {
    const page = render();

    page.click('.unscored-actions button');
    await Promise.resolve();

    expect(page.store.roundFor(SUBMISSION_ID)?.scoring).toBe('scored');
    expect(page.generated).toEqual([SUBMISSION_ID]);
  });

  it('remembers her choice as hers, not as the word-count estimate', () => {
    const page = render();

    page.click('.unscored-actions button');

    // scoringWasChosen() reads this: a round she scored on purpose must not
    // silently revert to comments-only when the estimate disagrees.
    expect(page.store.roundFor(SUBMISSION_ID)?.scoring).toBe('scored');
  });

  it('lets her put a round back to comments only', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    page.click('.rescore button:last-child');

    expect(page.store.roundFor(SUBMISSION_ID)?.scoring).toBe('comments_only');
  });

  /** Once there are numbers, the banner gets out of the way. */
  it('stops explaining itself once the paper is scored', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    expect(page.fixture.nativeElement.querySelector('.unscored')).toBeNull();
    expect(page.fixture.nativeElement.querySelector('.rescore')).not.toBeNull();
  });
});

/**
 * A run that produced nothing.
 *
 * The reported symptom was exact: "it just unpresses the button after a min".
 * The pass had run, the button had re-enabled, and the page was identical —
 * which is the same thing a broken feature looks like. Three outcomes shared
 * that appearance and need different fixes, so the screen has to separate them.
 */
describe('when scoring comes back with nothing', () => {
  async function runWith(
    scoring: { returned: number; kept: number; unmatched: string[] } | null,
    phase = 'idle',
    rows: Partial<PersistedSnapshot> = {},
  ) {
    const page = render(rows);
    page.generator.state.set({
      phase,
      message: phase === 'error' ? 'משהו נכשל' : null,
      detail: phase === 'error' ? 'HTTP 504' : null,
      discarded: 0,
      scoring,
    } as never);

    // Whichever run button this state renders: the banner's when nothing is
    // scored, the rescore row's once something is.
    page.click('.unscored-actions button, .rescore button');
    await Promise.resolve();
    page.fixture.detectChanges();
    return page;
  }

  it('says so when the model returned no scores at all', async () => {
    const page = await runWith({ returned: 0, kept: 0, unmatched: [] });

    expect(page.text()).toContain('לא החזיר ניקוד לאף סעיף');
  });

  /**
   * The one worth telling apart. Scores that match nothing on her rubric are
   * dropped in full, and "the model said nothing" would send her looking in
   * entirely the wrong place.
   */
  it('says so when every score it returned matched nothing on her form', async () => {
    const page = await runWith({
      returned: 11,
      kept: 0,
      unmatched: ['2.1 סקירת ספרות', '3.1 שיטה'],
    });

    expect(page.text()).toContain('11');
    expect(page.text()).toContain('לא התאים');
  });

  it('shows a real failure in the words the generator already had', async () => {
    const page = await runWith(null, 'error');

    expect(page.text()).toContain('משהו נכשל');
    expect(page.text()).toContain('HTTP 504');
  });

  it('says nothing at all before she has run one', () => {
    const page = render();

    expect(page.fixture.nativeElement.querySelector('.score-error')).toBeNull();
  });

  it('stays quiet when the run did produce scores', async () => {
    const page = await runWith({ returned: 11, kept: 11, unmatched: [] }, 'idle', {
      criterionScores: [score({ points: 3 })],
    });

    expect(page.fixture.nativeElement.querySelector('.score-error')).toBeNull();
  });

  /**
   * The expected outcome for an early draft, and the one that would otherwise
   * look exactly like another failure — leaving her to press the button again
   * on a paper the model has correctly declined to mark.
   */
  it('says when the model read everything and judged none of it scorable yet', async () => {
    const page = await runWith({ returned: 17, kept: 17, unmatched: [] });

    expect(page.text()).toContain('אין עדיין בסיס לנקד');
    expect(page.text()).toContain('זה לא כשל');
  });
});

/**
 * Why ציון העבודה never appeared.
 *
 * The paper score is withheld until every criterion carries one, which is
 * right — a total out of the part she has read so far is not the paper's
 * grade. But two of her seventeen are hers alone to judge and can never be
 * filled by the model, and the app gave her no way to enter them. The total
 * was unreachable by construction.
 *
 * setCriterionScore had existed and been tested since the rubric import
 * landed, with no caller anywhere in the UI. Third time on this screen.
 */
describe('entering a score by hand', () => {
  function withMine(scores: GradingCriterionScore[] = []) {
    return render({
      gradingCategories: [
        category({ id: 'cat-1', name: '2.1 סקירת ספרות', max_points: 4 }),
        category({ id: 'cat-2', name: '2.2 מקורות', max_points: 3, manual_only: true }),
      ],
      criterionScores: scores,
    });
  }

  it('writes her number against the criterion', () => {
    const page = withMine();
    page.click('.section-head');

    const input = page.fixture.nativeElement.querySelectorAll('.points')[0] as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('change'));
    page.fixture.detectChanges();

    expect(page.store.criterionScores(SUBMISSION_ID)[0]).toMatchObject({
      category_id: 'cat-1',
      points: 3,
    });
  });

  /** The one that was impossible before: hers can be filled in nowhere else. */
  it('lets her score the criteria only she may judge', () => {
    const page = withMine();
    page.click('.section-head');

    const input = page.fixture.nativeElement.querySelectorAll('.points')[1] as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('change'));
    page.fixture.detectChanges();

    expect(
      page.store.criterionScores(SUBMISSION_ID).find((s) => s.category_id === 'cat-2')?.points,
    ).toBe(3);
  });

  it('refuses a score above the criterion’s maximum', () => {
    const page = withMine();
    page.click('.section-head');

    const input = page.fixture.nativeElement.querySelectorAll('.points')[0] as HTMLInputElement;
    input.value = '9';
    input.dispatchEvent(new Event('change'));

    expect(page.store.criterionScores(SUBMISSION_ID)).toEqual([]);
  });

  /** Cleared, not zeroed. Emptying must be able to mean "not scored" again. */
  it('takes a score back to nothing when she empties the box', () => {
    const page = withMine([score({ category_id: 'cat-1', points: 3 })]);
    page.click('.section-head');

    const input = page.fixture.nativeElement.querySelectorAll('.points')[0] as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change'));
    page.fixture.detectChanges();

    expect(page.store.criterionScores(SUBMISSION_ID)[0].points).toBeNull();
  });

  it('gives the paper a score once nothing is left open', () => {
    const page = withMine([
      score({ id: 'sc-a', category_id: 'cat-1', points: 3 }),
      score({ id: 'sc-b', category_id: 'cat-2', points: 3 }),
    ]);

    // 6 of 7.
    expect(page.text()).toContain('6/7');
    expect(page.text()).toContain('86%');
  });
});

describe('what is holding the paper score up', () => {
  /**
   * "2 סעיפים" is useless when both are hers: she would wait for the model to
   * fill them, and it never will.
   */
  it('names her own criteria rather than counting them', () => {
    const page = render({
      gradingCategories: [
        category({ id: 'cat-1', name: '2.1 סקירת ספרות', max_points: 4 }),
        category({ id: 'cat-2', name: '2.2 מקורות', max_points: 3, manual_only: true }),
      ],
      criterionScores: [score({ category_id: 'cat-1', points: 3 })],
    });

    expect(page.text()).toContain('2.2');
    expect(page.text()).toContain('רק את מנקדת');
  });

  it('says nothing once the paper is fully scored', () => {
    const page = render({ criterionScores: [score({ points: 3 })] });

    expect(page.fixture.nativeElement.querySelector('.blocking')).toBeNull();
  });
});

/**
 * The model's reasoning for each score.
 *
 * Asked for after she tested the form: "שעל כל פרמטר יהיה לו גם הסבר למה הוא
 * נותן את הציון הזה... כדי שנוכל לעקוב אחרי הרציונל שלו". Distinct from the
 * comments, which are hers, and from the change note, which only speaks about
 * movement between rounds.
 */
describe('why a criterion got its score', () => {
  it('shows the explanation, attributed to the system rather than to her', () => {
    const page = render({
      criterionScores: [score({ points: 3, rationale: 'רק שניים מהמקורות פורסמו בעשור האחרון.' })],
    });
    page.click('.section-head');

    expect(page.text()).toContain('רק שניים מהמקורות');
    // Every other sentence on this screen is one she wrote. This one is not,
    // and unlabelled it would read as hers.
    expect(page.text()).toContain('ההסבר של המערכת');
  });

  it('says nothing where the model gave no reasoning', () => {
    const page = render({ criterionScores: [score({ points: 3, rationale: null })] });
    page.click('.section-head');

    expect(page.fixture.nativeElement.querySelector('.rationale')).toBeNull();
  });

  /**
   * The honesty rule. An explanation of 5 sitting under a 7 she typed herself
   * reads as a justification of her number, in a voice that never made that
   * judgement.
   */
  it('flags an explanation she has since scored over', () => {
    const page = render({
      criterionScores: [
        score({ points: 4, rationale: 'שני מקורות בלבד עדכניים.', rationale_points: 2 }),
      ],
    });
    page.click('.section-head');

    expect(page.text()).toContain('נכתב לניקוד 2');
    expect(page.fixture.nativeElement.querySelector('.rationale-stale')).not.toBeNull();
  });

  it('does not flag one that still matches the score', () => {
    const page = render({
      criterionScores: [score({ points: 3, rationale: 'הסבר', rationale_points: 3 })],
    });
    page.click('.section-head');

    expect(page.fixture.nativeElement.querySelector('.rationale-stale')).toBeNull();
  });

  /**
   * Her own edit keeps the reasoning but does not re-point it at her number —
   * so the moment she overrides a score, the explanation is marked as written
   * for the old one rather than silently adopted.
   */
  it('marks the explanation stale the moment she overrides the score', () => {
    const page = render({
      criterionScores: [score({ points: 3, rationale: 'הסבר', rationale_points: 3 })],
    });
    page.click('.section-head');

    const input = page.fixture.nativeElement.querySelector('.points') as HTMLInputElement;
    input.value = '4';
    input.dispatchEvent(new Event('change'));
    page.fixture.detectChanges();

    expect(page.text()).toContain('נכתב לניקוד 3');
  });
});

/**
 * Her reply to the model's reasoning.
 *
 * "אם הוא אומר, זה הסיבה שנתתי ציון כזה וכזה, אז אני אולי יכולה להגיב לו...
 * שתהיה אופציה כזאת, למשא ומתן כזה."
 *
 * Kept beside the rationale rather than replacing it: a disagreement needs
 * both halves on the page, or there is no way to tell whose voice is whose.
 */
describe('replying to the reasoning', () => {
  function open(over = {}) {
    const page = render({
      criterionScores: [score({ points: 3, rationale: 'רק שניים מהמקורות עדכניים.', ...over })],
    });
    page.click('.section-head');
    return page;
  }

  function type(page: ReturnType<typeof render>, text: string) {
    const box = page.fixture.nativeElement.querySelector('.reply-box') as HTMLTextAreaElement;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    page.fixture.detectChanges();
  }

  it('offers to answer the explanation', () => {
    const page = open();

    expect(page.text()).toContain('להגיב להסבר');
  });

  /** With no reasoning to answer, it is a note of her own, not a reply. */
  it('offers a plain note where the model said nothing', () => {
    const page = render({ criterionScores: [score({ points: 3, rationale: null })] });
    page.click('.section-head');

    expect(page.text()).toContain('הוספת הערה');
  });

  it('keeps what she writes, attributed to her', () => {
    const page = open();

    page.click('.reply-open');
    type(page, 'שניים מספיקים בפרק הזה, זה נושא ותיק.');
    page.click('.reply-actions button');

    expect(page.store.criterionScores(SUBMISSION_ID)[0].teacher_note).toBe(
      'שניים מספיקים בפרק הזה, זה נושא ותיק.',
    );
    expect(page.text()).toContain('התגובה שלי');
  });

  /**
   * Both halves stay on the page. Replacing the rationale with her answer
   * would erase the thing she was answering.
   */
  it('leaves the model’s reasoning standing beside it', () => {
    const page = open();

    page.click('.reply-open');
    type(page, 'לא מסכימה.');
    page.click('.reply-actions button');

    expect(page.text()).toContain('רק שניים מהמקורות עדכניים.');
    expect(page.text()).toContain('לא מסכימה.');
  });

  it('opens on what she wrote last, so editing is the same control', () => {
    const page = open({ teacher_note: 'הערה קודמת' });

    page.click('.reply .btn');
    const box = page.fixture.nativeElement.querySelector('.reply-box') as HTMLTextAreaElement;

    expect(box.value).toBe('הערה קודמת');
  });

  it('lets her take it back', () => {
    const page = open({ teacher_note: 'הערה קודמת' });

    page.click('.reply .btn');
    page.click('.reply-actions button:last-child');

    expect(page.store.criterionScores(SUBMISSION_ID)[0].teacher_note).toBeNull();
  });

  /**
   * The loss that would be invisible. A re-run rewrites the score and the
   * rationale; if it took her note with them she would only find out by
   * looking for something she wrote and not finding it.
   */
  it('survives a generated pass rewriting the score', () => {
    const page = open({ teacher_note: 'שניים מספיקים כאן.' });
    const category = page.store.gradingCategories()[0];

    page.store.applyCriterionScores(SUBMISSION_ID, 2, [
      { categoryId: category.id, points: 2, note: 'ירד', rationale: 'הסבר חדש' },
    ]);

    expect(page.store.criterionScores(SUBMISSION_ID)[0].teacher_note).toBe('שניים מספיקים כאן.');
  });

  /** And survives her own edit of the score, for the same reason. */
  it('survives her changing the score by hand', () => {
    const page = open({ teacher_note: 'שניים מספיקים כאן.' });
    const category = page.store.gradingCategories()[0];

    page.store.setCriterionScore(SUBMISSION_ID, category.id, 4);

    expect(page.store.criterionScores(SUBMISSION_ID)[0].teacher_note).toBe('שניים מספיקים כאן.');
  });
});

/**
 * The model answering back.
 *
 * The half that turns a note into "משא ומתן כזה". These cover the rules that
 * keep it a negotiation rather than a takeover — an answer that quietly
 * overwrote her own judgement would be the opposite of what she asked for.
 */
describe('what the model’s answer may and may not change', () => {
  const CATEGORY = 'cat-1';

  function scored(over = {}) {
    return render({
      criterionScores: [
        score({ points: 3, rationale: 'שני מקורות בלבד.', rationale_points: 3, ...over }),
      ],
    });
  }

  it('records the answer and the score it revised', () => {
    const page = scored();

    page.store.applyCriterionReply(SUBMISSION_ID, CATEGORY, {
      reply: 'צודקת, המקור מ־2019 עדיין נחשב עדכני בתחום.',
      points: 4,
      rationale: 'שלושה מקורות עדכניים.',
    });

    const after = page.store.criterionScores(SUBMISSION_ID)[0];
    expect(after.model_reply).toContain('צודקת');
    expect(after.points).toBe(4);
    // The reasoning follows the score it explains, so nothing goes stale.
    expect(after.rationale_points).toBe(4);
  });

  it('keeps the previous score, so the change is still traceable', () => {
    const page = scored();

    page.store.applyCriterionReply(SUBMISSION_ID, CATEGORY, {
      reply: 'משנה ל־4.',
      points: 4,
      rationale: 'הסבר חדש',
    });

    expect(page.store.criterionScores(SUBMISSION_ID)[0].previous_points).toBe(3);
  });

  /**
   * The rule that matters most. She overrode this score by hand; being talked
   * out of it by the thing she was arguing with is exactly backwards.
   */
  it('never overwrites a score she set herself', () => {
    const page = scored({ edited_by_teacher: true, points: 4 });

    page.store.applyCriterionReply(SUBMISSION_ID, CATEGORY, {
      reply: 'אני עדיין חושב 2.',
      points: 2,
      rationale: 'הסבר משלו',
    });

    const after = page.store.criterionScores(SUBMISSION_ID)[0];
    expect(after.points).toBe(4);
    // Its answer is still recorded — she asked for its opinion, and it gave one.
    expect(after.model_reply).toContain('עדיין חושב');
  });

  it('marks a score it revised as a draft, not as settled', () => {
    const page = scored();

    page.store.applyCriterionReply(SUBMISSION_ID, CATEGORY, {
      reply: 'משנה',
      points: 4,
      rationale: 'הסבר',
    });

    // She asked it to reconsider, not to decide.
    expect(page.store.criterionScores(SUBMISSION_ID)[0].status).toBe('draft');
  });

  it('is allowed to hold its ground', () => {
    const page = scored();

    page.store.applyCriterionReply(SUBMISSION_ID, CATEGORY, {
      reply: 'עדיין נראה לי ששניים מהם מיושנים, בעמוד 4.',
      points: 3,
      rationale: 'שני מקורות בלבד.',
    });

    const after = page.store.criterionScores(SUBMISSION_ID)[0];
    expect(after.points).toBe(3);
    expect(after.model_reply).toContain('עדיין נראה לי');
  });

  /**
   * An answer to a sentence she has since rewritten is not stale, it is wrong:
   * it puts words in the model's mouth about an objection it never read.
   */
  it('drops the answer when she rewrites the note it was answering', () => {
    const page = scored({ teacher_note: 'הערה ראשונה' });
    page.store.applyCriterionReply(SUBMISSION_ID, CATEGORY, {
      reply: 'תשובה להערה הראשונה',
      points: 3,
      rationale: 'הסבר',
    });

    page.store.setCriterionNote(SUBMISSION_ID, CATEGORY, 'הערה אחרת לגמרי');

    expect(page.store.criterionScores(SUBMISSION_ID)[0].model_reply).toBeNull();
  });

  it('keeps the answer when she saves the same note again', () => {
    const page = scored({ teacher_note: 'הערה' });
    page.store.applyCriterionReply(SUBMISSION_ID, CATEGORY, {
      reply: 'תשובה',
      points: 3,
      rationale: 'הסבר',
    });

    page.store.setCriterionNote(SUBMISSION_ID, CATEGORY, 'הערה');

    expect(page.store.criterionScores(SUBMISSION_ID)[0].model_reply).toBe('תשובה');
  });

  it('shows the answer, attributed to it', () => {
    const page = scored({ teacher_note: 'לא מסכימה', model_reply: 'צודקת בחלק מזה.' });
    page.click('.section-head');

    expect(page.text()).toContain('התשובה שלו');
    expect(page.text()).toContain('צודקת בחלק מזה.');
  });
});
