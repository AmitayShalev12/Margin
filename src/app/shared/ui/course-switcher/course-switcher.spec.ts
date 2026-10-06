import { TestBed } from '@angular/core/testing';

import { CourseSwitcher } from './course-switcher';
import { DataStore } from '../../../core/data/data-store';
import { LocalRepository } from '../../../core/data/local-repository';
import { Repository } from '../../../core/data/repository';
import { SupabaseService } from '../../../core/supabase/supabase';

/**
 * The course selector in the top bar.
 *
 * "בתפריט למעלה בוחרים את הקורס, ממנו נגזרים הנתונים המוצגים בהמשך."
 *
 * The store could already hold several courses and switch between them; what
 * was missing was a control anywhere she would look. So the tests that matter
 * are the ones the DOM answers: that pressing a year actually moves the store,
 * and that the menu is reachable at all — a selector nobody can find is the
 * same bug as a selector that does not exist.
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
  const fixture = TestBed.createComponent(CourseSwitcher);

  return {
    store,
    fixture,
    host: fixture.nativeElement as HTMLElement,
    render: () => fixture.detectChanges(),
  };
}

function press(host: HTMLElement, selector: string, text?: string) {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>(selector)];
  const button = text ? buttons.find((b) => (b.textContent ?? '').trim() === text) : buttons.at(0);
  if (!button) throw new Error(`no button matching ${selector}${text ? ` / ${text}` : ''}`);
  button.click();
}

beforeEach(() => localStorage.clear());

describe('choosing a course', () => {
  it('lists each course once, with its years underneath', () => {
    const { store, host, render } = make();
    store.createCourse('סמינריון', 'תשפ״ו');
    store.createCourse('סמינריון', 'תשפ״ז');
    store.createCourse('עבודה מעשית', 'תשפ״ז');
    render();

    press(host, '.trigger');
    render();

    expect([...host.querySelectorAll('.group-name')].map((e) => e.textContent?.trim())).toEqual([
      'סמינריון',
      'עבודה מעשית',
    ]);
    // Newest year first, which is the one she is almost always marking.
    expect(
      [...host.querySelectorAll('.group')].map((g) => g.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['סמינריון תשפ״ז תשפ״ו', 'עבודה מעשית תשפ״ז']);
  });

  /** The whole point of the control: pressing a year moves the rest of the app. */
  it('switches the store to the year she pressed', () => {
    const { store, host, render } = make();
    const first = store.createCourse('סמינריון', 'תשפ״ו');
    store.createCourse('סמינריון', 'תשפ״ז');
    render();

    press(host, '.trigger');
    render();
    press(host, '.year', 'תשפ״ו');
    render();

    expect(store.course()?.id).toBe(first!.id);
    // And the menu is gone, because the answer to "which course" is now on the
    // button she pressed from.
    expect(host.querySelector('.menu')).toBeNull();
  });

  it('marks the year she is already in', () => {
    const { store, host, render } = make();
    store.createCourse('סמינריון', 'תשפ״ו');
    const latest = store.createCourse('סמינריון', 'תשפ״ז');
    store.selectCourse(latest!.id);
    render();

    press(host, '.trigger');
    render();

    const marked = host.querySelector('.year.is-current');
    expect(marked?.textContent?.trim()).toBe('תשפ״ז');
  });

  /**
   * The year only appears on the button when there is more than one of it.
   * "סמינריון · תשפ״ו" on a teacher with a single course is noise that reads
   * like a setting she has to understand.
   */
  it('names the year on the button only when a course has several', () => {
    const { store, host, render } = make();
    store.createCourse('סמינריון', 'תשפ״ו');
    render();
    expect(host.querySelector('.trigger-label')?.textContent?.trim()).toBe('סמינריון');

    store.createCourse('סמינריון', 'תשפ״ז');
    render();
    expect(host.querySelector('.trigger-label')?.textContent?.trim()).toContain('תשפ״');
  });
});

describe('adding a course from the bar', () => {
  it('creates it and switches to it', () => {
    const { store, host, render } = make();
    store.createCourse('סמינריון', 'תשפ״ו');
    render();

    press(host, '.trigger');
    render();
    press(host, '.add-open');
    render();

    const [name, year] = host.querySelectorAll<HTMLInputElement>('.add .control');
    year.value = 'תשפ״ז';
    year.dispatchEvent(new Event('input'));
    render();

    // The name comes prefilled with the course she is in — adding next year's
    // run of the same course is by far the commonest reason to be here.
    expect(name.value).toBe('סמינריון');

    press(host, '.add-actions .btn', 'יצירה');
    render();

    expect(store.courses().map((c) => c.year)).toContain('תשפ״ז');
    expect(store.course()?.year).toBe('תשפ״ז');
  });

  it('says what is missing instead of closing on nothing', () => {
    const { store, host, render } = make();
    store.createCourse('סמינריון', 'תשפ״ו');
    render();

    press(host, '.trigger');
    render();
    press(host, '.add-open');
    render();
    // Year left empty.
    press(host, '.add-actions .btn', 'יצירה');
    render();

    expect(host.querySelector('.error')?.textContent).toContain('שנה');
    expect(store.courses().length).toBe(1);
    expect(host.querySelector('.add')).not.toBeNull();
  });

  it('offers to create one when she has no course at all', () => {
    const { host, render } = make();
    render();

    press(host, '.trigger');
    render();

    expect(host.querySelector('.none')).not.toBeNull();
    expect(host.querySelector('.add-open')).not.toBeNull();
  });
});
