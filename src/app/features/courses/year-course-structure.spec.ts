import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { routes } from '../../app.routes';
import { AnnotationGenerator } from '../../core/ai/annotation-generator';
import { DataStore } from '../../core/data/data-store';
import { LocalRepository } from '../../core/data/local-repository';
import { Repository } from '../../core/data/repository';
import { SupabaseService } from '../../core/supabase/supabase';
import { StudentsOverview } from '../students-overview/students-overview';
import { CourseStudents } from './course-students/course-students';
import { CourseTasks } from './course-tasks/course-tasks';
import { CoursesHome } from './courses-home/courses-home';
import { CourseRules } from './course-rules';
import { ProcessFlow } from './process-flow/process-flow';

/** Year, then course, then everything inside it. All names are invented. */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
}

function setup() {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  return TestBed.inject(DataStore);
}

const paper = (store: DataStore, studentId: string, assignmentId?: string) =>
  store.addUploadedSubmission({
    studentId,
    assignmentId,
    title: null,
    blocks: [{ id: 'b1', index: 0, type: 'paragraph', text: 'פסקה' }],
    text: 'פסקה',
    fileName: 'a.docx',
  });

function render<T>(component: new () => T) {
  const fixture = TestBed.createComponent(component as never);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement, instance: fixture.componentInstance as never as T };
}

describe('a task belongs to its course', () => {
  /** The bug this replaces: one assignment shared across every course. */
  it('files an upload under the course on screen, not the first one ever made', () => {
    const store = setup();
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    const firstTask = store.createAssignment('משימה א')!;
    const second = store.createCourse('שני', 'תשפ״ז')!;
    const secondTask = store.createAssignment('משימה ב')!;
    const student = store.addStudent('נועה כהן', undefined, [second.id])!;

    const uploaded = paper(store, student.id)!;

    expect(uploaded.assignment_id).toBe(secondTask.id);
    store.selectCourse(first.id);
    expect(store.assignment()!.id).toBe(firstTask.id);
  });

  it('gives a new course no tasks from the previous one', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    store.createAssignment('משימה א');

    store.createCourse('שני', 'תשפ״ז');

    expect(store.tasks()).toEqual([]);
    expect(store.assignment()).toBeNull();
  });

  it('makes a task quietly when a paper arrives and there are none', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');

    expect(store.ensureAssignment()!.title).toBe('עבודה');
    expect(store.tasks()).toHaveLength(1);
  });

  it('keeps one paper per student per task, and says so', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    const task = store.createAssignment('משימה א')!;
    const student = store.addStudent('נועה כהן')!;

    expect(paper(store, student.id, task.id)).not.toBeNull();
    expect(paper(store, student.id, task.id)).toBeNull();
    expect(store.submissions()).toHaveLength(1);
  });
});

describe('fifteen tasks', () => {
  it('stops at fifteen', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    for (let i = 0; i < 15; i += 1) expect(store.addTask(`משימה ${i}`, null)).not.toBeNull();

    expect(store.addTask('עוד אחת', null)).toBeNull();
  });

  it('keeps them in the order they were added', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    store.addTask('נושא', '2027-03-01');
    store.addTask('הצעה', '2026-12-01');

    expect(store.tasks().map((t) => t.title)).toEqual(['נושא', 'הצעה']);
  });

  it('will not delete a task that has students’ work', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    const task = store.addTask('נושא', null)!;
    const student = store.addStudent('נועה כהן')!;
    paper(store, student.id, task.id);

    expect(store.deleteTask(task.id)).toBe(false);
    expect(store.tasks()).toHaveLength(1);
  });

  it('refuses a task with no name', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    const task = store.addTask('נושא', null)!;

    expect(store.updateTask(task.id, { title: '   ' })).toBe(false);
    expect(store.tasks()[0].title).toBe('נושא');
  });

  it('shows both dates, Hebrew first', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    store.addTask('נושא', '2024-12-26');

    const { host } = render(CourseTasks);

    expect(host.querySelector('app-dual-date .hebrew')?.textContent).toContain('כ״ה בכסלו תשפ״ה');
    expect(host.querySelector('app-dual-date .gregorian')?.textContent).toContain('26.12.2024');
  });
});

