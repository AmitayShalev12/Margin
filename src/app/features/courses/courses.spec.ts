import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { Courses } from './courses';
import { DataStore } from '../../core/data/data-store';
import { LocalRepository } from '../../core/data/local-repository';
import { Repository } from '../../core/data/repository';
import { SupabaseService } from '../../core/supabase/supabase';

/**
 * A signed-in teacher. `createCourse` writes `teacher_id` and refuses without
 * one, so a spec that skips this gets no course and every rule it adds comes
 * back null — silently, since the screen simply renders nothing.
 */
class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

/**
 * Putting a file into the knowledge base.
 *
 * Reported as "it doesn't allow me to upload". The picker accepted `.docx` and
 * nothing else, so a `.doc`, a PDF, or anything exported from Drive appeared
 * greyed out and unselectable — which reads as the upload being broken rather
 * than as a format needing conversion. The control was also styled as a line
 * of prose, so it did not look like something to press in the first place.
 *
 * The refusals are the part worth testing. "לא הצלחתי לקרוא את הקובץ" leaves
 * her nowhere; naming the format and the one step that fixes it is the whole
 * difference between a dead end and a detour.
 */

function make() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Repository, useClass: LocalRepository },
      { provide: SupabaseService, useValue: new FakeSupabase() },
    ],
  });

  const store = TestBed.inject(DataStore);
  store.createCourse('סמינריון', 'תשפ״ו');

  const fixture = TestBed.createComponent(Courses);
  fixture.detectChanges();

  return {
    fixture,
    component: fixture.componentInstance as unknown as {
      readFile(event: Event): Promise<void>;
      addError(): string | null;
      draftBody(): string;
      draftTitle(): string;
      startAdding(id: string): void;
      toggle(id: string): void;
      startEditItem(id: string, text: string): void;
      editDraft: { set(v: string): void };
      saveEditItem(of: 'rule' | 'material', id: string): void;
      askDelete(id: string): void;
      confirmDelete(of: 'rule' | 'material', id: string): void;
    },
  };
}

/** A change event carrying one file, as the input would raise it. */
function pick(name: string, contents = 'שלום'): Event {
  const file = new File([contents], name);
  const input = document.createElement('input');
  input.type = 'file';

  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return { target: input } as unknown as Event;
}

beforeEach(() => localStorage.clear());

describe('the formats she can actually put in', () => {
  it('reads a plain text file', async () => {
    const page = make();

    await page.component.readFile(pick('הכללים.txt', 'לכתוב בגוף שלישי'));

    expect(page.component.draftBody()).toContain('לכתוב בגוף שלישי');
    expect(page.component.addError()).toBeNull();
  });

  it('names the file, so she does not have to type a title', async () => {
    const page = make();

    await page.component.readFile(pick('כללי APA.txt', 'טקסט'));

    expect(page.component.draftTitle()).toBe('כללי APA');
  });
});

describe('the formats she cannot, and what to do about them', () => {
  /**
   * The likeliest one to arrive from a teacher, and the one where "I could not
   * read the file" is least useful — it is one "save as" from working.
   */
  it('tells her how to convert an old .doc rather than just refusing', async () => {
    const page = make();

    await page.component.readFile(pick('עבודה.doc'));

    expect(page.component.addError()).toContain('.docx');
    expect(page.component.addError()).toContain('שמירה בשם');
  });

  it('says a PDF is not readable and offers two ways round it', async () => {
    const page = make();

    await page.component.readFile(pick('מאמר.pdf'));

    expect(page.component.addError()).toContain('PDF');
    expect(page.component.addError()).toContain('להעתיק את הטקסט');
  });

  it('does not leave an unknown format unexplained', async () => {
    const page = make();

    await page.component.readFile(pick('something.pages'));

    expect(page.component.addError()).toContain('Word');
  });

  /** A refusal must not look like a successful read of an empty file. */
  it('writes nothing into the box when it refuses', async () => {
    const page = make();

    await page.component.readFile(pick('מאמר.pdf'));

    expect(page.component.draftBody()).toBe('');
  });
});

