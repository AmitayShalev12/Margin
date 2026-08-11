import { renderBlock, sectionsOf, splitLtrRuns } from '../presentation/document-render';
import { DocsDocument, DocsStructuralElement } from './drive-types';
import { blocksToText, extractDocumentBlocks } from './docs-extract';

/** Builds the Docs paragraph shape from text runs. */
function para(
  runs: string[],
  namedStyleType?: string,
  extra: { bullet?: boolean; startIndex?: number } = {},
): DocsStructuralElement {
  return {
    startIndex: extra.startIndex,
    paragraph: {
      elements: runs.map((content) => ({ textRun: { content } })),
      paragraphStyle: namedStyleType ? { namedStyleType } : { namedStyleType: 'NORMAL_TEXT' },
      ...(extra.bullet ? { bullet: { listId: 'l1' } } : {}),
    },
  };
}

function doc(content: DocsStructuralElement[]): DocsDocument {
  return { documentId: 'doc1', title: 'עבודה', body: { content } };
}

describe('extractDocumentBlocks — text fidelity', () => {
  it('keeps paragraph text character for character', () => {
    const text = 'ניתוח מתאם פירסון העלה כי הקשר היה מובהק (r = .42, p < .01).\n';
    const blocks = extractDocumentBlocks(doc([para([text])]));

    expect(blocks[0].text).toBe(text.slice(0, -1));
  });

  it('joins split text runs without inserting anything between them', () => {
    // Docs splits a paragraph at every formatting change.
    const blocks = extractDocumentBlocks(
      doc([para(['הקשר היה ', 'מובהק', ' (r = .42, p < .01)', '.\n'])]),
    );

    expect(blocks[0].text).toBe('הקשר היה מובהק (r = .42, p < .01).');
  });

  it('does not collapse runs of spaces or trim inside the paragraph', () => {
    const blocks = extractDocumentBlocks(doc([para(['  שתי  רווחים   כאן  \n'])]));
    expect(blocks[0].text).toBe('  שתי  רווחים   כאן  ');
  });

  it('leaves non-breaking spaces alone', () => {
    const blocks = extractDocumentBlocks(doc([para(['לפני\u00A0אחרי\n'])]));
    expect(blocks[0].text).toBe('לפני\u00A0אחרי');
    expect(blocks[0].text.length).toBe('לפני\u00A0אחרי'.length);
  });

  it('drops only the paragraph terminator, not a trailing blank line of content', () => {
    const blocks = extractDocumentBlocks(doc([para(['שורה ראשונה\u000Bשורה שנייה\n'])]));
    expect(blocks[0].text).toBe('שורה ראשונה\nשורה שנייה');
  });

  it('maps break characters one-for-one so offsets never shift', () => {
    const raw = 'א\u000Bב\u000Cג\n';
    const blocks = extractDocumentBlocks(doc([para([raw])]));
    expect(blocks[0].text.length).toBe(raw.length - 1);
  });

  it('skips empty spacing paragraphs', () => {
    const blocks = extractDocumentBlocks(doc([para(['טקסט\n']), para(['\n']), para(['   \n'])]));
    expect(blocks.length).toBe(1);
  });
});

