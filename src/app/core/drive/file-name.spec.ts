import { Student } from '../models';
import { normaliseName, parseSubmissionName, searchPrefixes } from './file-name';

/**
 * `שם התלמידה - שם העבודה`, and nothing looser.
 *
 * This is what stands in, for a shared document, for the assertion a folder
 * makes. A file in the year folder was put there on purpose; "Shared with me"
 * holds memos, colleagues' drafts and years of paperwork, so the name has to
 * carry the claim instead — and carry it exactly, because the cost of a wrong
 * match is a colleague's document taking over a student's submission and
 * overwriting the text her comments are anchored to.
 */

function student(id: string, full_name: string, active = true): Student {
  return {
    id,
    teacher_id: 't',
    full_name,
    email: null,
    class_name: null,
    drive_account_email: null,
    notes: null,
    active,
    created_at: '',
    updated_at: '',
  };
}

const ROSTER = [
  student('s1', 'נועה ברקוביץ׳'),
  student('s2', 'שירה אלמוג'),
  student('s3', 'בת-אל כהן'),
  student('s4', 'Maya Levin'),
];

describe('reading a file name', () => {
  it('reads the student and the work', () => {
    const parsed = parseSubmissionName('נועה ברקוביץ׳ - עבודת גמר', ROSTER);
    expect(parsed?.student.id).toBe('s1');
    expect(parsed?.work).toBe('עבודת גמר');
  });

  it('takes the work exactly as she wrote it, whatever it says', () => {
    const parsed = parseSubmissionName('שירה אלמוג - טיוטה 2, סופי סופי (1)', ROSTER);
    expect(parsed?.student.id).toBe('s2');
    expect(parsed?.work).toBe('טיוטה 2, סופי סופי (1)');
  });

  it('accepts the dashes people actually type', () => {
    for (const dash of ['-', '–', '—', '‒']) {
      expect(parseSubmissionName(`שירה אלמוג ${dash} עבודה`, ROSTER)?.student.id).toBe('s2');
    }
    // And with no spaces around it.
    expect(parseSubmissionName('שירה אלמוג-עבודה', ROSTER)?.student.id).toBe('s2');
  });

  /**
   * The reason every separator is tried rather than only the first. Splitting
   * blindly at the first dash looks for a student called `בת`.
   */
  it('handles a dash inside the name itself', () => {
    const parsed = parseSubmissionName('בת-אל כהן - עבודת גמר', ROSTER);
    expect(parsed?.student.id).toBe('s3');
    expect(parsed?.work).toBe('עבודת גמר');
  });

  it('ignores which apostrophe she used', () => {
    expect(parseSubmissionName("נועה ברקוביץ' - עבודה", ROSTER)?.student.id).toBe('s1');
    expect(parseSubmissionName('נועה ברקוביץ - עבודה', ROSTER)?.student.id).toBe('s1');
  });

  it('trims a file extension off the work rather than showing it', () => {
    expect(parseSubmissionName('שירה אלמוג - עבודת גמר.docx', ROSTER)?.work).toBe('עבודת גמר');
  });

  // -- and everything it must refuse ---------------------------------------

  it('refuses a name that is not on the roster', () => {
    expect(parseSubmissionName('רינה המורה - הערכה', ROSTER)).toBeNull();
  });

  /**
   * The match this whole file exists to prevent. The folder matcher would
   * accept it — a student's name appearing anywhere in the file name is
   * enough there, because the folder already vouched for the file.
   */
  it('refuses a document that merely mentions a student', () => {
    expect(parseSubmissionName('הערכת מורה — נועה ברקוביץ׳', ROSTER)).toBeNull();
    expect(parseSubmissionName('ציונים של נועה ברקוביץ׳ - סופי', ROSTER)).toBeNull();
  });

  it('refuses a name with no dash at all', () => {
    expect(parseSubmissionName('נועה ברקוביץ׳ עבודת גמר', ROSTER)).toBeNull();
  });

  it('refuses a name with nothing after the dash', () => {
    expect(parseSubmissionName('נועה ברקוביץ׳ - ', ROSTER)).toBeNull();
    expect(parseSubmissionName('נועה ברקוביץ׳-', ROSTER)).toBeNull();
  });

  it('refuses a partial name', () => {
    expect(parseSubmissionName('נועה - עבודה', ROSTER)).toBeNull();
    expect(parseSubmissionName('ברקוביץ׳ - עבודה', ROSTER)).toBeNull();
  });

  /** Two girls with the same name is a coin toss, so it is refused. */
  it('refuses an ambiguous roster rather than guessing', () => {
    const twins = [...ROSTER, student('s5', 'שירה אלמוג')];
    expect(parseSubmissionName('שירה אלמוג - עבודה', twins)).toBeNull();
  });

  it('handles an empty or missing name', () => {
    expect(parseSubmissionName('', ROSTER)).toBeNull();
    expect(parseSubmissionName(undefined, ROSTER)).toBeNull();
    expect(parseSubmissionName('נועה ברקוביץ׳ - עבודה', [])).toBeNull();
  });
});

describe('what Drive is asked for', () => {
  /**
   * Given names, not full names, and deliberately.
   *
   * The prefix match is literal, so a surname written with a different
   * apostrophe than the roster uses would return nothing at all — which looks
   * exactly like "nobody shared anything". The strict parse refuses whatever
   * extra comes back.
   */
  it('asks by given name, once each', () => {
    const prefixes = searchPrefixes(ROSTER);
    expect(prefixes).toContain('נועה');
    expect(prefixes).toContain('בת-אל');
    expect(prefixes).toContain('Maya');
    expect(prefixes).not.toContain('ברקוביץ׳');
  });

  it('does not ask about students who left', () => {
    const roster = [...ROSTER, student('s9', 'תמר קסטן', false)];
    expect(searchPrefixes(roster)).not.toContain('תמר');
  });

  it('asks once for two students who share a given name', () => {
    const roster = [student('a', 'יעל דהן'), student('b', 'יעל שרעבי')];
    expect(searchPrefixes(roster)).toEqual(['יעל']);
  });
});

describe('normaliseName', () => {
  /** Dashes survive it — they are the separator the parser splits on. */
  it('keeps the dash it is asked to split on', () => {
    expect(normaliseName('בת-אל כהן')).toContain('-');
  });

  it('collapses whitespace and drops apostrophes', () => {
    expect(normaliseName('  נועה   ברקוביץ׳ ')).toBe('נועה ברקוביץ');
  });
});
