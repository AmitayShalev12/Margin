import { Injectable, computed, inject, signal } from '@angular/core';

import { SupabaseService } from '../supabase/supabase';

export type DriveConnection = 'unknown' | 'connected' | 'disconnected';

/** Keys earlier versions wrote. Cleared on startup so nothing lingers. */
const LEGACY_TOKEN_KEYS = ['margin.drive_token'];

interface MintedToken {
  access_token: string;
  /** Epoch milliseconds. */
  expires_at: number;
}

interface TokenResponse {
  connected: boolean;
  access_token?: string;
  expires_in?: number;
  scope?: string;
  google_email?: string | null;
  reason?: string;
}

interface StatusResponse {
  connected: boolean;
  google_email?: string | null;
  scope?: string;
}

/**
 * The teacher's Drive connection.
 *
 * The long-lived credential — Google's refresh token — lives in the
 * `drive-auth` Edge Function and its service-role-only table. It is never sent
 * to the browser. What this class holds is an access token minted on demand by
 * `drive-token`, kept in a private field for the minutes it is valid and
 * written to no storage of any kind.
 *
 * That is the whole point of the indirection: a compromised browser yields at
 * most the remainder of one short window against read-only scopes, rather than
 * standing access to a class's work.
 */
@Injectable({ providedIn: 'root' })
export class GoogleDriveAuth {
  private readonly supabase = inject(SupabaseService);

  /**
   * Deliberately a plain field, not a signal and not persisted. Nothing should
   * be able to observe it into a template, a devtools snapshot or storage.
   */
  private token: MintedToken | null = null;
  /** De-duplicates concurrent mints during a sync. */
  private inFlight: Promise<string | null> | null = null;

  private readonly _connection = signal<DriveConnection>('unknown');
  private readonly _email = signal<string | null>(null);
  private readonly _busy = signal(false);

  readonly connection = this._connection.asReadonly();
  readonly googleEmail = this._email.asReadonly();
  readonly busy = this._busy.asReadonly();

  readonly isConnected = computed(() => this._connection() === 'connected');
  readonly canConnect = this.supabase.isConfigured;

  constructor() {
    // Anything an earlier build left in browser storage is a credential we no
    // longer want to exist. Remove it whether or not it is still valid.
    for (const key of LEGACY_TOKEN_KEYS) {
      try {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      } catch {
        // Storage unavailable — nothing to clean up.
      }
    }
  }

  /**
   * Asks the server whether this teacher has a stored credential. Called on
   * startup and after returning from Google's consent screen.
   */
  async refreshStatus(): Promise<DriveConnection> {
    if (!this.canConnect) {
      this._connection.set('disconnected');
      return 'disconnected';
    }

    try {
      const status = await this.call<StatusResponse>('drive-auth/status', { method: 'POST' });
      this._connection.set(status?.connected ? 'connected' : 'disconnected');
      this._email.set(status?.google_email ?? null);
    } catch {
      this._connection.set('disconnected');
    }
    return this._connection();
  }

  /**
   * Starts the consent flow. The server builds the URL and records a
   * single-use state bound to this teacher; the browser only follows it.
   */
  async connect(redirectTo: string = window.location.origin + window.location.pathname) {
    this._busy.set(true);
    try {
      const started = await this.call<{ url: string }>('drive-auth/start', {
        method: 'POST',
        body: JSON.stringify({ redirect_to: redirectTo }),
      });
      if (started?.url) window.location.href = started.url;
    } finally {
      this._busy.set(false);
    }
  }

  /** Forgets the stored credential and revokes it at Google's end. */
  async disconnect() {
    this.token = null;
    try {
      await this.call('drive-auth', { method: 'DELETE' });
    } finally {
      this._connection.set('disconnected');
      this._email.set(null);
    }
  }

  /**
   * A usable access token, minting a fresh one when the current is missing or
   * spent. Returns null when there is nothing to mint from.
   */
  async accessToken(): Promise<string | null> {
    if (this.token && this.token.expires_at > Date.now()) return this.token.access_token;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.mint().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Drops the cached token after Drive rejects it, forcing a fresh mint. */
  invalidate() {
    this.token = null;
  }

  private async mint(): Promise<string | null> {
    if (!this.canConnect) {
      this._connection.set('disconnected');
      return null;
    }

    let response: TokenResponse | null;
    try {
      response = await this.call<TokenResponse>('drive-token', { method: 'POST' });
    } catch {
      return null;
    }

    if (!response?.connected || !response.access_token) {
      // Includes the case where the teacher revoked access at Google's end,
      // which the function reports as `reason: 'revoked'`.
      this.token = null;
      this._connection.set('disconnected');
      return null;
    }

    this.token = {
      access_token: response.access_token,
      expires_at: Date.now() + (response.expires_in ?? 600) * 1000,
    };
    this._connection.set('connected');
    if (response.google_email !== undefined) this._email.set(response.google_email);

    return this.token.access_token;
  }

  /** Calls an Edge Function with the teacher's Supabase session. */
  private async call<T>(path: string, init: RequestInit): Promise<T | null> {
    const { data } = await this.supabase.client.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt) throw new Error('Not signed in');

    const response = await fetch(`${this.functionsUrl}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    });

    if (!response.ok) throw new Error(`Edge function ${path} failed (${response.status})`);
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  private get functionsUrl(): string {
    return `${this.supabase.functionsUrl}`;
  }
}
