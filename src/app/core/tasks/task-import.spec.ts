import { readTaskDate, tasksFromSheet } from './task-import';

const text = (value: string) => ({ text: value, numeric: false });
const number = (value: string) => ({ text: value, numeric: true });

describe('reading a date from the file', () => {
  it('reads a real Excel date cell', () => {
    expect(readTaskDate(number('46023'))).toEqual({ kind: 'ok', iso: '2026-01-01' });
  });

  it('reads an unambiguous written date', () => {
    expect(readTaskDate(text('15/01/2027'))).toEqual({ kind: 'ok', iso: '2027-01-15' });
    expect(readTaskDate(text('2027-01-15'))).toEqual({ kind: 'ok', iso: '2027-01-15' });
    expect(readTaskDate(text('5.5.2027'))).toEqual({ kind: 'ok', iso: '2027-05-05' });
  });

  /** The 3rd of April or the 4th of March: not for the app to decide. */
  it('says a date is ambiguous instead of choosing', () => {
    expect(readTaskDate(text('03/04/2027'))).toEqual({
      kind: 'ambiguous',
      raw: '03/04/2027',
      options: ['2027-04-03', '2027-03-04'],
    });
  });

  it('says what it could not read', () => {
    for (const raw of ['31/02/2027', 'כ״ה בכסלו', 'בסוף הסמסטר', '1/2/27', '13/13/2027']) {
      expect(readTaskDate(text(raw)).kind, raw).toBe('unreadable');
    }
  });

  it('does not take a stray number for a date', () => {
    expect(readTaskDate(number('7')).kind).toBe('unreadable');
  });

  it('allows an empty date', () => {
    expect(readTaskDate(text(' ')).kind).toBe('empty');
    expect(readTaskDate(undefined).kind).toBe('empty');
  });
});

describe('splitting a sheet into tasks', () => {
  it('keeps the order, with no header row', () => {
    const { tasks } = tasksFromSheet([
      [text('נושא'), text('15/10/2026')],
      [text('הצעת מחקר'), text('20/11/2026')],
    ]);

    expect(tasks.map((t) => t.title)).toEqual(['נושא', 'הצעת מחקר']);
  });

  it('follows the header, whichever column comes first', () => {
    const { tasks } = tasksFromSheet([
      [text('תאריך'), text('משימה')],
      [text('15/10/2026'), text('נושא')],
    ]);

    expect(tasks).toEqual([{ title: 'נושא', date: { kind: 'ok', iso: '2026-10-15' } }]);
  });

  it('stops at fifteen and says how many were left out', () => {
    const rows = Array.from({ length: 18 }, (_, i) => [text(`משימה ${i}`)]);
    const { tasks, overflow } = tasksFromSheet([[text('תיאור'), text('אחר')], ...rows]);

    expect(tasks).toHaveLength(15);
    expect(overflow).toBe(4);
  });

  it('skips empty rows', () => {
    const { tasks } = tasksFromSheet([[text('נושא')], [], [text(' ')], [text('הצעה')]]);

    expect(tasks.map((t) => t.title)).toEqual(['נושא', 'הצעה']);
  });
});
