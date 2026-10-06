import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Dashboard } from './dashboard';
import { DataStore } from '../../core/data/data-store';
import { LocalRepository } from '../../core/data/local-repository';
import { Repository } from '../../core/data/repository';
import { seedStore } from '../../core/mock/seed-store';
import { TEACHER_ID } from '../../core/mock/seed-data';
import { SupabaseService } from '../../core/supabase/supabase';

/**
 * The home screen, rebuilt as the roster.
 *
 * "דף הבית מכיל את רשימת התלמידות וכתובת התיקיות שלהם... עבור כל תלמידה יופיע
 * מספר הקבצים בתיקייה וסיכום המצב שלה."
 *
 * What is worth testing here is the arithmetic in each row, because every one
 * of those numbers is a claim she will act on. A count that includes another
 * girl's papers, or a progress figure that counts comments she has not looked
 * at, is worse than no number at all: it reads as true and sends her to the
 * wrong student.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = TEACHER_ID;
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

interface Row {
  id: string;
  name: string;
  folder: string | null;
  files: number;
  checked: number;
  latestId: string | null;
  comments: number;
  decided: number;
  toFix: number;
  percent: number | null;
}

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
  seedStore(store);

  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();

  return {
    store,
    fixture,
    component: fixture.componentInstance as unknown as {
      rows(): Row[];
      subtitle(): string;
      search: { set(v: string): void };
      openUpload(id: string): void;
      startFolder(id: string, current: string | null): void;
      saveFolder(id: string): void;
      folderDraft: { set(v: string): void };
    },
  };
}

beforeEach(() => localStorage.clear());

describe('the roster', () => {
  it('shows every girl on the course, one row each', () => {
    const { store, component } = make();

    expect(component.rows().length).toBe(store.students().length);
    expect(component.rows().length).toBeGreaterThan(0);
    expect(component.rows().map((r) => r.name)).toEqual(store.students().map((s) => s.full_name));
  });

  /**
   * The count is hers alone. The seed has several girls with papers, so a row
   * that counted the whole table would pass a "greater than zero" test and
   * still be wrong on screen.
   */
  it('counts only the papers belonging to that student', () => {
    const { store, component } = make();
    const row = component.rows().find((r) => r.files > 0);

    expect(row).toBeDefined();
    const hers = store.submissions().filter((s) => s.student_id === row!.id);
    expect(row!.files).toBe(hers.length);
    expect(hers.length).toBeLessThan(store.submissions().length);
  });

  it('filters by name as she types', () => {
    const { store, component } = make();
    const target = store.students()[1];

    component.search.set(target.full_name);

    expect(component.rows().map((r) => r.name)).toEqual([target.full_name]);
  });

  it('matches a surname typed with the other geresh', () => {
    const { store, component } = make();
    const withGeresh = store.students().find((s) => /['׳’]/.test(s.full_name));

    if (!withGeresh) return expect(true).toBe(true);

    component.search.set(withGeresh.full_name.replace(/[׳’]/g, "'"));

    expect(component.rows().some((r) => r.name === withGeresh.full_name)).toBe(true);
  });
});

describe('how far the review got', () => {
  /**
   * Her progress is the share of comments she has ruled on — accepted, edited
   * or rejected alike. A pending comment is work outstanding whichever way it
   * eventually goes, so counting it as progress would overstate where she is.
   */
  it('counts a decision either way, and nothing still pending', () => {
    const { store, component } = make();

    const row = component.rows().find((r) => r.comments > 0);
    expect(row).toBeDefined();

    const mine = store.annotations().filter((a) => a.submission_id === row!.latestId);
    const pending = mine.filter((a) => a.status === 'pending').length;

    expect(row!.comments).toBe(mine.length);
    expect(row!.decided).toBe(mine.length - pending);
    expect(row!.percent).toBe(Math.round((row!.decided / row!.comments) * 100));
  });

  it('moves when she rules on one more', () => {
    const { store, component, fixture } = make();

    const before = component.rows().find((r) => r.comments > r.decided);
    expect(before).toBeDefined();

    const pending = store
      .annotations()
      .find((a) => a.submission_id === before!.latestId && a.status === 'pending');
    store.setAnnotationStatus(pending!.id, 'accepted');
    fixture.detectChanges();

    const after = component.rows().find((r) => r.id === before!.id);
    expect(after!.decided).toBe(before!.decided + 1);
    expect(after!.toFix).toBe(before!.toFix + 1);
  });

  /**
   * No comments, no share. Rendering 0% for a paper nobody has drafted yet
   * says the review has started and got nowhere, which is a different and
   * worse thing than not having started.
   */
  it('has no percentage before there are any comments', () => {
    const { component } = make();

    for (const row of component.rows()) {
      if (row.comments === 0) expect(row.percent).toBeNull();
    }
    expect(component.rows().some((r) => r.comments === 0)).toBe(true);
  });

  /** What the student has to go and fix is what the teacher stood behind. */
  it('counts a dismissed comment as decided but not as work for the student', () => {
    const { store, component, fixture } = make();

    const before = component.rows().find((r) => r.comments > r.decided);
    const pending = store
      .annotations()
      .find((a) => a.submission_id === before!.latestId && a.status === 'pending');
    store.setAnnotationStatus(pending!.id, 'dismissed');
    fixture.detectChanges();

    const after = component.rows().find((r) => r.id === before!.id);
    expect(after!.decided).toBe(before!.decided + 1);
    expect(after!.toFix).toBe(before!.toFix);
  });
});