describe('students inside a course', () => {
  it('shows only that course’s students', () => {
    const store = setup();
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    const second = store.createCourse('שני', 'תשפ״ז')!;
    store.addStudent('נועה', undefined, [first.id]);
    store.addStudent('שירה', undefined, [second.id]);

    const { host } = render(CourseStudents);

    expect(host.textContent).toContain('שירה');
    expect(host.textContent).not.toContain('נועה');
  });

  /** Nothing is lost: work from before enrollment still shows where it belongs. */
  it('includes a student with a paper in the course but no enrollment', () => {
    const store = setup();
    const course = store.createCourse('ראשון', 'תשפ״ז')!;
    const task = store.createAssignment('משימה')!;
    const student = store.addStudent('נועה')!;
    paper(store, student.id, task.id);

    expect(store.studentsIn(course.id).map((s) => s.id)).toEqual([student.id]);
  });

  it('offers a student with no course and no paper a way in', () => {
    const store = setup();
    const course = store.createCourse('ראשון', 'תשפ״ז')!;
    const student = store.addStudent('נועה')!;
    expect(store.unplacedStudents().map((s) => s.id)).toEqual([student.id]);

    const { host, fixture } = render(CourseStudents);
    [...host.querySelectorAll<HTMLButtonElement>('.unplaced button')][0].click();
    fixture.detectChanges();

    expect(store.studentsIn(course.id).map((s) => s.id)).toEqual([student.id]);
    expect(store.unplacedStudents()).toEqual([]);
  });

  it('numbers them in Hebrew alphabetical order', () => {
    const store = setup();
    const course = store.createCourse('ראשון', 'תשפ״ז')!;
    for (const name of ['שירה', 'אביגיל', 'מאיה']) store.addStudent(name, undefined, [course.id]);

    const { host } = render(CourseStudents);

    expect([...host.querySelectorAll('.name')].map((e) => e.textContent?.trim())).toEqual([
      'אביגיל',
      'מאיה',
      'שירה',
    ]);
    expect(host.querySelector('.row-number')?.textContent?.trim()).toBe('1');
  });

  it('can put those furthest behind first, and filter to them', () => {
    const store = setup();
    const course = store.createCourse('ראשון', 'תשפ״ז')!;
    const late = store.addTask('נושא', '2020-01-01')!;
    const onTime = store.addStudent('אביגיל', undefined, [course.id])!;
    store.addStudent('שירה', undefined, [course.id]);
    paper(store, onTime.id, late.id);

    const { instance } = render(CourseStudents);
    const list = instance as unknown as {
      rows(): { name: string; light: string }[];
      sort: { set(v: string): void };
      filter: { set(v: string): void };
    };

    expect(list.rows().map((r) => r.name)).toEqual(['אביגיל', 'שירה']);
    list.sort.set('status');
    expect(list.rows().map((r) => r.name)).toEqual(['שירה', 'אביגיל']);
    expect(list.rows()[0].light).toBe('red');

    list.filter.set('green');
    expect(list.rows().map((r) => r.name)).toEqual(['אביגיל']);
  });

  it('removing from a course keeps the student and her other courses', () => {
    const store = setup();
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    const second = store.createCourse('שני', 'תשפ״ז')!;
    const student = store.addStudent('נועה', undefined, [first.id, second.id])!;

    const { instance } = render(CourseStudents);
    (instance as unknown as { removeFromCourse(id: string): void }).removeFromCourse(student.id);

    expect(store.students()).toHaveLength(1);
    expect(store.coursesOf(student.id).map((c) => c.id)).toEqual([first.id]);
  });
});

