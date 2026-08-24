import { Injectable, signal } from '@angular/core';
import {
  AuthChangeEvent,
  Session,
  SupabaseClient,
  User,
  createClient,
} from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

const PLACEHOLDER_MARKER = 'YOUR-';

/**
 * Single entry point to Supabase.
 *
 * Everything data-related in the app goes through `client`; auth state is
 * mirrored into signals so components can read it without subscribing.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly supabase: SupabaseClient;

  /** Current session, or null when signed out. */
  readonly session = signal<Session | null>(null);
  readonly user = signal<User | null>(null);
  /** True until the initial session lookup has settled. */
  readonly loading = signal(true);

  /**
   * Resolves once the stored session has been restored (or found absent).
   *
   * Startup has to wait on this. Loading records before it settles would ask
   * Postgres for the teacher's rows with no JWT attached, and RLS answers that
   * with an empty result rather than an error — the app would render the
   * seeded demonstration records as though they were hers.
   */
  readonly ready: Promise<void>;
  private settleReady!: () => void;

  /** Notified when the signed-in teacher changes, including to nobody. */
  private readonly teacherListeners: ((teacherId: string | null) => void)[] = [];

  /**
   * True while the environment still holds placeholder credentials. Screens
   * use this to fall back to mock data instead of erroring out.
   */
  readonly isConfigured =
    !environment.supabaseUrl.includes(PLACEHOLDER_MARKER) &&
    !environment.supabaseAnonKey.includes(PLACEHOLDER_MARKER);

  constructor() {
    this.ready = new Promise<void>((resolve) => (this.settleReady = resolve));

    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    if (!this.isConfigured) {
      console.warn(
        '[Margin] Supabase credentials are still placeholders. ' +
          'Fill in src/environments/environment.development.ts to connect to real data.',
      );
      this.loading.set(false);
      this.settleReady();
      return;
    }

    void this.supabase.auth.getSession().then(({ data }) => {
      this.applySession(data.session);
      this.loading.set(false);
      this.settleReady();
    });

    this.supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session) => {
      this.applySession(session);
      // A magic link or an OAuth redirect lands here rather than in getSession
      // above, so this is what releases startup in those cases.
      this.loading.set(false);
      this.settleReady();
    });
  }

  /** The raw supabase-js client, for queries, storage and realtime. */
  get client(): SupabaseClient {
    return this.supabase;
  }

  /** Base URL of the project's Edge Functions. */
  get functionsUrl(): string {
    return `${environment.supabaseUrl.replace(/\/$/, '')}/functions/v1`;
  }

  /** Convenience: the signed-in teacher's id, used as the tenant key. */
  get teacherId(): string | null {
    return this.user()?.id ?? null;
  }

  /**
   * The teacher's own Google account, which is the same one Drive uses.
   *
   * Deliberately no Drive scopes here: this grant only identifies her. Drive
   * access is a separate consent handled by `drive-auth`, whose refresh token
   * never reaches the browser. Bundling them would put a long-lived Drive
   * grant behind an ordinary sign-in button.
   */
  signInWithGoogle(redirectTo: string = window.location.origin) {
    return this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }

  /** The fallback, for when Google is unavailable or refuses. */
  signInWithMagicLink(email: string, redirectTo: string = window.location.origin) {
    return this.supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
  }

  signInWithEmail(email: string, password: string) {
    return this.supabase.auth.signInWithPassword({ email, password });
  }

  signOut() {
    return this.supabase.auth.signOut();
  }

  /**
   * Registers a handler for sign-in and sign-out.
   *
   * A callback rather than an effect: this drives loading and clearing the
   * record store, which must happen once per actual change of teacher, not
   * once per token refresh — and `onAuthStateChange` fires on every refresh.
   */
  onTeacherChange(handler: (teacherId: string | null) => void): void {
    this.teacherListeners.push(handler);
  }

  private applySession(session: Session | null) {
    const before = this.user()?.id ?? null;
    this.session.set(session);
    this.user.set(session?.user ?? null);

    const after = session?.user?.id ?? null;
    if (before !== after) {
      for (const handler of this.teacherListeners) handler(after);
    }
  }
}
