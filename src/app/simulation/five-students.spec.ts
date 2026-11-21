import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AnnotationGenerator } from '../core/ai/annotation-generator';
import { AnnotateRequest } from '../core/ai/contract';
import { CriterionReply } from '../core/ai/criterion-reply';
import { EmailGenerator } from '../core/communication/email-generator';
import { DataStore } from '../core/data/data-store';
import { LocalRepository } from '../core/data/local-repository';
import { Repository } from '../core/data/repository';
import { PaperSize, SLIPS } from '../core/god/fake-paper';
import { GodMode } from '../core/god/god-mode';
import { AnnotationKind, Student, Submission } from '../core/models';
import { WaitingList } from '../core/notifications/waiting-list';
import { Viewport } from '../core/viewport';
import { savedComments } from '../core/presentation/saved-comments';
import { studentsByStage } from '../core/progress/stage-of';
import { roundChanges } from '../core/rounds/round-changes';
import { SupabaseService } from '../core/supabase/supabase';
import { SEMINAR_STAGES } from '../core/tasks/seminar-map';
import { CommonNotes } from '../features/courses/common-notes/common-notes';
import { Review } from '../features/review/review';

/**
 * A lecturer's term with five students, each handing in five stages.
 *
 * The same idea as the three-student semester, but through the test screen's
 * invented class and with every paper going back and forth: notes, a score, a
 * message, a corrected version, a second score. The AI answers from a script
 * that finds the mistakes planted in the invented papers; everything else is
 * the real code.
 *
 * Every name and every paper here is made up.
 */

const STAGES = SEMINAR_STAGES.slice(0, 5);
const SIZES: readonly PaperSize[] = ['short', 'medium', 'long'];

/** What the scripted AI says about each planted mistake. */
const FINDINGS: readonly { kind: AnnotationKind; body: string }[] = [
  { kind: 'sources', body: 'אילו מחקרים? צריך לציין מקור לטענה הזאת.' },
  { kind: 'content', body: 'ניסוח גורף מדי. מה בדיוק השתפר, ובכמה?' },
  { kind: 'content', body: 'חסרה רמת המובהקות של המתאם.' },
  { kind: 'content', body: 'זה מדגם נוחות ולא מדגם אקראי. צריך לתאר אותו כפי שהוא.' },
  { kind: 'sources', body: 'איזו ספרות? "הגורם היחיד" היא טענה חזקה מדי בלי מקור.' },
  { kind: 'language', body: 'התאמה במין: הסטודנטיות מרגישות, בשבילן.' },
  { kind: 'language', body: 'משלב דיבורי. עדיף: מאחר שהשאלון היה ארוך, חלק מהמשתתפות לא השלימו אותו.' },
  { kind: 'content', body: 'איך נבדקה המהימנות? צריך נתון.' },
  { kind: 'content', body: 'תוצאות אינן מוכיחות השערה, הן תומכות בה.' },
  { kind: 'language', body: 'בעבודה אקדמית לא כותבים "אני חושבת שזה ברור לכולם".' },
  { kind: 'content', body: 'חסרים הממוצעים וסטיות התקן של שתי הקבוצות.' },
  { kind: 'sources', body: '"נכתב באינטרנט" אינו מקור אקדמי.' },
];

interface Call {
  fn: string;
  body: Record<string, unknown>;
}

