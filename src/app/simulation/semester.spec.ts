import { TestBed } from '@angular/core/testing';

import { AnnotationGenerator } from '../core/ai/annotation-generator';
import { AnnotateRequest } from '../core/ai/contract';
import { CriterionReply } from '../core/ai/criterion-reply';
import { buildBackup, parseBackup } from '../core/backup/backup';
import { EmailGenerator } from '../core/communication/email-generator';
import { DataStore } from '../core/data/data-store';
import { LocalRepository } from '../core/data/local-repository';
import { Repository } from '../core/data/repository';
import { DriveApi } from '../core/drive/drive-api';
import { DocsDocument, DriveFile, DriveRevision } from '../core/drive/drive-types';
import { GoogleDriveAuth } from '../core/drive/google-auth';
import { SyncService } from '../core/drive/sync';
import { StudentFormGenerator } from '../core/grading/student-form-generator';
import { Student, Submission } from '../core/models';
import { WaitingList } from '../core/notifications/waiting-list';
import { gradeSheetText, summarise } from '../core/progress/grade-sheet';
import { studentsByStage } from '../core/progress/stage-of';
import { planRoster } from '../core/roster/roster';
import { SupabaseService } from '../core/supabase/supabase';
import { SEMINAR_STAGES } from '../core/tasks/seminar-map';

/**
 * A whole semester, start to finish, as one story.
 *
 * Three invented students hand papers in, get notes, hand them in again and
 * move through the stages, while the lecturer does everything the app lets her
 * do. Only the network is faked: the AI functions answer from a script and
 * Drive is a set of files in memory. Everything between (the store, the sync,
 * the generators, the waiting list, saving and loading) is the real code.
 *
 * The steps share one world and run in order; a step that fails usually takes
 * the later ones with it, so read the first failure.
 *
 * Every name, address and paper here is made up.
 */

// -- the invented class ------------------------------------------------------

const NOA = { name: 'נועה כהן', email: 'noa.cohen@students.example' };
const SHIRA = { name: 'שירה לוי', email: 'shira.levi@students.example', mobile: '0501112233' };
const DANA = { name: 'דנה מזרחי', email: 'dana.mizrahi@students.example' };

const SHIRA_FOLDER = 'folder-shira';
const STAGE_1 = SEMINAR_STAGES[0];
const STAGE_2 = SEMINAR_STAGES[1];

const sentence = (n: number) =>
  `משפט מספר ${n} בעבודה המומצאת עוסק בקשר בין תחושת מסוגלות לבין התמדה בלמידה אצל סטודנטיות להוראה.`;

/** Paragraphs of invented text; forty pages is about four hundred of them. */
const paragraphs = (count: number, tag: string) =>
  Array.from({ length: count }, (_, i) => `${tag} פסקה ${i + 1}. ${sentence(i)} ${sentence(i + 1000)}`);

// -- a Drive made of memory ---------------------------------------------------

const revisions = (owner: string): DriveRevision[] => [
  { id: 'rev1', modifiedTime: '2026-10-01T08:00:00.000Z', lastModifyingUser: { emailAddress: owner } },
  { id: 'rev2', modifiedTime: '2026-10-02T08:00:00.000Z', lastModifyingUser: { emailAddress: owner } },
];

function driveFile(id: string, name: string, owner: string, day: number, overrides: Partial<DriveFile> = {}): DriveFile {
  const at = `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`;
  return {
    id,
    name,
    mimeType: 'application/vnd.google-apps.document',
    webViewLink: `https://docs.google.com/document/d/${id}/edit`,
    createdTime: at,
    modifiedTime: at,
    owners: [{ emailAddress: owner, displayName: name }],
    ...overrides,
  };
}

function docsDocument(id: string, body: readonly string[]): DocsDocument {
  let at = 1;
  const block = (text: string, style: string) => {
    const element = {
      startIndex: at,
      paragraph: { elements: [{ textRun: { content: `${text}\n` } }], paragraphStyle: { namedStyleType: style } },
    };
    at += text.length + 1;
    return element;
  };
  return {
    documentId: id,
    revisionId: 'rev2',
    body: { content: [block('כותרת העבודה', 'TITLE'), ...body.map((text) => block(text, 'NORMAL_TEXT'))] },
  } as DocsDocument;
}

class MemoryDrive {
  /** Folder id to the files in it. */
  folders: Record<string, DriveFile[]> = {};
  /** What a search by student name returns. */
  sharedByName: DriveFile[] = [];
  /** File id to its paragraphs. */
  bodies: Record<string, string[]> = {};

