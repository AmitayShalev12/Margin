import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { writeZip } from '../export/zip-writer';
import { SheetError } from '../import/xlsx';
import { Student } from '../models';
import { SupabaseService } from '../supabase/supabase';
import { ROSTER_HEADERS, planRoster, readRoster, rosterMismatches, writeRoster } from './roster';

/** The student list, in the college's format. All names and numbers are invented. */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** A file shaped like the real export: padded phones, `;` after the address. */
function collegeFile(): ArrayBuffer {
  const strings = [
    ...ROSTER_HEADERS,
    'נועה כהן',
    'רחוב הדוגמה 1',
    '050-1234567         ',
    'noa@example.com;',
    'תלמיד מן המנין ',
    'ג ',
    'יסודי א-ו',
    'חינוך והוראה',
  ];
  const index = (text: string) => strings.indexOf(text);
  const cell = (ref: string, text: string) => `<c r="${ref}" t="s"><v>${index(text)}</v></c>`;
  const header = ROSTER_HEADERS.map((h, i) => cell(`${String.fromCharCode(65 + i)}1`, h)).join('');

  const sheet =
    `<worksheet xmlns="${MAIN}"><sheetData><row r="1">${header}</row><row r="2">` +
    cell('A2', 'נועה כהן') +
    `<c r="B2"><v>123456782</v></c>` +
    cell('C2', 'רחוב הדוגמה 1') +
    `<c r="D2"/>` +
    cell('E2', '050-1234567         ') +
    `<c r="F2" t="b"><v>0</v></c>` +
    cell('G2', 'noa@example.com;') +
    cell('H2', 'תלמיד מן המנין ') +
    cell('I2', 'ג ') +
    cell('J2', 'יסודי א-ו') +
    cell('K2', 'חינוך והוראה') +
    `</row></sheetData></worksheet>`;
  const shared =
    `<sst xmlns="${MAIN}">` + strings.map((t) => `<si><t xml:space="preserve">${t.replace(/"/g, '&quot;')}</t></si>`).join('') + `</sst>`;

  return writeZip(
    [
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
      { name: 'xl/sharedStrings.xml', data: shared },
    ],
    new Date('2026-11-05T10:00:00Z'),
  ).buffer as ArrayBuffer;
}

const student = (over: Partial<Student>): Student =>
  ({
    id: 's1',
    teacher_id: 't',
    full_name: 'נועה כהן',
    email: null,
    phone: null,
    mobile: null,
    class_name: null,
    drive_account_email: null,
    drive_folder_id: null,
    notes: null,
    active: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  }) as Student;

const row = (over: object = {}) => ({
  name: 'נועה כהן',
  phone: null,
  mobile: null,
  email: null,
  class_name: null,
  details: { status: null, pedagogic_year: null, track: null, department: null },
  ...over,
});

describe('reading the college list', () => {
  it('cleans the padding and the semicolon', async () => {
    const [noa] = await readRoster(collegeFile());

    expect(noa.name).toBe('נועה כהן');
    expect(noa.mobile).toBe('050-1234567');
    expect(noa.phone).toBeNull();
    expect(noa.email).toBe('noa@example.com');
    expect(noa.details.pedagogic_year).toBe('ג');
    expect(noa.details.department).toBe('חינוך והוראה');
  });

  /** Margin needs neither, and data it does not hold cannot leak. */
  it('never keeps the ID number or the home address', async () => {
    const text = JSON.stringify(await readRoster(collegeFile()));

    expect(text).not.toContain('123456782');
    expect(text).not.toContain('הדוגמה');
  });

  it('says what is wrong with a file it cannot read', async () => {
    await expect(readRoster(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)).rejects.toThrow(
      SheetError,
    );
  });
});

describe('writing it back', () => {
  it('has the same columns and survives the round trip', async () => {
    const out = writeRoster(
      [
        student({
          email: 'a&b@example.com',
          mobile: '050-1234567',
          roster_details: { status: 'פעילה', pedagogic_year: 'ג', track: 'יסודי', department: 'חינוך' },
        }),
      ],
      new Date('2026-11-05T10:00:00Z'),
    );

    const [noa] = await readRoster(out.buffer as ArrayBuffer);
    expect(noa.name).toBe('נועה כהן');
    expect(noa.email).toBe('a&b@example.com');
    expect(noa.mobile).toBe('050-1234567');
    expect(noa.details.department).toBe('חינוך');
  });
});

describe('checking details against the roster', () => {
  it('separates new students from existing ones', () => {
    const plan = planRoster([row(), row({ name: 'שירה לוי' })], [student({})]);

    expect(plan.added.map((r) => r.name)).toEqual(['שירה לוי']);
    expect(plan.existing).toHaveLength(1);
  });

  it('flags a student whose email or phone differs', () => {
    const plan = planRoster(
      [row({ email: 'new@example.com', mobile: '0529999999' })],
      [student({ email: 'old@example.com', mobile: '050-1111111' })],
    );

    expect(plan.conflicts.map((c) => c.field)).toEqual(['email', 'mobile']);
  });

  it('does not flag the same details written differently', () => {
    const plan = planRoster(
      [row({ email: 'NOA@example.com', mobile: '0501234567' })],
      [student({ email: 'noa@example.com', mobile: '050-1234567' })],
    );

    expect(plan.conflicts).toEqual([]);
  });

  it('flags one name twice in a file with different details', () => {
    const plan = planRoster([row({ email: 'a@example.com' }), row({ email: 'b@example.com' })], []);

    expect(plan.added).toHaveLength(1);
    expect(plan.repeated).toEqual(['נועה כהן']);
  });

  it('finds disagreement already on the roster', () => {
    const found = rosterMismatches([
      student({ id: 'a', mobile: '0501111111' }),
      student({ id: 'b', mobile: '0502222222' }),
      student({ id: 'c', full_name: 'שירה', email: 'x@example.com' }),
      student({ id: 'd', full_name: 'מאיה', email: 'X@example.com' }),
    ]);

    expect(found.map((f) => f.text).join(' ')).toContain('סלולרי');
    expect(found.map((f) => f.text).join(' ')).toContain('אותו מייל');
  });

  it('is silent when everything agrees', () => {
    expect(rosterMismatches([student({ email: 'a@example.com' })])).toEqual([]);
  });
});