describe('the upload control itself', () => {
  /**
   * "The button does nothing" was the report, and it was never a button — a
   * `.link` class on a label, indistinguishable from the prose around it.
   */
  it('looks like a button, and takes more than .docx', () => {
    const page = make();

    // The control lives inside a section's add form, so open one — asserting
    // on an element that was never rendered is a test that passes by default.
    // The add form lives inside an expanded section, so open it first.
    page.component.toggle('models');
    page.component.startAdding('models');
    page.fixture.detectChanges();

    const label = (page.fixture.nativeElement as HTMLElement).querySelector('.file-label');
    expect(label).not.toBeNull();
    expect(label!.className).toContain('btn');

    const input = label!.querySelector('input[type=file]');
    expect(input?.getAttribute('accept')).toContain('.txt');
  });
});

/**
 * Correcting and clearing what is already in the knowledge base.
 *
 * "add an option to delete/edit example works files rules or everything else".
 * Every list here was write-once: a rule with a typo could be switched off but
 * never corrected, and a paper uploaded twice stayed twice. Her rules reach the
 * model verbatim, so a wrong one is not cosmetic — it is an instruction being
 * followed.
 */
describe('editing what is already saved', () => {
  function withRule(body = 'לכתוב בגוף שלישי') {
    const page = make();
    const store = TestBed.inject(DataStore);
    const rule = store.addCourseRule('language', body, 'teacher');
    page.fixture.detectChanges();
    return { page, store, rule: rule! };
  }

  it('rewrites a rule she got wrong', () => {
    const { page, store, rule } = withRule('לכתוב בגוף שלישי');

    page.component.startEditItem(rule.id, rule.body);
    page.component.editDraft.set('לכתוב בגוף שלישי, בלשון עבר');
    page.component.saveEditItem('rule', rule.id);

    expect(store.courseRules().find((r) => r.id === rule.id)?.body).toBe(
      'לכתוב בגוף שלישי, בלשון עבר',
    );
  });

  /** An empty rule would reach the model as a blank instruction. */
  it('refuses to save an empty one', () => {
    const { page, store, rule } = withRule('כלל אמיתי');

    page.component.startEditItem(rule.id, rule.body);
    page.component.editDraft.set('   ');
    page.component.saveEditItem('rule', rule.id);

    expect(store.courseRules().find((r) => r.id === rule.id)?.body).toBe('כלל אמיתי');
  });

  it('deletes a rule outright', () => {
    const { page, store, rule } = withRule();

    page.component.confirmDelete('rule', rule.id);

    expect(store.courseRules().some((r) => r.id === rule.id)).toBe(false);
  });

  /**
   * Deleting and switching off are different acts and both are kept. Off is
   * "not this year"; deleted is "this was a mistake", and a mistake she cannot
   * clear sits in the list forever looking like a decision.
   */
  it('leaves a rule she only switched off in place', () => {
    const { store, rule } = withRule();

    store.setCourseRuleActive(rule.id, false);

    expect(store.courseRules().some((r) => r.id === rule.id)).toBe(true);
    expect(store.courseRules().find((r) => r.id === rule.id)?.active).toBe(false);
  });

  /** A stray press should not lose a rule she wrote in August. */
  it('asks before deleting rather than acting on the first press', () => {
    const { page, store, rule } = withRule();

    page.component.askDelete(rule.id);
    page.fixture.detectChanges();

    expect(store.courseRules().some((r) => r.id === rule.id)).toBe(true);
    expect((page.fixture.nativeElement as HTMLElement).textContent).toContain('למחוק את');
  });

  it('retitles and removes a material', () => {
    const page = make();
    const store = TestBed.inject(DataStore);
    const material = store.addCourseMaterial('model_assignment', 'עבודה לדוגמא', 'טקסט')!;

    page.component.startEditItem(material.id, material.title);
    page.component.editDraft.set('עבודה לדוגמה של נועה');
    page.component.saveEditItem('material', material.id);
    expect(store.courseMaterials().find((m) => m.id === material.id)?.title).toBe(
      'עבודה לדוגמה של נועה',
    );

    page.component.confirmDelete('material', material.id);
    expect(store.courseMaterials().some((m) => m.id === material.id)).toBe(false);
  });
});

