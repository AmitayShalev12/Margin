import { LIGHT_ORDER, lateNote, latePapers, progressOf } from './traffic-light';

const tasks = [
  { id: 'topic', due: '2026-10-01' },
  { id: 'proposal', due: '2026-11-01' },
  { id: 'chapter', due: '2026-12-01' },
  { id: 'undated', due: null },
];
const today = '2026-11-05';
const light = (...ids: string[]) => progressOf(tasks, new Set(ids), today).light;

describe('the traffic light', () => {
  it('is red when two deadlines were missed', () => expect(light('chapter')).toBe('red'));
  it('is red when a deadline passed and nothing came in', () => {
    expect(progressOf(tasks.slice(0, 1), new Set(), today).light).toBe('red');
  });
  it('is orange when one was missed and something came in', () => {
    expect(light('topic')).toBe('orange');
  });
  it('is green when nothing is missed', () => expect(light('topic', 'proposal')).toBe('green'));

  it('is yellow when she has not started and nothing is late yet', () => {
    expect(progressOf([{ id: 'a', due: '2027-01-01' }], new Set(), today).light).toBe('yellow');
  });

  it('never counts a task with no date as missed', () => {
    const progress = progressOf([{ id: 'a', due: null }], new Set(), today);
    expect(progress.missed).toBe(0);
    expect(progress.light).toBe('yellow');
  });

  it('does not count a deadline that is today as missed', () => {
    expect(progressOf([{ id: 'a', due: today }], new Set(), today).missed).toBe(0);
  });

  it('stops counting a paper as missing once it arrives', () => {
    expect(progressOf(tasks, new Set(['topic', 'proposal']), today).missed).toBe(0);
  });

  it('sorts those furthest behind first', () => {
    expect(LIGHT_ORDER).toEqual(['red', 'orange', 'yellow', 'green']);
  });
});

describe('a paper handed in late', () => {
  const late = (ids: string[]) => progressOf(tasks, new Set(ids), today, new Set(['topic']));

  it('stays marked late after it arrives', () => {
    const progress = late(['topic', 'proposal']);

    expect(progress.missed).toBe(0);
    expect(progress.late).toBe(1);
    expect(progress.light).toBe('orange');
  });

  it('counts together with a deadline still missed', () => {
    expect(late(['topic']).light).toBe('red');
  });

  const paper = (over: object) => ({
    assignment_id: 'topic',
    created_at: '2026-10-20T10:00:00Z',
    drive_created_at: null,
    status: 'new',
    ...over,
  });

  it('is found by when it was handed in, against its own task', () => {
    expect(latePapers(tasks, [paper({})])).toEqual([{ taskId: 'topic', checked: false }]);
    expect(latePapers(tasks, [paper({ created_at: '2026-10-01T10:00:00Z' })])).toEqual([]);
    expect(latePapers(tasks, [paper({ assignment_id: 'undated' })])).toEqual([]);
  });

  /** Revising after comments must not make a paper late. */
  it('goes by when the Drive file was created, not when it was synced', () => {
    const synced = paper({ drive_created_at: '2026-09-30T10:00:00Z' });

    expect(latePapers(tasks, [synced])).toEqual([]);
  });

  it('says it was handed in and whether it was checked', () => {
    expect(latePapers(tasks, [paper({ status: 'notes_sent' })])[0].checked).toBe(true);
    expect(lateNote('נושא', true)).toBe('נושא: הוגשה באיחור ונבדקה');
    expect(lateNote('נושא', false)).toBe('נושא: הוגשה באיחור, עוד לא נבדקה');
  });
});
