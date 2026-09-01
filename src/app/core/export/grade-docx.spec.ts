import { readZipParts } from '../import/zip';
import { GradeSheet, buildGradeDocx, gradeDocxName } from './grade-docx';

/**
 * The exported form, read back out of the archive it was written into.
 *
 * Word is the real consumer and cannot be asked here, so these check the two
 * things that would actually reach her wrong: the package structure that makes
 * it open at all, and the numbers on the page. The second matters more — a
 * file that will not open is obvious within a second, while a zero where a
 * blank belongs is a mark against a student that nobody catches.
 */

const AT = new Date('2026-08-31T10:30:00Z');

function sheet(over: Partial<GradeSheet> = {}): GradeSheet {
  return {
    student: 'נועה ברקוביץ׳',
    work: 'רשתות חברתיות בגיל ההתבגרות',
    exportedAt: AT,
    sections: [
      {
        name: 'פרק תאורטי',
        points: 3,
        outOf: 4,
        percent: 75,
        criteria: [
          {
            name: '2.1 סקירת ספרות',
            maxPoints: 4,
            points: 3,
            percent: 75,
            mine: false,
            note: null,
            rationale: null,
            teacherNote: null,
          },
        ],
      },
    ],
    paper: { points: 3, outOf: 4, percent: 75 },
    parts: [
      { name: 'ציון העבודה', percent: 65, value: 75 },
      { name: 'פרזנטציה', percent: 10, value: 90 },
      { name: 'מטלות שוטפות', percent: 25, value: 80 },
    ],
    final: 77.8,
    ...over,
  };
}

async function documentOf(input: GradeSheet): Promise<string> {
  const bytes = buildGradeDocx(input);
  const parts = await readZipParts(bytes.buffer as ArrayBuffer, [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
  ]);

  // The three parts Word needs to open the file at all.
  expect(parts.get('[Content_Types].xml')).toContain('wordprocessingml.document.main+xml');
  expect(parts.get('_rels/.rels')).toContain('word/document.xml');

  return parts.get('word/document.xml') ?? '';
}

describe('the exported grading form', () => {
  it('is a package Word can open', async () => {
    const xml = await documentOf(sheet());

    expect(xml).toContain('<w:document');
    expect(xml).toContain('</w:body></w:document>');
  });

  /** Right-to-left on the section, the paragraphs and the table alike. */
  it('is laid out right to left', async () => {
    const xml = await documentOf(sheet());

    expect(xml).toContain('<w:bidiVisual/>');
    // After pgSz/pgMar, which is where CT_SectPr's sequence puts it.
    expect(xml).toContain('<w:bidi/></w:sectPr>');
    expect(xml).toContain('<w:rtl/>');
  });

  it('carries the score as both a fraction and a percentage', async () => {
    const xml = await documentOf(sheet());

    expect(xml).toContain('3/4');
    expect(xml).toContain('75%');
    expect(xml).toContain('2.1 סקירת ספרות');
  });

  it('carries her sections and her weighting', async () => {
    const xml = await documentOf(sheet());

    expect(xml).toContain('פרק תאורטי');
    expect(xml).toContain('ציון העבודה');
    expect(xml).toContain('ציון סופי: 77.8');
  });

  /**
   * The one that matters. This document is read away from the screen and
   * without any of its context — a zero printed for an unread criterion is a
   * mark against a named student that nothing on the page contradicts.
   */
  it('prints a dash for an unscored criterion, never a zero', async () => {
    const xml = await documentOf(
      sheet({
        sections: [
          {
            name: 'פרק מחקרי',
            points: null,
            outOf: null,
            percent: null,
            criteria: [
              {
                name: '3.1 שיטה',
                maxPoints: 6,
                points: null,
                percent: null,
                mine: false,
                note: null,
                rationale: null,
                teacherNote: null,
              },
            ],
          },
        ],
        paper: null,
      }),
    );

    expect(xml).toContain('—');
    expect(xml).not.toContain('0/6');
    expect(xml).not.toContain('>0%<');
  });

  it('says a criterion is hers to judge rather than leaving it blank', async () => {
    const xml = await documentOf(
      sheet({
        sections: [
          {
            name: 'דרך ההגשה',
            points: null,
            outOf: null,
            percent: null,
            criteria: [
              {
                name: '4.2 הגשה נאה',
                maxPoints: 2,
                points: null,
                percent: null,
                mine: true,
                note: null,
                rationale: null,
                teacherNote: null,
              },
            ],
          },
        ],
      }),
    );

    expect(xml).toContain('לשיפוטך');
  });

  /** A partial grade is a wrong grade, and on paper it outlives its caveats. */
  it('prints no final grade while a part of it is missing', async () => {
    const xml = await documentOf(sheet({ final: null }));

    expect(xml).not.toContain('ציון סופי: 77.8');
    expect(xml).toContain('יחושב כשכל חלקי הציון יוזנו');
  });

  it('escapes a criterion name that would otherwise break the XML', async () => {
    const input = sheet();
    input.sections[0].criteria[0].name = 'מקורות <חב"ד> & עוד';

    const xml = await documentOf(input);

    expect(xml).toContain('&lt;חב&quot;ד&gt; &amp; עוד');
    expect(xml).toContain('</w:body></w:document>');
  });

  it('names the file after the student and her work', () => {
    expect(gradeDocxName(sheet())).toBe(
      'טופס ציון - נועה ברקוביץ׳ - רשתות חברתיות בגיל ההתבגרות.docx',
    );
  });
});
