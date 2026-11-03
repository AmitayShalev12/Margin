import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Assistant } from '../../core/assistant/assistant';
import { DataStore } from '../../core/data/data-store';
import { LocalRepository } from '../../core/data/local-repository';
import { Repository } from '../../core/data/repository';
import { seedStore } from '../../core/mock/seed-store';
import { TEACHER_ID } from '../../core/mock/seed-data';
import { SupabaseService } from '../../core/supabase/supabase';
import { QuickActions } from '../../shared/ui/quick-actions/quick-actions';
import { Home } from './home';

/**
 * Home: what she can do, and where to start.
 *
 * Every workflow is a card with its way in, the quick action that belongs to
 * it sits inside that card, and the one thing waiting on her comes first.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = TEACHER_ID;
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function render(seeded = true) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
    ],
  });
  if (seeded) seedStore(TestBed.inject(DataStore));
  const fixture = TestBed.createComponent(Home);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const press = (text: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    );
    if (!button) throw new Error(`no button "${text}"`);
    button.click();
    fixture.detectChanges();
  };
  return { host, press };
}

beforeEach(() => localStorage.clear());

describe('the home screen', () => {
  it('has a card for every workflow, each with its way in', () => {
    const { host } = render();
    const titles = [...host.querySelectorAll('.flow-title')].map((t) => t.textContent?.trim());

    expect(titles).toEqual([
      'התלמידות שלי',
      'עבודות שהוגשו',
      'קורסים וחומרי רקע',
      'טפסי הערכה',
      'הסגנון שלי',
      'העוזר',
    ]);
    const links = [...host.querySelectorAll('.flow a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/students', '/submissions', '/courses', '/grading-forms', '/style']);
  });

  /** The quick action lives in the card it belongs to. */
  it('adds a student from the students card, and a course from the courses card', () => {
    const { press } = render();
    const quick = TestBed.inject(QuickActions);

    press('הוספת תלמידה');
    expect(quick.addStudentOpen()).toBe(true);

    press('הוספת קורס');
    expect(quick.addCourseOpen()).toBe(true);
  });

  it('opens the assistant from its card', () => {
    const { press } = render();
    press('פתיחת העוזר');
    expect(TestBed.inject(Assistant).isOpen()).toBe(true);
  });

  it('puts what is waiting on her first, with the way straight to it', () => {
    const { host } = render();
    const waiting = host.querySelector('.waiting');

    expect(waiting).not.toBeNull();
    expect(waiting!.textContent).toContain('ממתינות להחלטה שלך');
    expect(waiting!.querySelector('a')?.getAttribute('href')).toMatch(/^\/review\//);
  });

  it('shows nothing waiting when nothing is', () => {
    const { host } = render(false);
    expect(host.querySelector('.waiting')).toBeNull();
    expect(host.textContent).toContain('כדי להתחיל');
  });
});
