import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { Courses } from './courses';
import { DataStore } from '../../core/data/data-store';
import { LocalRepository } from '../../core/data/local-repository';
import { Repository } from '../../core/data/repository';

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
    providers: [provideRouter([]), { provide: Repository, useClass: LocalRepository }],
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
