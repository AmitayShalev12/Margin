import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { gradeSheetText, summarise } from '../progress/grade-sheet';
import { SupabaseService } from '../supabase/supabase';
import { SEMINAR_STAGES } from '../tasks/seminar-map';
import { PROPOSED_STAGE_RUBRICS, proposedRubricFor, stageIndexOf } from './stage-rubrics';

/** A rubric per task, and what follows from it. All names are invented. */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
}

function setup() {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  const store = TestBed.inject(DataStore);
  const course = store.createCourse('סמינריון', 'תשפ״ז')!;
  const question = store.addTask('שאלת המחקר', null)!;
  const surveys = store.addTask('שאלונים', null)!;
  const final = store.addTask('הגשת העבודה המלאה המתוקנת לציון', null)!;
  const other = store.addTask('משימה משלה', null)!;
  const noa = store.addStudent('נועה כהן', 'noa@example.com', [course.id])!;
  return { store, course, question, surveys, final, other, noa };
}

const paper = (store: DataStore, studentId: string, assignmentId: string) =>
  store.addUploadedSubmission({
    studentId,
    assignmentId,
    title: null,
    blocks: [{ id: 'b1', index: 0, type: 'paragraph', text: 'פסקה' }],
    text: 'פסקה',
    fileName: 'a.docx',
  })!;

describe('the proposed rubric', () => {
  it('gives each of the first fifteen stages exactly 100 points, and the last none of its own', () => {
    expect(PROPOSED_STAGE_RUBRICS.length).toBe(SEMINAR_STAGES.length);
    const totals = PROPOSED_STAGE_RUBRICS.map((lines) => lines.reduce((sum, l) => sum + l.points, 0));
    expect(totals.slice(0, 15)).toEqual(Array(15).fill(100));
    expect(totals[15]).toBe(0);
  });

  it('finds a task s stage by its name, whole or before the colon', () => {
    expect(stageIndexOf('שאלת המחקר')).toBe(0);
    expect(stageIndexOf('  פרק ב׳: שיטת המחקר ')).toBe(7);
    expect(stageIndexOf('פרק ד׳')).toBe(12);
    expect(stageIndexOf('משהו אחר')).toBe(-1);
    expect(proposedRubricFor('משהו אחר')).toEqual([]);
  });
});

describe('a rubric per task', () => {
  it('loads the proposal only into tasks that are stages and have no rubric yet', () => {
    const { store, question, surveys, final, other } = setup();
    store.addStageCriterion(surveys.id, 'משלה', 100);

    expect(store.applyProposedRubrics()).toBe(1);

    expect(store.stageRubric(question.id).map((c) => c.max_points)).toEqual([30, 20, 30, 20]);
    expect(store.stageRubric(surveys.id).map((c) => c.name)).toEqual(['משלה']);
    expect(store.stageRubric(final.id)).toEqual([]);
    expect(store.stageRubric(other.id)).toEqual([]);
    // Loading it again changes nothing.
    expect(store.applyProposedRubrics()).toBe(0);
  });

  it('scores a paper against its task s rubric, and the general one when the task has none', () => {
    const { store, question, final } = setup();
    store.applyProposedRubrics();
    const general = store.gradingCategories().map((c) => c.id);

    expect(store.rubricFor(question.id).map((c) => c.max_points)).toEqual([30, 20, 30, 20]);
    expect(store.rubricFor(final.id).map((c) => c.id)).toEqual(general);
    // The course's general form is not touched by any task's rubric.
    expect(store.gradingCategories().some((c) => c.assignment_id)).toBe(false);
  });

  it('lets her change, add and remove lines', () => {
    const { store, question } = setup();
    store.applyProposedRubrics();
    const [first, second] = store.stageRubric(question.id);

    expect(store.editStageCriterion(first.id, { name: '  נושא ממוקד ', points: 35.4 })).toBe(true);
    expect(store.editStageCriterion(first.id, { name: '  ' })).toBe(false);
    store.removeStageCriterion(second.id);
    store.addStageCriterion(question.id, 'שורה חדשה', 250);

    expect(store.stageRubric(question.id).map((c) => [c.name, c.max_points])).toEqual([
      ['נושא ממוקד', 35],
      ['מקוריות וחידוש', 30],
      ['ניסוח כשאלת קשר בין משתנים ברי־מדידה (לא שאלת כן/לא)', 20],
      ['שורה חדשה', 100],
    ]);
  });

  it('totals a paper from the scores given so far', () => {
    const { store, question, noa } = setup();
    store.applyProposedRubrics();
    const p = paper(store, noa.id, question.id);
    const [a, b] = store.stageRubric(question.id);

    expect(store.paperScore(p.id)).toBeNull();
    store.setCriterionScore(p.id, a.id, 24);
    store.setCriterionScore(p.id, b.id, 20);

    expect(store.paperScore(p.id)).toEqual({ points: 44, outOf: 50 });
  });

  it('copies rubrics from another course task by task, keeping what is already here', () => {
    const { store, course, question } = setup();
    store.applyProposedRubrics();
    const next = store.createCourse('סמינריון', 'תשפ״ח')!;
    const sameName = store.addTask('שאלת המחקר', null)!;
    const renamed = store.addTask('שאלונים ומדדים', null)!;
    store.addStageCriterion(renamed.id, 'כבר שלה', 100);

    expect(store.coursesWithStageRubrics().map((c) => c.id)).toEqual([course.id]);
    expect(store.copyStageRubrics(course.id)).toBe(1);

    expect(store.stageRubric(sameName.id).map((c) => c.max_points)).toEqual([30, 20, 30, 20]);
    expect(store.stageRubric(renamed.id).map((c) => c.name)).toEqual(['כבר שלה']);
    // Copies, not the same rows: changing one course leaves the other alone.
    store.editStageCriterion(store.stageRubric(sameName.id)[0].id, { points: 5 });
    expect(next.id).not.toBe(course.id);
    store.selectCourse(course.id);
    expect(store.stageRubric(question.id)[0].max_points).toBe(30);
  });
});