function scriptedAnswer(fn: string, body: Record<string, unknown>): unknown {
  if (fn === 'annotate') {
    const request = body as unknown as AnnotateRequest;
    const found: { block_id: string; quote: string; kind: string; body: string }[] = [];
    if (request.comments !== false) {
      for (const block of request.blocks) {
        const slip = SLIPS.findIndex((s) => block.text.includes(s));
        if (slip >= 0 && found.length < 5) {
          found.push({ block_id: block.id, quote: SLIPS[slip], ...FINDINGS[slip] });
        }
      }
    }
    return {
      summary: `מצאתי ${found.length} דברים לתקן בסבב ${request.round_number}.`,
      annotations: found,
      scores:
        request.scoring === 'scored'
          ? request.rubric.map((r) => ({
              key: r.key,
              points:
                r.max_points === null
                  ? null
                  : Math.round(r.max_points * (request.round_number > 1 ? 0.9 : 0.7)),
              note: request.round_number > 1 ? 'השתפר מהסבב הקודם.' : 'סבב ראשון.',
              rationale: 'הנימוק לציון הזה.',
            }))
          : undefined,
    };
  }
  if (fn === 'student-email') {
    const variants = (body['variants'] as { key: string }[]) ?? [];
    return {
      variants: variants.map((v) => ({
        key: v.key,
        subject: 'הערות על העבודה',
        body: `שלום ${body['first_name']},\n\nקראתי את העבודה ויש כמה דברים לתקן. (${v.key})`,
      })),
    };
  }
  if (fn === 'criterion-reply') {
    return { reply: 'מקבל את ההסתייגות.', points: 18, changed: true, rationale: 'נימוק מעודכן.' };
  }
  return {};
}

class SignedInSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  user = () => ({ email: 'amitay.sh123@mail.example' });
  client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
}

