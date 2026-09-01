import { TestBed } from '@angular/core/testing';

import { DataStore } from '../../core/data/data-store';
import { LocalRepository } from '../../core/data/local-repository';
import { Repository } from '../../core/data/repository';
import { StyleSettings } from './style-settings';
import { SupabaseService } from '../../core/supabase/supabase';

/**
 * Dropping a file into "הסגנון שלי".
 *
 * "add an option to just add files... doesnt matter what it is. could be
 * anything." It used to take a `.docx` and read only its tracked comments; a
 * file she had typed her feedback into directly, or a plain text file of her
 * notes, was refused with "I found no comments".
 *
 * The test that matters is the refusal to learn silently. A marked student
 * paper is mostly the *student's* writing, and importing its prose as her
 * style would teach the model to write like a seminar student and call it her
 * voice — a mistake nothing would report, and that would surface months later
 * as every drafted comment sounding subtly wrong.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function make() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: Repository, useClass: LocalRepository },
      { provide: SupabaseService, useValue: new FakeSupabase() },
    ],
  });

  const store = TestBed.inject(DataStore);
  store.createCourse('סמינריון', 'תשפ״ו');

  const fixture = TestBed.createComponent(StyleSettings);
  fixture.detectChanges();

  return {
    store,
    fixture,
    component: fixture.componentInstance as unknown as {
      chooseFile(event: Event): Promise<void>;
      importError(): string | null;
      found(): { body: string }[];
      fromText(): boolean;
      mine: { set(v: boolean): void };
      canSave(): boolean;
      save(): void;
      tone(): string;
      setTone(t: 'gentle' | 'balanced' | 'direct'): void;
    },
  };
}

/** A change event carrying one file, as the input would raise it. */
function pick(name: string, contents = ''): Event {
  const file = new File([contents], name);
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return { target: input } as unknown as Event;
}

const NOTES = [
  'זו כבר המסקנה, והיא מופיעה לפני שהצגת את שאלת המחקר שלך כאן.',
  'הנתון הזה צריך הפניה עם שנה ועמוד, מאיזו מטה־אנליזה הוא לקוח בדיוק.',
].join('\n\n');

beforeEach(() => localStorage.clear());

describe('adding a plain file to learn from', () => {
  it('reads a text file she typed her feedback into', async () => {
    const page = make();

    await page.component.chooseFile(pick('ההערות שלי.txt', NOTES));

    expect(page.component.fromText()).toBe(true);
    expect(page.component.found().length).toBe(2);
    expect(page.component.importError()).toBeNull();
  });

  /**
   * The gate. Prose is never learned from until she has said it is hers,
   * because the app cannot tell her writing from a student's by looking.
   */
  it('will not learn from prose until she says it is hers', async () => {
    const page = make();
    await page.component.chooseFile(pick('עבודה.txt', NOTES));

    expect(page.component.canSave()).toBe(false);

    page.component.mine.set(true);
    expect(page.component.canSave()).toBe(true);
  });

  it('learns the paragraphs once she has confirmed', async () => {
    const page = make();
    await page.component.chooseFile(pick('ההערות שלי.txt', NOTES));

    page.component.mine.set(true);
    page.component.save();

    expect(page.store.styleExamples().length).toBe(2);
  });

  /** Headings and stray labels are not sentences in her voice. */
  it('skips lines too short to be feedback', async () => {
    const page = make();

    await page.component.chooseFile(pick('קובץ.txt', ['מבוא', 'פרק א', NOTES].join('\n\n')));

    expect(page.component.found().length).toBe(2);
  });

  it('says so when there is nothing in the file to learn from', async () => {
    const page = make();

    await page.component.chooseFile(pick('ריק.txt', 'קצר'));

    expect(page.component.importError()).toContain('לא מצאתי');
    expect(page.component.found()).toEqual([]);
  });
});

describe('the formats it still cannot read', () => {
  it('tells her how to convert an old .doc', async () => {
    const page = make();

    await page.component.chooseFile(pick('הערות.doc'));

    expect(page.component.importError()).toContain('.docx');
    expect(page.component.importError()).toContain('שמירה בשם');
  });

  it('says a PDF is not readable, and what to do instead', async () => {
    const page = make();

    await page.component.chooseFile(pick('עבודה.pdf'));

    expect(page.component.importError()).toContain('PDF');
  });

  /** A refusal must never look like a successful read of an empty file. */
  it('offers nothing to learn from when it refuses', async () => {
    const page = make();

    await page.component.chooseFile(pick('עבודה.pdf'));

    expect(page.component.found()).toEqual([]);
    expect(page.component.canSave()).toBe(false);
  });
});

/**
 * How gently the comments are put.
 *
 * "add an option to choose how graceful it is." A first-year handing in her
 * first chapter and a fourth-year finishing a seminar paper need the same
 * problems named, and not in the same words.
 */
describe('choosing how gently to put it', () => {
  it('starts balanced, since a new course has told us nothing yet', () => {
    expect(make().component.tone()).toBe('balanced');
  });

  it('remembers what she chose', () => {
    const page = make();

    page.component.setTone('gentle');

    expect(page.component.tone()).toBe('gentle');
    expect(page.store.course()?.comment_tone).toBe('gentle');
  });

  /**
   * Per course-year, which is where the difference actually lives: the same
   * teacher is gentler with a class meeting research writing for the first
   * time than with one handing in its final paper.
   */
  it('is a property of the course, not of everything she teaches', () => {
    const page = make();
    const first = page.store.course()!;
    page.component.setTone('direct');

    const second = page.store.createCourse('שיטות מחקר', 'תשפ״ו')!;

    expect(page.store.course()?.id).toBe(second.id);
    expect(page.store.course()?.comment_tone).toBe('balanced');

    page.store.selectCourse(first.id);
    expect(page.store.course()?.comment_tone).toBe('direct');
  });
});