describe('the overview', () => {
  it('shows one line per person, with a cell for each course of the year', () => {
    const store = setup();
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    const second = store.createCourse('שני', 'תשפ״ז')!;
    store.createCourse('של שנה אחרת', 'תשפ״ו');
    store.selectCourse(first.id);
    store.addStudent('נועה', undefined, [first.id, second.id]);
    store.addStudent('שירה', undefined, [second.id]);

    const { host } = render(StudentsOverview);

    const rows = host.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const headers = [...host.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(headers).toContain('ראשון');
    expect(headers).toContain('שני');
    expect(headers).not.toContain('של שנה אחרת');
    // שירה is not in the first course, and the table says so instead of guessing.
    const shira = [...rows].find((r) => r.textContent?.includes('שירה'))!;
    expect(shira.querySelector('.none')).not.toBeNull();
  });

  it('still lists someone in no course, so nobody disappears', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    store.addStudent('נועה');

    const { host } = render(StudentsOverview);

    expect(host.querySelector('tbody')?.textContent).toContain('נועה');
  });
});

describe('the rules', () => {
  it('shows the three groups, and a rule with no group is one of hers', () => {
    const store = setup();
    store.createCourse('ראשון', 'תשפ״ז');
    store.addCourseRule('language', 'כלל ישן', 'teacher');
    store.addCourseRule('language', 'כלל של משרד', 'teacher', 'course', 'ministry');

    const { instance } = render(CourseRules);
    const sections = (instance as unknown as {
      sections(): { id: string; title: string; items: { text: string }[] }[];
    }).sections();

    expect(sections.slice(0, 3).map((s) => s.title)).toEqual([
      'כללי העבודה',
      'כללי משרד החינוך',
      'הכללים שלי',
    ]);
    expect(sections[1].items.map((i) => i.text)).toEqual(['כלל של משרד']);
    expect(sections[2].items.map((i) => i.text)).toEqual(['כלל ישן']);
  });
});

describe('the courses screen', () => {
  it('shows this year’s courses as cards, leading into the course', () => {
    const store = setup();
    store.createCourse('של שנה אחרת', 'תשפ״ו');
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    store.createCourse('שני', 'תשפ״ז');
    store.addStudent('נועה', undefined, [first.id]);

    const { host } = render(CoursesHome);
    const cards = [...host.querySelectorAll<HTMLAnchorElement>('.course-card')];

    expect(cards.map((c) => c.querySelector('.card-title')?.textContent).sort()).toEqual([
      'ראשון',
      'שני',
    ]);
    const card = cards.find((c) => c.textContent?.includes('ראשון'))!;
    expect(card.getAttribute('href')).toBe(`/courses/${first.id}`);
    expect(card.textContent).toContain('תלמידה אחת');
  });

  it('says so when the year has no courses', () => {
    const store = setup();
    store.createCourse('של שנה אחרת', 'תשפ״ו');
    store.selectYear('תשפ״ח');

    const { host } = render(CoursesHome);

    expect(host.querySelector('.course-card')).toBeNull();
    expect(host.textContent).toContain('עוד אין קורסים בשנת');
  });

  it('shows the process with who reached each stage', () => {
    const store = setup();
    const course = store.createCourse('ראשון', 'תשפ״ז')!;
    const task = store.addTask('נושא', '2026-10-01')!;
    store.addTask('הצעה', '2026-12-01');
    const a = store.addStudent('א', undefined, [course.id])!;
    store.addStudent('ב', undefined, [course.id]);
    paper(store, a.id, task.id);

    const { host } = render(ProcessFlow);

    const counts = [...host.querySelectorAll('.stage-count')].map((c) => c.textContent?.trim());
    expect(counts).toEqual(['הגישו 1 מתוך 2', 'הגישו 0 מתוך 2']);
  });
});

