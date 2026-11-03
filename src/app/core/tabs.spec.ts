import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

import { DataStore } from './data/data-store';
import { LocalRepository } from './data/local-repository';
import { Repository } from './data/repository';
import { SupabaseService } from './supabase/supabase';
import { MAX_TABS, Tabs, tabKey } from './tabs';

/**
 * Open places as tabs, the way a browser keeps pages.
 *
 * What makes it worth having is that switching is one click and nothing is
 * lost: returning to a place re-activates its tab rather than opening a
 * second, and each paper under review is its own tab so two can sit side by
 * side.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function setup() {
  const navigated: string[] = [];
  const router = {
    events: new Subject(),
    navigateByUrl: async (url: string) => void navigated.push(url),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
      { provide: Router, useValue: router },
    ],
  });
  return { tabs: TestBed.inject(Tabs), store: TestBed.inject(DataStore), navigated };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('which tab a place belongs to', () => {
  it('gives every section one tab, and every paper its own', () => {
    expect(tabKey('/students')).toBe('students');
    expect(tabKey('/students?q=נועה')).toBe('students');
    expect(tabKey('/review/abc')).toBe('review:abc');
    expect(tabKey('/review/abc?comment=1')).toBe('review:abc');
    expect(tabKey('/')).toBe('home');
  });
});

describe('opening places', () => {
  it('opens a tab for each new place and marks the one on screen', () => {
    const { tabs } = setup();

    tabs.visit('/home');
    tabs.visit('/students');

    expect(tabs.tabs().map((t) => t.key)).toEqual(['home', 'students']);
    expect(
      tabs
        .tabs()
        .filter((t) => t.active)
        .map((t) => t.key),
    ).toEqual(['students']);
  });

  /** Returning re-activates; it does not open a second copy. */
  it('re-activates the tab of a place she has been, and remembers where in it', () => {
    const { tabs } = setup();

    tabs.visit('/students');
    tabs.visit('/courses');
    tabs.visit('/students?q=נועה');

    expect(tabs.tabs().map((t) => t.key)).toEqual(['students', 'courses']);
    const students = tabs.tabs().find((t) => t.key === 'students')!;
    expect(students.active).toBe(true);
    expect(students.url).toBe('/students?q=נועה');
  });

  it('keeps two papers under review as two tabs', () => {
    const { tabs } = setup();

    tabs.visit('/review/one');
    tabs.visit('/review/two');

    expect(tabs.tabs().map((t) => t.key)).toEqual(['review:one', 'review:two']);
  });

  it('names a review tab after the student', () => {
    const { tabs, store } = setup();
    store.createCourse('שיטות מחקר', 'תשפ״ז');
    store.createAssignment('עבודה');
    const noa = store.addStudent('נועה כהן')!;
    const paper = store.addUploadedSubmission({
      studentId: noa.id,
      title: null,
      blocks: [{ id: 'b1', index: 0, type: 'paragraph', text: 'פסקה' }],
      text: 'פסקה',
      fileName: 'a.docx',
    })!;

    tabs.visit(`/review/${paper.id}`);

    expect(tabs.tabs()[0].title).toBe('נועה כהן');
  });

  it(`holds at most ${MAX_TABS}, dropping the one unused longest`, () => {
    const { tabs } = setup();
    const now = vi.spyOn(Date, 'now');

    for (let i = 0; i < MAX_TABS; i++) {
      now.mockReturnValue(1000 + i);
      tabs.visit(`/review/p${i}`);
    }
    // p0 is used again, so p1 becomes the longest unused.
    now.mockReturnValue(5000);
    tabs.visit('/review/p0');
    now.mockReturnValue(6000);
    tabs.visit('/students');

    const keys = tabs.tabs().map((t) => t.key);
    expect(keys).toHaveLength(MAX_TABS);
    expect(keys).toContain('review:p0');
    expect(keys).not.toContain('review:p1');
    expect(keys).toContain('students');
    now.mockRestore();
  });
});

describe('closing tabs', () => {
  it('moves to the neighbour when the tab on screen closes', () => {
    const { tabs, navigated } = setup();
    tabs.visit('/home');
    tabs.visit('/students');
    tabs.visit('/courses');
    tabs.visit('/students');

    tabs.close('students');

    expect(tabs.tabs().map((t) => t.key)).toEqual(['home', 'courses']);
    expect(navigated).toEqual(['/courses']);
  });

  it('closes a background tab without going anywhere', () => {
    const { tabs, navigated } = setup();
    tabs.visit('/home');
    tabs.visit('/students');

    tabs.close('home');

    expect(tabs.tabs().map((t) => t.key)).toEqual(['students']);
    expect(navigated).toEqual([]);
  });

  it('goes home when the last tab closes', () => {
    const { tabs, navigated } = setup();
    tabs.visit('/students');

    tabs.close('students');

    expect(navigated).toEqual(['/home']);
  });
});

describe('remembering them', () => {
  it('brings the tabs back in a new session', () => {
    const first = setup();
    first.tabs.visit('/home');
    first.tabs.visit('/courses');

    const second = setup();
    expect(second.tabs.tabs().map((t) => t.key)).toEqual(['home', 'courses']);
  });

  /** Private windows and blocked storage: the strip simply starts empty. */
  it('starts empty, without failing, when storage holds something unreadable', () => {
    localStorage.setItem('margin.tabs', '{not json');
    const { tabs } = setup();
    expect(tabs.tabs()).toEqual([]);
  });
});
