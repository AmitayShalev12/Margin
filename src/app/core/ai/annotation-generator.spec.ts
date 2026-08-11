import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { seedId } from '../mock/seed-data';
import { SupabaseService } from '../supabase/supabase';
import { AnnotationGenerator } from './annotation-generator';
import { AnnotateRequest } from './contract';

/**
 * The generator is exercised end to end against the real seeded course — its
 * rules, materials, style examples and past edits — with only the network
 * faked. What the Edge Function receives is asserted, because the knowledge
 * base being assembled correctly is the whole substance of the feature.
 */

const NOA = seedId('sub-noa');

class FakeSupabase {
  isConfigured = true;
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function boot() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  return {
    store: TestBed.inject(DataStore),
    generator: TestBed.inject(AnnotationGenerator),
  };
}

describe('AnnotationGenerator', () => {
  const realFetch = globalThis.fetch;
  let sent: AnnotateRequest[];

  function respondWith(body: unknown, status = 200) {
    sent = [];
    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      sent.push(JSON.parse(String(init.body)) as AnnotateRequest);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }

  beforeEach(() => {
    localStorage.clear();
    sent = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  // -- what the model is given ---------------------------------------------

  it('tells the function which categories are allowed, so it cannot invent one', async () => {
    respondWith({ summary: 'סיכום', annotations: [] });
    const { generator } = boot();
    await generator.generate(NOA);

    expect(sent[0].allowed_kinds.sort()).toEqual(
      ['content', 'formatting', 'language', 'other', 'praise', 'sources', 'structure'].sort(),
    );
  });

  it('sends the course knowledge base, not a summary of it', async () => {
    respondWith({ summary: 'סיכום', annotations: [] });
    const { generator } = boot();
    await generator.generate(NOA);

    const request = sent[0];

    // Her own rules, verbatim.
    expect(request.rules.map((r) => r.body)).toContain(
      'מתאם אינו סיבתיות — לא לכתוב ״גורם ל…״ במערך מתאמי.',
    );
    // Rules pulled from the web are included but marked, so they can be
    // deferred to her own.
    expect(request.rules.some((r) => r.origin === 'web')).toBe(true);
    // Syllabus, model assignments and her example corrections.
    expect(request.materials.map((m) => m.kind)).toEqual(
      expect.arrayContaining(['syllabus', 'model_assignment', 'example_correction']),
    );
  });

  it('omits rules and materials she has switched off', async () => {
    respondWith({ summary: 'סיכום', annotations: [] });
    const { store, generator } = boot();
    await generator.generate(NOA);

    const inactiveRule = store.courseRules.find((r) => !r.active);
    expect(inactiveRule).toBeTruthy();
    expect(sent[0].rules.map((r) => r.body)).not.toContain(inactiveRule!.body);
  });

  it('sends her style examples and her past rewrites, newest rewrite first', async () => {
    respondWith({ summary: 'סיכום', annotations: [] });
    const { store, generator } = boot();
    await generator.generate(NOA);

    const request = sent[0];
    expect(request.style_examples.length).toBe(
      store.styleExamples().filter((e) => e.active).length,
    );
    expect(request.style_examples.map((e) => e.teacher_text)).toContain(
      'מדגם נוחות זה בסדר גמור. פשוט תכתבי שזה מה שזה.',
    );

    // Both halves of every rewrite — the pair is what carries the voice.
    expect(request.style_edits.length).toBeGreaterThan(0);
    for (const edit of request.style_edits) {
      expect(edit.ai_text).toBeTruthy();
      expect(edit.final_text).toBeTruthy();
    }
    const dates = request.style_edits.map((e) => e.final_text);
    expect(dates[0]).toBe('מה האלפא של קרונבך לכל תת־סולם? מספר אחד לכל אחד יספיק.');
  });

  it('sends the document as blocks with their ids, so quotes can be anchored back', async () => {
    respondWith({ summary: 'סיכום', annotations: [] });
    const { store, generator } = boot();
    await generator.generate(NOA);

    const blocks = store.roundFor(NOA)!.document_blocks!;
    expect(sent[0].blocks.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    // Text goes across untouched — the offsets are computed against it.
    expect(sent[0].blocks.map((b) => b.text)).toEqual(blocks.map((b) => b.text));
  });

  // -- what comes back ------------------------------------------------------

  it('turns drafted comments into anchored annotations on the round', async () => {
    respondWith({
      summary: 'סימנתי בעיקר ניסוחים חזקים מדי ומקורות חסרים.',
      annotations: [
        {
          block_id: 'b-intro',
          quote: 'מחקרים רבים הוכיחו',
          kind: 'language',
          body: '״הוכיחו״ חזק מדי למחקר מתאמי.',
        },
        {
          block_id: 'b-findings',
          quote: 'הקשר בין המשתנים היה מובהק',
          kind: 'content',
          body: 'מובהק זה לא הכול — כמה גדול האפקט?',
        },
      ],
    });

    const { store, generator } = boot();
    const result = await generator.generate(NOA);
    await store.settled();

    expect(result).toEqual({ created: 2, discarded: 0 });

    const round = store.roundFor(NOA)!;
    const annotations = store.annotations().filter((a) => a.round_id === round.id);
    expect(annotations.length).toBe(2);

    const blocks = round.document_blocks!;
    for (const annotation of annotations) {
      const block = blocks.find((b) => b.id === annotation.anchor.block_id)!;
      expect(block.text.slice(annotation.anchor.start, annotation.anchor.end)).toBe(
        annotation.anchor.quote,
      );
      expect(annotation.origin).toBe('ai');
      expect(annotation.status).toBe('pending');
      // Captured up front — there is no second chance once she rewrites it.
      expect(annotation.ai_body).toBe(annotation.body);
    }
  });

  it('replaces the round’s previous batch rather than stacking on it', async () => {
    respondWith({
      summary: 'ראשון',
      annotations: [
        { block_id: 'b-intro', quote: 'מחקרים רבים הוכיחו', kind: 'language', body: 'א' },
      ],
    });
    const { store, generator } = boot();
    await generator.generate(NOA);
    await store.settled();

    respondWith({
      summary: 'שני',
      annotations: [
        { block_id: 'b-intro', quote: 'שאלת המחקר שלי היא האם', kind: 'praise', body: 'ב' },
      ],
    });
    await generator.generate(NOA);
    await store.settled();

    const round = store.roundFor(NOA)!;
    const annotations = store.annotations().filter((a) => a.round_id === round.id);
    expect(annotations.length).toBe(1);
    expect(annotations[0].body).toBe('ב');
  });

  it('reports comments it had to discard instead of quietly shortening the batch', async () => {
    respondWith({
      summary: 'סיכום',
      annotations: [
        { block_id: 'b-intro', quote: 'מחקרים רבים הוכיחו', kind: 'language', body: 'טוב' },
        { block_id: 'b-intro', quote: 'ציטוט שלא קיים בטקסט', kind: 'content', body: 'רע' },
        { block_id: 'b-nope', quote: 'מחקרים רבים הוכיחו', kind: 'content', body: 'רע' },
      ],
    });

    const { generator } = boot();
    const result = await generator.generate(NOA);

    expect(result).toEqual({ created: 1, discarded: 2 });
    expect(generator.state().discarded).toBe(2);
  });

  // -- the batch confirmation ----------------------------------------------

  it('stores the restatement unconfirmed, so the teacher reads it first', async () => {
    respondWith({
      summary: 'סימנתי בעיקר ניסוחים חזקים מדי.',
      annotations: [
        { block_id: 'b-intro', quote: 'מחקרים רבים הוכיחו', kind: 'language', body: 'הערה' },
      ],
    });

    const { store, generator } = boot();
    await generator.generate(NOA);

    const round = store.roundFor(NOA)!;
    expect(round.ai_summary).toBe('סימנתי בעיקר ניסוחים חזקים מדי.');
    expect(round.ai_summary_confirmed_at).toBeNull();
  });

  it('confirms the whole batch in one pass, not per comment', async () => {
    respondWith({
      summary: 'סיכום',
      annotations: [
        { block_id: 'b-intro', quote: 'מחקרים רבים הוכיחו', kind: 'language', body: 'א' },
        { block_id: 'b-intro', quote: 'שאלת המחקר שלי היא האם', kind: 'praise', body: 'ב' },
      ],
    });

    const { store, generator } = boot();
    await generator.generate(NOA);
    generator.confirmBatch(store.roundFor(NOA)!.id);

    expect(store.roundFor(NOA)!.ai_summary_confirmed_at).toBeTruthy();
    // Confirming is not a decision about any single comment.
    const annotations = store.annotations().filter((a) => a.round_id === store.roundFor(NOA)!.id);
    expect(annotations.every((a) => a.status === 'pending')).toBe(true);
  });

  it('discarding a batch removes its comments and its restatement', async () => {
    respondWith({
      summary: 'סיכום',
      annotations: [
        { block_id: 'b-intro', quote: 'מחקרים רבים הוכיחו', kind: 'language', body: 'א' },
      ],
    });

    const { store, generator } = boot();
    await generator.generate(NOA);
    const roundId = store.roundFor(NOA)!.id;
    generator.discardBatch(roundId);
    await store.settled();

    expect(store.annotations().filter((a) => a.round_id === roundId)).toEqual([]);
    expect(store.roundFor(NOA)!.ai_summary).toBeNull();
  });

  // -- persistence and failure ---------------------------------------------

  it('persists the batch through the repository, so it survives a reload', async () => {
    respondWith({
      summary: 'סיכום שנשמר',
      annotations: [
        { block_id: 'b-intro', quote: 'מחקרים רבים הוכיחו', kind: 'language', body: 'הערה' },
      ],
    });

    const first = boot();
    await first.generator.generate(NOA);
    first.generator.confirmBatch(first.store.roundFor(NOA)!.id);
    await first.store.settled();

    const before = first.store
      .annotations()
      .filter((a) => a.round_id === first.store.roundFor(NOA)!.id);

    // --- reload ---
    const second = boot();
    await second.store.hydrate();

    const round = second.store.roundFor(NOA)!;
    const after = second.store.annotations().filter((a) => a.round_id === round.id);

    expect(after.map((a) => a.id).sort()).toEqual(before.map((a) => a.id).sort());
    expect(after[0].ai_body).toBe('הערה');
    expect(round.ai_summary).toBe('סיכום שנשמר');
    expect(round.ai_summary_confirmed_at).toBeTruthy();
  });

  it('surfaces a failure in Hebrew and writes nothing', async () => {
    respondWith({ error: 'generation_failed' }, 502);
    const { store, generator } = boot();

    const before = store.annotations().length;
    const result = await generator.generate(NOA);

    expect(result).toBeNull();
    expect(generator.state().phase).toBe('error');
    expect(generator.state().message).toBeTruthy();
    expect(store.annotations().length).toBe(before);
  });

  /**
   * SEL coursework legitimately discusses distress and family difficulty, so a
   * content filter will occasionally stop on a perfectly ordinary paper. The
   * teacher has to be told the document is fine and the automatic pass isn't.
   */
  it('tells her the work is fine when a content filter blocked the pass', async () => {
    respondWith({ error: 'safety_blocked' }, 422);
    const { generator } = boot();

    await generator.generate(NOA);
    const message = generator.state().message!;

    expect(message).toContain('לא עבר עיבוד אוטומטי');
    expect(message).toContain('תעברי עליה ישירות');
  });

  it('distinguishes a momentary rate limit from the daily cap', async () => {
    respondWith({ error: 'rate_limited' }, 429);
    const { generator } = boot();
    await generator.generate(NOA);
    expect(generator.state().message).toContain('עוד רגע');

    respondWith({ error: 'daily_cap' }, 429);
    await generator.generate(NOA);
    expect(generator.state().message).toContain('מחר');
  });

  it('reports a truncated reply as its own failure rather than a generic one', async () => {
    respondWith({ error: 'bad_response' }, 502);
    const { generator } = boot();
    await generator.generate(NOA);
    expect(generator.state().message).toContain('לא הייתה שלמה');
  });

  it('falls back to a generic message for a code it does not recognise', async () => {
    respondWith({ error: 'something_new' }, 502);
    const { generator } = boot();
    await generator.generate(NOA);
    expect(generator.state().message).toContain('משהו השתבש');
  });

  it('refuses to run on a submission with no extracted document', async () => {
    respondWith({ summary: '', annotations: [] });
    const { store, generator } = boot();

    store.replaceRoundDocument(store.roundFor(NOA)!.id, {
      document_blocks: null,
      document_text: null,
    });

    expect(await generator.generate(NOA)).toBeNull();
    expect(sent.length).toBe(0);
  });
});
