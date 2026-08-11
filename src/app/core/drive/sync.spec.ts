import { Student } from '../models';
import { DriveFile } from './drive-types';
import { matchStudent } from './sync';

function student(
  id: string,
  full_name: string,
  drive_account_email: string | null = null,
): Student {
  return {
    id,
    teacher_id: 't',
    full_name,
    email: null,
    class_name: null,
    drive_account_email,
    notes: null,
    active: true,
    created_at: '',
    updated_at: '',
  };
}

function file(name: string, ownerEmail?: string): DriveFile {
  return {
    id: 'f1',
    name,
    ...(ownerEmail ? { owners: [{ emailAddress: ownerEmail }] } : {}),
  };
}

const ROSTER = [
  student('s1', 'נועה ברקוביץ׳', 'noa.b@school.org.il'),
  student('s2', 'שירה אלמוג'),
  student('s3', 'יעל דהן'),
  student('s4', 'יעל שרעבי'),
];

describe('matchStudent', () => {
  it('prefers the file owner over anything in the name', () => {
    // The file name says one student, the owning account says another.
    const match = matchStudent(file('שירה אלמוג — סמינריון', 'noa.b@school.org.il'), ROSTER);
    expect(match?.id).toBe('s1');
  });

  it('matches the owning account case-insensitively', () => {
    expect(matchStudent(file('work.gdoc', 'NOA.B@School.org.il'), ROSTER)?.id).toBe('s1');
  });

  it('falls back to the file name when the account is unknown', () => {
    expect(matchStudent(file('שירה אלמוג סמינריון'), ROSTER)?.id).toBe('s2');
  });

  it('reads a Latin file name written with separators', () => {
    const roster = [...ROSTER, student('s5', 'Noa Berkovich')];
    expect(matchStudent(file('Noa_Berkovich-SEL_survey_v2.docx'), roster)?.id).toBe('s5');
  });

  it('ignores the geresh so ברקוביץ׳ and ברקוביץ both match', () => {
    expect(matchStudent(file('נועה ברקוביץ סמינריון.docx'), ROSTER)?.id).toBe('s1');
  });

  it('refuses to guess when a first name fits two students', () => {
    // "יעל" alone matches both יעל דהן and יעל שרעבי.
    expect(matchStudent(file('יעל — עבודה סופית'), ROSTER)).toBeNull();
  });

  it('requires every part of the name, not just one', () => {
    expect(matchStudent(file('דהן'), ROSTER)).toBeNull();
  });

  it('returns null rather than attributing an unrecognised file', () => {
    expect(matchStudent(file('scan_0042.pdf'), ROSTER)).toBeNull();
  });

  it('handles a file with no name at all', () => {
    expect(matchStudent({ id: 'f1' }, ROSTER)).toBeNull();
  });
});
