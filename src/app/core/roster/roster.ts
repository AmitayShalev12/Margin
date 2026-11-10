import { normaliseName } from '../drive/file-name';
import { writeZip } from '../export/zip-writer';
import { SheetError, readSheet } from '../import/xlsx';
import { Student, StudentRosterDetails } from '../models';

/**
 * The student list as the college's system exports it.
 *
 * Same columns on the way in and out, so a file can go back and forth. Two are
 * deliberately never read or kept: the ID number and the home address. Margin
 * needs neither to mark a paper, and data it does not hold cannot leak. They
 * stay in the export as empty columns so the format still matches.
 */
export const ROSTER_HEADERS = [
  'שם',
  'זהות',
  'כתובת:',
  'טלפון:',
  'סלולרי',
  'סמן דואל',
  'דוא"ל:',
  'סטטוס:',
  'שנה פדגוגית:',
  'מסלול',
  'חוג',
  'כיתה',
] as const;

export interface RosterRow {
  name: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  class_name: string | null;
  details: StudentRosterDetails;
}

const key = (header: string) => normaliseName(header.replace(/:/g, ''));
const clean = (value: string | undefined) => value?.trim() || null;

/** The file ends each address with `;`, and can hold more than one. */
function cleanEmail(value: string | undefined): string | null {
  return value?.split(';')[0].trim() || null;
}

function cleanPhone(value: string | undefined): string | null {
  const text = clean(value);
  // A phone stored as a number in Excel has lost its leading zero.
  return text && /^[1-9]\d{7,8}$/.test(text) ? `0${text}` : text;
}

export async function readRoster(data: ArrayBuffer): Promise<RosterRow[]> {
  const table = (await readSheet(data)).map((row) => {
    const cells: string[] = [];
    row.forEach((cell, index) => (cells[index] = cell.text));
    return cells;
  });

  const headers = new Map((table[0] ?? []).map((header, index) => [key(header ?? ''), index]));
  if (!headers.has('שם')) {
    throw new SheetError('בשורה הראשונה של הקובץ צריכה להיות עמודה בשם "שם".');
  }
  const cell = (row: string[], header: string) => {
    const index = headers.get(key(header));
    return index === undefined ? undefined : row[index];
  };

  return table
    .slice(1)
    .map((row) => ({
      name: clean(cell(row, 'שם')) ?? '',
      phone: cleanPhone(cell(row, 'טלפון')),
      mobile: cleanPhone(cell(row, 'סלולרי')),
      email: cleanEmail(cell(row, 'דואל')),
      class_name: clean(cell(row, 'כיתה')),
      details: {
        status: clean(cell(row, 'סטטוס')),
        pedagogic_year: clean(cell(row, 'שנה פדגוגית')),
        track: clean(cell(row, 'מסלול')),
        department: clean(cell(row, 'חוג')),
      },
    }))
    .filter((row) => row.name);
}

// -- comparing ----------------------------------------------------------------

export type ContactField = 'email' | 'phone' | 'mobile';

export const CONTACT_LABEL: Record<ContactField, string> = {
  email: 'מייל',
  phone: 'טלפון',
  mobile: 'סלולרי',
};

const FIELDS: ContactField[] = ['email', 'phone', 'mobile'];

/** 050-1234567 and 0501234567 are the same phone; case is not part of an address. */
function same(field: ContactField, a: string, b: string): boolean {
  return field === 'email'
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : a.replace(/\D/g, '') === b.replace(/\D/g, '');
}

export interface RosterConflict {
  id: string;
  studentId: string;
  name: string;
  field: ContactField;
  current: string;
  incoming: string;
}

export interface RosterPlan {
  added: RosterRow[];
  /** On the roster already; blanks are filled in and she joins this course. */
  existing: { student: Student; row: RosterRow }[];
  /** Different details for someone on the roster. Kept as they are unless she says. */
  conflicts: RosterConflict[];
  /** The same name twice in the file with different details. The first row is used. */
  repeated: string[];
}

