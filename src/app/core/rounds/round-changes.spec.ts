import { Annotation, SubmissionRound } from '../models';
import { savedComments } from '../presentation/saved-comments';
import { roundChanges } from './round-changes';

const round = (id: string, number: number, paragraphs: string[]): SubmissionRound =>
  ({
    id,
    submission_id: 'paper',
    round_number: number,
    document_text: paragraphs.join('\n\n'),
    document_blocks: paragraphs.map((text, index) => ({
      id: `b${index + 1}`,
      index,
      type: index === 0 ? 'heading' : 'paragraph',
      text,
    })),
  }) as unknown as SubmissionRound;

const note = (id: string, quote: string, over: Partial<Annotation> = {}): Annotation =>
  ({
    id,
    submission_id: 'paper',
    round_id: 'r1',
    anchor: { block_id: 'b2', block_index: 1, start: 0, end: quote.length, quote },
    kind: 'content',
    body: `הערה על ${quote}`,
    origin: 'ai',
    edited_by_teacher: false,
    status: 'accepted',
    ...over,
  }) as unknown as Annotation;

describe('what a corrected version changed', () => {
  const first = round('r1', 1, ['כותרת', 'משפט ראשון נשאר.', 'משפט שני ישן.']);
  const second = round('r2', 2, ['כותרת', 'משפט ראשון  נשאר.', 'משפט שני מתוקן.', 'פסקה חדשה.']);

  it('marks the paragraphs that are new or rewritten, and not the ones only respaced', () => {
    const changes = roundChanges(first, second, [])!;
    expect([...changes.changedBlockIds]).toEqual(['b3', 'b4']);
  });

  it('says for each kept note whether its sentence is still there', () => {
    const changes = roundChanges(first, second, [
      note('a', 'משפט ראשון נשאר.'),
      note('b', 'משפט שני ישן.'),
      note('removed', 'משפט שני ישן.', { status: 'dismissed' }),
      note('waiting', 'משפט שני ישן.', { status: 'pending' }),
      note('praise', 'משפט שני ישן.', { kind: 'praise' }),
      note('other-round', 'משפט שני ישן.', { round_id: 'r2' }),
    ])!;

    expect(changes.notes.map((n) => [n.id, n.state])).toEqual([
      ['a', 'same'],
      ['b', 'changed'],
    ]);
    expect(changes.handled).toBe(1);
  });

  it('has nothing to say on a first round', () => {
    expect(roundChanges(undefined, first, [])).toBeNull();
    expect(roundChanges(first, first, [])).toBeNull();
  });
});

describe('notes she wrote before', () => {
  const hers = (id: string, body: string, over: Partial<Annotation> = {}) =>
    note(id, 'x', { body, origin: 'teacher', ...over });

  it('offers her own wording, most used first, and never the model s', () => {
    const all = [
      hers('1', 'חסר מקור.'),
      hers('2', 'חסר מקור.'),
      hers('3', 'לפצל למשפטים קצרים.', { kind: 'language' }),
      note('4', 'x', { body: 'ניסוח של המודל' }),
      note('5', 'x', { body: 'ניסוח שהיא ערכה', edited_by_teacher: true }),
      hers('6', 'הערה שהסירה', { status: 'dismissed' }),
    ];

    expect(savedComments(all, '', 'content')).toEqual(['חסר מקור.', 'ניסוח שהיא ערכה', 'לפצל למשפטים קצרים.']);
    // The kind she is writing comes first.
    expect(savedComments(all, '', 'language')[0]).toBe('לפצל למשפטים קצרים.');
    // Typing narrows, and what she has already typed in full is not offered back.
    expect(savedComments(all, 'מקור', 'content')).toEqual(['חסר מקור.']);
    expect(savedComments(all, 'חסר מקור.', 'content')).toEqual([]);
  });
});
