import { parseRubricParagraphs } from './rubric';

/**
 * Read against her real form, line for line.
 *
 * These are the paragraphs as they actually come out of
 * `תבנית טופס ציון פז.docx` — the run-together `והתקציר10`, the missing space
 * in `1.2בעל`, the stray `:_` in 3.4, the fill-in rules of different lengths.
 * A tidied-up fixture would pass while the real document failed, which is the
 * only outcome that matters here.
 */
const HER_FORM = [
  'קריטריונים להערכת עבודה מחקרית/סמינריונית ל- B.Ed.',
  'המנחה: ד"ר ליאורה חייביתאריך:',
  'שם התלמידה: שם העבודה:',
  'הערות ותיקונים נדרשים',
  '1. נושא העבודה והתקציר10 נקודות',
  '1.1 נושא ממוקד _______________________________________________(3)___ נקודות',
  '1.2בעל מסר חברתי/ערכי/לימודי_______________________________________________(2)_____ נקודות',
  '1.3מקוריות וחידוש______________________________________________(3)_____ נקודות',
  '1.4 תקציר ______________________________________________ ____(2)_____נקודות',
  'סה"כ _________ נקודות',
  '2. פרק תאורטי 42 נקודות',
  '2.1 סקירה של מחקר מגוון רלוונטי, ועדכני בתחום שאלת המחקר:________________(8)____ נקודות',
  '2.2 שילוב מקורות חב"ד בהשקפה חסידית ________________________ ____(3)____ נקודות',
  '2.3 חקר וניתוח של מקורות: _______________________________________(7)_____ נקודות',
  '2.4 בהירות הגדרת השערות ומשתנים __________________________________(8)____ נקודות',
  '2.5 מבנה וקוהרנטיות - ______________________________________ __(8)____ נקודות',
  '2.6 ביבליוגרפיה עדכנית ותואמת בין הרשימה לגוף העבודה: - ______________(8) ___ נקודות',
  'סה"כ________ נקודות',
  '3. פרק מחקרי43 נקודות',
  '3.1 טיב והיקף המדגם- _____________________________________________(8)___ נקודות',
  '3.2 איכות כלי המחקר______________________________________________(8)__ נקודות',
  '3.3 דווח והצגת נתונים: ___________________________________________(8)_____ נקודות',
  '3.4 שמוש בכלים סטטיסטיים:_ ________________________________________(6) נקודות',
  '3.5 דיון ומסקנות (עומק והשלכות):__ __________________________________(13)___ נקודות',
  'סה"כ _________ נקודות',
  '4. דרך ההגשה5 נקודות',
  '4.1 כתיבה בעברית תקנית__________________________________________(3)_____ נקודות',
  '4.2 הגשה נאה___________________________________________________(2)____ נקודות',
  'ציון העבודה:_____________________',
  'חישוב הציון הסופי:',
  '1. .פרזנטציה (10%)_______________',
  '2.מטלות שוטפות (25%)___________',
  '3. ציון העבודה (65%)____________',
  'ציון סופי:_______________',
  'תאריך: חתימת המנחה: ל.ו. חייבי',
  'בסיכום: [ ]לאשר[ ]לא לאשר[ ]להגיש שנית לאחר תיקונים',
];