export function planRoster(rows: readonly RosterRow[], students: readonly Student[]): RosterPlan {
  const byName = new Map(students.map((s) => [normaliseName(s.full_name), s]));
  const plan: RosterPlan = { added: [], existing: [], conflicts: [], repeated: [] };
  const seen = new Map<string, RosterRow>();

  for (const row of rows) {
    const name = normaliseName(row.name);
    const earlier = seen.get(name);
    if (earlier) {
      const differs = FIELDS.some(
        (f) => earlier[f] && row[f] && !same(f, earlier[f] as string, row[f] as string),
      );
      if (differs && !plan.repeated.includes(row.name)) plan.repeated.push(row.name);
      continue;
    }
    seen.set(name, row);

    const student = byName.get(name);
    if (!student) {
      plan.added.push(row);
      continue;
    }

    plan.existing.push({ student, row });
    for (const field of FIELDS) {
      const current = student[field];
      const incoming = row[field];
      if (current && incoming && !same(field, current, incoming)) {
        plan.conflicts.push({
          id: `${student.id}:${field}`,
          studentId: student.id,
          name: student.full_name,
          field,
          current,
          incoming,
        });
      }
    }
  }

  return plan;
}

export interface RosterMismatch {
  id: string;
  text: string;
}

/**
 * Details that do not agree across the roster.
 *
 * Two rows with one name and different details, or one address under two names.
 * Either can be innocent, so this asks her to look rather than fixing anything.
 */
export function rosterMismatches(students: readonly Student[]): RosterMismatch[] {
  const found: RosterMismatch[] = [];

  const byName = new Map<string, Student[]>();
  const byEmail = new Map<string, Student[]>();
  for (const student of students) {
    const name = normaliseName(student.full_name);
    byName.set(name, [...(byName.get(name) ?? []), student]);
    const email = student.email?.trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), student]);
  }

  for (const [name, rows] of byName) {
    if (rows.length < 2) continue;
    for (const field of FIELDS) {
      const values = rows.map((r) => r[field]).filter((v): v is string => !!v);
      if (values.some((v) => !same(field, v, values[0]))) {
        found.push({
          id: `name:${name}:${field}`,
          text: `${rows[0].full_name}: יש שתי שורות בשם הזה, עם ${CONTACT_LABEL[field]} שונה.`,
        });
      }
    }
  }

  for (const [email, rows] of byEmail) {
    if (new Set(rows.map((r) => normaliseName(r.full_name))).size > 1) {
      found.push({
        id: `email:${email}`,
        text: `אותו מייל רשום אצל ${rows.map((r) => r.full_name).join(' ואצל ')}.`,
      });
    }
  }

  return found;
}

// -- writing ------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const escapeXml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function columnName(index: number): string {
  return String.fromCharCode(65 + index);
}

function textCell(column: number, row: number, value: string | null | undefined): string {
  if (!value) return '';
  const text = escapeXml(value);
  return `<c r="${columnName(column)}${row}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

/** The roster as an Excel file, in the columns it arrived in. */
export function writeRoster(students: readonly Student[], at: Date): Uint8Array {
  const header = ROSTER_HEADERS.map((title, column) => textCell(column, 1, title)).join('');

  const rows = students.map((student, index) => {
    const row = index + 2;
    const details = student.roster_details;
    const values = [
      student.full_name,
      student.id_number,
      student.address,
      student.phone,
      student.mobile,
      null, // סמן דואל: a flag of the system it came from
      student.email,
      details?.status,
      details?.pedagogic_year,
      details?.track,
      details?.department,
      student.class_name,
    ];
    return `<row r="${row}">${values.map((value, column) => textCell(column, row, value)).join('')}</row>`;
  });

  const sheet =
    `${XML_HEAD}<worksheet xmlns="${MAIN}"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>` +
    `<sheetData><row r="1">${header}</row>${rows.join('')}</sheetData></worksheet>`;

  return writeZip(
    [
      {
        name: '[Content_Types].xml',
        data:
          `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      },
      {
        name: '_rels/.rels',
        data:
          `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        data:
          `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
          `<sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ],
    at,
  );
}
