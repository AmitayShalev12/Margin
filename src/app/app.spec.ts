import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';
import { LocalRepository } from './core/data/local-repository';
import { Repository } from './core/data/repository';
import { SupabaseService } from './core/supabase/supabase';

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

function configure(supabase: FakeSupabase) {
  TestBed.resetTestingModule();
  return TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: SupabaseService, useValue: supabase },
      { provide: Repository, useClass: LocalRepository },
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