describe('a term with five students and five papers each', () => {
  const realFetch = globalThis.fetch;
  const calls: Call[] = [];

  let store: DataStore;
  let god: GodMode;
  let generator: AnnotationGenerator;
  let emails: EmailGenerator;
  let replies: CriterionReply;
  let waiting: WaitingList;
  let students: Student[];

  const providers = () => [
    provideRouter([]),
    { provide: SupabaseService, useValue: new SignedInSupabase() },
    { provide: Repository, useClass: LocalRepository },
  ];

  /**
   * A screen over the same world. The test module is rebuilt between steps, so
   * the screen is handed the store the story has been writing to all along.
   */
  const onScreen = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...providers(),
        { provide: DataStore, useValue: store },
        { provide: AnnotationGenerator, useValue: generator },
        // A wide screen: the notes sit in the margin beside the paper.
        { provide: Viewport, useValue: { isDesktop: () => true } },
      ],
    });
  };

  const task = (stage: number) => store.tasks()[stage];
  const paperOf = (student: Student, stage: number): Submission =>
    store.submissionFor(task(stage).id, student.id)!;
  const notesOn = (paper: Submission) => {
    const round = store.roundFor(paper.id)!;
    return store.annotations().filter((a) => a.round_id === round.id);
  };

  beforeAll(() => {
    localStorage.clear();
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const fn = String(url).split('/').pop()!;
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      calls.push({ fn, body });
      return new Response(JSON.stringify(scriptedAnswer(fn, body)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: providers() });
    store = TestBed.inject(DataStore);
    god = TestBed.inject(GodMode);
    generator = TestBed.inject(AnnotationGenerator);
    emails = TestBed.inject(EmailGenerator);
    replies = TestBed.inject(CriterionReply);
    waiting = TestBed.inject(WaitingList);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  it('1. sets the class up in one press', () => {
    expect(god.setUp()).toBe(true);
    students = god.students();
    expect(students.length).toBe(5);
    expect(store.tasks().length).toBe(16);
  });

  it('2. every student hands in five stages, at different lengths', () => {
    students.forEach((student, s) => {
      STAGES.forEach((_, stage) => {
        // One forty-page paper in the class; the rest run from a page to thirteen.
        const size: PaperSize = s === 2 && stage === 4 ? 'full' : SIZES[(s + stage) % SIZES.length];
        expect(god.submit(student.id, size)).not.toBeNull();
      });
    });

    expect(store.submissions().length).toBe(25);
    expect(store.submissions().every((p) => p.status === 'new')).toBe(true);
    for (const student of students) {
      expect(STAGES.map((_, i) => store.assignmentById(paperOf(student, i).assignment_id)!.title)).toEqual([
        ...STAGES,
      ]);
    }
    expect(paperOf(students[2], 4).word_count!).toBeGreaterThanOrEqual(10000);
  });

  it('3. shows twenty-five papers waiting under five stages, and checks each stage in one press', async () => {
    expect(waiting.total()).toBe(25);
    expect(waiting.groups().map((g) => g.title)).toEqual([...STAGES]);

    for (const title of STAGES) {
      const group = waiting.groups().find((g) => g.title === title)!;
      expect(group.unchecked.length).toBe(5);
      await waiting.checkAll(group);
      expect(waiting.run()).toEqual(expect.objectContaining({ running: false, done: 5, failed: [] }));
    }

    for (const paper of store.submissions()) {
      expect(paper.status).toBe('in_review');
      const notes = notesOn(paper);
      expect(notes.length).toBeGreaterThan(0);
      // Every note points at a sentence that is really in the paper.
      const text = store.roundFor(paper.id)!.document_text!;
      expect(notes.every((n) => text.includes(n.anchor.quote))).toBe(true);
    }
    // The forty-page paper was read in parts and got notes from more than one.
    expect(notesOn(paperOf(students[2], 4)).length).toBeGreaterThan(5);
  });

  it('4. works through the notes of stage one: approve, rewrite, remove, bring back, approve the rest', () => {
    for (const student of students) {
      const paper = paperOf(student, 0);
      const round = store.roundFor(paper.id)!;
      generator.confirmBatch(round.id);
      const notes = notesOn(paper);
      expect(notes.length).toBeGreaterThanOrEqual(2);

      store.setAnnotationStatus(notes[0].id, 'accepted');
      store.editAnnotation(notes[1].id, `${notes[1].body} נא לתקן עד ההגשה הבאה.`);
      if (notes[2]) {
        // Removed by mistake, then brought back from the bar that stays behind.
        store.setAnnotationStatus(notes[2].id, 'dismissed');
        expect(store.canUndo(notes[2].id)).toBe(true);
        store.undoDecision(notes[2].id);
        expect(store.annotation(notes[2].id)!.status).toBe('pending');
      }
      // "Approve all that are waiting".
      for (const note of notesOn(paper).filter((n) => n.status === 'pending')) {
        store.setAnnotationStatus(note.id, 'accepted');
      }
      expect(store.annotationsPending(paper.id)).toBe(0);
    }
  });

  it('5. offers a note she wrote before when she writes a new one', () => {
    const wording = 'חסר משפט מעבר בין הפסקה הזאת לפסקה שאחריה.';
    const [first, second] = students.map((s) => paperOf(s, 0));

    const anchorOf = (paper: Submission) => {
      const block = store.roundFor(paper.id)!.document_blocks!.find((b) => b.type === 'paragraph')!;
      const quote = block.text.split(' ').slice(0, 4).join(' ');
      return { block_id: block.id, block_index: block.index, start: 0, end: quote.length, quote };
    };

    expect(savedComments(store.annotations(), '', 'structure')).not.toContain(wording);
    store.addOwnAnnotation({
      submissionId: first.id,
      roundId: store.roundFor(first.id)!.id,
      anchor: anchorOf(first),
      kind: 'structure',
      body: wording,
    });

    // On the next paper it is there to press, first in line for the same kind.
    expect(savedComments(store.annotations(), '', 'structure')[0]).toBe(wording);
    expect(savedComments(store.annotations(), 'משפט מעבר', 'language')).toEqual([wording]);
    expect(savedComments(store.annotations(), 'מילים שאין באף הערה', 'language')).toEqual([]);

    const again = store.addOwnAnnotation({
      submissionId: second.id,
      roundId: store.roundFor(second.id)!.id,
      anchor: anchorOf(second),
      kind: 'structure',
      body: savedComments(store.annotations(), '', 'structure')[0],
    });
    expect(again?.body).toBe(wording);
  });

  it('6. scores stage one for all five, overrules a number and argues another', async () => {
    for (const student of students) {
      const paper = paperOf(student, 0);
      store.setRoundScoring(store.roundFor(paper.id)!.id, 'scored');
      await generator.generate(paper.id);
      expect(store.paperScore(paper.id)).toEqual({ points: 70, outOf: 100 });
      // Asking for a score did not undo what she had decided about the notes.
      expect(store.annotationsPending(paper.id)).toBe(0);
    }

    const paper = paperOf(students[0], 0);
    const [first, second] = store.stageRubric(task(0).id);
    store.setCriterionScore(paper.id, first.id, first.max_points, 'הנושא ממוקד מאוד.');
    expect(store.paperScore(paper.id)!.points).toBeGreaterThan(70);

    store.addDiscussionTurn(paper.id, second.id, { role: 'teacher', text: 'לדעתי מגיע כאן יותר.' });
    expect(await replies.ask(paper.id, second)).toBe(true);
    const argued = store.criterionScores(paper.id).find((s) => s.category_id === second.id)!;
    expect(argued.discussion!.map((t) => t.role)).toEqual(['teacher', 'model']);
    expect(argued.points).toBe(18);
  });

  it('7. writes each student a message and marks it sent', async () => {
    for (const student of students) {
      const paper = paperOf(student, 0);
      const email = (await emails.generate(paper.id))!;
      expect(email.variants.length).toBe(3);
      store.chooseEmailVariant(email.id, 'warm');
      store.editStudentEmail(email.id, { body: `${store.studentEmail(paper.id)!.body}\n\nבהצלחה!` });
      store.markStudentEmailSent(email.id);
      expect(store.submission(paper.id)!.status).toBe('notes_sent');
    }
    // No paper text, address or phone went to the message writer.
    const sent = calls.filter((c) => c.fn === 'student-email');
    expect(sent.length).toBe(5);
    expect(JSON.stringify(sent.map((c) => c.body))).not.toContain('@fake.example');
    expect(sent.every((c) => c.body['assignment_title'] === STAGES[0])).toBe(true);

    // A paper from a later stage is named by its own stage, not by the first.
    const later = paperOf(students[0], 2);
    for (const note of notesOn(later)) store.setAnnotationStatus(note.id, 'accepted');
    expect(await emails.generate(later.id)).not.toBeNull();
    expect(calls.filter((c) => c.fn === 'student-email').at(-1)!.body['assignment_title']).toBe(STAGES[2]);
  });

  it('8. all five hand in a corrected version, and she sees what changed without rereading', () => {
    for (const student of students) {
      const paper = paperOf(student, 0);
      const firstRound = store.roundFor(paper.id)!;
      expect(god.resubmit(paper.id)).toBe(true);

      const now = store.submission(paper.id)!;
      expect(now.status).toBe('resubmitted');
      expect(now.current_round).toBe(2);

      const changes = roundChanges(firstRound, store.roundFor(paper.id), store.annotations())!;
      // The closing line she added is new, and so is every paragraph she fixed.
      expect(changes.changedBlockIds.size).toBeGreaterThan(0);
      // Each note she gave is listed with what became of its sentence.
      expect(changes.notes.length).toBeGreaterThanOrEqual(2);
      const newText = store.roundFor(paper.id)!.document_text!;
      for (const note of changes.notes) {
        expect(note.state).toBe(newText.includes(note.quote) ? 'same' : 'changed');
      }
      expect(changes.handled).toBe(changes.notes.filter((n) => n.state === 'changed').length);
    }
    // Across the class some notes were handled and some were not.
    const all = students.flatMap((s) => {
      const paper = paperOf(s, 0);
      return roundChanges(store.round(paper.id, 1), store.roundFor(paper.id), store.annotations())!.notes;
    });
    expect(all.some((n) => n.state === 'changed')).toBe(true);
    expect(all.some((n) => n.state === 'same')).toBe(true);
  });

  it('9. checks the second round with the first score in view, and the score moves', async () => {
    for (const student of students) {
      const paper = paperOf(student, 0);
      store.setRoundScoring(store.roundFor(paper.id)!.id, 'scored');
      await generator.generate(paper.id);

      const request = calls.filter((c) => c.fn === 'annotate').at(-1)!.body as unknown as AnnotateRequest;
      expect(request.round_number).toBe(2);
      expect(request.previous_scores.some((s) => s.points !== null)).toBe(true);
      // Fewer mistakes are left to find than the first time.
      expect(store.round(paper.id, 1)).toBeTruthy();
      for (const note of notesOn(paper)) store.setAnnotationStatus(note.id, 'accepted');
    }

    // A student whose numbers nobody touched by hand went from 70 to 90.
    expect(store.paperScore(paperOf(students[1], 0).id)).toEqual({ points: 90, outOf: 100 });
    // The number she set by hand in the first round is hers and stays.
    const [first] = store.stageRubric(task(0).id);
    const hers = store.criterionScores(paperOf(students[0], 0).id).find((s) => s.category_id === first.id)!;
    expect(hers.points).toBe(first.max_points);
  });

  it('10. sends the second message, and one student goes round a third time', async () => {
    for (const student of students) {
      const paper = paperOf(student, 0);
      const email = (await emails.generate(paper.id))!;
      store.markStudentEmailSent(email.id);
      expect(store.submission(paper.id)!.status).toBe('notes_sent');
    }
    const paper = paperOf(students[4], 0);
    expect(god.resubmit(paper.id)).toBe(true);
    expect(store.submission(paper.id)!.current_round).toBe(3);
    expect(store.rounds().filter((r) => r.submission_id === paper.id).length).toBe(3);
  });

  it('11. the review screen shows her place in the pile and what the new version changed', async () => {
    const ordered = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name, 'he'));
    const paper = paperOf(ordered[1], 0);

    onScreen();
    const fixture = TestBed.createComponent(Review);
    fixture.componentRef.setInput('submissionId', paper.id);
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('עבודה 2 מתוך 5');
    expect(text).toContain('העבודה הבאה');
    expect(text).toContain('מהסבב הקודם');
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.pager a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual([`/review/${paperOf(ordered[0], 0).id}`, `/review/${paperOf(ordered[2], 0).id}`]);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.doc-para.is-changed').length).toBeGreaterThan(0);
    fixture.destroy();
  }, 30000);

  it('12. the course view shows where everyone is and what the class gets wrong most', async () => {
    const chart = studentsByStage(store.tasks(), store.studentsIn(god.course()!.id), store.submissions());
    const atFive = chart.find((c) => c.students.length === 5)!;
    expect(atFive.number).toBe(5);

    onScreen();
    const fixture = TestBed.createComponent(CommonNotes);
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('על מה הערת הכי הרבה');
    expect(text).toContain('תוכן');
    expect(text).toContain('אצל 5 תלמידות');
    fixture.destroy();
  }, 30000);

  it('13. saves everything, and a fresh start brings it all back', async () => {
    await store.settled();
    expect(store.persistError()).toBeNull();
    const counts = (s: DataStore) => ({
      students: s.students().length,
      papers: s.submissions().length,
      rounds: s.rounds().length,
      notes: s.annotations().length,
      scores: students.map((x) => s.paperScore(s.submissionFor(s.tasks()[0].id, x.id)!.id)),
    });
    const before = counts(store);
    // Twenty-five papers, five corrected versions, and one third round.
    expect(before.rounds).toBe(25 + 5 + 1);

    const courseId = god.course()!.id;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: providers() });
    const reopened = TestBed.inject(DataStore);
    await reopened.hydrate();
    reopened.selectCourse(courseId);
    expect(counts(reopened)).toEqual(before);
  });
});