describe('applying it', () => {
  class FakeSupabase {
    isConfigured = true;
    teacherId = 'teacher-1';
    functionsUrl = 'https://project.supabase.co/functions/v1';
    client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
  }

  function setup() {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: new FakeSupabase() },
        { provide: Repository, useClass: LocalRepository },
      ],
    });
    const store = TestBed.inject(DataStore);
    store.createCourse('סמינריון', 'תשפ״ז');
    return store;
  }

  it('adds a new student with her details, in this course', () => {
    const store = setup();
    const plan = planRoster([row({ mobile: '050-1234567', email: 'n@example.com' })], []);

    store.applyRoster(plan, new Set());

    const [noa] = store.students();
    expect(noa.mobile).toBe('050-1234567');
    expect(store.coursesOf(noa.id).map((c) => c.name)).toEqual(['סמינריון']);
  });

  it('keeps what is recorded unless she chose to replace it, and fills blanks', () => {
    const store = setup();
    const existing = store.addStudent('נועה כהן', 'old@example.com')!;
    const plan = planRoster(
      [row({ email: 'new@example.com', mobile: '050-1234567' })],
      store.students(),
    );

    store.applyRoster(plan, new Set());
    let noa = store.students().find((s) => s.id === existing.id)!;
    expect(noa.email).toBe('old@example.com');
    expect(noa.mobile).toBe('050-1234567');
    expect(store.students()).toHaveLength(1);

    const second = planRoster([row({ email: 'new@example.com' })], store.students());
    store.applyRoster(second, new Set([`${existing.id}:email`]));
    noa = store.students().find((s) => s.id === existing.id)!;
    expect(noa.email).toBe('new@example.com');
  });
});

describe('taking from an earlier year', () => {
  class FakeSupabase {
    isConfigured = true;
    teacherId = 'teacher-1';
    functionsUrl = 'https://project.supabase.co/functions/v1';
    client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function setup() {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: new FakeSupabase() },
        { provide: Repository, useClass: LocalRepository },
      ],
    });
    const store = TestBed.inject(DataStore);
    const last = store.createCourse('סמינריון', 'תשפ״ו')!;
    const kept = store.addCourseRule('other', 'כלל שעובר', 'teacher')!;
    const dropped = store.addCourseRule('other', 'כלל שנשאר מאחור', 'teacher')!;
    store.importRubric({
      criteria: [{ code: '1', section: 'א', name: 'טענה', maxPoints: 10 }],
      weights: [{ name: 'עבודה', percent: 100 }],
    });
    await settled();
    const next = store.createCourse('סמינריון', 'תשפ״ז')!;
    return { store, last, next, kept, dropped };
  }

  it('copies only what she ticked, as new rows', async () => {
    const { store, last, next, kept, dropped } = await setup();

    const copied = await store.carryOver(last.id, next.id, {
      ruleIds: [kept.id],
      materialIds: [],
      gradingForm: false,
    });

    expect(copied.rules).toBe(1);
    const here = store.allCourseRules().filter((r) => r.course_id === next.id);
    expect(here.map((r) => r.body)).toEqual(['כלל שעובר']);
    expect(here[0].id).not.toBe(kept.id);
    expect(store.allCourseRules().find((r) => r.id === dropped.id)?.course_id).toBe(last.id);
  });

  it('leaves last year untouched', async () => {
    const { store, last, next, kept } = await setup();

    await store.carryOver(last.id, next.id, { ruleIds: [kept.id], materialIds: [], gradingForm: false });

    expect(store.allCourseRules().find((r) => r.id === kept.id)?.course_id).toBe(last.id);
  });

  it('brings the grading form and its weights when asked', async () => {
    const { store, last, next } = await setup();

    const copied = await store.carryOver(last.id, next.id, { ruleIds: [], materialIds: [], gradingForm: true });
    await settled();

    expect(copied.gradingForm).toBe(true);
    const active = store.gradingCategories().filter((c) => c.active);
    expect(active.map((c) => c.name)).toEqual(['1 טענה']);
    expect(store.course()!.grade_weights).toEqual([{ name: 'עבודה', percent: 100 }]);
  });

  it('brings nothing when she asks for nothing', async () => {
    const { store, last, next } = await setup();

    const copied = await store.carryOver(last.id, next.id, { ruleIds: [], materialIds: [], gradingForm: false });

    expect(copied).toEqual({ rules: 0, materials: 0, gradingForm: false });
    expect(store.allCourseRules().filter((r) => r.course_id === next.id)).toEqual([]);
  });
});
