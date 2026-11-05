import { LIGHT_ORDER, progressOf } from './traffic-light';

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

  it('stops counting a late paper as missed once it arrives', () => {
    expect(progressOf(tasks, new Set(['topic', 'proposal']), today).missed).toBe(0);
  });

  it('sorts those furthest behind first', () => {
    expect(LIGHT_ORDER).toEqual(['red', 'orange', 'yellow', 'green']);
  });
});
