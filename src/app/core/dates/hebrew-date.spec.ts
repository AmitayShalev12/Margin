import {
  currentYearLabel,
  dualDateText,
  gregorianDate,
  gregorianFromHebrew,
  hebrewDate,
  hebrewParts,
  yearChoices,
  yearKey,
} from './hebrew-date';

/** Checked against dates that can be looked up: festivals and new years. */
describe('known dates', () => {
  const known: [string, string][] = [
    // Year boundaries.
    ['2023-09-15', 'כ״ט באלול תשפ״ג'],
    ['2023-09-16', 'א׳ בתשרי תשפ״ד'],
    ['2025-09-23', 'א׳ בתשרי תשפ״ו'],
    ['2026-09-12', 'א׳ בתשרי תשפ״ז'],
    // A leap year: 5784 has both Adars.
    ['2024-02-10', 'א׳ באדר א׳ תשפ״ד'],
    ['2024-02-23', 'י״ד באדר א׳ תשפ״ד'],
    ['2024-03-11', 'א׳ באדר ב׳ תשפ״ד'],
    ['2024-03-24', 'י״ד באדר ב׳ תשפ״ד'],
    // A plain year: one Adar, and Purim in it.
    ['2023-03-07', 'י״ד באדר תשפ״ג'],
    // Festivals, and the two days written differently.
    ['2024-04-23', 'ט״ו בניסן תשפ״ד'],
    ['2025-04-13', 'ט״ו בניסן תשפ״ה'],
    ['2024-12-26', 'כ״ה בכסלו תשפ״ה'],
    ['2024-04-24', 'ט״ז בניסן תשפ״ד'],
  ];

  for (const [iso, expected] of known) {
    it(`${iso} is ${expected}`, () => expect(hebrewDate(iso)).toBe(expected));
  }
});

describe('converting back', () => {
  it('returns to the same day, for every day across a leap year and its neighbours', () => {
    const start = Date.UTC(2023, 0, 1);
    for (let i = 0; i < 1200; i += 13) {
      const iso = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      const parts = hebrewParts(iso)!;
      expect(gregorianFromHebrew(parts.year, parts.monthKey, parts.day), iso).toBe(iso);
    }
  });

  it('moves forward one day at a time, with no gap or repeat', () => {
    const start = Date.UTC(2023, 8, 1);
    let previous = hebrewParts('2023-08-31')!;
    for (let i = 0; i < 800; i += 1) {
      const parts = hebrewParts(new Date(start + i * 86_400_000).toISOString().slice(0, 10))!;
      if (parts.day !== 1) expect(parts.day).toBe(previous.day + 1);
      else expect([29, 30]).toContain(previous.day);
      previous = parts;
    }
  });

  it('refuses a day that year does not have', () => {
    expect(gregorianFromHebrew(5783, 'Adar II', 1)).toBeNull();
    expect(gregorianFromHebrew(5784, 'Adar I', 1)).toBe('2024-02-10');
  });
});

describe('what is not a date', () => {
  it('stays null rather than becoming one', () => {
    expect(hebrewDate('2025-02-31')).toBeNull();
    expect(hebrewDate('not a date')).toBeNull();
    expect(gregorianDate('2025-13-01')).toBeNull();
    expect(dualDateText(null)).toBeNull();
    expect(dualDateText('')).toBeNull();
  });
});

describe('both together', () => {
  it('reads a timestamp by its date', () => {
    expect(dualDateText('2024-12-26T00:00:00+00:00')).toBe('כ״ה בכסלו תשפ״ה (26.12.2024)');
  });
});

describe('years', () => {
  it('offers last year, this year and the next two', () => {
    expect(yearChoices(new Date('2026-11-05T12:00:00Z'))).toEqual([
      'תשפ״ו',
      'תשפ״ז',
      'תשפ״ח',
      'תשפ״ט',
    ]);
    expect(currentYearLabel(new Date('2026-11-05T12:00:00Z'))).toBe('תשפ״ז');
  });

  it('treats the spellings of a year as one year', () => {
    expect(yearKey('תשפ״ז')).toBe(yearKey('תשפז'));
    expect(yearKey('תשפ"ז')).toBe(yearKey('תשפז'));
  });
});
