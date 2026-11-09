import { isRealDay } from '../dates/hebrew-date';
import { SheetCell, readSheet } from '../import/xlsx';

export const MAX_TASKS = 16;

/**
 * What a date cell turned out to be.
 *
 * Never a guess. 03/04/2027 is the 3rd of April or the 4th of March, and a wrong
 * deadline is worse than a blank one, so it comes back as both for her to choose.
 */
export type ReadDate =
  | { kind: 'ok'; iso: string }
  | { kind: 'empty' }
  | { kind: 'ambiguous'; raw: string; options: [string, string] }
  | { kind: 'unreadable'; raw: string };

export interface ImportedTask {
  title: string;
  date: ReadDate;
}

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

export function readTaskDate(cell: SheetCell | undefined): ReadDate {
  const raw = cell?.text.trim() ?? '';
  if (!raw) return { kind: 'empty' };

  // A real date cell: Excel stores days since the end of 1899. 2000 to 2100 only,
  // so a stray number in the column is not taken for a date.
  if (cell?.numeric && /^\d+(\.\d+)?$/.test(raw)) {
    const serial = Math.floor(Number(raw));
    if (serial < 36526 || serial > 73050) return { kind: 'unreadable', raw };
    return {
      kind: 'ok',
      iso: new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10),
    };
  }

  const dashed = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dashed) {
    const value = iso(Number(dashed[1]), Number(dashed[2]), Number(dashed[3]));
    return isRealDay(value) ? { kind: 'ok', iso: value } : { kind: 'unreadable', raw };
  }

  const written = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!written) return { kind: 'unreadable', raw };

  const [first, second, year] = [Number(written[1]), Number(written[2]), Number(written[3])];
  const dayFirst = iso(year, second, first);
  const monthFirst = iso(year, first, second);
  const dayFirstReal = second <= 12 && isRealDay(dayFirst);
  const monthFirstReal = first <= 12 && isRealDay(monthFirst);

  if (dayFirstReal && monthFirstReal && first !== second) {
    return { kind: 'ambiguous', raw, options: [dayFirst, monthFirst] };
  }
  if (dayFirstReal) return { kind: 'ok', iso: dayFirst };
  if (monthFirstReal) return { kind: 'ok', iso: monthFirst };
  return { kind: 'unreadable', raw };
}

/**
 * Tasks and dates from a sheet, in the order they appear.
 *
 * A header row is optional. Without one, the first column is the task and the
 * second the date.
 */
export function tasksFromSheet(rows: readonly (readonly SheetCell[])[]): {
  tasks: ImportedTask[];
  /** Rows past the limit, which are not imported. */
  overflow: number;
} {
  let titleColumn = 0;
  let dateColumn = 1;
  let body = rows;

  const header = rows[0]?.map((cell) => cell?.text ?? '') ?? [];
  const named = (pattern: RegExp) => header.findIndex((text) => pattern.test(text));
  const titleHeader = named(/משימה|מטלה|הגשה|שם/);
  const dateHeader = named(/תאריך|מועד/);
  if (dateHeader >= 0 || titleHeader >= 0) {
    if (titleHeader >= 0) titleColumn = titleHeader;
    if (dateHeader >= 0) dateColumn = dateHeader;
    body = rows.slice(1);
  }

  const all = body
    .map((row) => ({
      title: row[titleColumn]?.text.trim() ?? '',
      date: readTaskDate(row[dateColumn]),
    }))
    .filter((task) => task.title || task.date.kind !== 'empty');

  return { tasks: all.slice(0, MAX_TASKS), overflow: Math.max(0, all.length - MAX_TASKS) };
}

export async function readTaskFile(data: ArrayBuffer) {
  return tasksFromSheet(await readSheet(data));
}
