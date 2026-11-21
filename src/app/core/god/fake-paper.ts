import { DocumentBlock } from '../models';

/**
 * Invented papers for the test screen.
 *
 * Nothing here is a student's writing. The text is made up, with the kinds of
 * slips a first draft has (a claim with no source, a result with no numbers, a
 * sample called random that is not), so that a check has something to find.
 */

export type PaperSize = 'short' | 'medium' | 'long' | 'full';

/** Roughly how many words each size is. `full` is the forty-page paper. */
export const PAPER_WORDS: Record<PaperSize, number> = {
  short: 300,
  medium: 1500,
  long: 4000,
  full: 10000,
};

export const PAPER_LABELS: Record<PaperSize, string> = {
  short: 'קצרה (עמוד)',
  medium: 'בינונית (5 עמודים)',
  long: 'ארוכה (13 עמודים)',
  full: 'מלאה (40 עמודים)',
};

const SECTIONS = [
  'מבוא',
  'רקע תיאורטי',
  'תחושת מסוגלות עצמית',
  'התמדה בלמידה',
  'שאלת המחקר והשערות',
  'שיטת המחקר',
  'משתתפות',
  'כלי המחקר',
  'הליך',
  'תוצאות',
  'דיון',
  'מגבלות המחקר',
  'סיכום ומסקנות',
];

/** Sentences with something to fix in them. */
export const SLIPS = [
  'מחקרים רבים מראים שתחושת מסוגלות משפיעה באופן ישיר על הישגים בלימודים.',
  'אין ספק שהתכנית הוכיחה את עצמה והביאה לשיפור אצל כל המשתתפות.',
  'נמצא קשר חיובי בין תחושת המסוגלות לבין ההתמדה (r = .42).',
  'המדגם נבחר באופן אקראי מבין חברותיי לכיתה שהסכימו למלא את השאלון.',
  'לפי הספרות, מוטיבציה היא הגורם היחיד שמסביר הצלחה בהכשרה להוראה.',
  'הסטודנטיות מרגישים שהתמיכה של המדריכה היא הדבר הכי חשוב בשבילם.',
  'בגלל שהשאלון היה ארוך אז חלק מהמשתתפות לא ענו על כולו.',
  'השאלון נמצא מהימן ולכן אפשר לסמוך על התוצאות שלו.',
  'התוצאות מוכיחות שהשערת המחקר נכונה.',
  'אני חושבת שזה ברור לכולם שסטודנטית שמאמינה בעצמה תצליח יותר.',
  'ממוצע ההתמדה בקבוצת ההתערבות היה גבוה יותר מאשר בקבוצת הביקורת.',
  'כפי שנכתב באינטרנט, רוב הסטודנטיות נושרות בשנה הראשונה.',
];

/** Sentences that are fine as they are. */
const SOUND = [
  'תחושת מסוגלות עצמית מוגדרת כאמונה של אדם ביכולתו לבצע משימה מסוימת (Bandura, 1997).',
  'המחקר הנוכחי בוחן את הקשר בין תחושת מסוגלות לבין התמדה בלמידה אצל סטודנטיות להוראה.',
  'במחקר השתתפו 64 סטודנטיות בשנה השנייה ללימודיהן במכללה להכשרת מורות.',
  'השאלון כלל 24 פריטים בסולם ליקרט בן חמש דרגות.',
  'מהימנות השאלון נבדקה באמצעות אלפא של קרונבך (α = .86).',
  'נמצא מתאם חיובי מובהק בין שני המשתנים (r = .42, p < .01).',
  'הממצא עולה בקנה אחד עם מחקרים קודמים שנערכו בקרב פרחי הוראה (Tschannen-Moran & Hoy, 2001).',
  'מאחר שמדובר במחקר מתאמי, אי אפשר להסיק ממנו על קשר סיבתי.',
  'המשתתפות חתמו על טופס הסכמה מדעת, ונשמרה האנונימיות שלהן.',
  'יש מקום למחקר המשך שיעקוב אחרי אותן סטודנטיות גם בשנת ההתמחות.',
];