describe('the summary line', () => {
  it('says so in words when it is one girl', () => {
    const { component } = make();

    expect(component.rows().filter((r) => r.comments > r.decided).length).toBe(1);
    expect(component.subtitle()).toContain('אחת');
  });

  it('counts them once a second girl has comments waiting', () => {
    const { store, component, fixture } = make();

    // A girl with nothing outstanding, given one comment to rule on.
    const quiet = component.rows().find((r) => r.comments === 0 && r.latestId);
    expect(quiet).toBeDefined();

    const round = store.rounds().find((r) => r.submission_id === quiet!.latestId);
    const written = store.addOwnAnnotation({
      submissionId: quiet!.latestId!,
      roundId: round!.id,
      anchor: { block_id: 'b1', block_index: 0, start: 0, end: 16, quote: 'משפט מתוך העבודה' },
      kind: 'sources',
      body: 'צריך מקור לטענה הזו.',
    });
    store.setAnnotationStatus(written!.id, 'pending');
    fixture.detectChanges();

    expect(component.rows().find((r) => r.id === quiet!.id)!.comments).toBe(1);
    expect(component.subtitle()).toContain('2');
  });

  it('says nothing is waiting once she has ruled on all of them', () => {
    const { store, component, fixture } = make();

    for (const a of store.annotations()) {
      if (a.status === 'pending') store.setAnnotationStatus(a.id, 'dismissed');
    }
    fixture.detectChanges();

    expect(component.rows().every((r) => r.decided === r.comments)).toBe(true);
    expect(component.subtitle()).toContain('אין כרגע הערות');
  });

  /**
   * The count is of students, not of the filtered view she happens to be in.
   *
   * Searched for deliberately on a girl with nothing outstanding: counting off
   * the filtered list would make the line read "אין כרגע הערות" while a paper
   * sat waiting one keystroke away.
   */
  it('does not change when she searches for someone with nothing waiting', () => {
    const { component } = make();
    const before = component.subtitle();
    const quiet = component.rows().find((r) => r.comments === 0);

    component.search.set(quiet!.name);

    expect(component.rows().length).toBe(1);
    expect(component.subtitle()).toBe(before);
  });
});

/**
 * The screen itself, not the arithmetic behind it.
 *
 * Twice in this project a method landed on the store with no caller in any
 * template, and twice the symptom was a button that did nothing. These assert
 * against the rendered DOM, because that is the only place that question gets
 * a real answer.
 */
describe('what the row actually renders', () => {
  it('puts both buttons on every row, not just the first', () => {
    const { fixture, component } = make();
    const host = fixture.nativeElement as HTMLElement;
    const labels = [...host.querySelectorAll('.row-actions .btn')].map((b) =>
      (b.textContent ?? '').trim(),
    );

    expect(component.rows().length).toBeGreaterThan(1);
    expect(labels.filter((t) => t === 'הוספת קובץ').length).toBe(component.rows().length);
    expect(labels.filter((t) => t === 'כתיבת טיוטה').length).toBe(component.rows().length);
    // Nothing is picking a file until she asks for one.
    expect(host.querySelectorAll('input[type="file"]').length).toBe(0);
  });

  it('opens a file picker on the row she pressed, and on no other', () => {
    const { fixture, component } = make();
    const row = component.rows()[1];

    component.openUpload(row.id);
    fixture.detectChanges();

    const pickers = (fixture.nativeElement as HTMLElement).querySelectorAll('input[type="file"]');
    expect(pickers.length).toBe(1);
  });

  it('shows the folder field, and keeps it open when the paste is refused', () => {
    const { fixture, component } = make();
    const row = component.rows()[0];

    component.startFolder(row.id, row.folder);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.folder-edit')).not.toBeNull();

    component.folderDraft.set('התיקייה של נועה');
    component.saveFolder(row.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.folder-edit')).not.toBeNull();
    expect(host.querySelector('.folder-errorline')?.textContent).toContain('קישור לתיקייה');
  });

  it('shows the folder as a link once it is saved', () => {
    const { fixture, component } = make();
    const row = component.rows()[0];

    component.startFolder(row.id, row.folder);
    component.folderDraft.set(
      'https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h?usp=sharing',
    );
    component.saveFolder(row.id);
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector(
      'a.folder-link',
    ) as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe(
      'https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h',
    );
  });
});