describe('reading her rubric out of the form', () => {
  const rubric = parseRubricParagraphs(HER_FORM);

  it('reads all seventeen criteria', () => {
    expect(rubric.criteria.length).toBe(17);
  });

  it('adds up to 100', () => {
    expect(rubric.totalPoints).toBe(100);
  });

  /**
   * The whole point of reading rather than retyping. Seventeen numbers typed by
   * hand is seventeen chances to be quietly wrong.
   */
  it('gets each section right', () => {
    const bySection = new Map<string, number>();
    for (const c of rubric.criteria) {
      bySection.set(c.section, (bySection.get(c.section) ?? 0) + c.maxPoints);
    }

    expect(bySection.get('נושא העבודה והתקציר')).toBe(10);
    expect(bySection.get('פרק תאורטי')).toBe(42);
    expect(bySection.get('פרק מחקרי')).toBe(43);
    expect(bySection.get('דרך ההגשה')).toBe(5);
  });

  it('keeps her numbering, because she refers to criteria by it', () => {
    expect(rubric.criteria.map((c) => c.code).slice(0, 5)).toEqual([
      '1.1',
      '1.2',
      '1.3',
      '1.4',
      '2.1',
    ]);
  });

  /** The awkward lines, each one a real thing her document does. */
  it('reads a criterion with no space after its number', () => {
    const c = rubric.criteria.find((x) => x.code === '1.2');
    expect(c?.name).toBe('בעל מסר חברתי/ערכי/לימודי');
    expect(c?.maxPoints).toBe(2);
  });

  it('strips the fill-in rule and the trailing word from the name', () => {
    expect(rubric.criteria.find((x) => x.code === '4.1')?.name).toBe('כתיבה בעברית תקנית');
    expect(rubric.criteria.find((x) => x.code === '3.2')?.name).toBe('איכות כלי המחקר');
  });

  it('strips a stray single underscore welded to the name', () => {
    expect(rubric.criteria.find((x) => x.code === '3.4')?.name).toBe('שמוש בכלים סטטיסטיים');
  });

  it('keeps brackets that are part of the name, not the points', () => {
    const c = rubric.criteria.find((x) => x.code === '3.5');
    expect(c?.name).toBe('דיון ומסקנות (עומק והשלכות)');
    expect(c?.maxPoints).toBe(13);
  });

  it('does not mistake a criterion for a section', () => {
    expect(rubric.sections.map((s) => s.code)).toEqual(['1', '2', '3', '4']);
  });

  /**
   * The weighting block is numbered `1.` `2.` `3.` exactly like the sections,
   * two lines below the rubric. Read as criteria it would add three phantom
   * entries; read as sections it would wipe the real ones.
   */
  it('reads the final-grade weighting and keeps it out of the rubric', () => {
    expect(rubric.weights).toEqual([
      { name: 'פרזנטציה', percent: 10 },
      { name: 'מטלות שוטפות', percent: 25 },
      { name: 'ציון העבודה', percent: 65 },
    ]);
    expect(rubric.criteria.some((c) => c.name.includes('פרזנטציה'))).toBe(false);
  });

  it('finds nothing to complain about in her form', () => {
    expect(rubric.warnings).toEqual([]);
  });

  it('takes the title', () => {
    expect(rubric.title).toContain('קריטריונים להערכת עבודה');
  });
});

describe('when the rubric does not add up', () => {
  /**
   * Reported rather than silently accepted. A form scored out of 97 produces
   * grades that are wrong by three points and look completely ordinary.
   */
  it('says so when a section total disagrees with its criteria', () => {
    const rubric = parseRubricParagraphs([
      '2. פרק תאורטי 42 נקודות',
      '2.1 סקירה ______(8)__ נקודות',
      '2.2 מקורות ______(3)__ נקודות',
    ]);

    expect(rubric.warnings.some((w) => w.includes('42'))).toBe(true);
    expect(rubric.warnings.some((w) => w.includes('11'))).toBe(true);
  });

  it('says so when the whole form is not 100', () => {
    const rubric = parseRubricParagraphs(['1. פרק 9 נקודות', '1.1 סעיף ______(9)__ נקודות']);

    expect(rubric.warnings.some((w) => w.includes('ולא 100'))).toBe(true);
  });

  it('names a criterion whose points it could not find', () => {
    const rubric = parseRubricParagraphs(['1. פרק 10 נקודות', '1.1 סעיף בלי ניקוד ______ נקודות']);

    expect(rubric.criteria).toEqual([]);
    expect(rubric.warnings.some((w) => w.includes('1.1'))).toBe(true);
  });

  it('says so when the weighting does not reach 100%', () => {
    const rubric = parseRubricParagraphs(['1. פרזנטציה (10%)__', '2. עבודה (65%)__']);
    expect(rubric.warnings.some((w) => w.includes('75%'))).toBe(true);
  });
});
