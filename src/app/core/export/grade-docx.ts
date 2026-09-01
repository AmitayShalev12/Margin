import { writeZip } from './zip-writer';

/**
 * Her grading form, filled in, as a `.docx` she can edit.
 *
 * She was asked directly whether she needed the Word file back or whether the
 * scores on screen would do:
 *
 *   "ברור שהכי טוב שיהיה הטופס מוכן ורק אני אערוך על הטופס ואני אוכל להוריד
 *    אותו... אבל אם אתה רואה שאני אטבח עם זה, אז אפשר גם בדרך אחרת."
 *
 * So a real Word file rather than a print stylesheet — the point is that she
 * can open it, change a number, and send it on. A PDF would be a picture of
 * the form; this is the form.
 *
 * It is **not** pixel-identical to `תבנית טופס ציון פז.docx`, and it is not
 * meant to be: it carries her sections, her criteria, her point values and her
 * 65/10/25 weighting in the same order, in a table that reads right to left.
 * Reproducing her exact typesetting would mean shipping her template as a
 * binary and patching it, which breaks the moment she edits it.
 *
 * Nothing here invents a number. A criterion with no score prints an em dash,
 * never a zero, and the final grade is simply absent until every part of it is
 * in — the same rule the screen follows, because the document outlives the
 * screen and will be read without it.
 */

export interface GradeSheetCriterion {
  name: string;
  maxPoints: number | null;
  points: number | null;
  percent: number | null;
  /** Hers to judge — 2.2 and 4.2. Printed as such, not as a gap. */
  mine: boolean;
  note: string | null;
  /**
   * Why this score, in the model's words.
   *
   * Carried into the document because the document is where she reads the
   * form back — "כדי שנוכל לעקוב אחרי הרציונל שלו" is not a thing that only
   * needs to be true on screen. Attributed on the page for the same reason it
   * is on screen: everything else on the form is her judgement.
   */
  rationale: string | null;
}

export interface GradeSheetSection {
  name: string;
  points: number | null;
  outOf: number | null;
  percent: number | null;
  criteria: GradeSheetCriterion[];
}

export interface GradeSheet {
  student: string;
  work: string | null;
  exportedAt: Date;
  sections: GradeSheetSection[];
  paper: { points: number; outOf: number; percent: number } | null;
  /** The weighted parts, in her order: 65 / 10 / 25. */
  parts: readonly { name: string; percent: number; value: number | null }[];
  final: number | null;
}

/** What an absent number prints as. Never `0`, which is a different claim. */
const NONE = '—';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A paragraph, right-aligned and marked bidi.
 *
 * Both `w:bidi` on the paragraph and `w:rtl` on the run are needed: the first
 * sets the reading order of the line, the second the direction of the text in
 * it. With only one of them Word lays Hebrew out subtly wrongly — punctuation
 * migrates to the wrong end of the sentence.
 */
function p(text: string, opts: { bold?: boolean; size?: number } = {}): string {
  const size = opts.size ?? 20; // half-points, so 20 = 10pt
  const runProps = `<w:rPr>${opts.bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:rtl/></w:rPr>`;

  return (
    `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/>` +
    `<w:rPr>${opts.bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:rtl/></w:rPr></w:pPr>` +
    `<w:r>${runProps}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
  );
}

function cell(
  text: string,
  opts: { bold?: boolean; width: number; shaded?: boolean } = { width: 2000 },
): string {
  const shade = opts.shaded ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : '';
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${opts.width}" w:type="dxa"/>${shade}</w:tcPr>` +
    p(text, { bold: opts.bold }) +
    `</w:tc>`
  );
}

function row(cells: string): string {
  return `<w:tr>${cells}</w:tr>`;
}

/** Column widths in twentieths of a point, summing to a portrait text column. */
const W_NAME = 5200;
const W_SCORE = 1400;
const W_PERCENT = 1400;

function table(rows: string): string {
  return (
    `<w:tbl><w:tblPr>` +
    // Lays the columns out right-to-left, which is what makes the first column
    // appear on the right where she reads it.
    `<w:bidiVisual/>` +
    `<w:tblW w:w="8000" w:type="dxa"/>` +
    `<w:tblBorders>` +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="BFBFBF"/>`)
      .join('') +
    `</w:tblBorders></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${W_NAME}"/><w:gridCol w:w="${W_SCORE}"/><w:gridCol w:w="${W_PERCENT}"/></w:tblGrid>` +
    rows +
    `</w:tbl>`
  );
}

