import { DocumentBlock } from '../models';
import { checkCitations, citationsIn, splitBibliography } from './citations';

/**
 * The check that replaced an AI-text detector.
 *
 * Its worth is entirely in being exact. A report listing things that were
 * never citations is one she stops reading after the second paper, and at that
 * point it is worse than nothing — it has taught her to ignore it.
 */

function blocks(...items: [string, string][]): DocumentBlock[] {
  return items.map(([type, text], i) => ({
    id: `b${i}`,
    type: type as DocumentBlock['type'],
    text,
  })) as DocumentBlock[];
}

describe('finding the citations in a paragraph', () => {
  it('reads the parenthetical form, in Hebrew and in English', () => {
    const found = citationsIn('נמצא קשר מובהק (כהן, 2021) וגם במחקר אחר (Cohen, 2019).');

    expect(found.map((c) => c.key)).toEqual(['כהן|2021', 'cohen|2019']);
  });

  it('reads the narrative form', () => {
    const found = citationsIn('כהן (2021) טוענת כי. Twenge (2019) found the opposite.');

    expect(found.map((c) => c.key)).toEqual(['כהן|2021', 'twenge|2019']);
  });

  it('files two authors under the first, as the reference list does', () => {
    expect(citationsIn('(כהן ולוי, 2021)')[0].key).toBe('כהן|2021');
    expect(citationsIn('(Cohen and Levi, 2020)')[0].key).toBe('cohen|2020');
  });

  it('ignores the geresh, so ברקוביץ׳ and ברקוביץ agree', () => {
    expect(citationsIn('(ברקוביץ׳, 2021)')[0].key).toBe(citationsIn("(ברקוביץ', 2021)")[0].key);
  });

  it('counts a source cited twice once', () => {
    expect(citationsIn('(כהן, 2021) ... ושוב (כהן, 2021)').length).toBe(1);
  });

  /**
   * The failure that makes a report unreadable. A pattern loose enough to
   * catch every citation style also catches every year in brackets.
   */
  it('does not mistake an aside for a citation', () => {
    expect(citationsIn('כפי שמוצג בתרשים (ראו פרק 3).')).toEqual([]);
    expect(citationsIn('הנתונים נאספו בשנת (2021).')).toEqual([]);
  });
});

describe('splitting the bibliography off', () => {
  const paper = blocks(
    ['heading', 'מבוא'],
    ['paragraph', 'נמצא קשר (כהן, 2021).'],
    ['heading', 'ביבליוגרפיה'],
    ['paragraph', 'כהן, ר׳ (2021). מתבגרים ורשתות חברתיות. הוצאת אקדמיה.'],
  );

  it('separates the reference list from the body', () => {
    const { body, entries } = splitBibliography(paper);

    expect(body).toContain('כהן, 2021');
    expect(entries.length).toBe(1);
    // The entry is not counted as a citation of itself.
    expect(body).not.toContain('הוצאת אקדמיה');
  });

  it('recognises the headings she actually uses', () => {
    for (const heading of ['ביבליוגרפיה', 'רשימת מקורות', 'מקורות', 'References']) {
      const split = splitBibliography(
        blocks(['paragraph', 'טקסט'], ['heading', heading], ['paragraph', 'כהן, ר׳ (2021).']),
      );
      expect(split.entries.length).toBe(1);
    }
  });
});

describe('what the paper cites against what it lists', () => {
  it('names a source cited but never listed', () => {
    const report = checkCitations(
      blocks(
        ['paragraph', 'נמצא קשר (כהן, 2021) ובמחקר נוסף (לוי, 2018).'],
        ['heading', 'ביבליוגרפיה'],
        ['paragraph', 'כהן, ר׳ (2021). מתבגרים ורשתות חברתיות.'],
      ),
    );

    expect(report.missing.map((c) => c.key)).toEqual(['לוי|2018']);
  });

  /**
   * The substitution a model makes: the right author, the wrong year. Matching
   * on the surname alone would let the 2019 entry answer a 2021 citation and
   * the report would say everything is in order.
   */
  it('does not let one year stand in for another by the same author', () => {
    const report = checkCitations(
      blocks(
        ['paragraph', 'נמצא קשר (כהן, 2021).'],
        ['heading', 'ביבליוגרפיה'],
        ['paragraph', 'כהן, ר׳ (2019). ספר אחר לגמרי.'],
      ),
    );

    expect(report.missing.map((c) => c.key)).toEqual(['כהן|2021']);
  });

  it('names an entry that is listed but never cited', () => {
    const report = checkCitations(
      blocks(
        ['paragraph', 'נמצא קשר (כהן, 2021).'],
        ['heading', 'ביבליוגרפיה'],
        ['paragraph', 'כהן, ר׳ (2021). מתבגרים ורשתות חברתיות.'],
        ['paragraph', 'לוי, מ׳ (2018). ספר שאיש לא ציטט.'],
      ),
    );

    expect(report.missing).toEqual([]);
    expect(report.uncited.length).toBe(1);
    expect(report.uncited[0]).toContain('לוי');
  });

  it('finds nothing to say about a paper that is in order', () => {
    const report = checkCitations(
      blocks(
        ['paragraph', 'נמצא קשר (כהן, 2021), וכן Twenge (2019).'],
        ['heading', 'ביבליוגרפיה'],
        ['paragraph', 'כהן, ר׳ (2021). מתבגרים ורשתות חברתיות.'],
        ['paragraph', 'Twenge, J. M. (2019). Adolescent mental health.'],
      ),
    );

    expect(report.missing).toEqual([]);
    expect(report.uncited).toEqual([]);
    expect(report.cited.length).toBe(2);
  });

  /**
   * No bibliography is the check having nothing to run on, not a finding that
   * everything is present. Conflating the two would report a paper with no
   * references at all as clean.
   */
  it('says when there is no bibliography rather than reporting all clear', () => {
    const report = checkCitations(blocks(['paragraph', 'נמצא קשר (כהן, 2021).']));

    expect(report.noBibliography).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.cited.length).toBe(1);
  });
});
