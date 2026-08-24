import { TestBed } from '@angular/core/testing';

import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { seedId } from '../mock/seed-data';
import { SupabaseService } from '../supabase/supabase';
import { CommentPoster, commentText } from './comment-poster';
import { isMarker, markerChar } from './markers';
import {
  DriveApi,
  DriveWriteRefused,
  isAnchoredCommentInsert,
  isCommentCreation,
  isMarkerEditBatch,
} from './drive-api';
import { GoogleDriveAuth } from './google-auth';
import { seedStore } from '../mock/seed-store';

/**
 * Putting the teacher's comments on a student's Google Doc.
 *
 * Two properties matter more than the feature itself and are asserted hardest:
 * that nothing in this app can modify the student's writing, and that a comment
 * is never posted against text she no longer wrote. Everything else — counts,
 * duplicate suppression, the report — is in service of those.
 */

const NOA = seedId('sub-noa');
const FILE_ID = '1kuoBsMEMf_Pbet0cRbvAI9y_BmgxcyQe';

/** A Docs response built from the seeded round, so quotes match by default. */
function docsPayload(paragraphs: string[], anchorable = false) {
  let index = 1;
  return {
    documentId: FILE_ID,
    body: {
      content: paragraphs.map((text) => {
        const startIndex = index;
        index += text.length + 1;
        return {
          startIndex,
          paragraph: {
            // Google reports a start index per element. Without one no
            // character can be positioned, and anchoring correctly declines.
            elements: [
              anchorable
                ? {
                    startIndex,
                    textRun: {
                      content: `${text}
`,
                    },
                  }
                : {
                    textRun: {
                      content: `${text}
`,
                    },
                  },
            ],
          },
        };
      }),
    },
  };
}

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  session = () => ({ access_token: 'jwt' });
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

