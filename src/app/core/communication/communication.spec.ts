import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { routes } from '../../app.routes';
import { Communication, mailtoUrl } from '../../features/communication/communication';
import { Review } from '../../features/review/review';
import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { countDecisions } from '../learning/style-profile';
import { seedId } from '../mock/seed-data';
import { SupabaseService } from '../supabase/supabase';

import { EmailRequest, VARIANT_BRIEFS } from './contract';
import { EmailGenerator } from './email-generator';
import { seedStore } from '../mock/seed-store';

/** The app starts empty; a spec that reads records installs the fixtures. */
function seeded(store: DataStore): DataStore {
  seedStore(store);
  return store;
}

/**
 * The message that carries a round of comments back to the student.
 *
 * Two things are pinned here above everything else. First, that the loop closes
 * the same way the annotation loop does — her rewrite of a drafted email is
 * captured and reaches the next prompt, rather than accumulating in a table
 * nobody reads. Second, that nothing claims to have been sent that wasn't:
 * the review screen used to mark a submission `notes_sent` on a click while
 * delivering nothing, and a teacher had no way to see the difference.
 */

const NOA = seedId('sub-noa');

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  loading = () => false;
  session = () => ({ access_token: 'jwt' });
  user = () => ({ id: 'teacher-1', email: 'ronit@school.org.il' });
  signOut = async () => undefined;
  onTeacherChange = () => undefined;
  ready = Promise.resolve();
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
      provideRouter(routes),
    ],
  });
  return {
    store: seeded(TestBed.inject(DataStore)),
    generator: TestBed.inject(EmailGenerator),
  };
}

/** Three options back from the model, as the Edge Function would return them. */
function reply(bodies: Partial<Record<string, string>> = {}) {
  return {
    variants: VARIANT_BRIEFS.map((v) => ({
      key: v.key,
      subject: `על העבודה — ${v.label}`,
      body:
        bodies[v.key] ??
        `נועה שלום, קראתי את העבודה שלך בעיון רב והשארתי לך הערות לאורך המסמך. ניסוח ${v.label}.`,
    })),
  };
}

