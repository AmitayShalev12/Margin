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
   * True while the environment still holds placeholder credentials. Screens
   * use this to fall back to mock data instead of erroring out.
   */
  readonly isConfigured =
    !environment.supabaseUrl.includes(PLACEHOLDER_MARKER) &&
    !environment.supabaseAnonKey.includes(PLACEHOLDER_MARKER);

  constructor() {
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
      return;
    }

    void this.supabase.auth.getSession().then(({ data }) => {
      this.applySession(data.session);
      this.loading.set(false);
    });

    this.supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session) => {
      this.applySession(session);
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

  signInWithGoogle(redirectTo: string = window.location.origin) {
    return this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }

  signInWithEmail(email: string, password: string) {
    return this.supabase.auth.signInWithPassword({ email, password });
  }

  signOut() {
    return this.supabase.auth.signOut();
  }

  private applySession(session: Session | null) {
    this.session.set(session);
    this.user.set(session?.user ?? null);
  }
}
