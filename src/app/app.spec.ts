import { Assistant } from './core/assistant/assistant';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';
import { LocalRepository } from './core/data/local-repository';
import { Repository } from './core/data/repository';
import { SupabaseService } from './core/supabase/supabase';
import { FEATURE_FLAGS } from './core/features';

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
    expect(compiled.textContent).toContain('קורסים');
  });

  it('shows which account she is signed in as, and the way out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // In the account menu at the top, and in the phone's "עוד" sheet.
    compiled.querySelector<HTMLButtonElement>('[aria-label="החשבון"]')!.click();
    fixture.detectChanges();

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

/** No sidebar: home, her students and the assistant are reached from the edges. */
describe('the navigation', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  async function render(mailing = false) {
    await configure(new FakeSupabase(), mailing);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('has no sidebar', async () => {
    const { host } = await render();
    expect(host.querySelector('.rail')).toBeNull();
  });

  it('opens the dynamic sidebar with home, her students, what waits and the courses', async () => {
    const { host, fixture } = await render();
    expect(host.querySelector('app-side-dock .panel')).toBeNull();

    host.querySelector<HTMLButtonElement>('app-side-dock .handle')!.click();
    fixture.detectChanges();

    const panel = host.querySelector('app-side-dock .panel') as HTMLElement;
    const heads = [...panel.querySelectorAll('.head')].map((h) => h.textContent?.trim());
    expect(heads[0]).toBe('בית');
    expect(heads[1]).toBe('התלמידות שלי');
    expect(heads[2]).toContain('מה מחכה לי');
    expect(heads[3]).toContain('הקורסים');
    expect(panel.querySelector('a[href="/students"]')).not.toBeNull();
  });

  /** One row: the tabs, then the year and search at its far end. */
  it('puts the year and search in the same row as the tabs', async () => {
    const { host } = await render();
    const bar = host.querySelector('.topbar') as HTMLElement;

    expect(bar.querySelector('app-tab-strip')).not.toBeNull();
    expect(bar.querySelector('.pick-year')).not.toBeNull();
    expect(bar.querySelector('#top-search')).not.toBeNull();
  });

  it('opens search with Ctrl+K', async () => {
    const { host, fixture } = await render();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    fixture.detectChanges();

    expect(host.querySelector('.search')?.classList).toContain('is-open');
  });

  it('keeps her account in the corner', async () => {
    const { host } = await render();
    // Outside the top bar: its blur would otherwise pin the button to the bar.
    expect(host.querySelector('app-account-corner [aria-label="החשבון"]')).not.toBeNull();
    expect(host.querySelector('.topbar [aria-label="החשבון"]')).toBeNull();
  });

  it('opens the assistant from the corner button', async () => {
    const { host, fixture } = await render();

    host.querySelector<HTMLButtonElement>('.assistant-launcher')!.click();
    fixture.detectChanges();

    expect(TestBed.inject(Assistant).isOpen()).toBe(true);
    expect(host.querySelector('.assistant-launcher')).toBeNull();
  });
});