function date(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}`;
}

function documentXml(sheet: GradeSheet): string {
  const body: string[] = [];

  body.push(p('טופס הערכה', { bold: true, size: 32 }));
  body.push(p(sheet.student, { bold: true, size: 24 }));
  if (sheet.work) body.push(p(sheet.work));
  body.push(p(`הופק ב־${date(sheet.exportedAt)}`, { size: 18 }));
  body.push(p(''));

  const rows: string[] = [];
  rows.push(
    row(
      cell('סעיף', { bold: true, width: W_NAME, shaded: true }) +
        cell('ניקוד', { bold: true, width: W_SCORE, shaded: true }) +
        cell('אחוז', { bold: true, width: W_PERCENT, shaded: true }),
    ),
  );

  for (const section of sheet.sections) {
    rows.push(
      row(
        cell(section.name, { bold: true, width: W_NAME, shaded: true }) +
          cell(
            section.points !== null && section.outOf !== null
              ? `${section.points}/${section.outOf}`
              : NONE,
            { bold: true, width: W_SCORE, shaded: true },
          ) +
          cell(section.percent !== null ? `${section.percent}%` : NONE, {
            bold: true,
            width: W_PERCENT,
            shaded: true,
          }),
      ),
    );

    for (const criterion of section.criteria) {
      // Three distinct states, and they must not collapse into each other: a
      // score, a criterion she reserved for herself, and one not yet read.
      const score =
        criterion.points !== null && criterion.maxPoints !== null
          ? `${criterion.points}/${criterion.maxPoints}`
          : criterion.mine
            ? `לשיפוטך · ${criterion.maxPoints ?? NONE}`
            : NONE;

      rows.push(
        row(
          cell(criterion.name, { width: W_NAME }) +
            cell(score, { width: W_SCORE }) +
            cell(criterion.percent !== null ? `${criterion.percent}%` : NONE, {
              width: W_PERCENT,
            }),
        ),
      );

      if (criterion.rationale) {
        rows.push(
          row(
            cell(`ההסבר של המערכת: ${criterion.rationale}`, { width: W_NAME }) +
              cell('', { width: W_SCORE }) +
              cell('', { width: W_PERCENT }),
          ),
        );
      }

      if (criterion.note) {
        rows.push(
          row(
            cell(`מה השתנה: ${criterion.note}`, { width: W_NAME }) +
              cell('', { width: W_SCORE }) +
              cell('', { width: W_PERCENT }),
          ),
        );
      }
    }
  }

  body.push(table(rows.join('')));
  body.push(p(''));

  body.push(
    p(
      sheet.paper
        ? `ציון העבודה: ${sheet.paper.points}/${sheet.paper.outOf} — ${sheet.paper.percent}%`
        : 'ציון העבודה: טרם הושלם ניקוד כל הסעיפים',
      { bold: true, size: 24 },
    ),
  );

  if (sheet.parts.length) {
    body.push(p(''));
    for (const part of sheet.parts) {
      body.push(p(`${part.name} (${part.percent}%): ${part.value ?? NONE}`));
    }
  }

  body.push(p(''));
  body.push(
    p(
      sheet.final !== null ? `ציון סופי: ${sheet.final}` : 'ציון סופי: יחושב כשכל חלקי הציון יוזנו',
      { bold: true, size: 28 },
    ),
  );

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body.join('')}` +
    // `w:bidi` on the section makes the page itself right-to-left, which is
    // what puts the table's first column on the right.
    //
    // Order matters and is not alphabetical: CT_SectPr puts `bidi` *after*
    // pgSz and pgMar. Word is often forgiving about sequence and then, on one
    // machine, is not — and what it does instead of forgiving is refuse to
    // open the file.
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>` +
    `<w:bidi/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

export function buildGradeDocx(sheet: GradeSheet): Uint8Array {
  return writeZip(
    [
      // `[Content_Types].xml` first, by convention — some readers look for it
      // at the head of the archive rather than through the directory.
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: '_rels/.rels', data: ROOT_RELS },
      { name: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
      { name: 'word/document.xml', data: documentXml(sheet) },
    ],
    sheet.exportedAt,
  );
}

/** What the downloaded file is called. Her naming, so it files itself. */
export function gradeDocxName(sheet: GradeSheet): string {
  const parts = [sheet.student, sheet.work].filter(Boolean).join(' - ');
  return `טופס ציון - ${parts || 'עבודה'}.docx`;
}
