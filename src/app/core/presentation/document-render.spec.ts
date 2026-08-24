import { Annotation, DocumentBlock } from '../models';
import { renderBlock, sectionsOf, splitLtrRuns } from './document-render';

function block(id: string, index: number, text: string, level?: number): DocumentBlock {
  return {
    id,
    index,
    text,
    type: level === undefined ? 'paragraph' : 'heading',
    ...(level === undefined ? {} : { level }),
  };
}

function annotation(id: string, blockId: string, text: string, quote: string): Annotation {
  const start = text.indexOf(quote);
  return {
    id,
    submission_id: 'sub',
    round_id: 'round',
    anchor: { block_id: blockId, block_index: 0, start, end: start + quote.length, quote },
    kind: 'language',
    body: 'הערה',
    ai_body: null,
    origin: 'ai',
    edited_by_teacher: false,
    status: 'pending',
    confidence: null,
    grading_category_id: null,
    resolved_in_round: null,
    sort_order: 0,
    posted_comment_id: null,
    posted_at: null,
    marker_number: null,
    created_at: '',
    updated_at: '',
  };
}

describe('splitLtrRuns', () => {
  it('isolates a statistical expression so its brackets survive RTL', () => {
    const runs = splitLtrRuns('הקשר היה מובהק (r = .42, p < .01). ברגרסיה');
    expect(runs.filter((r) => r.ltr).map((r) => r.text)).toEqual(['(r = .42, p < .01)']);
  });

  it('leaves the sentence-final full stop outside the isolate', () => {
    const runs = splitLtrRuns('מובהק (r = .42). ואז');
    const after = runs[runs.indexOf(runs.find((r) => r.ltr)!) + 1];
    expect(after.text.startsWith('.')).toBe(true);
  });

  it('isolates a Latin term embedded in Hebrew', () => {
    const runs = splitLtrRuns('שאלון SEL בן 24 היגדים');
    expect(runs.filter((r) => r.ltr).map((r) => r.text)).toEqual(['SEL']);
  });

  it('leaves bare Hebrew and numbers alone — they are already correct', () => {
    const runs = splitLtrRuns('במחקר השתתפו 214 תלמידים, שיפור של כ־11%');
    expect(runs.every((r) => !r.ltr)).toBe(true);
  });

  it('reassembles to the original text', () => {
    const text = 'ניתוח פירסון (r = .42, p < .01) על שאלון SEL בן 24 היגדים.';
    expect(
      splitLtrRuns(text)
        .map((r) => r.text)
        .join(''),
    ).toBe(text);
  });
});

describe('renderBlock', () => {
  const text = 'בעשור האחרון מחקרים רבים הוכיחו שהתוכנית תורמת לוויסות עצמי.';
  const b = block('b1', 0, text);

  it('splits the paragraph at the anchor and marks only the quoted span', () => {
    const a = annotation('a1', 'b1', text, 'מחקרים רבים הוכיחו');
    const runs = renderBlock(b, [a]);

    const marked = runs.filter((r) => r.annotation_id);
    expect(marked.length).toBe(1);
    expect(marked[0].text).toBe('מחקרים רבים הוכיחו');
    expect(marked[0].annotation_id).toBe('a1');
  });

  it('never loses or duplicates a character', () => {
    const a = annotation('a1', 'b1', text, 'מחקרים רבים הוכיחו');
    expect(
      renderBlock(b, [a])
        .map((r) => r.text)
        .join(''),
    ).toBe(text);
  });

  it('leaves no trace of a dismissed comment', () => {
    const a = {
      ...annotation('a1', 'b1', text, 'מחקרים רבים הוכיחו'),
      status: 'dismissed' as const,
    };
    expect(renderBlock(b, [a]).some((r) => r.annotation_id)).toBe(false);
  });

  it('ignores annotations anchored to a different block', () => {
    const a = annotation('a1', 'other', text, 'מחקרים רבים הוכיחו');
    expect(renderBlock(b, [a]).some((r) => r.annotation_id)).toBe(false);
  });

  it('keeps the first comment when two anchors overlap', () => {
    const first = annotation('a1', 'b1', text, 'מחקרים רבים הוכיחו');
    const second = annotation('a2', 'b1', text, 'רבים הוכיחו שהתוכנית');
    const runs = renderBlock(b, [first, second]);

    expect(runs.filter((r) => r.annotation_id).map((r) => r.annotation_id)).toEqual(['a1']);
    expect(runs.map((r) => r.text).join('')).toBe(text);
  });
});

describe('sectionsOf', () => {
  const blocks = [
    block('title', 0, 'כותרת העבודה', 1),
    block('h1', 1, 'מבוא', 2),
    block('p1', 2, 'פסקה'),
    block('h2', 3, 'ממצאים', 2),
    block('p2', 4, 'פסקה'),
    block('p3', 5, 'פסקה'),
  ];

  it('derives one section per level-2 heading, ignoring the title', () => {
    expect(sectionsOf(blocks).map((s) => s.title)).toEqual(['מבוא', 'ממצאים']);
  });

  it('assigns every following block to its section', () => {
    expect(sectionsOf(blocks).map((s) => s.block_indexes)).toEqual([[2], [4, 5]]);
  });

  it('keeps a sub-heading inside its section rather than opening a new one', () => {
    const withSub = [
      block('title', 0, 'כותרת', 1),
      block('h1', 1, 'שיטה', 2),
      block('h1a', 2, 'משתתפים', 3),
      block('p1', 3, 'פסקה'),
    ];
    const sections = sectionsOf(withSub);

    expect(sections.map((s) => s.title)).toEqual(['שיטה']);
    expect(sections[0].block_indexes).toEqual([2, 3]);
  });

  it('opens an unnamed section for text that precedes any heading', () => {
    const sections = sectionsOf([block('p0', 0, 'פסקה יתומה'), ...blocks.slice(1)]);
    expect(sections[0].title).toBe('פתיחה');
    expect(sections[0].block_indexes).toEqual([0]);
  });
});
