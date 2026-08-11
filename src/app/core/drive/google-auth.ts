import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { SupabaseService } from '../supabase/supabase';

/**
 * Read-only access, and nothing more.
 *
 * `drive.readonly` lists the folder and reads file metadata and revisions.
 * `documents.readonly` is what makes the Docs API return the document's
 * *structure* — Drive's plain-text export throws away the headings the review
 * screen groups by, so the second scope is what keeps grouping working.
 */
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
].join(' ');

const STORAGE_KEY = 'margin.drive_token';

/** Google's OAuth access tokens last an hour; we retire ours slightly early. */
const ASSUMED_LIFETIME_MS = 55 * 60 * 1000;

interface StoredToken {
  access_token: string;
  obtained_at: number;
}

function read(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

function write(token: StoredToken | null) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing with storage disabled: the token simply lives in
    // memory for this page view.
  }
}

/**
 * Connects the teacher's Google account and holds the Drive access token.
 *
 * The OAuth round trip runs through Supabase Auth, which hands back Google's
 * access token as `session.provider_token` on the redirect back into the app.
 *
 * Two things worth knowing about that token:
 *
 *  - supabase-js surfaces it on the sign-in event and does not refresh it. So
 *    it is cached here, in `sessionStorage` — it dies with the browser tab
 *    rather than persisting to disk, and when it expires the teacher is asked
 *    to reconnect.
 *  - holding an access token in the browser at all is a tradeoff. It is bounded
 *    (read-only, one hour, tab-scoped), but the durable answer is to keep the
 *    refresh token server-side in a Supabase Edge Function and have the client
 *    ask *it* for documents. That is the right move before this handles a real
 *    class's work; it is out of scope for wiring up the integration.
 */
@Injectable({ providedIn: 'root' })
export class GoogleDriveAuth {
  private readonly supabase = inject(SupabaseService);

  private readonly token = signal<StoredToken | null>(read());
  private readonly now = signal(Date.now());

  /** True when there is a live token to call Drive with. */
  readonly isConnected = computed(() => {
    const token = this.token();
    return !!token && this.now() - token.obtained_at < ASSUMED_LIFETIME_MS;
  });

  /** True when a token existed but has aged out — the teacher must reconnect. */
  readonly isExpired = computed(() => !!this.token() && !this.isConnected());

  /** Supabase must be configured before any of this can work. */
  readonly canConnect = this.supabase.isConfigured;

  constructor() {
    // The provider token arrives on the session when Google redirects back.
    effect(() => {
      const session = this.supabase.session();
      const provider = session?.provider_token;
      if (provider) this.store(provider);
    });
  }

  accessToken(): string | null {
    return this.isConnected() ? (this.token()?.access_token ?? null) : null;
  }

  /** Sends the teacher to Google's consent screen. */
  connect(redirectTo: string = window.location.href) {
    return this.supabase.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: DRIVE_SCOPES,
        redirectTo,
        queryParams: {
          // Ask every time, so the Drive scopes are actually granted rather
          // than silently reused from an earlier, narrower consent.
          prompt: 'consent',
          access_type: 'offline',
        },
      },
    });
  }

  /** Forgets the cached token. Does not revoke the grant at Google's end. */
  disconnect() {
    this.token.set(null);
    write(null);
  }

  /**
   * Called when Drive rejects the token mid-sync. Clears it so the UI offers
   * reconnection rather than retrying with a credential that cannot work.
   */
  invalidate() {
    this.disconnect();
  }

  /** Re-evaluates expiry — the connection card calls this when it is shown. */
  refreshClock() {
    this.now.set(Date.now());
  }

  private store(accessToken: string) {
    const token: StoredToken = { access_token: accessToken, obtained_at: Date.now() };
    this.token.set(token);
    this.now.set(Date.now());
    write(token);
  }
}
