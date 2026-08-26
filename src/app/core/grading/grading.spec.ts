import {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  DocumentBlock,
  GradingFormCategory,
  GradingFormEntry,
  StudentGradingForm,
} from '../models';
import { STARTING_CATEGORIES, buildCategories, categoryFor, isStartingSet } from './categories';
import { buildEntries, countsTowardGrade, groupByCategory } from './entries';
import { buildTranslations } from './student-form-generator';

const COURSE = 'c0000000-0000-4000-8000-00000000000a';

const BLOCKS: DocumentBlock[] = [
  { id: 'b-title', index: 0, type: 'heading', level: 1, text: 'סמינריון' },
  { id: 'b-h-method', index: 1, type: 'heading', level: 2, text: 'שיטת המחקר' },
  {
    id: 'b-method',
    index: 2,
    type: 'paragraph',
    text: 'המדגם נבחר באופן אקראי מבין תלמידות השכבה.',
  },
  { id: 'b-h-findings', index: 3, type: 'heading', level: 2, text: 'ממצאים ודיון' },
  {
    id: 'b-findings',
    index: 4,
    type: 'paragraph',
    text: 'הקשר בין המשתנים היה מובהק (r = .42, p < .01).',
  },
];

function annotation(overrides: Partial<Annotation> & { block_id: string }): Annotation {
  const block = BLOCKS.find((b) => b.id === overrides.block_id)!;
  return {
    id: `an-${overrides.block_id}-${overrides.kind ?? 'content'}`,
    submission_id: 'sub-1',
    round_id: 'r1',
    anchor: {
      block_id: block.id,
      block_index: block.index,
      start: 0,
      end: 5,
      quote: block.text.slice(0, 5),
    },
    kind: (overrides.kind ?? 'content') as AnnotationKind,
    body: 'הערה',
    ai_body: 'הערה',
    origin: 'ai',
    edited_by_teacher: false,
    status: (overrides.status ?? 'accepted') as AnnotationStatus,
    confidence: null,
    grading_category_id: null,
    resolved_in_round: null,
    sort_order: 0,
    posted_comment_id: null,
    posted_at: null,
    marker_number: null,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

const CATEGORIES = buildCategories(COURSE, []);
const named = (name: string) => CATEGORIES.find((c) => c.name.includes(name))!;

describe('the grading form categories', () => {
  it('starts a course with headings shaped like a research paper', () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual(STARTING_CATEGORIES.map((t) => t.name));
    expect(CATEGORIES.every((c) => c.course_id === COURSE)).toBe(true);
  });

  it('gives the same course the same category ids every time', () => {
    expect(buildCategories(COURSE, []).map((c) => c.id)).toEqual(CATEGORIES.map((c) => c.id));
  });

  /**
   * The point of the whole feature: her form, not ours. A course with history
   * must not have our starting set imposed over the headings she already uses.
   */
  it('uses her own headings from a previous year rather than the starting set', () => {
    const hers: GradingFormCategory[] = [
      {
        id: 'k1',
        course_id: COURSE,
        name: 'עומק הניתוח',
        description: null,
        origin: 'teacher',
        section: null,
        max_points: null,
        manual_only: false,
        sort_order: 1,
        active: true,
        created_at: '2025-09-01T09:00:00.000Z',
        updated_at: '2025-09-01T09:00:00.000Z',
      },
      {
        id: 'k0',
        course_id: COURSE,
        name: 'שאלת המחקר',
        description: null,
        origin: 'teacher',
        section: null,
        max_points: null,
        manual_only: false,
        sort_order: 0,
        active: true,
        created_at: '2025-09-01T09:00:00.000Z',
        updated_at: '2025-09-01T09:00:00.000Z',
      },
    ];

    const built = buildCategories(COURSE, hers);
    expect(built.map((c) => c.name)).toEqual(['שאלת המחקר', 'עומק הניתוח']);
  });

  it('leaves out a heading she switched off', () => {
    const hers = buildCategories(COURSE, []).map((c, i) => ({ ...c, active: i !== 0 }));
    expect(buildCategories(COURSE, hers).length).toBe(CATEGORIES.length - 1);
  });
});

describe('placing a comment on the form', () => {
  it('files it under the section of the paper it sits in', () => {
    const inMethod = annotation({ block_id: 'b-method', kind: 'content' });
    expect(categoryFor(inMethod, BLOCKS, CATEGORIES)?.name).toBe(named('שיטת').name);
  });

  it('reads a conjunction-prefixed heading word', () => {
    // "ממצאים ודיון" has to reach the דיון heading as well as ממצאים.
    const inFindings = annotation({ block_id: 'b-findings', kind: 'content' });
    expect(categoryFor(inFindings, BLOCKS, CATEGORIES)?.name).toContain('ממצאים');
  });

  /**
   * A strength is a strength wherever it appears. Filing praise from the
   * findings chapter under "findings" would bury it among the corrections.
   */
  it('keeps praise with praise rather than with the chapter it appeared in', () => {
    const praise = annotation({ block_id: 'b-findings', kind: 'praise' });
    expect(categoryFor(praise, BLOCKS, CATEGORIES)?.name).toBe('חוזקות');
  });

  it('falls back to the kind of comment when the section says nothing', () => {
    const language = annotation({ block_id: 'b-title', kind: 'language' });
    expect(categoryFor(language, BLOCKS, CATEGORIES)?.name).toContain('לשון');
  });

  it('matches headings she wrote herself, not only ours', () => {
    const hers = buildCategories(COURSE, [
      {
        id: 'k1',
        course_id: COURSE,
        name: 'המקורות והביבליוגרפיה',
        description: null,
        origin: 'teacher',
        section: null,
        max_points: null,
        manual_only: false,
        sort_order: 0,
        active: true,
        created_at: '2025-09-01T09:00:00.000Z',
        updated_at: '2025-09-01T09:00:00.000Z',
      },
    ]);

    const sources = annotation({ block_id: 'b-method', kind: 'sources' });
    expect(categoryFor(sources, BLOCKS, hers)?.name).toBe('המקורות והביבליוגרפיה');
  });
});

describe('building the form from a review', () => {
  it('takes only the comments she stood behind', () => {
    expect(countsTowardGrade('accepted')).toBe(true);
    expect(countsTowardGrade('edited')).toBe(true);
    expect(countsTowardGrade('resolved')).toBe(true);
    expect(countsTowardGrade('pending')).toBe(false);
    expect(countsTowardGrade('dismissed')).toBe(false);
  });

  it('uses her wording, not the draft she replaced', () => {
    const edited = annotation({
      block_id: 'b-method',
      status: 'edited',
      body: 'האם באמת אקראי, או נוחות?',
      ai_body: 'המדגם מתואר כאקראי אך תיאור ההליך אינו תומך בכך.',
      edited_by_teacher: true,
    });

    const entries = buildEntries('sub-1', [edited], () => BLOCKS, CATEGORIES);
    expect(entries[0].body).toBe('האם באמת אקראי, או נוחות?');
    // The draft is kept alongside, for the learning loop — not shown as the line.
    expect(entries[0].ai_body).toBe('המדגם מתואר כאקראי אך תיאור ההליך אינו תומך בכך.');
  });

  it('leaves dismissed and undecided comments off the form', () => {
    const annotations = [
      annotation({ block_id: 'b-method', kind: 'content', status: 'dismissed' }),
      annotation({ block_id: 'b-findings', kind: 'content', status: 'pending' }),
    ];
    expect(buildEntries('sub-1', annotations, () => BLOCKS, CATEGORIES)).toEqual([]);
  });

  /**
   * Recomputed rather than accumulated, so the form follows her in both
   * directions — otherwise a comment she changed her mind about lives on it
   * forever.
   */
  it('produces the same row for the same comment, so it never duplicates', () => {
    const one = annotation({ block_id: 'b-method', status: 'accepted' });
    const first = buildEntries('sub-1', [one], () => BLOCKS, CATEGORIES);
    const second = buildEntries('sub-1', [one], () => BLOCKS, CATEGORIES);
    expect(first[0].id).toBe(second[0].id);
  });

  it('keeps lines she wrote herself, which are derived from nothing', () => {
    const mine: GradingFormEntry = {
      id: 'mine-1',
      submission_id: 'sub-1',
      category_id: CATEGORIES[0].id,
      annotation_id: null,
      body: 'דיברנו על זה בכיתה.',
      ai_body: null,
      origin: 'teacher',
      edited_by_teacher: true,
      sort_order: 99,
      created_at: '2026-08-01T09:00:00.000Z',
      updated_at: '2026-08-01T09:00:00.000Z',
    };

    const entries = buildEntries('sub-1', [], () => BLOCKS, CATEGORIES, [mine]);
    expect(entries).toEqual([mine]);
  });

  it('keeps empty headings on the form, because an empty one says something', () => {
    const one = annotation({ block_id: 'b-method', status: 'accepted' });
    const groups = groupByCategory(
      buildEntries('sub-1', [one], () => BLOCKS, CATEGORIES),
      CATEGORIES,
    );

    expect(groups.length).toBe(CATEGORIES.length);
    expect(groups.filter((g) => g.entries.length === 0).length).toBe(CATEGORIES.length - 1);
  });

  /**
   * A comment from an earlier round is categorised against the document it was
   * written on, not the one currently open.
   *
   * Handing every annotation the current round's blocks silently dropped every
   * earlier-round comment into the fallback heading — on a form that still
   * looked complete, which is the way this build has repeatedly been bitten.
   */
  it('categorises a comment against its own round, not the open one', () => {
    const OLD_BLOCKS = [
      { id: 'b-old', index: 0, type: 'heading' as const, level: 2, text: 'שיטת המחקר' },
      { id: 'b-old-body', index: 1, type: 'paragraph' as const, text: 'המדגם נבחר באופן אקראי.' },
    ];
    // Built from a block that exists, then pointed at the old round's — the
    // helper resolves `block_id` against the current document by design.
    const earlier: Annotation = {
      ...annotation({ block_id: 'b-method', status: 'accepted' }),
      round_id: 'round-old',
      kind: 'content',
      anchor: { block_id: 'b-old-body', block_index: 1, start: 0, end: 6, quote: 'המדגם' },
    };

    const byRound = (roundId: string) => (roundId === 'round-old' ? OLD_BLOCKS : BLOCKS);
    const entries = buildEntries('sub-1', [earlier], byRound, CATEGORIES);

    const heading = CATEGORIES.find((c) => c.name === 'שיטת המחקר');
    expect(entries.length).toBe(1);
    expect(entries[0].category_id).toBe(heading?.id);
  });
});

describe('learning how she talks to students', () => {
  const entries: GradingFormEntry[] = [
    {
      id: 'e1',
      submission_id: 'sub-1',
      category_id: 'cat-method',
      annotation_id: null,
      body: 'אין אלפא לתת־סולמות.',
      ai_body: null,
      origin: 'ai',
      edited_by_teacher: false,
      sort_order: 0,
      created_at: '2026-01-01T09:00:00.000Z',
      updated_at: '2026-01-01T09:00:00.000Z',
    },
    {
      id: 'e2',
      submission_id: 'sub-1',
      category_id: 'cat-findings',
      annotation_id: null,
      body: 'מובהק בלי גודל אפקט.',
      ai_body: null,
      origin: 'ai',
      edited_by_teacher: false,
      sort_order: 1,
      created_at: '2026-01-01T09:00:00.000Z',
      updated_at: '2026-01-01T09:00:00.000Z',
    },
  ];

  function form(overrides: Partial<StudentGradingForm> = {}): StudentGradingForm {
    return {
      id: 'f1',
      student_id: 's1',
      course_id: COURSE,
      year: 'תשפ״ה',
      sections: [
        {
          title: 'שיטה',
          body: 'שווה להוסיף את מדד המהימנות לכל תת־סולם — זה מחזק את מה שבנית.',
          category_id: 'cat-method',
        },
      ],
      summary: 'שנה יפה.',
      status: 'sent',
      edited_by_teacher: false,
      source_entry_ids: ['e1', 'e2'],
      approved_at: null,
      sent_at: '2026-06-01T09:00:00.000Z',
      created_at: '2026-06-01T09:00:00.000Z',
      updated_at: '2026-06-01T09:00:00.000Z',
      ...overrides,
    };
  }

  /**
   * The pairing is the feature. A section beside the internal notes from its
   * own category is what teaches the transformation; the year's notes beside
   * the year's letter teaches almost nothing.
   */
  it('pairs each section with the internal notes from its own category', () => {
    const pairs = buildTranslations([form()], entries);

    expect(pairs.length).toBe(1);
    expect(pairs[0].internal).toEqual(['אין אלפא לתת־סולמות.']);
    expect(pairs[0].student).toContain('מדד המהימנות');
  });

  it('ignores a form she never sent, which is not evidence of anything', () => {
    expect(buildTranslations([form({ status: 'draft', sent_at: null })], entries)).toEqual([]);
  });

  it('ignores a form whose internal lines have since been deleted', () => {
    expect(buildTranslations([form()], [])).toEqual([]);
  });

  it('has nothing to teach from in a first year, and says so by being empty', () => {
    expect(buildTranslations([], entries)).toEqual([]);
  });
});

/**
 * Whether the headings are hers, said honestly.
 *
 * The failure this guards against is the one that hides: a grading form built
 * from seed constants does not error, it produces a plausible-looking result
 * under headings nobody chose. `origin` is the only thing that can tell the
 * two apart a year later.
 */
describe('where the headings came from', () => {
  it('does not call the default set learned', () => {
    const categories = buildCategories('course-1', []);

    expect(categories.length).toBe(STARTING_CATEGORIES.length);
    // Nothing was learned — there was no history to learn from.
    expect(categories.every((c) => c.origin === 'starting')).toBe(true);
    expect(categories.some((c) => c.origin === 'learned')).toBe(false);
    expect(isStartingSet(categories)).toBe(true);
  });

  it('carries her own headings over untouched, and stops calling it a start', () => {
    const hers: GradingFormCategory[] = [
      {
        id: 'c-hers',
        course_id: 'course-1',
        name: 'עומק הניתוח',
        description: null,
        origin: 'learned',
        section: null,
        max_points: null,
        manual_only: false,
        sort_order: 0,
        active: true,
        created_at: '2025-09-01T09:00:00.000Z',
        updated_at: '2025-09-01T09:00:00.000Z',
      },
    ];

    const categories = buildCategories('course-1', hers);

    expect(categories.map((c) => c.name)).toEqual(['עומק הניתוח']);
    expect(isStartingSet(categories)).toBe(false);
  });

  it('is not a starting set when she has edited one of them', () => {
    const mixed = buildCategories('course-1', []).map((c, i) =>
      i === 0 ? { ...c, origin: 'teacher' as const } : c,
    );

    // She has touched it, so it is no longer purely a default.
    expect(isStartingSet(mixed)).toBe(false);
  });

  it('claims nothing about an empty set', () => {
    expect(isStartingSet([])).toBe(false);
  });
});