/**
 * Several courses, and years within them.
 *
 * One row per course-year, grouped by name: "סמינריון תשפ״ו" and "סמינריון
 * תשפ״ז" are separate courses sharing a title, which is what the data already
 * looked like. Each year keeps its own roster, assignments and papers.
 *
 * The tests that matter are the ones about leakage. A rule written for one
 * course appearing in another would reach the model as an instruction she
 * never gave for that class.
 */
describe('more than one course', () => {
  function twoCourses() {
    const page = make();
    const store = TestBed.inject(DataStore);
    const first = store.course()!;
    const second = store.createCourse('סמינריון', 'תשפ״ז')!;
    page.fixture.detectChanges();
    return { page, store, first, second };
  }

  it('keeps every course, rather than only the first', () => {
    const { store } = twoCourses();

    expect(store.courses().length).toBe(2);
  });

  it('switches between them', () => {
    const { store, first, second } = twoCourses();
    expect(store.course()?.id).toBe(second.id);

    store.selectCourse(first.id);

    expect(store.course()?.id).toBe(first.id);
  });

  /** A stale link should leave her where she was, not blank the screen. */
  it('ignores a course she does not have', () => {
    const { store, second } = twoCourses();

    store.selectCourse('no-such-course');

    expect(store.course()?.id).toBe(second.id);
  });

  /**
   * The leak that would matter. A rule she wrote for one class must not turn
   * up as an instruction in another.
   */
  it('keeps a course’s own rules to itself', () => {
    const { store, first, second } = twoCourses();

    store.selectCourse(first.id);
    store.addCourseRule('language', 'כלל של הקורס הראשון', 'teacher');

    store.selectCourse(second.id);

    expect(store.courseRules().some((r) => r.body === 'כלל של הקורס הראשון')).toBe(false);
  });

  it('shows a global rule in every course', () => {
    const { store, first, second } = twoCourses();

    store.selectCourse(first.id);
    store.addCourseRule('sources', 'APA מהדורה שביעית', 'teacher', 'all');

    store.selectCourse(second.id);

    expect(store.courseRules().some((r) => r.body === 'APA מהדורה שביעית')).toBe(true);
  });

  /**
   * Shared, not copied — the distinction she chose. One record, so a
   * correction lands everywhere instead of leaving stale duplicates in the
   * courses she was not looking at.
   */
  it('corrects a global rule in every course at once', () => {
    const { store, first, second } = twoCourses();
    store.selectCourse(first.id);
    const rule = store.addCourseRule('sources', 'APA מהדורה שישית', 'teacher', 'all')!;

    store.editCourseRule(rule.id, 'APA מהדורה שביעית');

    store.selectCourse(second.id);
    expect(store.courseRules().find((r) => r.id === rule.id)?.body).toBe('APA מהדורה שביעית');
    // One record, not two.
    expect(store.allCourseRules().filter((r) => r.id === rule.id).length).toBe(1);
  });

  it('sends a global source to the model in every course', () => {
    const { store, first, second } = twoCourses();
    store.selectCourse(first.id);
    store.addSource('האקדמיה ללשון', 'https://hebrew-academy.org.il', 'כתיב מלא', 'all');

    store.selectCourse(second.id);

    expect(store.sources().some((m) => m.title === 'האקדמיה ללשון')).toBe(true);
  });

  it('groups the years under one course name', () => {
    const { page } = twoCourses();

    const text = (page.fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('תשפ״ו');
    expect(text).toContain('תשפ״ז');
  });
});