  listFolder = async (folderId?: string) => this.folders[folderId ?? ''] ?? [];
  listSharedByOwners = async () => [] as DriveFile[];
  listSharedDocuments = async () => this.sharedByName;
  listSharedNamedAfter = async () => this.sharedByName;
  getFile = async (fileId: string) => {
    const all = [...Object.values(this.folders).flat(), ...this.sharedByName];
    return all.find((f) => f.id === fileId) ?? driveFile(fileId, fileId, 'nobody@students.example', 1);
  };
  getFolder = async (id: string) => ({ id, mimeType: 'application/vnd.google-apps.folder' });
  listRevisions = async (fileId: string) => {
    const file = await this.getFile(fileId);
    return { revisions: revisions(file.owners?.[0]?.emailAddress ?? ''), truncated: false };
  };
  getDocument = async (fileId: string) => docsDocument(fileId, this.bodies[fileId] ?? ['מסמך ריק מתוכן.']);
}

class ConnectedAuth {
  isConnected = () => true;
  accessToken = async () => 'minted-access-token';
  invalidate = () => {};
}

class SignedInSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
}

// -- the AI, answering from a script ------------------------------------------

interface Call {
  fn: string;
  body: Record<string, unknown>;
  text: string;
}

const KINDS = ['language', 'content', 'structure'] as const;
/** How many parts the forty-page paper is read in. */
const DANA_PARTS = 6;

function scriptedAnswer(fn: string, body: Record<string, unknown>): unknown {
  if (fn === 'annotate') {
    const request = body as unknown as AnnotateRequest;
    const targets = request.blocks.filter((b) => b.text.split(' ').length >= 6).slice(0, 3);
    return {
      summary: `נמצאו ${targets.length} דברים לתקן בסבב ${request.round_number}.`,
      annotations: targets.map((b, i) => ({
        block_id: b.id,
        quote: b.text.split(' ').slice(0, 5).join(' '),
        kind: KINDS[i % KINDS.length],
        body: `הערה ${i + 1} בסבב ${request.round_number}: כדאי לנסח מחדש ולבסס על מקור.`,
      })),
      scores:
        request.scoring === 'scored'
          ? request.rubric.map((r) => ({
              key: r.key,
              points: r.max_points === null ? null : Math.round(r.max_points * 0.8),
              note: 'ללא שינוי מהסבב הקודם.',
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
        subject: `הערות על העבודה (${v.key})`,
        body: `שלום ${body['first_name']},\n\nקראתי את העבודה. (${v.key})`,
      })),
    };
  }
  if (fn === 'criterion-reply') {
    return { reply: 'מקבל את ההסתייגות.', points: 25, changed: true, rationale: 'נימוק מעודכן.' };
  }
  if (fn === 'student-form') {
    const categories = (body['categories'] as { id: string; name: string }[]) ?? [];
    return {
      summary: 'סיכום השנה.',
      sections: categories.slice(0, 2).map((c) => ({ category_id: c.id, title: c.name, body: 'פסקה לתלמידה.' })),
    };
  }
  return {};
}

// -- the world ----------------------------------------------------------------