/** How each slip reads once she has corrected it. */
const FIXES: Record<string, string> = {
  [SLIPS[0]]:
    'מחקרים מראים שתחושת מסוגלות קשורה להישגים בלימודים (Zimmerman, 2000; Schunk & Pajares, 2009).',
  [SLIPS[1]]: 'בקבוצת ההתערבות נמצא שיפור ממוצע של 0.6 נקודות בסולם ההתמדה.',
  [SLIPS[2]]: 'נמצא קשר חיובי מובהק בין תחושת המסוגלות לבין ההתמדה (r = .42, p < .01).',
  [SLIPS[3]]: 'המדגם היה מדגם נוחות: סטודנטיות מהכיתה שלי שהסכימו למלא את השאלון.',
  [SLIPS[8]]: 'התוצאות תומכות בהשערת המחקר.',
};

const count = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** A small repeatable shuffle, so two students do not hand in the same paper. */
function picker(seed: number) {
  let state = seed % 2147483647 || 1;
  return <T>(items: readonly T[]): T => {
    state = (state * 48271) % 2147483647;
    return items[state % items.length];
  };
}

export interface FakePaper {
  blocks: DocumentBlock[];
  text: string;
  words: number;
}

function assemble(lines: { type: DocumentBlock['type']; text: string; level?: number }[]): FakePaper {
  const blocks = lines.map((line, index) => ({ id: `b${index + 1}`, index, ...line }));
  const text = blocks.map((b) => b.text).join('\n\n');
  return { blocks, text, words: count(text) };
}

/**
 * One invented paper.
 *
 * `seed` decides the wording, so each student and each task gets its own text
 * and asking again for the same one gives the same paper.
 */
export function fakePaper(input: {
  student: string;
  task: string;
  size: PaperSize;
  seed: number;
}): FakePaper {
  const pick = picker(input.seed);
  const target = PAPER_WORDS[input.size];
  const lines: { type: DocumentBlock['type']; text: string; level?: number }[] = [
    { type: 'heading', level: 1, text: input.task },
    { type: 'paragraph', text: `מגישה: ${input.student} (עבודה מומצאת לניסוי)` },
  ];

  let words = 0;
  let paragraph = 0;
  let section = 0;
  // A short paper is one stretch of text; a longer one is divided like a paper.
  const perSection = input.size === 'short' ? Infinity : Math.max(3, Math.round(target / 90 / SECTIONS.length));

  while (words < target) {
    if (perSection !== Infinity && paragraph % perSection === 0) {
      lines.push({ type: 'heading', level: 2, text: SECTIONS[section % SECTIONS.length] });
      section++;
    }
    paragraph++;
    // Every paragraph has one slip among sound sentences, and its own number
    // so that no two paragraphs are the same words.
    const sentences = [pick(SOUND), pick(SLIPS), pick(SOUND), pick(SOUND)];
    const text = `בפסקה ${paragraph} נבחן היבט נוסף של הנושא. ${sentences.join(' ')}`;
    lines.push({ type: 'paragraph', text });
    words += count(text);
  }

  return assemble(lines);
}

/**
 * The same paper after she corrected it: some slips fixed, and a closing line.
 * Some are left as they were on purpose, the way a real second draft is.
 */
export function revisedPaper(blocks: readonly DocumentBlock[]): FakePaper {
  const lines = blocks.map((block) => {
    let text = block.text;
    for (const [slip, fix] of Object.entries(FIXES)) text = text.split(slip).join(fix);
    return { type: block.type, text, ...(block.level === undefined ? {} : { level: block.level }) };
  });
  lines.push({
    type: 'paragraph' as const,
    text: 'תיקנתי את העבודה לפי ההערות: הוספתי מקורות, דיווחתי את רמת המובהקות ותיארתי את המדגם כפי שהוא.',
  });
  return assemble(lines);
}
