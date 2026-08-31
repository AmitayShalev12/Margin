import { TestBed } from '@angular/core/testing';

import { DataStore } from './data-store';
import { LocalRepository } from './local-repository';
import { Repository } from './repository';
import { seedId } from '../mock/seed-data';
import { seedStore } from '../mock/seed-store';
import { SupabaseService } from '../supabase/supabase';

/**
 * Taking a decision back.
 *
 * Asked for in the plainest terms — "lets say i regret clicking edit/ decline
 * or accept on a comment" — and until it existed a click was final the instant
 * it happened, with no recovery but writing the comment again by hand.
 *
 * The half that is easy to forget is the learning log. A decision she reverses
 * has to stop teaching the model, and it fails silently if it doesn't: the log
 * is read a year later, by which time nothing connects a phrasing the model
 * favours to an edit she took back thirty seconds after making it.
 */

const NOA = seedId('sub-noa');
/** Accepted in the fixture, so it is already on the grading form. */
const ACCEPTED = seedId('an-1');
/** Rewritten by her in the fixture — its body and its ai_body differ. */
const EDITED = seedId('an-3');
/** Undecided in the fixture. */
const PENDING = seedId('an-4');

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

/** A fresh injector over the same durable storage — a browser refresh. */
function boot(): DataStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  const store = TestBed.inject(DataStore);
  seedStore(store);
  return store;
}

function logFor(store: DataStore, id: string) {
  return store.feedbackLogs().find((l) => l.target_type === 'annotation' && l.target_id === id);
}

beforeEach(() => localStorage.clear());

describe('undoing a decision', () => {
  it('puts a comment she just accepted back among the undecided', () => {
    const store = boot();
    store.setAnnotationStatus(PENDING, 'accepted');

    store.undoDecision(PENDING);

    expect(store.annotation(PENDING)?.status).toBe('pending');
  });

  it('goes back to the state before the last decision, not to the beginning', () => {
    const store = boot();

    // Two decisions in a row: undo returns to the accepted one between them,
    // which is what she means by taking back the click she just made.
    store.setAnnotationStatus(PENDING, 'accepted');
    store.setAnnotationStatus(PENDING, 'dismissed');

    store.undoDecision(PENDING);

    expect(store.annotation(PENDING)?.status).toBe('accepted');
  });

  it('restores the wording she replaced when undoing an edit', () => {
    const store = boot();
    const before = store.annotation(PENDING)!;

    store.editAnnotation(PENDING, 'ניסוח אחר לגמרי שלה');
    expect(store.annotation(PENDING)?.body).toBe('ניסוח אחר לגמרי שלה');

    store.undoDecision(PENDING);

    expect(store.annotation(PENDING)?.body).toBe(before.body);
    expect(store.annotation(PENDING)?.edited_by_teacher).toBe(before.edited_by_teacher);
  });

  /**
   * The one that fails silently. The log is keyed on the comment and read as
   * the record of what she wanted; an edit she took back that stays in it
   * teaches the model a phrasing she rejected.
   */
  it('stops a reversed decision from teaching the model', () => {
    const store = boot();

    store.editAnnotation(PENDING, 'ניסוח שלה שהיא מיד מתחרטת עליו');
    expect(logFor(store, PENDING)).toBeDefined();

    store.undoDecision(PENDING);

    expect(logFor(store, PENDING)).toBeUndefined();
  });

  it('leaves the log alone for comments she did not touch', () => {
    const store = boot();

    store.editAnnotation(PENDING, 'ניסוח שלה');
    store.setAnnotationStatus(ACCEPTED, 'dismissed');

    store.undoDecision(ACCEPTED);

    expect(logFor(store, PENDING)).toBeDefined();
  });

  it('refuses to undo a comment she has not decided on', () => {
    const store = boot();

    expect(store.canUndo(PENDING)).toBe(false);
    store.undoDecision(PENDING);

    expect(store.annotation(PENDING)?.status).toBe('pending');
  });

  /**
   * A comment of hers was never pending. Returning it to "awaiting a decision"
   * would invent a step that never happened and leave it looking undrafted.
   */
  it('returns a comment she wrote herself to accepted, not to pending', () => {
    const store = boot();
    const round = store.roundFor(NOA)!;
    const target = store.annotations().find((a) => a.round_id === round.id)!;

    const mine = store.addOwnAnnotation({
      submissionId: NOA,
      roundId: round.id,
      anchor: target.anchor,
      kind: 'content',
      body: 'הערה שכתבתי בעצמי',
    });
    expect(mine).toBeTruthy();

    store.setAnnotationStatus(mine!.id, 'dismissed');
    store.undoDecision(mine!.id);

    expect(store.annotation(mine!.id)?.status).toBe('accepted');
    expect(store.annotation(mine!.id)?.body).toBe('הערה שכתבתי בעצמי');
  });

  it('brings a dismissed comment back onto the grading form', () => {
    const store = boot();
    const lines = () => store.gradingEntries().filter((e) => e.submission_id === NOA).length;

    // Measured after the dismissal: the form is derived, and nothing has
    // rebuilt it yet on a freshly seeded store.
    store.setAnnotationStatus(ACCEPTED, 'dismissed');
    const without = lines();

    store.undoDecision(ACCEPTED);

    expect(lines()).toBe(without + 1);
  });
});

describe('undoing a decision made before this session', () => {
  /**
   * The exact previous state is held in memory, so anything decided in an
   * earlier sitting has none. That is the ordinary case, not the exception —
   * she opens a paper she marked last week — and the button still has to work.
   * One that is there sometimes and not others, with the difference being
   * whether the page happened to reload, teaches her it is unreliable rather
   * than teaching her the rule.
   */
  it('still offers the way back', () => {
    const store = boot();

    // Decided in the fixture; nothing in this session ever touched it.
    expect(store.annotation(ACCEPTED)?.status).toBe('accepted');
    expect(store.canUndo(ACCEPTED)).toBe(true);
  });

  it('falls back to the undecided state', () => {
    const store = boot();

    store.undoDecision(ACCEPTED);

    expect(store.annotation(ACCEPTED)?.status).toBe('pending');
  });

  it('falls back to the model’s own draft, not her rewrite of it', () => {
    const store = boot();
    const rewritten = store.annotation(EDITED)!;
    // The fixture's edited comment: her wording and the model's differ.
    expect(rewritten.body).not.toBe(rewritten.ai_body);

    store.undoDecision(EDITED);

    expect(store.annotation(EDITED)?.body).toBe(rewritten.ai_body);
    expect(store.annotation(EDITED)?.status).toBe('pending');
    expect(store.annotation(EDITED)?.edited_by_teacher).toBe(false);
  });
});