describe('a semester with three students', () => {
  const realFetch = globalThis.fetch;
  const calls: Call[] = [];
  /** Set to make the next AI call fail the way the server does. */
  let failNext: { status: number; body: unknown; times?: number } | null = null;

  let drive: MemoryDrive;
  let store: DataStore;
  let sync: SyncService;
  let generator: AnnotationGenerator;
  let emails: EmailGenerator;
  let replies: CriterionReply;
  let forms: StudentFormGenerator;
  let waiting: WaitingList;

  let courseId: string;
  let noa: Student;
  let shira: Student;
  let dana: Student;

  const providers = () => [
    { provide: SupabaseService, useValue: new SignedInSupabase() },
    { provide: Repository, useClass: LocalRepository },
    { provide: DriveApi, useValue: drive },
    { provide: GoogleDriveAuth, useValue: new ConnectedAuth() },
  ];

  const task = (title: string) => store.tasks().find((t) => t.title === title)!;
  const paperOf = (student: Student, title: string): Submission =>
    store.submissionFor(task(title).id, student.id)!;
  const notesOn = (paper: Submission) => {
    const round = store.roundFor(paper.id)!;
    return store.annotations().filter((a) => a.round_id === round.id);
  };
  const annotateCalls = () => calls.filter((c) => c.fn === 'annotate');

  beforeAll(() => {
    localStorage.clear();
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const fn = String(url).split('/').pop()!;
      const text = String(init.body ?? '{}');
      const body = JSON.parse(text) as Record<string, unknown>;
      calls.push({ fn, body, text });
      const failure = failNext;
      if (failNext && (failNext.times ?? 1) > 1) failNext = { ...failNext, times: (failNext.times ?? 1) - 1 };
      else failNext = null;
      return new Response(JSON.stringify(failure ? failure.body : scriptedAnswer(fn, body)), {
        status: failure?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    drive = new MemoryDrive();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: providers() });
    store = TestBed.inject(DataStore);
    sync = TestBed.inject(SyncService);
    generator = TestBed.inject(AnnotationGenerator);
    emails = TestBed.inject(EmailGenerator);
    replies = TestBed.inject(CriterionReply);
    forms = TestBed.inject(StudentFormGenerator);
    waiting = TestBed.inject(WaitingList);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  // -- 1. she sets the course up ----------------------------------------------

  it('1. opens a seminar course with its sixteen stages and a rubric for each', () => {
    const course = store.createCourse('סמינריון מחקרי', 'תשפ״ז', { isSeminar: true, asksQuestion: true })!;
    courseId = course.id;
    for (const title of SEMINAR_STAGES) store.addTask(title, null);

    expect(store.tasks().map((t) => t.title)).toEqual([...SEMINAR_STAGES]);
    expect(store.applyProposedRubrics()).toBe(15);
    expect(store.stageRubric(task(STAGE_1).id).reduce((sum, c) => sum + (c.max_points ?? 0), 0)).toBe(100);
    // The last stage is the whole paper: it is marked with the course's general form.
    expect(store.stageRubric(task(SEMINAR_STAGES[15]).id)).toEqual([]);
  });

  it('2. writes her rules, groups them, and adds a source and a material', () => {
    const rule = store.addCourseRule('language', 'כל טענה נשענת על מקור.', 'teacher')!;
    store.addCourseRule('formatting', 'ציטוט לפי APA 7.', 'teacher', 'course', 'work');
    const group = store.addRuleGroup('ציטוט ומקורות')!;
    store.addCourseRule('sources', 'לפחות חמישה מאמרים מחמש השנים האחרונות.', 'teacher', 'course', group.key);
    expect(store.renameRuleGroup('work', 'כללי הסמינריון')).toBe(true);
    store.editCourseRule(rule.id, 'כל טענה נשענת על מקור אקדמי.');
    store.addSource('האקדמיה ללשון העברית', 'https://hebrew-academy.org.il', 'כתיב מלא');
    store.addCourseMaterial('syllabus', 'סילבוס', 'מטרות הקורס ולוח הזמנים.');
    store.setCommentTone('gentle');

    expect(store.courseRules().filter((r) => r.active).length).toBe(3);
    expect(store.ruleGroups().map((g) => g.title)).toContain('ציטוט ומקורות');
    expect(store.ruleGroups().find((g) => g.key === 'work')?.title).toBe('כללי הסמינריון');
    expect(store.sources().length).toBe(1);
    expect(store.courseMaterials().some((m) => m.title === 'סילבוס')).toBe(true);
  });

  it('3. brings in three students: by hand, from a class list, and with a folder of her own', () => {
    noa = store.addStudent(NOA.name, NOA.email, [courseId])!;
    dana = store.addStudent(DANA.name, DANA.email, [courseId])!;

    const plan = planRoster(
      [
        {
          name: SHIRA.name,
          phone: null,
          mobile: SHIRA.mobile,
          email: SHIRA.email,
          class_name: 'ג׳2',
          details: { status: 'פעילה', pedagogic_year: 'ג', track: 'יסודי', department: 'חינוך' },
        },
        // Already here: must not become a second נועה.
        { name: NOA.name, phone: null, mobile: null, email: NOA.email, class_name: null, details: { status: null, pedagogic_year: null, track: null, department: null } },
      ],
      store.students(),
    );
    expect(plan.added.map((r) => r.name)).toEqual([SHIRA.name]);
    expect(store.applyRoster(plan, new Set())).toEqual({ added: 1, existing: 1 });
    shira = store.students().find((s) => s.full_name === SHIRA.name)!;

    expect(store.setStudentFolder(shira.id, `https://drive.google.com/drive/folders/${SHIRA_FOLDER}`)).toBe(true);
    expect(store.setStudentFolder(shira.id, 'לא קישור')).toBe(false);
    store.setResearchQuestion(noa.id, courseId, 'האם יש קשר בין מסוגלות להתמדה?');

    expect(store.studentsIn(courseId).map((s) => s.full_name).sort()).toEqual([DANA.name, NOA.name, SHIRA.name].sort());
    expect(store.researchQuestion(noa.id, courseId)).toContain('מסוגלות');
    // Nobody has handed anything in: the flow chart shows all three waiting.
    const chart = studentsByStage(store.tasks(), store.studentsIn(courseId), store.submissions());
    expect(chart[0]).toEqual(expect.objectContaining({ number: 0 }));
    expect(chart[0].students.length).toBe(3);
  });

  // -- 2. the first papers arrive, three different ways -------------------------

  it('4. takes in the first stage: one uploaded by hand, one from her folder, one shared by name', async () => {
    const text = paragraphs(3, 'נועה');
    const uploaded = store.addUploadedSubmission({
      studentId: noa.id,
      assignmentId: task(STAGE_1).id,
      title: null,
      blocks: text.map((t, i) => ({ id: `b${i}`, index: i, type: 'paragraph', text: t })),
      text: text.join('\n'),
      fileName: 'שאלת המחקר.docx',
    });
    expect(uploaded).not.toBeNull();

    drive.folders[SHIRA_FOLDER] = [driveFile('shira-q', STAGE_1, SHIRA.email, 3)];
    drive.bodies['shira-q'] = paragraphs(4, 'שירה');
    drive.sharedByName = [driveFile('dana-q', `${DANA.name} - ${STAGE_1}`, 'dana.private@mail.example', 4)];
    // Forty pages: the long paper the lecturer asked about.
    drive.bodies['dana-q'] = paragraphs(400, 'דנה');

    const outcome = await sync.syncNow();

    expect(outcome.error).toBeNull();
    expect(paperOf(shira, STAGE_1)?.drive_file_id).toBe('shira-q');
    expect(paperOf(dana, STAGE_1)?.drive_file_id).toBe('dana-q');
    expect(store.submissions().length).toBe(3);
    expect(store.submissions().every((s) => s.status === 'new')).toBe(true);
    expect(store.roundFor(paperOf(dana, STAGE_1).id)!.document_blocks!.length).toBeGreaterThan(400);

    // A second sync with nothing new changes nothing.
    const again = await sync.syncNow();
    expect(again.created).toBe(0);
    expect(store.submissions().length).toBe(3);
  });

  it('5. shows the three papers waiting under their stage, and checks them all in one press', async () => {
    const groups = waiting.groups();
    expect(groups.length).toBe(1);
    expect(groups[0].title).toBe(STAGE_1);
    expect(groups[0].unchecked.length).toBe(3);
    expect(waiting.total()).toBe(3);

    await waiting.checkAll(groups[0]);

    expect(waiting.run()).toEqual(expect.objectContaining({ running: false, done: 3, failed: [] }));
    for (const student of [noa, shira, dana]) {
      const paper = paperOf(student, STAGE_1);
      expect(paper.status).toBe('in_review');
      expect(notesOn(paper).every((a) => a.status === 'pending')).toBe(true);
    }
    // A short paper is one request and three notes.
    expect(notesOn(paperOf(noa, STAGE_1)).length).toBe(3);
    expect(notesOn(paperOf(shira, STAGE_1)).length).toBe(3);
    // Nothing is left that nobody has looked at.
    expect(waiting.groups()[0].unchecked.length).toBe(0);
  });

  it('6. reads the forty-page paper in parts, and every paragraph of it is read', () => {
    const dana_calls = annotateCalls()
      .filter((c) => c.body['student_name'] === DANA.name)
      .map((c) => c.body as unknown as AnnotateRequest);
    const parts = dana_calls.filter((r) => r.part);
    const whole = store.roundFor(paperOf(dana, STAGE_1).id)!.document_blocks!;

    // No single request carries the whole paper's comments.
    expect(parts.length).toBe(DANA_PARTS);
    expect(parts.map((r) => r.part!.index)).toEqual(parts.map((_, i) => i + 1));
    expect(parts.every((r) => r.part!.total === DANA_PARTS && r.scoring === 'comments_only')).toBe(true);
    // Together the parts are the paper, start to end, nothing twice.
    expect(parts.flatMap((r) => r.blocks.map((b) => b.id))).toEqual(whole.map((b) => b.id));
    expect(parts.at(-1)!.blocks.at(-1)!.text).toContain('פסקה 400');
    // Notes come back from every part, each tied to its place.
    expect(notesOn(paperOf(dana, STAGE_1)).length).toBe(DANA_PARTS * 3);
    // The score is asked for once, with the whole paper in view and no comments.
    const scoring = dana_calls.filter((r) => r.comments === false);
    expect(scoring.length).toBe(1);
    expect(scoring[0].blocks.length).toBe(whole.length);
    expect(scoring[0].scoring).toBe('scored');
    // Every part is told her rules, her source and the gentle tone she chose.
    for (const request of parts) {
      expect(request.rules.map((r) => r.body)).toContain('כל טענה נשענת על מקור אקדמי.');
      expect(request.sources.map((s) => s.title)).toEqual(['האקדמיה ללשון העברית']);
      expect(request.tone).toBe('gentle');
      expect(request.assignment_title).toBe(STAGE_1);
    }
  });

  // -- 3. she works through the notes -------------------------------------------

  it('7. accepts, rewrites, dismisses, changes her mind, and adds a note of her own', () => {
    const paper = paperOf(noa, STAGE_1);
    const round = store.roundFor(paper.id)!;
    generator.confirmBatch(round.id);
    const [first, second, third] = notesOn(paper);

    store.setAnnotationStatus(first.id, 'accepted');
    store.editAnnotation(second.id, 'בניסוח שלי: לחדד את השאלה.');
    store.setAnnotationStatus(third.id, 'dismissed');
    expect(store.annotationsPending(paper.id)).toBe(0);

    expect(store.canUndo(third.id)).toBe(true);
    store.undoDecision(third.id);
    expect(store.annotation(third.id)!.status).toBe('pending');
    store.setAnnotationStatus(third.id, 'dismissed');

    const own = store.addOwnAnnotation({
      submissionId: paper.id,
      roundId: round.id,
      anchor: { ...first.anchor },
      kind: 'praise',
      body: 'פתיחה טובה.',
    });
    expect(own?.origin).toBe('teacher');

    expect(store.annotation(second.id)).toEqual(
      expect.objectContaining({ status: 'edited', body: 'בניסוח שלי: לחדד את השאלה.', edited_by_teacher: true }),
    );
    // What she rewrote is kept as a before and after, to learn her voice from.
    expect(store.feedbackLogs().some((l) => l.final_text === 'בניסוח שלי: לחדד את השאלה.')).toBe(true);
    expect(store.round(paper.id, 1)!.ai_summary_confirmed_at).not.toBeNull();
  });

  it('8. scores a stage against that stage s rubric, and lets her overrule a number', async () => {
    const paper = paperOf(shira, STAGE_1);
    const round = store.roundFor(paper.id)!;
    // A short paper gets notes only until she says to score it.
    expect(store.paperScore(paper.id)).toBeNull();
    store.setRoundScoring(round.id, 'scored');
    await generator.generate(paper.id);

    const request = annotateCalls().at(-1)!.body as unknown as AnnotateRequest;
    expect(request.scoring).toBe('scored');
    expect(request.rubric.map((r) => r.max_points)).toEqual([30, 20, 30, 20]);
    expect(store.paperScore(paper.id)).toEqual({ points: 80, outOf: 100 });

    const [criterion] = store.stageRubric(task(STAGE_1).id);
    store.setCriterionScore(paper.id, criterion.id, 30, 'הנושא ממוקד מאוד.');
    expect(store.paperScore(paper.id)).toEqual({ points: 86, outOf: 100 });
  });

  it('9. argues one score with the AI and gets a revised number', async () => {
    const paper = paperOf(shira, STAGE_1);
    const second = store.stageRubric(task(STAGE_1).id)[1];
    store.addDiscussionTurn(paper.id, second.id, { role: 'teacher', text: 'לדעתי השאלה מקורית יותר ממה שנכתב.' });

    expect(await replies.ask(paper.id, second)).toBe(true);

    const score = store.criterionScores(paper.id).find((s) => s.category_id === second.id)!;
    expect(score.discussion!.map((t) => t.role)).toEqual(['teacher', 'model']);
    expect(calls.some((c) => c.fn === 'criterion-reply')).toBe(true);
  });

  // -- 4. notes go back to the students -----------------------------------------

  it('10. drafts a message in three versions, picks one, rewrites it and marks it sent', async () => {
    const paper = paperOf(noa, STAGE_1);
    const email = (await emails.generate(paper.id))!;
    expect(email.variants.map((v) => v.key)).toEqual(['short', 'detailed', 'warm']);

    store.chooseEmailVariant(email.id, 'warm');
    expect(store.studentEmail(paper.id)!.body).toContain('(warm)');
    store.editStudentEmail(email.id, { body: 'נועה שלום, קראתי. יש כמה דברים לתקן.' });
    store.markStudentEmailSent(email.id);

    expect(store.studentEmail(paper.id)).toEqual(expect.objectContaining({ status: 'sent', edited_by_teacher: true }));
    expect(store.submission(paper.id)!.status).toBe('notes_sent');
    // Only the notes she stood behind went into the message: not the one she dismissed.
    const request = calls.find((c) => c.fn === 'student-email')!.body as { comments: unknown[] };
    expect(request.comments.length).toBe(3);
    // A sent message cannot be drafted over.
    expect(await emails.generate(paper.id)).toBeNull();
  });

  it('11. refuses to draft a message before she has approved any note', async () => {
    const paper = paperOf(dana, STAGE_1);
    const before = calls.length;
    expect(await emails.generate(paper.id)).toBeNull();
    expect(calls.length).toBe(before);
  });

  it('12. lets her finish a paper with no message at all', () => {
    const paper = paperOf(shira, STAGE_1);
    for (const note of notesOn(paper)) store.setAnnotationStatus(note.id, 'accepted');
    store.skipStudentEmail(paper.id);
    expect(store.submission(paper.id)!.status).toBe('notes_sent');
    expect(store.studentEmail(paper.id)?.status).not.toBe('sent');
  });

  // -- 5. back and forth ---------------------------------------------------------

  it('13. opens a second round when a student corrects her paper, and keeps the first as it was', async () => {
    const paper = paperOf(shira, STAGE_1);
    const firstRound = store.roundFor(paper.id)!;
    const firstText = firstRound.document_text;
    const firstNotes = notesOn(paper).length;

    drive.folders[SHIRA_FOLDER] = [
      driveFile('shira-q', STAGE_1, SHIRA.email, 3, { modifiedTime: '2026-10-20T08:00:00.000Z' }),
    ];
    drive.bodies['shira-q'] = paragraphs(4, 'שירה מתוקן');
    const outcome = await sync.syncNow();

    const updated = store.submission(paper.id)!;
    expect(outcome.error).toBeNull();
    expect(updated.status).toBe('resubmitted');
    expect(updated.current_round).toBe(2);
    expect(store.round(paper.id, 1)!.document_text).toBe(firstText);
    expect(store.annotations().filter((a) => a.round_id === firstRound.id).length).toBe(firstNotes);
    expect(store.roundFor(paper.id)!.document_blocks!.some((b) => b.text.includes('שירה מתוקן'))).toBe(true);
    // No second paper was opened for the same stage.
    expect(store.submissions().filter((s) => s.student_id === shira.id).length).toBe(1);
  });

  it('14. checks the second round knowing what the first one scored', async () => {
    const paper = paperOf(shira, STAGE_1);
    expect(waiting.groups().flatMap((g) => g.items).some((i) => i.paperId === paper.id)).toBe(true);
    store.setRoundScoring(store.roundFor(paper.id)!.id, 'scored');

    expect(await generator.generate(paper.id)).toEqual({ created: 3, discarded: 0 });

    const request = annotateCalls().at(-1)!.body as unknown as AnnotateRequest;
    expect(request.round_number).toBe(2);
    expect(request.previous_scores.filter((s) => s.points !== null).length).toBeGreaterThan(0);
    expect(notesOn(paper).every((a) => a.body.includes('בסבב 2'))).toBe(true);
    // The score she set by hand in round one is hers and stays.
    const [criterion] = store.stageRubric(task(STAGE_1).id);
    expect(store.criterionScores(paper.id).find((s) => s.category_id === criterion.id)?.points).toBe(30);
  });

  it('15. sends a second message for the second round', async () => {
    const paper = paperOf(shira, STAGE_1);
    for (const note of notesOn(paper)) store.setAnnotationStatus(note.id, 'accepted');
    store.unskipStudentEmail(paper.id);
    const email = await emails.generate(paper.id);
    expect(email).not.toBeNull();
    store.markStudentEmailSent(email!.id);
    expect(store.submission(paper.id)!.status).toBe('notes_sent');
  });

  // -- 6. moving through the stages ----------------------------------------------

  it('16. files later papers under the right stage, sees through a second format, and takes an extra one in', async () => {
    drive.folders[SHIRA_FOLDER] = [
      driveFile('shira-q', STAGE_1, SHIRA.email, 3, { modifiedTime: '2026-10-20T08:00:00.000Z' }),
      driveFile('shira-2', STAGE_2, SHIRA.email, 21),
      driveFile('shira-2-pdf', `${STAGE_2}.pdf`, SHIRA.email, 22),
      driveFile('shira-extra', 'מכתב למנחה.docx', SHIRA.email, 23),
    ];
    drive.bodies['shira-2'] = paragraphs(5, 'שירה שלב שני');
    drive.bodies['shira-extra'] = paragraphs(2, 'שירה מכתב');

    const outcome = await sync.syncNow();
    const report = outcome.ownFolders.find((r) => r.studentId === shira.id)!.files;

    expect(paperOf(shira, STAGE_2)?.drive_file_id).toBe('shira-2');
    expect(store.submissionByDriveFile('shira-2-pdf')).toBeUndefined();
    expect(report.find((f) => f.name === `${STAGE_2}.pdf`)).toEqual(
      expect.objectContaining({ result: 'have', reason: 'same_paper' }),
    );
    // A file whose name says no stage goes under the next stage she has not
    // handed in. Here that is a letter, filed as stage 3.
    const extra = store.submissionByDriveFile('shira-extra')!;
    expect(extra.student_id).toBe(shira.id);
    expect(extra.assignment_id).toBe(task(SEMINAR_STAGES[2]).id);
    expect(store.submissions().filter((s) => s.student_id === shira.id).length).toBe(3);
  });

  it('17. shows where each student is: the flow chart, the card, and the grade sheet', () => {
    const tasks = store.tasks().slice(0, SEMINAR_STAGES.length);
    const chart = studentsByStage(tasks, store.studentsIn(courseId), store.submissions());
    const at = (student: Student) => chart.find((c) => c.students.some((s) => s.id === student.id))!.number;
    expect([at(noa), at(shira), at(dana)]).toEqual([1, 3, 1]);

    const rows = tasks.map((t, index) => {
      const paper = store.submissionFor(t.id, shira.id) ?? null;
      return {
        taskId: t.id,
        number: index + 1,
        title: t.title,
        paperId: paper?.id ?? null,
        handedIn: null,
        score: paper ? store.paperScore(paper.id) : null,
      };
    });
    const summary = summarise(rows);
    expect(summary.handedIn).toBe(3);
    expect(summary.missing).toBe(13);
    expect(summary.average).not.toBeNull();

    const sheet = gradeSheetText({ student: SHIRA.name, course: 'סמינריון מחקרי', rows });
    expect(sheet).toContain(`1. ${STAGE_1}: הוגש`);
    expect(sheet).toContain('מתוך 100');
    expect(sheet).toContain('הוגשו 3 מתוך 16 שלבים.');
    // About her alone.
    expect(sheet).not.toContain(NOA.name);
    expect(sheet).not.toContain(DANA.name);
  });

  // -- 7. when things go wrong ----------------------------------------------------

  it('17b. files a paper by what it says at its top, and lets her move it', async () => {
    const proposal = SEMINAR_STAGES[3];
    drive.folders[SHIRA_FOLDER] = [
      ...drive.folders[SHIRA_FOLDER],
      driveFile('shira-draft', 'טיוטה חדשה.docx', SHIRA.email, 24),
    ];
    drive.bodies['shira-draft'] = ['הצעת מחקר', ...paragraphs(3, 'שירה הצעה')];

    const outcome = await sync.syncNow();
    const report = outcome.ownFolders.find((r) => r.studentId === shira.id)!.files;

    // The name says nothing, the paper does: it skips the open stages before it.
    expect(report.find((f) => f.name === 'טיוטה חדשה.docx')).toEqual(
      expect.objectContaining({ result: 'created', task: proposal, by: 'content' }),
    );
    const paper = paperOf(shira, proposal);
    expect(paper.drive_file_id).toBe('shira-draft');

    // She disagrees and moves it. Not onto a stage that already has a paper.
    expect(store.moveSubmission(paper.id, paperOf(shira, STAGE_2).assignment_id)).toBe(false);
    const other = store.tasks().find((t) => t.title === SEMINAR_STAGES[4])!;
    expect(store.moveSubmission(paper.id, other.id)).toBe(true);
    expect(paperOf(shira, SEMINAR_STAGES[4]).id).toBe(paper.id);
    // A paper that was already checked stays where its notes were written.
    expect(store.moveSubmission(paperOf(noa, STAGE_1).id, other.id)).toBe(false);
  });

  it('18. says so when the AI fails, and loses none of the notes that were there', async () => {
    const paper = paperOf(dana, STAGE_1);
    const before = notesOn(paper).map((a) => a.id);

    // A part that fails is tried once more, so it takes two failures to stop.
    failNext = { status: 502, body: { error: 'generation_failed', reason: 'MAX_TOKENS' }, times: 2 };
    expect(await generator.generate(paper.id)).toBeNull();
    expect(generator.state().message).toContain(`חלק 1 מתוך ${DANA_PARTS}`);

    expect(generator.state().phase).toBe('error');
    expect(generator.state().message).toBeTruthy();
    expect(generator.state().detail).toContain('MAX_TOKENS');
    expect(notesOn(paper).map((a) => a.id)).toEqual(before);
    // Trying again works.
    expect(await generator.generate(paper.id)).toEqual({ created: DANA_PARTS * 3, discarded: 0 });

    // One failure alone is got past without her seeing it.
    failNext = { status: 502, body: { error: 'generation_failed', reason: 'MAX_TOKENS' } };
    expect(await generator.generate(paper.id)).toEqual({ created: DANA_PARTS * 3, discarded: 0 });
  });

  it('19. keeps a decided note when a paper is checked again', async () => {
    const paper = paperOf(dana, STAGE_1);
    const [kept] = notesOn(paper);
    store.setAnnotationStatus(kept.id, 'accepted');

    await generator.generate(paper.id);

    expect(store.annotation(kept.id)?.status).toBe('accepted');
    expect(notesOn(paper).filter((a) => a.status === 'pending').length).toBe(DANA_PARTS * 3);
  });

  it('20. never tells the AI a student s address, phone or folder', () => {
    const secrets = [NOA.email, SHIRA.email, DANA.email, SHIRA.mobile, 'dana.private@mail.example', SHIRA_FOLDER];
    expect(calls.length).toBeGreaterThan(8);
    for (const call of calls) {
      for (const secret of secrets) expect(call.text, `${call.fn} was sent ${secret}`).not.toContain(secret);
    }
  });

  // -- 8. the end of the year ------------------------------------------------------

  it('21. builds the grade form from the notes she kept, and drafts the student s own copy', async () => {
    const paper = paperOf(noa, STAGE_1);
    const lines = store.gradingEntries().filter((e) => e.submission_id === paper.id);
    // The three notes she stood behind became lines; the one she dismissed did not.
    expect(lines.length).toBe(3);

    const form = await forms.generate(noa.id);

    expect(form?.sections.length).toBeGreaterThan(0);
    const request = calls.find((c) => c.fn === 'student-form')!.body as { entries: unknown[] };
    expect(request.entries.length).toBe(3);
  });

  it('22. saves everything, and a fresh start brings it all back', async () => {
    await store.settled();
    expect(store.persistError()).toBeNull();
    const counts = (s: DataStore) => ({
      courses: s.courses().length,
      tasks: s.tasks().length,
      students: s.students().length,
      papers: s.submissions().length,
      rounds: s.rounds().length,
      notes: s.annotations().length,
      rules: s.courseRules().length,
      groups: s.ruleGroups().map((g) => g.title),
      rubric: s.stageRubric(s.tasks()[0].id).map((c) => c.max_points),
      score: s.paperScore(s.submissionFor(s.tasks()[0].id, shira.id)!.id),
    });
    const before = counts(store);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: providers() });
    const reopened = TestBed.inject(DataStore);
    await reopened.hydrate();
    reopened.selectCourse(courseId);

    expect(counts(reopened)).toEqual(before);
    expect(reopened.studentEmail(paperOf(noa, STAGE_1).id)?.status).toBe('sent');

    // And a backup of it reads back whole.
    const snapshot = await TestBed.inject(Repository).load();
    const backup = parseBackup(JSON.stringify(buildBackup(snapshot, '2026-11-17T00:00:00.000Z')));
    expect(backup.counts['submissions']).toBe(before.papers);
    expect(backup.counts['students']).toBe(3);
    expect(JSON.stringify(backup)).not.toContain('minted-access-token');
  });

  it('23. starts next year s course with this year s rules and rubrics', async () => {
    const rules = store.courseRules().map((r) => r.id);
    const next = store.createCourse('סמינריון מחקרי', 'תשפ״ח', { isSeminar: true, asksQuestion: true })!;
    for (const title of SEMINAR_STAGES) store.addTask(title, null);

    expect(store.copyStageRubrics(courseId)).toBe(15);
    const carried = await store.carryOver(courseId, next.id, { ruleIds: rules, materialIds: [], gradingForm: false });

    expect(carried.rules).toBe(3);
    expect(store.stageRubric(task(STAGE_1).id).map((c) => c.max_points)).toEqual([30, 20, 30, 20]);
    expect(store.courseSubmissions().length).toBe(0);
    // Last year is untouched.
    store.selectCourse(courseId);
    expect(store.courseSubmissions().length).toBe(6);
  });

  it('24. removes a paper, a stage and a student, and leaves nothing of theirs behind', async () => {
    const extra = store.submissionByDriveFile('shira-extra')!;
    store.deleteSubmission(extra.id);
    expect(store.submission(extra.id)).toBeUndefined();
    expect(store.rounds().some((r) => r.submission_id === extra.id)).toBe(false);

    // A stage with papers in it cannot simply vanish with them.
    const taskCount = store.tasks().length;
    const emptyStage = task(SEMINAR_STAGES[5]);
    expect(store.deleteTask(emptyStage.id)).toBe(true);
    expect(store.tasks().length).toBe(taskCount - 1);

    const danaPaper = paperOf(dana, STAGE_1).id;
    store.deleteStudent(dana.id);
    expect(store.students().some((s) => s.id === dana.id)).toBe(false);
    expect(store.submission(danaPaper)).toBeUndefined();
    expect(store.annotations().some((a) => a.submission_id === danaPaper)).toBe(false);

    await store.settled();
    expect(store.persistError()).toBeNull();
  });
});