class FakeAuth {
  granted = true;
  accessToken = async () => 'drive-token';
  invalidate = () => undefined;
  needsCommentConsent = () => !this.granted;
  commentConsentMessage = () => (this.granted ? null : 'צריך לאשר את ההרשאה בגוגל.');
  connect = async () => undefined;
  busy = () => false;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

describe('posting comments to the document', () => {
  const realFetch = globalThis.fetch;

  let store: DataStore;
  let poster: CommentPoster;
  let auth: FakeAuth;
  let calls: Call[];
  /** The document as Drive currently has it. */
  let paragraphs: string[];
  let commentStatus = 200;
  let commentSeq = 0;
  /** What a refusing Drive answers with — the reason is what gets classified. */
  let commentBody: unknown = { error: { message: 'nope' } };
  /** Whether the fake document reports positions the anchored path can use. */
  let anchorable = false;
  /** What the Docs anchoring endpoint answers with. */
  let anchorStatus = 200;

  beforeEach(async () => {
    localStorage.clear();
    calls = [];
    commentStatus = 200;
    commentSeq = 0;
    commentBody = { error: { message: 'nope' } };
    anchorable = false;
    anchorStatus = 200;
    auth = new FakeAuth();

    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        url: String(url),
        method,
        body: init.body ? JSON.parse(String(init.body)) : null,
      });

      if (String(url).includes(':batchUpdate')) {
        return new Response(JSON.stringify({}), { status: anchorStatus });
      }
      if (String(url).includes('docs.googleapis.com')) {
        return new Response(JSON.stringify(docsPayload(paragraphs, anchorable)), { status: 200 });
      }
      if (commentStatus !== 200) {
        return new Response(JSON.stringify(commentBody), { status: commentStatus });
      }
      commentSeq += 1;
      return new Response(JSON.stringify({ id: `comment-${commentSeq}` }), { status: 200 });
    }) as typeof fetch;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: new FakeSupabase() },
        { provide: Repository, useClass: LocalRepository },
        { provide: GoogleDriveAuth, useValue: auth },
        DriveApi,
      ],
    });

    store = TestBed.inject(DataStore);

    // The app starts empty; these are the fixture records the test reads.

    seedStore(store);
    poster = TestBed.inject(CommentPoster);

    // The seeded submission, made to look like it came from Drive.
    store.updateSubmission(NOA, { drive_file_id: FILE_ID });

    // The document as synced: every seeded comment's quote is present.
    paragraphs = (store.roundFor(NOA)?.document_blocks ?? []).map((b) => b.text);

    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    store.editAnnotation(seedId('an-5'), 'האם באמת אקראי, או מדגם נוחות?');
    store.setAnnotationStatus(seedId('an-7'), 'dismissed');
    await store.settled();
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  const commentCalls = () => calls.filter((c) => c.url.includes('/comments'));

  // -- the guarantee --------------------------------------------------------

  /**
   * The scope Margin now holds could rewrite a student's paper. The only thing
   * preventing it is this, so it is asserted rather than trusted.
   */
  it('never issues a request that could change the document', async () => {
    await poster.post(NOA);

    for (const call of calls) {
      if (call.method === 'GET') continue;
      // Every non-GET must be a comment creation, and nothing else.
      expect(isCommentCreation(call.url)).toBe(true);
    }

    // Everything sent to the Docs write endpoint is either a comment insertion
    // or a marker edit bounded to one character. That endpoint can also delete
    // and replace her text, and this is what says it never will.
    for (const call of calls.filter((c) => c.url.includes(':batchUpdate'))) {
      const permitted =
        isAnchoredCommentInsert(call.url, call.body) || isMarkerEditBatch(call.url, call.body);
      expect(permitted).toBe(true);
    }
    // Every other Docs call is a read.
    expect(
      calls
        .filter((c) => c.url.includes('docs.googleapis.com') && !c.url.includes(':batchUpdate'))
        .every((c) => c.method === 'GET'),
    ).toBe(true);
  });

  it('anchors the comment to the text when Docs allows it', async () => {
    anchorable = true;

    const report = await poster.post(NOA);

    expect(report!.anchored).toBe(true);
    const comments = calls.filter((c) => isAnchoredCommentInsert(c.url, c.body));
    expect(comments.length).toBeGreaterThan(0);

    for (const call of comments) {
      const body = call.body as {
        requests: { insertComment: { range: { startIndex: number } } }[];
      };
      expect(body.requests[0].insertComment.range.startIndex).toBeGreaterThan(0);
    }
    // The unanchored endpoint was not needed.
    expect(commentCalls().length).toBe(0);
  });

  /**
   * Anchoring is in Developer Preview, so an account outside it is refused —
   * a reason to fall back, not a failed send.
   */
  it('falls back to an unanchored comment when anchoring is refused', async () => {
    anchorable = true;
    anchorStatus = 403;

    const report = await poster.post(NOA);

    expect(report!.anchored).toBe(false);
    expect(report!.posted).toBeGreaterThan(0);
    expect(report!.failed).toBe(false);
    // Refused once, then not attempted again for the remaining comments. The
    // marker batch is the other write to that endpoint, and is not a retry.
    expect(calls.filter((c) => isAnchoredCommentInsert(c.url, c.body)).length).toBe(1);
    expect(commentCalls().length).toBe(report!.posted);
  });

  it('refuses a document write before it reaches the network', async () => {
    const api = TestBed.inject(DriveApi) as unknown as {
      post: (url: string, body: object) => Promise<unknown>;
    };
    const before = calls.length;

    const forbidden = [
      `https://docs.googleapis.com/v1/documents/${FILE_ID}:batchUpdate`,
      `https://www.googleapis.com/drive/v3/files/${FILE_ID}`,
      `https://www.googleapis.com/drive/v3/files/${FILE_ID}/permissions`,
      `https://www.googleapis.com/drive/v3/files/${FILE_ID}/comments/c1/replies`,
    ];

    for (const url of forbidden) {
      await expect(api.post(url, {})).rejects.toBeInstanceOf(DriveWriteRefused);
    }
    // Refused means refused: not one of them was sent.
    expect(calls.length).toBe(before);
  });

  it('sends only the comment text, with no anchor', async () => {
    await poster.post(NOA);

    for (const call of commentCalls()) {
      expect(Object.keys(call.body as object)).toEqual(['content']);
    }
  });

  // -- what gets posted -----------------------------------------------------

  it('posts the comments she approved and nothing else', async () => {
    // Derived, not hardcoded: the seeded round already carries decisions of
    // its own, and pinning a number here would be pinning the fixture.
    const expected = poster.waiting(NOA).length;
    expect(expected).toBeGreaterThan(1);

    const report = await poster.post(NOA);

    expect(report!.posted).toBe(expected);
    expect(commentCalls().length).toBe(expected);

    const sent = commentCalls().map((c) => (c.body as { content: string }).content);
    // Her rewrite, not the model's original.
    expect(sent.some((text) => text.includes('האם באמת אקראי, או מדגם נוחות?'))).toBe(true);
    expect(sent.some((text) => text.includes(store.annotation(seedId('an-5'))!.ai_body!))).toBe(
      false,
    );

    // A dismissed comment never reaches a student, and neither does a pending
    // one — sending is a decision, not a flush.
    const dismissed = store.annotation(seedId('an-7'))!;
    expect(sent.some((text) => text.includes(dismissed.body))).toBe(false);
    for (const pending of store.annotations().filter((a) => a.status === 'pending')) {
      expect(sent.some((text) => text.includes(pending.body))).toBe(false);
    }
  });

  it('carries the quoted sentence, since Drive cannot anchor the comment', async () => {
    // Document order, so the sidebar reads down the paper.
    const first = poster.waiting(NOA)[0];
    await poster.post(NOA);

    const content = (commentCalls()[0].body as { content: string }).content;
    expect(content).toContain(`״${first.anchor.quote}״`);
    expect(content).toContain(first.body);
  });

  it('names the section so an unanchored comment is still findable', () => {
    expect(commentText('ההערה', 'הציטוט', 'שיטת המחקר')).toBe('שיטת המחקר · ״הציטוט״\n\nההערה');
    expect(commentText('ההערה', 'הציטוט', null)).toBe('״הציטוט״\n\nההערה');
  });

  // -- sending twice --------------------------------------------------------

  it('records the Drive comment id on each annotation it posts', async () => {
    await poster.post(NOA);

    const posted = store.annotation(seedId('an-4'))!;
    expect(posted.posted_comment_id).toMatch(/^comment-/);
    expect(posted.posted_at).toBeTruthy();
  });

  it('posts nothing the second time when nothing has changed', async () => {
    await poster.post(NOA);
    const after = commentCalls().length;

    const again = await poster.post(NOA);

    expect(again).toBeNull();
    expect(poster.message()).toContain('כבר נמצאות במסמך');
    expect(commentCalls().length).toBe(after);
  });

  it('posts only what is new on a re-send after further review', async () => {
    const firstSend = poster.waiting(NOA).length;
    await poster.post(NOA);
    calls = [];

    // She comes back and approves one more.
    const next = store.annotations().find((a) => a.status === 'pending')!;
    store.setAnnotationStatus(next.id, 'accepted');

    const report = await poster.post(NOA);

    expect(report!.posted).toBe(1);
    expect(report!.skipped).toBe(firstSend);
    expect(commentCalls().length).toBe(1);
    expect((commentCalls()[0].body as { content: string }).content).toContain(next.body);
  });

  /**
   * The screen showed "19 are on the document" beside "12 the email was
   * written from" — two true numbers about different rounds, presented as if
   * they were about the same one.
   */
  it('counts only this round when reporting what is already on the document', async () => {
    // An earlier round of the same submission, with a comment already posted.
    const round = store.roundFor(NOA)!;
    store.addRound({ ...round, id: 'older-round', round_number: round.round_number - 1 });
    const stray = store.annotations().find((a) => a.status === 'accepted')!;
    store.markAnnotationPosted(stray.id, 'comment-from-last-time');
    await store.settled();

    const thisRound = poster.waiting(NOA).length;
    const report = await poster.post(NOA);

    // `skipped` is this round's, not every round's.
    expect(report!.posted).toBe(thisRound);
    expect(report!.skipped).toBeLessThanOrEqual(thisRound);
  });

  it('survives a reload without forgetting what it already sent', async () => {
    await poster.post(NOA);
    await store.settled();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: new FakeSupabase() },
        { provide: Repository, useClass: LocalRepository },
        { provide: GoogleDriveAuth, useValue: auth },
        DriveApi,
      ],
    });
    const reloaded = TestBed.inject(DataStore);
    // The app starts empty; these are the fixture records the test reads.
    seedStore(reloaded);
    await reloaded.hydrate();

    expect(reloaded.annotation(seedId('an-4'))?.posted_comment_id).toMatch(/^comment-/);
    expect(TestBed.inject(CommentPoster).waiting(NOA)).toEqual([]);
  });

  // -- anchoring failures ---------------------------------------------------

  it('does not post a comment whose sentence the student has rewritten', async () => {
    const waiting = poster.waiting(NOA);
    const victim = waiting[0];
    // Only that one sentence changes; the rest of the paragraph stands.
    paragraphs = paragraphs.map((text) => text.replace(victim.anchor.quote, 'נוסח אחר לגמרי'));

    const report = await poster.post(NOA);

    expect(report!.unplaced.map((u) => u.id)).toContain(victim.id);
    expect(report!.posted).toBe(waiting.length - report!.unplaced.length);
    // Not posted means not recorded as posted — a later send can still carry
    // it once she has looked at it.
    expect(store.annotation(victim.id)!.posted_comment_id).toBeNull();
    expect(
      commentCalls().some((c) => (c.body as { content: string }).content.includes(victim.body)),
    ).toBe(false);
  });

  it('reports partial success as partial, not as sent', async () => {
    const waiting = poster.waiting(NOA);
    const victim = waiting[0];
    paragraphs = paragraphs.map((text) => text.replace(victim.anchor.quote, 'טקסט אחר'));

    const report = await poster.post(NOA);

    // Some went, one did not, and the report says both rather than rounding.
    expect(report!.posted).toBeGreaterThan(0);
    expect(report!.posted).toBeLessThan(waiting.length);
    expect(report!.unplaced.length).toBe(1);
    // The quote and her wording, so she can place it by hand.
    expect(report!.unplaced[0].quote).toBe(victim.anchor.quote);
    expect(report!.unplaced[0].body).toBe(victim.body);
  });

  // -- failures -------------------------------------------------------------

  it('raises the save banner when Drive refuses, rather than failing quietly', async () => {
    commentStatus = 403;

    const report = await poster.post(NOA);

    expect(report!.failed).toBe(true);
    expect(report!.posted).toBe(0);
    // The same path every other lost write takes.
    expect(store.persistError()).not.toBeNull();
    expect(store.unsavedCount()).toBeGreaterThan(0);
  });

  it('posts the comments for real when she retries a failed send', async () => {
    const waiting = poster.waiting(NOA).length;
    commentStatus = 500;
    await poster.post(NOA);
    expect(store.unsavedCount()).toBe(waiting);

    commentStatus = 200;
    const saved = await store.retryFailedWrites();

    expect(saved).toBe(true);
    expect(store.annotation(seedId('an-4'))!.posted_comment_id).toMatch(/^comment-/);
    expect(store.persistError()).toBeNull();
  });

  /**
   * The pre-flight check reads a scope list that lives in the Edge Functions,
   * so between changing that list and deploying them it says the grant is
   * complete and Drive refuses anyway. She still has to be asked.
   */
  it('asks for the permission when Drive refuses even though the check passed', async () => {
    auth.granted = true;
    commentStatus = 403;
    // Google's real shape, reason field and all — the earlier fixture left it
    // out and classified as a plain refusal, which is the wrong ask entirely.
    commentBody = {
      error: {
        code: 403,
        message: 'Request had insufficient authentication scopes.',
        errors: [
          {
            message: 'Insufficient Permission',
            domain: 'global',
            reason: 'insufficientPermissions',
          },
        ],
        status: 'PERMISSION_DENIED',
      },
    };

    const report = await poster.post(NOA);

    expect(report!.failed).toBe(true);
    expect(poster.needsReconnect()).toBe(true);
    expect(poster.message()).toContain('לקריאה בלבד');
    expect(poster.message()).toContain('להתחבר מחדש');
  });

  /**
   * A missing permission is not unsaved work.
   *
   * Queuing it meant the banner came back on every attempt claiming the
   * afternoon's review would be lost if she closed the page — while the
   * comments sat safely in the database and only their trip to the document
   * had failed. And the queue could never empty, because retrying without the
   * permission fails identically every time.
   */
  it('does not queue a permission problem as work that could be lost', async () => {
    commentStatus = 403;
    commentBody = {
      error: {
        code: 403,
        message: 'Request had insufficient authentication scopes.',
        errors: [{ reason: 'insufficientPermissions' }],
      },
    };

    await poster.post(NOA);

    expect(poster.needsReconnect()).toBe(true);
    // Nothing queued, so no banner promising lost work and no futile retry.
    expect(store.unsavedCount()).toBe(0);
    expect(store.persistError()).toBeNull();
  });

  /** Everything else still is queued, because retrying it genuinely helps. */
  it('still queues an ordinary failure for a retry that can work', async () => {
    commentStatus = 500;

    await poster.post(NOA);

    expect(store.unsavedCount()).toBeGreaterThan(0);
    expect(store.persistError()).not.toBeNull();
  });

  it('does not ask for a permission when the refusal was something else', async () => {
    commentStatus = 500;

    await poster.post(NOA);

    expect(poster.needsReconnect()).toBe(false);
  });

  it('asks for the new permission instead of letting Drive refuse it', async () => {
    auth.granted = false;

    const report = await poster.post(NOA);

    expect(report).toBeNull();
    expect(poster.message()).toContain('לאשר');
    // Nothing was attempted — she is asked first.
    expect(calls).toEqual([]);
  });

  it('says so when the submission never came from Drive', async () => {
    store.updateSubmission(NOA, { drive_file_id: null });

    expect(await poster.post(NOA)).toBeNull();
    expect(poster.message()).toContain('לא הגיעה מהדרייב');
    expect(calls).toEqual([]);
  });
});

