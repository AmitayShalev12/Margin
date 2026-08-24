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
  /** Requested permissions Google says she did not grant. Computed server-side. */
  missing_scopes?: string[];
  google_email?: string | null;
  reason?: string;
}

interface StatusResponse {
  connected: boolean;
  google_email?: string | null;
  scope?: string;
  missing_scopes?: string[];
}

/**
 * The scope that lets Margin leave a comment on a document.
 *
 * Restated here rather than imported: the Edge Functions are Deno and share no
 * module graph with the app. `supabase/functions/_shared/google.ts` is the
 * source of truth and explains why this scope and not a narrower one.
 */
export const DRIVE_WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';

/** Teacher-facing names for the permissions, for when one is missing. */
const SCOPE_LABEL: Record<string, string> = {
  [DRIVE_WRITE_SCOPE]: 'הוספת הערות למסמכים',
  'https://www.googleapis.com/auth/drive.readonly': 'צפייה בקבצים בדרייב',
  'https://www.googleapis.com/auth/documents.readonly': 'קריאת תוכן המסמכים',
};

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
  private readonly _missingScopes = signal<string[]>([]);
  /** The scopes Google actually issued, as reported with the credential. */
  private readonly _grantedScopes = signal<string[]>([]);

  readonly connection = this._connection.asReadonly();
  readonly googleEmail = this._email.asReadonly();
  readonly busy = this._busy.asReadonly();

  /** Permissions she was asked for and did not grant. Empty is the good case. */
  readonly missingScopes = this._missingScopes.asReadonly();

  readonly isConnected = computed(() => this._connection() === 'connected');

  /**
   * Connected, but short of a permission the app needs.
   *
   * Kept distinct from `isConnected` because Google reports a partial grant as
   * a success: the connection is real, the token is valid, and Drive still
   * refuses the calls that need what she unticked.
   */
  readonly isIncomplete = computed(
    () =>
      this._connection() === 'connected' &&
      // The commenting permission is excluded on purpose. Missing it does not
      // make the connection incomplete for syncing, which is what this flag
      // drives — a teacher who only wants to pull work in should not be shown
      // a warning about a screen she has not been to.
      this._missingScopes().some((scope) => scope !== DRIVE_WRITE_SCOPE),
  );

  /**
   * Connected, reading fine, but not allowed to comment.
   *
   * This is the ordinary state for every teacher who connected before Margin
   * could write comments: she granted read-only, that grant is still valid, and
   * the sync keeps working. Only posting is refused — so it is kept apart from
   * `isIncomplete`, and the ask is made where it is relevant rather than as a
   * standing warning on a screen she came to for something else.
   */
  readonly needsCommentConsent = computed(() => {
    const granted = this._grantedScopes();

    /**
     * Read from the grant itself, not from the server's verdict on it.
     *
     * `missing_scopes` is computed inside the Edge Functions against their own
     * copy of the required list — so between widening that list and deploying
     * them, the server reports nothing missing while Google refuses every
     * write. The grant string is a fact rather than a judgement, and it is
     * already in the same response, so the check does not have to wait for a
     * deployment to become true.
     *
     * Compared as whole tokens: `…/auth/drive.readonly` contains `…/auth/drive`
     * as a substring, and a naive match would read a read-only grant as
     * permission to write on a student's document.
     */
    if (granted.length) return !granted.includes(DRIVE_WRITE_SCOPE);

    // No grant string to go on — fall back to whatever the server said.
    return this._missingScopes().includes(DRIVE_WRITE_SCOPE);
  });

  /**
   * Why she is being asked again, in her terms.
   *
   * It says what changed, what the new permission does, and — because this is
   * the question anyone sensible asks of an app that wants write access to
   * their students' work — what it will still never do.
   */
  readonly commentConsentMessage = computed(() =>
    this.needsCommentConsent()
      ? 'עד היום Margin רק קראה את המסמכים, ולכן ההרשאה שאישרת היא לקריאה בלבד. ' +
        'כדי להוסיף הערות במסמך עצמו גוגל דורשת הרשאה רחבה יותר, וצריך לאשר אותה פעם אחת. ' +
        'ההערות נכתבות בשם החשבון שלך, ו־Margin לא תשנה אף מילה בעבודה עצמה — רק תוסיף הערות בצד.'
      : null,
  );

  /** Hebrew, naming the permissions rather than their URLs. */
  readonly missingScopeMessage = computed(() => {
    const missing = this._missingScopes();
    if (!missing.length) return null;

    // The write permission has its own explanation, and it is not a fault to
    // be reported — she simply granted what the app asked for at the time.
    if (missing.length === 1 && missing[0] === DRIVE_WRITE_SCOPE) return null;

    const names = missing.map((scope) => SCOPE_LABEL[scope] ?? scope).join(' ו');
    return `החיבור לגוגל לא כולל הרשאת ${names}. צריך להתחבר מחדש ולאשר את כל התיבות במסך של גוגל.`;
  });

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
      this.recordGrant(status?.scope, status?.missing_scopes);
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
      this.recordGrant(undefined, undefined);
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

  /** What Google issued, and what the server made of it. */
  private recordGrant(scope: string | undefined, missing: string[] | undefined) {
    this._grantedScopes.set((scope ?? '').split(/\s+/).filter(Boolean));
    this._missingScopes.set(missing ?? []);
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
    // Re-read on every mint rather than only at connect: she can withdraw a
    // permission from her Google account page at any time, and the next token
    // is the first place that shows.
    this.recordGrant(response.scope, response.missing_scopes);
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