describe('the message to the student', () => {
  const realFetch = globalThis.fetch;
  let sent: EmailRequest[];
  let payload: unknown;
  let status = 200;

  let store: DataStore;
  let generator: EmailGenerator;

  beforeEach(() => {
    localStorage.clear();
    sent = [];
    payload = reply();
    status = 200;

    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      sent.push(JSON.parse(String(init.body)) as EmailRequest);
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    ({ store, generator } = boot());

    // She has been through the review: two comments she stood behind.
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
    store.editAnnotation(seedId('an-5'), 'האם באמת אקראי, או נוחות?');
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  // -- drafting -------------------------------------------------------------

  it('offers her the three options, labelled here rather than by the model', async () => {
    const email = await generator.generate(NOA);

    expect(email).not.toBeNull();
    expect(email!.variants.map((v) => v.key)).toEqual(VARIANT_BRIEFS.map((v) => v.key));
    expect(email!.variants.map((v) => v.label)).toEqual(VARIANT_BRIEFS.map((v) => v.label));
    // One of them is already on screen, so there is something to read.
    expect(email!.body).toBeTruthy();
    expect(email!.ai_body).toBe(email!.body);
  });

  it('drops an option under a key nobody asked for', async () => {
    payload = { variants: [...reply().variants, { key: 'formal', subject: 'ס', body: 'ב' }] };

    const email = await generator.generate(NOA);

    expect(email!.variants.map((v) => v.key)).not.toContain('formal');
  });

  it('is written only from the comments she stood behind', async () => {
    await generator.generate(NOA);

    const bodies = sent[0].comments.map((c) => c.body);
    expect(bodies).toContain('האם באמת אקראי, או נוחות?');
    // A comment still waiting for her decision is not something to tell a
    // student about.
    const pending = store
      .annotations()
      .filter((a) => a.submission_id === NOA && a.status === 'pending');
    for (const annotation of pending) expect(bodies).not.toContain(annotation.body);
  });

  it('refuses to draft when she has not approved anything yet', async () => {
    for (const annotation of store.annotations().filter((a) => a.submission_id === NOA)) {
      store.setAnnotationStatus(annotation.id, 'dismissed');
    }
    sent = [];

    const email = await generator.generate(NOA);

    expect(email).toBeNull();
    expect(generator.message()).toContain('אין עדיין הערות שאישרת');
    expect(sent).toEqual([]);
  });

  it('drafts into the same record on a second device, not a rival draft', async () => {
    const first = await generator.generate(NOA);
    const second = await generator.generate(NOA);

    expect(second!.id).toBe(first!.id);
    expect(store.studentEmails().length).toBe(1);
  });

  // -- her text is hers -----------------------------------------------------

  it('keeps her rewrite when she asks for other options', async () => {
    const email = await generator.generate(NOA);
    store.editStudentEmail(email!.id, { body: 'נועה, קראתי. נדבר מחר.' });

    payload = reply({ short: 'ניסוח חדש לגמרי' });
    const redrafted = await generator.generate(NOA);

    // New options arrived; her message is untouched.
    expect(redrafted!.body).toBe('נועה, קראתי. נדבר מחר.');
    expect(redrafted!.edited_by_teacher).toBe(true);
    expect(redrafted!.variants.some((v) => v.body === 'ניסוח חדש לגמרי')).toBe(true);
  });

  it('replaces the text when she picks a different option, because she asked', async () => {
    const email = await generator.generate(NOA);
    const other = email!.variants[1];

    store.chooseEmailVariant(email!.id, other.key);

    const after = store.studentEmail(NOA)!;
    expect(after.body).toBe(other.body);
    // The baseline moves with it: her next edit is measured against what she
    // is actually looking at.
    expect(after.ai_body).toBe(other.body);
    expect(after.edited_by_teacher).toBe(false);
  });

  it('will not redraft over a message she has already sent', async () => {
    const email = await generator.generate(NOA);
    store.markStudentEmailSent(email!.id);

    const again = await generator.generate(NOA);

    expect(again).toBeNull();
    expect(generator.message()).toContain('כבר נשלח');
  });

  // -- the learning loop ----------------------------------------------------

  it('records her rewrite of a drafted message as a before/after pair', async () => {
    const email = await generator.generate(NOA);
    const drafted = email!.body;

    store.editStudentEmail(email!.id, { body: 'נועה, יפה מאוד. שני דברים לתקן.' });

    const log = store.feedbackLogs().find((l) => l.target_type === 'student_email');
    expect(log).toBeTruthy();
    expect(log!.action).toBe('edited');
    expect(log!.ai_text).toBe(drafted);
    expect(log!.final_text).toBe('נועה, יפה מאוד. שני דברים לתקן.');
    expect(log!.change_note).toContain('קיצרת');
    // Which register she started from — there is no student sentence to quote.
    expect(log!.context_excerpt).toContain('ניסוח');
  });

  it('treats a message she sends untouched as an acceptance, not a rewrite', async () => {
    const email = await generator.generate(NOA);
    store.markStudentEmailSent(email!.id);

    const log = store.feedbackLogs().find((l) => l.target_type === 'student_email');
    expect(log!.action).toBe('accepted');
  });

  it('supersedes an earlier save instead of stacking a log per keystroke', async () => {
    const email = await generator.generate(NOA);

    store.editStudentEmail(email!.id, { body: 'טיוטה ראשונה שלי' });
    store.editStudentEmail(email!.id, { body: 'ניסוח שני' });
    store.editStudentEmail(email!.id, { body: 'הניסוח שיצא בסוף' });
    store.markStudentEmailSent(email!.id);

    const logs = store.feedbackLogs().filter((l) => l.target_type === 'student_email');
    expect(logs.length).toBe(1);
    expect(logs[0].final_text).toBe('הניסוח שיצא בסוף');
  });

  it('feeds her past email rewrites back into the next draft', async () => {
    const email = await generator.generate(NOA);
    store.editStudentEmail(email!.id, { body: 'נועה, קראתי. נדבר מחר.' });

    await generator.generate(NOA);

    const request = sent.at(-1)!;
    expect(request.email_edits.map((e) => e.final_text)).toContain('נועה, קראתי. נדבר מחר.');
    // Requirement 4: one voice, not an email voice — her comment rewrites go
    // to this prompt too.
    expect(request.style_edits.map((e) => e.final_text)).toContain('האם באמת אקראי, או נוחות?');
    expect(request.style_examples.length).toBeGreaterThan(0);
  });

  it('does not count a rewritten message as a rewritten comment', async () => {
    const before = countDecisions(store.feedbackLogs(), store.styleExamples());

    const email = await generator.generate(NOA);
    store.editStudentEmail(email!.id, { body: 'ניסוח משלי' });

    const after = countDecisions(store.feedbackLogs(), store.styleExamples());
    expect(after.edited).toBe(before.edited);
    expect(after.emailEdits).toBe(before.emailEdits + 1);
  });

  it('brings the draft and the decision back after a reload', async () => {
    const email = await generator.generate(NOA);
    store.editStudentEmail(email!.id, { body: 'הניסוח שלי, שאסור לו להיעלם' });
    await store.settled();

    ({ store, generator } = boot());
    await store.hydrate();

    expect(store.studentEmail(NOA)?.body).toBe('הניסוח שלי, שאסור לו להיעלם');
    expect(store.feedbackLogs().find((l) => l.target_type === 'student_email')?.final_text).toBe(
      'הניסוח שלי, שאסור לו להיעלם',
    );
  });

  // -- nothing claims to have been sent -------------------------------------

  it('marks the submission sent only when she says the message went out', async () => {
    const email = await generator.generate(NOA);

    // Drafted, edited, handed to her mail client — still not sent.
    store.editStudentEmail(email!.id, { body: 'מוכן לשליחה' });
    expect(store.submission(NOA)!.status).not.toBe('notes_sent');
    expect(store.studentEmail(NOA)!.status).toBe('draft');

    store.markStudentEmailSent(email!.id);

    expect(store.studentEmail(NOA)!.status).toBe('sent');
    expect(store.studentEmail(NOA)!.sent_at).toBeTruthy();
    expect(store.submission(NOA)!.status).toBe('notes_sent');
  });

  it('puts the whole message in the mail client, newlines and all', () => {
    const url = mailtoUrl(' noa@school.org.il ', 'על העבודה', 'שורה ראשונה\n\nשורה שנייה & עוד');

    expect(url.startsWith('mailto:noa%40school.org.il?subject=')).toBe(true);
    // The ampersand escaped, so the body is not cut off at it.
    expect(url).toContain('%26');
    expect(decodeURIComponent(url.split('&body=')[1])).toBe('שורה ראשונה\n\nשורה שנייה & עוד');
  });

  it('tells her on screen that the sending happens from her own mail account', async () => {
    const fixture = TestBed.createComponent(Communication);
    fixture.componentRef.setInput('submissionId', NOA);
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const draftButton = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('ניסוח המייל'),
    );
    expect(draftButton).toBeTruthy();

    draftButton!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = element.textContent ?? '';
    // The three options are on screen, and so is what the button really does.
    for (const variant of VARIANT_BRIEFS) expect(text).toContain(variant.label);
    expect(text).toContain('פותח את תוכנת המייל שלך');
    expect(text).toContain('מהחשבון שלך');
    // Drafted is not sent.
    expect(store.submission(NOA)!.status).not.toBe('notes_sent');
  });

  /**
   * The screen must always offer a way forward.
   *
   * When a new round opens on a submission whose earlier round carried
   * comments, the review screen showed the document, no comments, and no
   * "draft me some" — because that button appears only when there are none,
   * and the count was still seeing the previous round's. The teacher was left
   * with the send button and nothing to send.
   */
  it('offers drafting on a fresh round, rather than counting the previous one’s comments', async () => {
    window.matchMedia ??= ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;

    const round = store.roundFor(NOA)!;
    expect(store.annotations().some((a) => a.round_id === round.id)).toBe(true);

    // The student edits after notes go out: a new round, with none of the
    // previous round's comments on it.
    store.addRound({
      ...round,
      id: 'round-two-of-noa',
      round_number: round.round_number + 1,
      ai_summary: null,
      ai_summary_confirmed_at: null,
    });

    const fixture = TestBed.createComponent(Review);
    fixture.componentRef.setInput('submissionId', NOA);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('ניסוח טיוטת הערות');
    expect(text).toContain('אין עדיין הערות על העבודה הזו');
  });

  /**
   * Two deliveries, and the screen must not let one stand for both.
   *
   * Confirming the message flips the submission to "notes sent" on its own. If
   * the comments never reached the document — a refused permission, a failed
   * post — a review with nothing delivered to it looks finished.
   */
  it('says when comments are still not on the document, after the email is sent', async () => {
    window.matchMedia ??= ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;

    // A Drive-synced submission with approved comments that never posted.
    store.updateSubmission(NOA, { drive_file_id: 'file-noa' });
    const email = await generator.generate(NOA);
    store.markStudentEmailSent(email!.id);

    const fixture = TestBed.createComponent(Communication);
    fixture.componentRef.setInput('submissionId', NOA);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('סימנת שהמייל נשלח');
    // The part that was missing: the document got nothing.
    expect(text).toContain('עדיין לא נוספו למסמך');
  });

  it('takes the review screen’s primary action to the message, and sends nothing', async () => {
    // jsdom has no `matchMedia`, and the review screen renders different markup
    // on each side of the breakpoint. Desktop, so the margin column renders.
    window.matchMedia ??= ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(Review);
    fixture.componentRef.setInput('submissionId', NOA);
    await fixture.whenStable();

    (fixture.componentInstance as unknown as { send: () => void }).send();
    await fixture.whenStable();

    expect(router.url).toBe(`/communication/${NOA}`);
    // The whole point: it used to say the review had been sent right here.
    expect(store.submission(NOA)!.status).not.toBe('notes_sent');
  });
});

/**
 * Skipping the covering message.
 *
 * Not every round needs one: the comments are already on the student's
 * document, and she may be seeing the girl on Thursday. Before this the only
 * ways past the screen were to write a message she did not want to send, or to
 * mark one sent that never was — and the second is a lie the app would then
 * keep, in a log that feeds the model.
 */
describe('deciding not to write a message', () => {
  it('records the decision rather than leaving the screen blank', () => {
    const { store } = boot();

    store.skipStudentEmail(NOA);

    // "No message" and "not written yet" look identical on an empty screen and
    // mean opposite things.
    expect(store.studentEmail(NOA)?.status).toBe('skipped');
  });

  it('moves the submission on, because the notes are on the document', () => {
    const { store } = boot();

    store.skipStudentEmail(NOA);

    expect(store.submission(NOA)?.status).toBe('notes_sent');
  });

  /** Nothing was written, so there is no wording for the model to learn from. */
  it('teaches the learning loop nothing', () => {
    const { store } = boot();
    const before = store.feedbackLogs().length;

    store.skipStudentEmail(NOA);

    expect(store.feedbackLogs().length).toBe(before);
  });

  it('never claims a skipped message was sent', () => {
    const { store } = boot();

    store.skipStudentEmail(NOA);

    const email = store.studentEmail(NOA);
    expect(email?.sent_at).toBeNull();
    expect(email?.status).not.toBe('sent');
  });

  it('lets her change her mind', () => {
    const { store } = boot();
    store.skipStudentEmail(NOA);

    store.unskipStudentEmail(NOA);

    expect(store.studentEmail(NOA)?.status).toBe('draft');
    expect(store.submission(NOA)?.status).toBe('in_review');
  });

  /**
   * A message already gone cannot be unsent by pressing skip.
   *
   * Written the lazy way this passed for the wrong reason: the fixture has no
   * message for this submission, so `markStudentEmailSent` never ran and the
   * assertion was about a state the test had not set up.
   */
  it('refuses to skip one she has already sent', () => {
    const { store } = boot();

    store.skipStudentEmail(NOA);
    const email = store.studentEmail(NOA);
    expect(email).toBeDefined();

    store.markStudentEmailSent(email!.id);
    expect(store.studentEmail(NOA)?.status).toBe('sent');

    store.skipStudentEmail(NOA);

    expect(store.studentEmail(NOA)?.status).toBe('sent');
  });
});