/**
 * The markers Margin puts in the student's document.
 *
 * This is the one place the app adds anything to her writing, so what is
 * pinned here is the bounding of it: one glyph per comment, never a second,
 * never renumbered, never at a guessed position, and removable.
 */
describe('numbered markers', () => {
  let store: DataStore;
  let poster: CommentPoster;
  const realFetch = globalThis.fetch;

  let calls: Call[];
  let paragraphs: string[];
  let batchStatus = 200;

  function boot() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: new FakeSupabase() },
        { provide: Repository, useClass: LocalRepository },
        { provide: GoogleDriveAuth, useValue: new FakeAuth() },
        DriveApi,
      ],
    });
    store = TestBed.inject(DataStore);
    // The app starts empty; these are the fixture records the test reads.
    seedStore(store);
    poster = TestBed.inject(CommentPoster);
  }

  beforeEach(async () => {
    localStorage.clear();
    calls = [];
    batchStatus = 200;

    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      if (String(url).includes(':batchUpdate')) {
        return new Response(JSON.stringify({}), { status: batchStatus });
      }
      if (String(url).includes('docs.googleapis.com')) {
        return new Response(JSON.stringify(docsPayload(paragraphs, true)), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'c1' }), { status: 200 });
    }) as typeof fetch;

    boot();
    store.updateSubmission(NOA, { drive_file_id: FILE_ID });
    paragraphs = (store.roundFor(NOA)?.document_blocks ?? []).map((b) => b.text);
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    await store.settled();
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  const markerBatches = () => calls.filter((c) => isMarkerEditBatch(c.url, c.body));

  it('places one glyph per comment, coloured by category', async () => {
    const expected = poster.waiting(NOA).length;
    const report = await poster.post(NOA);

    expect(report!.markers).toBe(expected);

    const requests = markerBatches().flatMap(
      (c) => (c.body as { requests: Record<string, { text?: string }>[] }).requests,
    );
    const inserts = requests.filter((r) => 'insertText' in r);
    const styles = requests.filter((r) => 'updateTextStyle' in r);

    expect(inserts.length).toBe(expected);
    // One colouring per glyph, never a range of her text.
    expect(styles.length).toBe(expected);
    for (const insert of inserts) {
      expect(isMarker(insert['insertText'].text!)).toBe(true);
    }
  });

  /** Requirement 4: a later insertion must not shift an earlier position. */
  it('inserts back to front, so no position drifts', async () => {
    await poster.post(NOA);

    const inserts = markerBatches()
      .flatMap(
        (c) =>
          (c.body as { requests: Record<string, { location?: { index: number } }>[] }).requests,
      )
      .filter((r) => 'insertText' in r)
      .map((r) => r['insertText'].location!.index);

    expect(inserts.length).toBeGreaterThan(1);
    // Strictly descending: each insertion is earlier in the document than the
    // one before it, so the indices measured beforehand stay valid.
    for (let i = 1; i < inserts.length; i++) {
      expect(inserts[i]).toBeLessThan(inserts[i - 1]);
    }
  });

  it('records the number, and the comment carries the same one', async () => {
    await poster.post(NOA);

    const marked = store.annotations().filter((a) => a.marker_number !== null);
    expect(marked.length).toBeGreaterThan(0);

    for (const annotation of marked) {
      const glyph = markerChar(annotation.marker_number!)!;
      const comment = calls.find(
        (c) =>
          isAnchoredCommentInsert(c.url, c.body) &&
          JSON.stringify(c.body).includes(annotation.body.slice(0, 20)),
      );
      // The glyph in the text and the number on the note are the anchor.
      expect(JSON.stringify(comment?.body)).toContain(glyph);
    }
  });

  /** Requirement 3: a re-send must not duplicate or renumber. */
  it('leaves an existing marker exactly as it is on a re-send', async () => {
    await poster.post(NOA);
    const before = store
      .annotations()
      .filter((a) => a.marker_number !== null)
      .map((a) => [a.id, a.marker_number] as const);
    calls = [];

    // She approves one more and sends again.
    const next = store.annotations().find((a) => a.status === 'pending')!;
    store.setAnnotationStatus(next.id, 'accepted');
    const report = await poster.post(NOA);

    // Only the new one got a glyph.
    expect(report!.markers).toBe(1);
    for (const [id, number] of before) {
      expect(store.annotation(id)!.marker_number).toBe(number);
    }
    // And its number continues rather than repeating.
    expect(store.annotation(next.id)!.marker_number).toBe(before.length + 1);
  });

  /** Requirement 6: no marker at a guessed position. */
  it('places no marker where the quoted text has gone', async () => {
    const victim = poster.waiting(NOA)[0];
    paragraphs = paragraphs.map((t) => t.replace(victim.anchor.quote, 'נוסח אחר לגמרי'));

    const report = await poster.post(NOA);

    expect(store.annotation(victim.id)!.marker_number).toBeNull();
    expect(report!.unplaced.map((u) => u.id)).toContain(victim.id);
  });

  it('takes its own markers back out, and only those', async () => {
    await poster.post(NOA);
    const placed = store.annotations().filter((a) => a.marker_number !== null);
    expect(placed.length).toBeGreaterThan(0);

    // The document now contains the glyphs.
    paragraphs = paragraphs.map((text, i) =>
      i === 0 ? `${markerChar(placed[0].marker_number!)}${text}` : text,
    );
    calls = [];

    const result = await poster.removeMarkers(NOA);

    expect(result!.failed).toBe(false);
    const deletes = markerBatches().flatMap(
      (c) =>
        (
          c.body as {
            requests: Record<string, { range: { startIndex: number; endIndex: number } }>[];
          }
        ).requests,
    );
    // Every deletion spans exactly one character.
    for (const request of deletes) {
      const range = request['deleteContentRange'].range;
      expect(range.endIndex - range.startIndex).toBe(1);
    }
    expect(store.annotation(placed[0].id)!.marker_number).toBeNull();
  });

  it('surfaces a failed marker insert without losing the comments', async () => {
    batchStatus = 500;

    const report = await poster.post(NOA);

    expect(report!.markers).toBe(0);
    // The comments still went, by the unanchored route.
    expect(report!.posted).toBeGreaterThan(0);
    expect(store.annotations().every((a) => a.marker_number === null)).toBe(true);
  });
});
