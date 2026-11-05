/**
 * Hebrew dates, from a real calendar.
 *
 * Intl's Hebrew calendar does the arithmetic, including leap years and the two
 * Adars; nothing here reckons a date, and the AI model is never asked for one.
 * Days are civil days: the Hebrew day really begins at sunset, but a deadline in
 * this app is a calendar day, so "the evening before" does not exist here.
 */

const MONTHS: Record<string, string> = {
  Tishri: 'תשרי',
  Heshvan: 'חשוון',
  Kislev: 'כסלו',
  Tevet: 'טבת',
  Shevat: 'שבט',
  'Adar I': 'אדר א׳',
  Adar: 'אדר',
  'Adar II': 'אדר ב׳',
  Nisan: 'ניסן',
  Iyar: 'אייר',
  Sivan: 'סיוון',
  Tamuz: 'תמוז',
  Av: 'אב',
  Elul: 'אלול',
};

const PARTS = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export interface HebrewParts {
  day: number;
  /** Intl's English month name, the stable key: "Adar II". */
  monthKey: string;
  month: string;
  year: number;
}

function letters(value: number): string {
  const units = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש'];

  let rest = value % 1000;
  let out = 'ת'.repeat(Math.floor(rest / 400));
  rest %= 400;
  out += hundreds[Math.floor(rest / 100)];
  rest %= 100;
  // 15 and 16 are written ט״ו and ט״ז, since the plain letters spell a divine name.
  if (rest === 15) out += 'טו';
  else if (rest === 16) out += 'טז';
  else out += tens[Math.floor(rest / 10)] + units[rest % 10];

  return out.length === 1 ? `${out}׳` : `${out.slice(0, -1)}״${out.slice(-1)}`;
}

/** The day of a stored value: a plain date, or the date part of a timestamp. */
export function dayOf(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match && isRealDay(match[0]) ? match[0] : null;
}

export function isRealDay(iso: string): boolean {
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

export function hebrewParts(iso: string): HebrewParts | null {
  if (!isRealDay(iso)) return null;
  const parts = PARTS.formatToParts(new Date(`${iso}T12:00:00Z`));
  const read = (type: string) => parts.find((p) => p.type === type)?.value;

  const monthKey = read('month') ?? '';
  const month = MONTHS[monthKey];
  const day = Number(read('day'));
  const year = Number(read('year'));
  // A month this table does not know is refused rather than shown wrong.
  if (!month || !day || !year) return null;
  return { day, monthKey, month, year };
}

/** "כ״ה בכסלו תשפ״ה", or null for something that is not a date. */
export function hebrewDate(iso: string): string | null {
  const parts = hebrewParts(iso);
  return parts && `${letters(parts.day)} ב${parts.month} ${letters(parts.year)}`;
}

export function gregorianDate(iso: string): string | null {
  if (!isRealDay(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return `${day}.${month}.${year}`;
}

/** Both, for places that are one line of text: "כ״ה בכסלו תשפ״ה (26.12.2024)". */
export function dualDateText(value: string | null | undefined): string | null {
  const iso = dayOf(value);
  const hebrew = iso && hebrewDate(iso);
  return hebrew ? `${hebrew} (${gregorianDate(iso!)})` : null;
}

/**
 * Back from Hebrew to Gregorian, as the second check on the first direction.
 * Null when that day does not exist in that year: 30 Heshvan in a short year,
 * or Adar II in a year that is not a leap year.
 */
export function gregorianFromHebrew(year: number, monthKey: string, day: number): string | null {
  // Tishrei of Hebrew year Y falls in September or October of Y - 3761.
  const start = Date.UTC(year - 3761, 7, 15);
  for (let offset = 0; offset < 420; offset += 1) {
    const iso = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    const parts = hebrewParts(iso);
    if (parts && parts.year === year && parts.monthKey === monthKey && parts.day === day) return iso;
  }
  return null;
}

// -- years --------------------------------------------------------------------

/** One year is spelled תשפ״ז, תשפ"ז or תשפז; they must count as one year. */
export function yearKey(label: string): string {
  return label.replace(/["'״׳\s]/g, '');
}

export function hebrewYearLabel(year: number): string {
  return letters(year);
}

/** Last year, this year and the next two: "תשפ״ו, תשפ״ז, תשפ״ח, תשפ״ט". */
export function yearChoices(today: Date = new Date()): string[] {
  const parts = hebrewParts(today.toISOString().slice(0, 10));
  const current = parts?.year ?? 5787;
  return [-1, 0, 1, 2].map((offset) => hebrewYearLabel(current + offset));
}

export function currentYearLabel(today: Date = new Date()): string {
  return yearChoices(today)[1];
}
