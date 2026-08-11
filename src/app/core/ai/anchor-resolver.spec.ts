import { DOCUMENT_BLOCKS } from '../mock/seed-data';
import { renderBlock, splitLtrRuns } from '../presentation/document-render';
import { Annotation } from '../models';
import { resolveAnnotations, splitsNotation } from './anchor-resolver';
import { DraftAnnotation } from './contract';

/**
 * These run against the real seeded document — the same blocks Phase 2's
 * anchor tests use — so an anchor produced here is verified the same way a
 * hand-written one is.
 */

const INTRO = DOCUMENT_BLOCKS.find((b) => b.id === 'b-intro')!;
const FINDINGS = DOCUMENT_BLOCKS.find((b) => b.id === 'b-findings')!;

function draft(overrides: Partial<DraftAnnotation> = {}): DraftAnnotation {
  return {
    block_id: 'b-intro',
    quote: 'מחקרים רבים הוכיחו',
    kind: 'language',
    body: '״הוכיחו״ חזק מדי למחקר מתאמי.',
    ...overrides,
  };
}

describe('resolveAnnotations — against the seeded document', () => {
  it('locates a quote and produces an anchor that resolves back to it', () => {
    const { resolved, rejected } = resolveAnnotations([draft()], DOCUMENT_BLOCKS);

    expect(rejected).toEqual([]);
    const anchor = resolved[0].anchor;
    expect(anchor.block_id).toBe('b-intro');
    expect(anchor.block_index).toBe(INTRO.index);
    // The same assertion Phase 2's seed-data spec makes of every anchor.
    expect(INTRO.text.slice(anchor.start, anchor.end)).toBe(anchor.quote);
  });

  it('produces anchors renderBlock can weave back in without losing a character', () => {
    const { resolved } = resolveAnnotations(
      [
        draft(),
        draft({
          quote: 'שאלת המחקר שלי היא האם',
          kind: 'praise',
          body: 'שאלת מחקר ממוקדת. בדיוק כך.',
        }),
      ],
      DOCUMENT_BLOCKS,
    );

    const annotations = resolved.map(
      (r, i) =>
        ({
          id: `a${i}`,
          submission_id: 's',
          round_id: 'r',
          anchor: r.anchor,
          kind: r.draft.kind,
          body: r.draft.body,
          ai_body: r.draft.body,
          origin: 'ai',
          edited_by_teacher: false,
          status: 'pending',
          confidence: null,
          grading_category_id: null,
          resolved_in_round: null,
          sort_order: i,
          created_at: '',
          updated_at: '',
        }) satisfies Annotation,
    );

    const runs = renderBlock(INTRO, annotations);
    expect(runs.map((r) => r.text).join('')).toBe(INTRO.text);
    expect(runs.filter((r) => r.annotation_id).length).toBe(2);
  });

  it('sorts the batch into document order', () => {
    const { resolved } = resolveAnnotations(
      [
        draft({
          block_id: 'b-discussion',
          quote: 'ניתן להסיק כי התוכנית גורמת',
          kind: 'structure',
        }),
        draft({ quote: 'שאלת המחקר שלי היא האם' }),
        draft({ quote: 'מחקרים רבים הוכיחו' }),
      ],
      DOCUMENT_BLOCKS,
    );

    const order = resolved.map((r) => [r.anchor.block_index, r.anchor.start]);
    expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  it('discards a quote the model altered rather than guessing where it meant', () => {
    // One character changed — a fuzzy matcher would land this on real words.
    const { resolved, rejected } = resolveAnnotations(
      [draft({ quote: 'מחקרים רבים הוכיח' + 'ן' })],
      DOCUMENT_BLOCKS,
    );

    expect(resolved).toEqual([]);
    expect(rejected[0].reason).toBe('quote_not_found');
  });

  it('discards a quote for a block that is not in the document', () => {
    const { rejected } = resolveAnnotations([draft({ block_id: 'b-nope' })], DOCUMENT_BLOCKS);
    expect(rejected[0].reason).toBe('unknown_block');
  });

  it('refuses a category the review screen has no colour for', () => {
    const { rejected } = resolveAnnotations(
      [draft({ kind: 'severity' as never })],
      DOCUMENT_BLOCKS,
    );
    expect(rejected[0].reason).toBe('unknown_kind');
  });

  it('accepts all seven real kinds, neutral ones included', () => {
    const kinds = ['language', 'structure', 'sources', 'content', 'praise', 'formatting', 'other'];
    const quotes = [
      'מחקרים רבים הוכיחו',
      'תוכניות למידה חברתית־רגשית תורמות לוויסות עצמי',
      'שיפור של כ־11% במדדי ויסות עצמי',
      'שאלת המחקר שלי היא האם',
      'בעשור האחרון',
      'בקרב מתבגרים',
      'בהשוואה לקבוצות ביקורת',
    ];

    const { resolved, rejected } = resolveAnnotations(
      kinds.map((kind, i) => draft({ kind: kind as never, quote: quotes[i] })),
      DOCUMENT_BLOCKS,
    );

    expect(rejected).toEqual([]);
    expect(resolved.length).toBe(7);
  });

  it('drops an empty comment or an empty quote', () => {
    const { rejected } = resolveAnnotations(
      [draft({ body: '   ' }), draft({ quote: '' })],
      DOCUMENT_BLOCKS,
    );
    expect(rejected.map((r) => r.reason)).toEqual(['empty', 'empty']);
  });

  it('refuses a quote that appears twice in one block instead of picking', () => {
    const { rejected } = resolveAnnotations(
      // "ויסות עצמי" occurs more than once in the intro paragraph.
      [draft({ quote: 'ויסות עצמי' })],
      DOCUMENT_BLOCKS,
    );
    expect(rejected[0].reason).toBe('quote_ambiguous');
  });

  it('keeps only the first comment when two land on the same span', () => {
    const { resolved, rejected } = resolveAnnotations([draft(), draft()], DOCUMENT_BLOCKS);
    expect(resolved.length).toBe(1);
    expect(rejected[0].reason).toBe('duplicate_span');
  });
});

describe('anchors never split bidi-isolated notation', () => {
  const STAT = '(r = .42, p < .01)';

  it('the seeded findings paragraph really does contain an isolated run', () => {
    expect(FINDINGS.text).toContain(STAT);
    expect(splitLtrRuns(FINDINGS.text).some((r) => r.ltr && r.text === STAT)).toBe(true);
  });

  it('rejects an anchor that ends part-way into the statistic', () => {
    const statStart = FINDINGS.text.indexOf(STAT);
    // A quote running from the start of the clause into the middle of "(r = .42".
    const quote = FINDINGS.text.slice(0, statStart + 6);

    const { resolved, rejected } = resolveAnnotations(
      [draft({ block_id: 'b-findings', quote, kind: 'content' })],
      DOCUMENT_BLOCKS,
    );

    expect(resolved).toEqual([]);
    expect(rejected[0].reason).toBe('splits_notation');
  });

  it('rejects an anchor that starts part-way into the statistic', () => {
    const statStart = FINDINGS.text.indexOf(STAT);
    const quote = FINDINGS.text.slice(statStart + 4, statStart + 40);

    const { rejected } = resolveAnnotations(
      [draft({ block_id: 'b-findings', quote, kind: 'content' })],
      DOCUMENT_BLOCKS,
    );

    expect(rejected[0].reason).toBe('splits_notation');
  });

  it('allows an anchor that contains the whole statistic', () => {
    const statStart = FINDINGS.text.indexOf(STAT);
    const quote = FINDINGS.text.slice(0, statStart + STAT.length);

    const { resolved, rejected } = resolveAnnotations(
      [draft({ block_id: 'b-findings', quote, kind: 'content' })],
      DOCUMENT_BLOCKS,
    );

    expect(rejected).toEqual([]);
    expect(resolved[0].anchor.quote).toContain(STAT);
  });

  it('allows an anchor that stops cleanly before the statistic', () => {
    const { rejected } = resolveAnnotations(
      [draft({ block_id: 'b-findings', quote: 'הקשר בין המשתנים היה מובהק', kind: 'content' })],
      DOCUMENT_BLOCKS,
    );
    expect(rejected).toEqual([]);
  });

  it('splitsNotation is only true for a genuine bisection', () => {
    const start = FINDINGS.text.indexOf(STAT);
    expect(splitsNotation(FINDINGS.text, start, start + STAT.length)).toBe(false);
    expect(splitsNotation(FINDINGS.text, 0, start)).toBe(false);
    expect(splitsNotation(FINDINGS.text, start + 2, start + STAT.length)).toBe(true);
    expect(splitsNotation(FINDINGS.text, start, start + 5)).toBe(true);
  });
});
