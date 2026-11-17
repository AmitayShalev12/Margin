import { studentsByStage } from './stage-of';

/** All names are invented. */
const tasks = [
  { id: 't1', title: 'שאלת המחקר' },
  { id: 't2', title: 'שאלונים' },
  { id: 't3', title: '5 מאמרים' },
];
const students = [{ id: 'noa' }, { id: 'shira' }, { id: 'dana' }];
const paper = (student_id: string, assignment_id: string) => ({ student_id, assignment_id });

describe('which stage each student is in', () => {
  it('puts her in the furthest stage she handed in, whatever the order', () => {
    const stages = studentsByStage(tasks, students, [
      paper('noa', 't3'),
      paper('noa', 't1'),
      paper('shira', 't1'),
      paper('dana', 't2'),
    ]);

    expect(stages.map((s) => [s.number, s.students.map((x) => x.id)])).toEqual([
      [1, ['shira']],
      [2, ['dana']],
      [3, ['noa']],
    ]);
  });

  it('opens with those who have handed nothing in, only when there are any', () => {
    const stages = studentsByStage(tasks, students, [paper('noa', 't1')]);

    expect(stages[0]).toEqual({
      taskId: null,
      title: 'עוד לא הגישו',
      number: 0,
      students: [{ id: 'shira' }, { id: 'dana' }],
    });
    expect(stages.length).toBe(4);
  });

  it('ignores papers of tasks that are not in this course', () => {
    const stages = studentsByStage(tasks, [{ id: 'noa' }], [paper('noa', 'elsewhere')]);

    expect(stages[0].taskId).toBeNull();
  });
});