describe('extractDocumentBlocks — structure', () => {
  it('preserves heading text verbatim', () => {
    const blocks = extractDocumentBlocks(
      doc([para(['הכותרת\n'], 'TITLE'), para(['שיטת המחקר\n'], 'HEADING_2')]),
    );
    expect(blocks.map((b) => b.text)).toEqual(['הכותרת', 'שיטת המחקר']);
    expect(blocks.every((b) => b.type === 'heading')).toBe(true);
  });

  it('indexes blocks in document order', () => {
    const blocks = extractDocumentBlocks(doc([para(['א\n']), para(['ב\n']), para(['ג\n'])]));
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('marks list items', () => {
    const blocks = extractDocumentBlocks(doc([para(['פריט\n'], undefined, { bullet: true })]));
    expect(blocks[0].type).toBe('list_item');
  });

  it('walks table cells so no text is lost', () => {
    const blocks = extractDocumentBlocks(
      doc([
        {
          table: {
            tableRows: [{ tableCells: [{ content: [para(['בתוך טבלה\n'])] }] }],
          },
        },
      ]),
    );
    expect(blocks.map((b) => b.text)).toEqual(['בתוך טבלה']);
  });

  it('ignores a generated table of contents', () => {
    const blocks = extractDocumentBlocks(
      doc([
        { tableOfContents: { content: [para(['מבוא\n'], 'HEADING_2')] } },
        para(['מבוא\n'], 'HEADING_2'),
        para(['גוף\n']),
      ]),
    );
    expect(blocks.map((b) => b.text)).toEqual(['מבוא', 'גוף']);
  });
});

describe('extractDocumentBlocks — heading levels feed sectionsOf', () => {
  it('treats a TITLE as the paper title and HEADING_1 as sections', () => {
    const blocks = extractDocumentBlocks(
      doc([
        para(['כותרת העבודה\n'], 'TITLE'),
        para(['מבוא\n'], 'HEADING_1'),
        para(['גוף\n']),
        para(['ממצאים\n'], 'HEADING_1'),
        para(['גוף\n']),
      ]),
    );

    expect(blocks[0].level).toBe(1);
    expect(sectionsOf(blocks).map((s) => s.title)).toEqual(['מבוא', 'ממצאים']);
  });

  it('treats a HEADING_1 title with HEADING_2 sections the same way', () => {
    const blocks = extractDocumentBlocks(
      doc([
        para(['כותרת העבודה\n'], 'HEADING_1'),
        para(['מבוא\n'], 'HEADING_2'),
        para(['גוף\n']),
        para(['ממצאים\n'], 'HEADING_2'),
        para(['גוף\n']),
      ]),
    );

    expect(sectionsOf(blocks).map((s) => s.title)).toEqual(['מבוא', 'ממצאים']);
  });

  it('does not let TITLE and SUBTITLE be mistaken for sections', () => {
    const blocks = extractDocumentBlocks(
      doc([
        para(['כותרת\n'], 'TITLE'),
        para(['תת־כותרת\n'], 'SUBTITLE'),
        para(['מבוא\n'], 'HEADING_1'),
        para(['גוף\n']),
        para(['ממצאים\n'], 'HEADING_1'),
        para(['גוף\n']),
      ]),
    );

    expect(blocks.slice(0, 2).map((b) => b.level)).toEqual([1, 1]);
    expect(sectionsOf(blocks).map((s) => s.title)).toEqual(['מבוא', 'ממצאים']);
  });

  it('keeps sub-headings below the section level', () => {
    const blocks = extractDocumentBlocks(
      doc([
        para(['כותרת\n'], 'TITLE'),
        para(['שיטה\n'], 'HEADING_1'),
        para(['משתתפים\n'], 'HEADING_2'),
        para(['גוף\n']),
        para(['ממצאים\n'], 'HEADING_1'),
        para(['גוף\n']),
      ]),
    );

    expect(blocks.find((b) => b.text === 'משתתפים')?.level).toBe(3);
    expect(sectionsOf(blocks).map((s) => s.title)).toEqual(['שיטה', 'ממצאים']);
  });
});

describe('extracted documents stay anchorable', () => {
  const source = doc([
    para(['למידה חברתית־רגשית וויסות עצמי\n'], 'TITLE'),
    para(['ממצאים ודיון\n'], 'HEADING_2'),
    para([
      'ניתוח מתאם פירסון העלה כי ',
      'הקשר בין המשתנים היה מובהק',
      ' (r = .42, p < .01). ברגרסיה לינארית מרובה, הקשר נותר מובהק.\n',
    ]),
  ]);

  it('supports offsets located by quote, exactly as the seed data does', () => {
    const blocks = extractDocumentBlocks(source);
    const block = blocks[2];
    const quote = 'הקשר בין המשתנים היה מובהק';
    const start = block.text.indexOf(quote);

    expect(start).toBeGreaterThan(-1);
    expect(block.text.slice(start, start + quote.length)).toBe(quote);
  });

  it('round-trips through renderBlock without losing a character', () => {
    const blocks = extractDocumentBlocks(source);
    const block = blocks[2];
    const quote = 'הקשר בין המשתנים היה מובהק';
    const start = block.text.indexOf(quote);

    const runs = renderBlock(block, [
      {
        id: 'a1',
        submission_id: 's',
        round_id: 'r',
        anchor: {
          block_id: block.id,
          block_index: block.index,
          start,
          end: start + quote.length,
          quote,
        },
        kind: 'content',
        body: 'הערה',
        ai_body: null,
        origin: 'ai',
        edited_by_teacher: false,
        status: 'pending',
        confidence: null,
        grading_category_id: null,
        resolved_in_round: null,
        sort_order: 0,
        created_at: '',
        updated_at: '',
      },
    ]);

    expect(runs.map((r) => r.text).join('')).toBe(block.text);
    expect(runs.find((r) => r.annotation_id)?.text).toBe(quote);
  });

  it('leaves the statistic intact for bidi isolation to find', () => {
    const blocks = extractDocumentBlocks(source);
    const isolated = splitLtrRuns(blocks[2].text)
      .filter((r) => r.ltr)
      .map((r) => r.text);

    expect(isolated).toContain('(r = .42, p < .01)');
  });
});

describe('blocksToText', () => {
  it('joins blocks with a blank line, matching the seeded rounds', () => {
    const blocks = extractDocumentBlocks(doc([para(['א\n']), para(['ב\n'])]));
    expect(blocksToText(blocks)).toBe('א\n\nב');
  });
});
