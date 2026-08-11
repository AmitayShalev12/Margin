import { TestBed } from '@angular/core/testing';

import { AnnotationGenerator } from '../ai/annotation-generator';
import { AnnotateRequest } from '../ai/contract';
import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { seedId } from '../mock/seed-data';
import { SupabaseService } from '../supabase/supabase';

/**
 * The loop, end to end: she decides, the decision is recorded, it survives a
 * reload, and the next draft is conditioned on it.
 *
 * The last link is the one that matters. Logs that accumulate without ever
 * reaching a prompt are a database of good intentions — so the assertions here
 * are on what the Edge Function actually receives.
 */

const NOA = seedId('sub-noa');
const ACCEPTED = seedId('an-4');
const EDITED = seedId('an-5');
const DISMISSED = seedId('an-7');

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

/** A fresh injector over the same durable storage — a browser refresh. */
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

describe('the learning loop', () => {
  const realFetch = globalThis.fetch;
  let sent: AnnotateRequest[];
  /** What the next call comes back with; empty unless a test needs a batch. */
  let reply: { summary: string; annotations: unknown[] };

  beforeEach(() => {
    localStorage.clear();
    sent = [];
    reply = { summary: 'סיכום', annotations: [] };

    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      sent.push(JSON.parse(String(init.body)) as AnnotateRequest);
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  function logFor(store: DataStore, annotationId: string) {
    return store.feedbackLogs().find((l) => l.target_id === annotationId);
  }

  // -- capture --------------------------------------------------------------

  it('records an acceptance, which nothing used to write anywhere', () => {
    const { store } = boot();
    const before = store.annotation(ACCEPTED)!;

    store.setAnnotationStatus(ACCEPTED, 'accepted');

    const entry = logFor(store, ACCEPTED)!;
    expect(entry.action).toBe('accepted');
    expect(entry.ai_text).toBe(before.ai_body);
    // She kept the wording, so the final text is that same wording — not null.
    expect(entry.final_text).toBe(before.body);
    expect(entry.teacher_id).toBe('teacher-1');
  });

  it('records a dismissal with no final text, because there is no final text', () => {
    const { store } = boot();
    store.setAnnotationStatus(DISMISSED, 'dismissed');

    const entry = logFor(store, DISMISSED)!;
    expect(entry.action).toBe('dismissed');
    expect(entry.final_text).toBeNull();
  });

  it('records a rewrite as the before/after pair the annotation already held', () => {
    const { store } = boot();
    const before = store.annotation(EDITED)!;

    store.editAnnotation(EDITED, 'האם באמת אקראי, או נוחות?');

    const entry = logFor(store, EDITED)!;
    expect(entry.action).toBe('edited');
    expect(entry.ai_text).toBe(before.ai_body);
    expect(entry.final_text).toBe('האם באמת אקראי, או נוחות?');
    // Described from the pair, not asserted by hand.
    expect(entry.change_note).toContain('קיצרת');
  });

  it('keeps the student’s own words beside the decision', () => {
    const { store } = boot();
    store.setAnnotationStatus(ACCEPTED, 'accepted');

    expect(logFor(store, ACCEPTED)!.context_excerpt).toBe(store.annotation(ACCEPTED)!.anchor.quote);
  });

  it('treats saving the draft untouched as an acceptance, not a rewrite', () => {
    const { store } = boot();
    const draft = store.annotation(EDITED)!.ai_body!;

    store.editAnnotation(EDITED, draft);

    expect(logFor(store, EDITED)!.action).toBe('accepted');
  });

  it('does not log marking a comment resolved — that is about her student, not her voice', () => {
    const { store } = boot();
    const before = store.feedbackLogs().length;

    store.setAnnotationStatus(ACCEPTED, 'resolved');

    expect(store.feedbackLogs().length).toBe(before);
  });

  /**
   * Changing her mind has to replace the earlier entry. A trail of superseded
   * decisions would teach the model phrasings she has since moved away from.
   */
  it('supersedes an earlier decision on the same comment instead of stacking', () => {
    const { store } = boot();

    store.setAnnotationStatus(ACCEPTED, 'accepted');
    const first = logFor(store, ACCEPTED)!.id;
    store.editAnnotation(ACCEPTED, 'מאיזו מטה־אנליזה?');

    const entries = store.feedbackLogs().filter((l) => l.target_id === ACCEPTED);
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe(first);
    expect(entries[0].action).toBe('edited');
  });

  it('does not log the same decision twice when she taps it again', () => {
    const { store } = boot();

    store.setAnnotationStatus(DISMISSED, 'dismissed');
    const created = logFor(store, DISMISSED)!.created_at;
    store.setAnnotationStatus(DISMISSED, 'dismissed');

    expect(logFor(store, DISMISSED)!.created_at).toBe(created);
  });

  // -- durability -----------------------------------------------------------

  it('brings her decisions back after a reload', async () => {
    const first = boot();
    first.store.setAnnotationStatus(ACCEPTED, 'accepted');
    first.store.editAnnotation(EDITED, 'האם באמת אקראי, או נוחות?');
    first.store.setAnnotationStatus(DISMISSED, 'dismissed');
    await first.store.settled();

    const second = boot();
    await second.store.hydrate();

    expect(logFor(second.store, ACCEPTED)?.action).toBe('accepted');
    expect(logFor(second.store, EDITED)?.final_text).toBe('האם באמת אקראי, או נוחות?');
    expect(logFor(second.store, DISMISSED)?.action).toBe('dismissed');
  });

  it('keeps the log when the comment it came from is deleted', async () => {
    const first = boot();
    first.store.setAnnotationStatus(DISMISSED, 'dismissed');
    const roundId = first.store.roundFor(NOA)!.id;

    // A regenerated batch hard-deletes the round's comments.
    first.store.replaceRoundAnnotations(roundId, []);
    await first.store.settled();

    expect(logFor(first.store, DISMISSED)?.action).toBe('dismissed');

    const second = boot();
    await second.store.hydrate();
    expect(logFor(second.store, DISMISSED)?.action).toBe('dismissed');
  });

  // -- the loop closing -----------------------------------------------------

  it('sends a fresh rewrite to the model, ahead of everything older', async () => {
    const { store, generator } = boot();
    store.editAnnotation(EDITED, 'האם באמת אקראי, או נוחות?');

    await generator.generate(NOA);

    expect(sent[0].style_edits[0]).toEqual(
      expect.objectContaining({ final_text: 'האם באמת אקראי, או נוחות?' }),
    );
  });

  it('sends accepts and dismissals, which used to reach the model as nothing at all', async () => {
    const { store, generator } = boot();
    const accepted = store.annotation(ACCEPTED)!;
    const dismissed = store.annotation(DISMISSED)!;

    store.setAnnotationStatus(ACCEPTED, 'accepted');
    store.setAnnotationStatus(DISMISSED, 'dismissed');

    await generator.generate(NOA);

    expect(sent[0].style_accepted.map((e) => e.ai_text)).toContain(accepted.ai_body);
    expect(sent[0].style_dismissed.map((e) => e.ai_text)).toContain(dismissed.ai_body);
    // With the student's words attached, so a dismissal reads as a judgement
    // about that comment on that text rather than about the whole category.
    expect(
      sent[0].style_dismissed.find((e) => e.ai_text === dismissed.ai_body)?.context_excerpt,
    ).toBe(dismissed.anchor.quote);
  });

  /**
   * The whole claim of this phase, in one test: work through a drafted batch,
   * and the next batch is drafted with those decisions in hand.
   */
  it('measurably shifts what the model is given as she works', async () => {
    const { store, generator } = boot();

    reply = {
      summary: 'סיכום',
      annotations: [
        {
          block_id: 'b-intro',
          quote: 'מחקרים רבים הוכיחו',
          kind: 'language',
          body: '״הוכיחו״ חזק מדי למחקר מתאמי.',
        },
        {
          block_id: 'b-intro',
          quote: 'שאלת המחקר שלי היא האם',
          kind: 'praise',
          body: 'שאלה ממוקדת וניתנת לבדיקה.',
        },
      ],
    };

    await generator.generate(NOA);
    const before = sent[0];

    const roundId = store.roundFor(NOA)!.id;
    const drafted = store.annotations().filter((a) => a.round_id === roundId);
    const kept = drafted.find((a) => a.body === 'שאלה ממוקדת וניתנת לבדיקה.')!;
    const thrownAway = drafted.find((a) => a.body === '״הוכיחו״ חזק מדי למחקר מתאמי.')!;

    store.setAnnotationStatus(kept.id, 'accepted');
    store.setAnnotationStatus(thrownAway.id, 'dismissed');

    reply = { summary: 'סיכום', annotations: [] };
    await generator.generate(NOA);
    const after = sent[1];

    expect(after.style_accepted.length).toBe(before.style_accepted.length + 1);
    expect(after.style_dismissed.length).toBe(before.style_dismissed.length + 1);
    expect(after.style_accepted.map((e) => e.ai_text)).toContain('שאלה ממוקדת וניתנת לבדיקה.');
    expect(after.style_dismissed.map((e) => e.ai_text)).toContain('״הוכיחו״ חזק מדי למחקר מתאמי.');
  });

  it('carries her decisions across a reload into the next draft', async () => {
    const first = boot();
    first.store.setAnnotationStatus(DISMISSED, 'dismissed');
    await first.store.settled();

    const dismissedText = first.store.annotation(DISMISSED)!.ai_body;

    const second = boot();
    await second.store.hydrate();
    await second.generator.generate(NOA);

    expect(sent[0].style_dismissed.map((e) => e.ai_text)).toContain(dismissedText);
  });
});
