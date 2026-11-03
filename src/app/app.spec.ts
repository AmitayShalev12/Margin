import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';
import { LocalRepository } from './core/data/local-repository';
import { Repository } from './core/data/repository';
import { SupabaseService } from './core/supabase/supabase';
import { FEATURE_FLAGS } from './core/features';
import { QuickActions } from './shared/ui/quick-actions/quick-actions';

class FakeSupabase {
  isConfigured = true;
  loading = () => false;
  session = () => ({ access_token: 'jwt' }) as unknown;
  user = () => ({ id: 'teacher-1', email: 'ronit@school.org.il' }) as unknown;
  teacherId = 'teacher-1';
  signOut = async () => undefined;
  onTeacherChange = () => undefined;
  ready = Promise.resolve();
}

function configure(supabase: FakeSupabase, mailing = false) {
  TestBed.resetTestingModule();
  return TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: SupabaseService, useValue: supabase },
      { provide: Repository, useClass: LocalRepository },
      { provide: FEATURE_FLAGS, useValue: { mailing } },
      provideRouter(routes),
    ],
  }).compileComponents();
}

describe('App', () => {
  let supabase: FakeSupabase;

  beforeEach(async () => {
    supabase = new FakeSupabase();
    await configure(supabase);
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the primary navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('nav[aria-label="ניווט ראשי"]').length).toBeGreaterThan(0);
    expect(compiled.textContent).toContain('עבודות');
  });

  it('shows which account she is signed in as, and the way out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('ronit@school.org.il');
    expect(compiled.textContent).toContain('התנתקות');
  });

  /**
   * There is no useful signed-out view of this app: every screen reads the
   * teacher's own rows, and RLS answers an unauthenticated read with silence,
   * which would render as an empty account rather than as a problem.
   */
  it('shows the sign-in screen instead of the app when signed out', async () => {
    supabase.session = () => null;
    supabase.user = () => null;
    await configure(supabase);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-sign-in')).toBeTruthy();
    expect(compiled.querySelector('nav[aria-label="ניווט ראשי"]')).toBeNull();
    expect(compiled.textContent).toContain('התחברות עם חשבון Google');
  });

  it('waits rather than flashing the sign-in screen while the session is restored', async () => {
    supabase.loading = () => true;
    supabase.session = () => null;
    await configure(supabase);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-sign-in')).toBeNull();
    expect(compiled.querySelector('nav[aria-label="ניווט ראשי"]')).toBeNull();
  });

  /** An unconfigured checkout has to stay openable, on seeded records. */
  it('skips the gate entirely when the project is not configured', async () => {
    supabase.isConfigured = false;
    supabase.session = () => null;
    supabase.user = () => null;
    await configure(supabase);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-sign-in')).toBeNull();
    expect(compiled.querySelectorAll('nav[aria-label="ניווט ראשי"]').length).toBeGreaterThan(0);
  });
});

/**
 * The sidebar, reorganised after a usability review: grouped by what she is
 * doing, each group folding on its own, the whole rail folding to icons, and
 * the quick actions beside the places they belong to.
 */
describe('the navigation', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  async function render(mailing = false) {
    await configure(new FakeSupabase(), mailing);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const rail = (fixture.nativeElement as HTMLElement).querySelector('.rail') as HTMLElement;
    const press = (selector: string, text?: string) => {
      const target = [...rail.querySelectorAll<HTMLElement>(selector)].find(
        (el) => !text || el.textContent?.includes(text),
      );
      if (!target) throw new Error(`nothing matching ${selector} ${text ?? ''}`);
      target.click();
      fixture.detectChanges();
    };
    return { fixture, rail, press };
  }

  it('groups the places, each group with a heading of its own', async () => {
    const { rail } = await render();
    const heads = [...rail.querySelectorAll('.group-head')].map((h) => h.textContent?.trim());

    expect(heads).toEqual(['סקירה', 'תלמידות ועבודות', 'הקורס', 'הגדרות']);
    expect(rail.textContent).toContain('התלמידות שלי');
    expect(rail.textContent).toContain('טפסי הערכה');
  });

  /** Hidden from the interface, kept in the code. */
  it('has no mail entry while mailing is switched off, and has one when it is on', async () => {
    expect((await render(false)).rail.textContent).not.toContain('מיילים');
    expect((await render(true)).rail.textContent).toContain('מיילים לתלמידות');
  });

  it('folds one group away and leaves the others', async () => {
    const { rail, press } = await render();

    press('.group-head', 'הקורס');

    expect(rail.textContent).not.toContain('טפסי הערכה');
    expect(rail.textContent).toContain('התלמידות שלי');
    expect(rail.querySelector('.group-head[aria-expanded="false"]')?.textContent).toContain(
      'הקורס',
    );
  });

  it('folds the whole rail to icons, every place still reachable', async () => {
    const { rail, press } = await render();
    const before = rail.querySelectorAll('a.rail-link').length;

    press('.rail-toggle');

    expect(rail.querySelectorAll('.group-head')).toHaveLength(0);
    expect(rail.querySelectorAll('a.rail-link')).toHaveLength(before);
    expect(rail.querySelector('a.rail-link')?.getAttribute('aria-label')).toBeTruthy();
  });

  it('remembers the folded rail in a new session', async () => {
    (await render()).press('.rail-toggle');
    const again = await render();
    expect(again.rail.querySelectorAll('.group-head')).toHaveLength(0);
  });

  it('opens "add a student" from beside My Students', async () => {
    const { press } = await render();

    press('.rail-quick[aria-label="הוספת תלמידה"]');

    expect(TestBed.inject(QuickActions).addStudentOpen()).toBe(true);
  });
});