describe('corrections stay in their course', () => {
  it('does not send one course’s correction when drafting in another', () => {
    const store = setup();
    const strict = store.createCourse('מחמיר', 'תשפ״ז')!;
    const lenient = store.createCourse('מקל', 'תשפ״ז')!;
    const log = (course: string, text: string) => ({
      id: text,
      teacher_id: 'teacher-1',
      course_id: course,
      target_type: 'annotation' as const,
      target_id: text,
      action: 'edited' as const,
      ai_text: 'טיוטה',
      final_text: text,
      change_note: null,
      context_excerpt: null,
      created_at: '2026-01-01',
    });
    (store as unknown as { _feedbackLogs: { set(v: unknown[]): void } })._feedbackLogs.set([
      log(strict.id, 'תיקון של המחמיר'),
      log(lenient.id, 'תיקון של המקל'),
    ]);

    const generator = TestBed.inject(AnnotationGenerator) as unknown as {
      decisions(action: string): { final_text: string }[];
    };
    expect(generator.decisions('edited').map((l) => l.final_text)).toEqual(['תיקון של המקל']);

    store.selectCourse(strict.id);
    expect(generator.decisions('edited').map((l) => l.final_text)).toEqual(['תיקון של המחמיר']);
  });
});

describe('no way in is left broken', () => {
  const redirect = (path: string) => routes.find((r) => r.path === path)?.redirectTo;

  it('sends every old address somewhere real', () => {
    expect(redirect('')).toBe('courses');
    expect(redirect('home')).toBe('courses');
    expect(redirect('**')).toBe('courses');
    expect(redirect('dashboard')).toBe('students');
    expect(redirect('submissions')).toBe('courses/current/papers');
    expect(redirect('grading-forms')).toBe('courses/current/grading');
    expect(redirect('style')).toBe('courses/current/style');
    expect(redirect('communication')).toBe('courses/current/messages');
  });

  it('has a screen for every part of a course', () => {
    const world = routes.find((r) => r.path === 'courses/:courseId')!;
    expect(world.children!.map((c) => c.path).filter(Boolean)).toEqual([
      'students',
      'papers',
      'rules',
      'process',
      'grading',
      'style',
      'messages',
    ]);
  });
});

describe('style belongs to one course', () => {
  const example = (store: DataStore, course: string | null, at: string, text: string) => ({
    id: text,
    teacher_id: 'teacher-1',
    course_id: course,
    source: 'manual' as const,
    student_text: null,
    teacher_text: text,
    tags: [],
    active: true,
    created_at: at,
    updated_at: at,
  });

  it('keeps new examples in their course, and older shared ones everywhere', () => {
    const store = setup();
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    const second = store.createCourse('שני', 'תשפ״ז')!;
    (store as unknown as { _styleExamples: { set(v: unknown[]): void } })._styleExamples.set([
      example(store, first.id, '2026-12-01', 'חדש של הראשון'),
      example(store, second.id, '2026-12-01', 'חדש של השני'),
      example(store, first.id, '2026-09-01', 'ישן'),
    ]);

    expect(store.herWriting().map((w) => w.teacher_text).sort()).toEqual(['חדש של השני', 'ישן']);
    store.selectCourse(first.id);
    expect(store.herWriting().map((w) => w.teacher_text).sort()).toEqual(['חדש של הראשון', 'ישן']);
  });
});

describe('everything below the year follows it', () => {
  it('lists only the papers of the course on screen', () => {
    const store = setup();
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    const firstTask = store.createAssignment('א')!;
    const student = store.addStudent('נועה')!;
    paper(store, student.id, firstTask.id);
    store.createCourse('שני', 'תשפ״ז');

    expect(store.courseSubmissions()).toEqual([]);
    store.selectCourse(first.id);
    expect(store.courseSubmissions()).toHaveLength(1);
  });

  /** The form was loaded once and stayed on screen for every other course. */
  it('swaps the grading form with the course, and brings each one back', () => {
    const store = setup();
    const first = store.createCourse('ראשון', 'תשפ״ז')!;
    store.importRubric({
      criteria: [{ code: '1', section: 'א', name: 'טענה', maxPoints: 10 }],
      weights: [],
    });
    const second = store.createCourse('שני', 'תשפ״ז')!;

    expect(store.gradingCategories().every((c) => c.course_id === second.id)).toBe(true);
    expect(store.gradingCategories().map((c) => c.name)).not.toContain('1 טענה');

    store.selectCourse(first.id);
    expect(store.gradingCategories().every((c) => c.course_id === first.id)).toBe(true);
    expect(store.gradingCategories().map((c) => c.name)).toContain('1 טענה');
  });
});