describe('rule groups', () => {
  it('starts with the three built in, and lets her rename, add and remove', () => {
    const { store } = setup();
    expect(store.ruleGroups().map((g) => g.key)).toEqual(['work', 'ministry', 'own']);

    expect(store.renameRuleGroup('work', 'כללי הסמינריון')).toBe(true);
    expect(store.renameRuleGroup('ministry', 'כללי הסמינריון')).toBe(false);
    const made = store.addRuleGroup('ציטוט ומקורות')!;
    expect(store.addRuleGroup(' ')).toBeNull();
    store.addCourseRule('language', 'כל טענה נשענת על מקור.', 'teacher', 'course', made.key);

    expect(store.ruleGroups().map((g) => g.title)).toEqual([
      'כללי הסמינריון',
      'כללי משרד החינוך',
      'הכללים שלי',
      'ציטוט ומקורות',
    ]);
    // A group with rules in it stays; an empty one can go.
    expect(store.removeRuleGroup(made.key)).toBe(false);
    expect(store.removeRuleGroup('ministry')).toBe(true);
    expect(store.ruleGroups().length).toBe(3);
  });
});

describe('the grade sheet', () => {
  const rows = [
    { taskId: 't1', number: 1, title: 'שאלת המחקר', paperId: 'p1', handedIn: '1.9.2026', score: { points: 90, outOf: 100 } },
    { taskId: 't2', number: 2, title: 'שאלונים', paperId: 'p2', handedIn: null, score: null },
    { taskId: 't3', number: 3, title: '5 מאמרים', paperId: null, handedIn: null, score: null },
  ];

  it('counts what came in and averages only what was scored', () => {
    expect(summarise(rows)).toEqual({ handedIn: 2, missing: 1, average: 90 });
    expect(summarise([rows[2]]).average).toBeNull();
  });

  it('writes one line per stage, about her alone', () => {
    expect(gradeSheetText({ student: 'נועה כהן', course: 'סמינריון', rows })).toBe(
      [
        'גיליון ציונים: נועה כהן',
        'סמינריון',
        '',
        '1. שאלת המחקר: הוגש (1.9.2026) · 90 מתוך 100',
        '2. שאלונים: הוגש · עוד לא נוקד',
        '3. 5 מאמרים: עוד לא הוגש',
        '',
        'הוגשו 2 מתוך 3 שלבים.',
        'ממוצע השלבים שנוקדו: 90.',
      ].join('\n'),
    );
  });
});
