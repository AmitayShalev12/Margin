import { buildMessage, mailtoLink, nextDeadline } from '../messages/student-message';
import { Annotation, Assignment, Course, Student, Submission, SubmissionRound } from '../models';
import { waitingFor } from '../notifications/waiting';
import { search } from '../search/search';
import { runChecks } from './checks';

/** The parts of the new flow that need no screen. All names are invented. */

const task = (id: string, title: string, due: string | null) =>
  ({ id, course_id: 'c1', title, due_at: due, created_at: '2026-01-01' }) as Assignment;
const round = (id: string, received: string, text: string) =>
  ({ id, received_at: received, document_text: text }) as SubmissionRound;
const comment = (over: Partial<Annotation>) =>
  ({
    id: 'a1',
    submission_id: 'p1',
    round_id: 'r1',
    status: 'accepted',
    body: 'לחדד',
    anchor: { quote: 'משפט ישן' },
    ...over,
  }) as Annotation;
const paper = (over: Partial<Submission> = {}) =>
  ({ id: 'p1', assignment_id: 't2', student_id: 's1', status: 'in_review', ...over }) as Submission;

describe('flags for her to judge', () => {
  const context = (text: string, handedIn = ['t1', 't2']) => ({
    paper: paper(),
    round: round('r2', '2026-02-01', text),
    earlierRounds: [round('r1', '2026-01-01', 'משפט ישן')],
    annotations: [comment({})],
    tasks: [task('t1', 'נושא', null), task('t2', 'הצעה', null)],
    handedIn: new Set(handedIn),
  });

  it('points to a commented sentence that is still there, word for word', () => {
    const flags = runChecks(context('פתיחה. משפט   ישן. סיום.'));

    expect(flags).toHaveLength(1);
    expect(flags[0].text).toContain('לחדד');
  });

  it('says nothing when the sentence changed', () => {
    expect(runChecks(context('משפט חדש לגמרי'))).toEqual([]);
  });

  it('ignores a comment she dismissed', () => {
    const flags = runChecks({
      ...context('משפט ישן'),
      annotations: [comment({ status: 'dismissed' })],
    });
    expect(flags).toEqual([]);
  });

  it('says so when an earlier stage was never handed in', () => {
    const flags = runChecks(context('חדש', ['t2']));
    expect(flags.map((f) => f.text)).toEqual(['לא הוגשה המשימה הקודמת "נושא".']);
  });

  it('has nothing to say about a first paper', () => {
    expect(runChecks({ ...context('משפט ישן'), earlierRounds: [] })).toEqual([]);
  });
});

describe('what is waiting for her', () => {
  const name = () => 'נועה';

  it('tells her about new work, comments to decide, and work ready to send', () => {
    const items = waitingFor(
      [paper({ id: 'new' }), paper({ id: 'decide' }), paper({ id: 'ready' })],
      [
        comment({ submission_id: 'decide', status: 'pending' }),
        comment({ submission_id: 'ready', status: 'accepted' }),
      ],
      name,
    );

    expect(items.map((i) => i.link)).toEqual(['/approve/ready', '/review/decide', '/review/new']);
  });

  it('leaves out what has already gone back to the student', () => {
    expect(waitingFor([paper({ status: 'notes_sent' })], [], name)).toEqual([]);
  });
});

describe('the message to the student', () => {
  const tasks = [
    task('t1', 'נושא', '2026-10-01'),
    task('t2', 'הצעה', '2026-11-01'),
    task('t3', 'פרק ראשון', '2024-12-26'),
    task('t4', 'פרק שני', '2027-01-15'),
  ];
  const input = {
    name: 'נועה',
    templateBody: 'הטקסט שלי',
    tasks,
    handedIn: new Set(['t1', 't2']),
    currentTaskId: 't2',
    today: '2026-11-05',
    link: null,
  };

  it('opens with the next deadline', () => {
    const message = buildMessage(input);
    expect(message.startsWith('המועד הבא: פרק שני')).toBe(true);
  });

  it('uses her name, her template, and says there are corrections', () => {
    const message = buildMessage(input);
    expect(message).toContain('שלום נועה');
    expect(message).toContain('יש בה תיקונים');
    expect(message).toContain('הטקסט שלי');
  });

  it('shows the whole process, where she is and what month it is', () => {
    const message = buildMessage(input);
    expect(message).toContain('הצעה');
    expect(message).toContain('← את כאן');
    expect(message).toContain('אנחנו בחודש חשוון');
  });

  it('adds the link only when given one', () => {
    expect(buildMessage(input)).not.toContain('העבודה עם ההערות');
    expect(buildMessage({ ...input, link: 'https://x.example/a' })).toContain('https://x.example/a');
  });

  it('finds no next deadline when all have passed', () => {
    expect(nextDeadline(tasks, '2030-01-01')).toBeNull();
    expect(buildMessage({ ...input, today: '2030-01-01' })).not.toContain('המועד הבא');
  });

  it('encodes Hebrew safely for the mail app', () => {
    expect(mailtoLink('a@example.com', 'נושא', 'א&ב')).toContain('%26');
  });
});

describe('search', () => {
  const courses = [
    { id: 'c1', name: 'סמינריון', year: 'תשפ״ז' },
    { id: 'c2', name: 'אוריינות', year: 'תשפ״ו' },
  ] as Course[];
  const students = [
    { id: 's1', full_name: 'נועה ברקוביץ׳' },
    { id: 's2', full_name: 'נועה לוי' },
  ] as Student[];
  const source = {
    courses,
    students,
    coursesInYear: [courses[0]],
    studentsIn: (id: string) => (id === 'c1' ? [students[0]] : []),
  };

  it('finds a course in any year, saying which', () => {
    const [result] = search('אורי', source);
    expect(result.link).toBe('/courses/c2');
    expect(result.detail).toContain('תשפ״ו');
  });

  it('leads a student to her course, past the geresh', () => {
    const [result] = search('ברקוביץ', source);
    expect(result.link).toBe('/courses/c1/students');
    expect(result.queryParams).toEqual({ q: 'נועה ברקוביץ׳' });
  });

  it('leads a student in no course this year to the overview', () => {
    expect(search('לוי', source)[0].link).toBe('/students');
  });

  it('says nothing for an empty box', () => {
    expect(search('   ', source)).toEqual([]);
  });
});
