import { TestBed } from '@angular/core/testing';

import { SupabaseService } from '../supabase/supabase';
import { GoogleDriveAuth } from './google-auth';

/**
 * The security property this suite exists to hold: nothing long-lived ever
 * reaches the browser.
 *
 * The refresh token lives in the `drive-auth` Edge Function's service-role
 * table. The client may only ever hold an access token minted by
 * `drive-token`, in memory, for the minutes it is valid.
 */

const SESSION = {
  access_token: 'supabase-jwt',
  // Supabase would hand these over if the app used its Google provider.
  // Nothing here may touch them.
  provider_token: 'ya29.PROVIDER-ACCESS-TOKEN',
  provider_refresh_token: '1//LONG-LIVED-REFRESH-TOKEN',
};

class FakeSupabase {
  isConfigured = true;
  functionsUrl = 'https://project.supabase.co/functions/v1';
  session = () => SESSION;
  client = {
    auth: {
      getSession: async () => ({ data: { session: SESSION } }),
    },
  };
}

/** Records everything written to either browser store. */
function watchStorage() {
  const writes: { key: string; value: string }[] = [];
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    writes.push({ key, value });
    return original.call(this, key, value);
  };
  return {
    writes,
    restore: () => {
      Storage.prototype.setItem = original;
    },
  };
}

function makeAuth() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SupabaseService, useValue: new FakeSupabase() }],
  });
  return TestBed.inject(GoogleDriveAuth);
}

describe('GoogleDriveAuth — credential handling', () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit }[];

  function respondWith(body: unknown, status = 200) {
    globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }

  beforeEach(() => {
    calls = [];
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('writes nothing to browser storage while minting a token', async () => {
    respondWith({ connected: true, access_token: 'minted', expires_in: 600 });
    const watcher = watchStorage();

    try {
      const auth = makeAuth();
      const token = await auth.accessToken();

      expect(token).toBe('minted');
      expect(watcher.writes).toEqual([]);
    } finally {
      watcher.restore();
    }

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('never touches the provider refresh token, even when the session carries one', async () => {
    respondWith({ connected: true, access_token: 'minted', expires_in: 600 });

    const auth = makeAuth();
    await auth.accessToken();

    // Nothing derived from the long-lived credential is stored...
    const stored = JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
    expect(stored).not.toContain('LONG-LIVED-REFRESH-TOKEN');
    expect(stored).not.toContain('PROVIDER-ACCESS-TOKEN');

    // ...nor sent anywhere by this client.
    const outbound = JSON.stringify(calls);
    expect(outbound).not.toContain('LONG-LIVED-REFRESH-TOKEN');
    expect(outbound).not.toContain('PROVIDER-ACCESS-TOKEN');
  });

  it('mints through the Edge Function, authenticated as the teacher', async () => {
    respondWith({ connected: true, access_token: 'minted', expires_in: 600 });

    const auth = makeAuth();
    await auth.accessToken();

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://project.supabase.co/functions/v1/drive-token');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer supabase-jwt',
    );
  });

  it('re-mints once the short-lived token has expired', async () => {
    respondWith({ connected: true, access_token: 'first', expires_in: 0 });
    const auth = makeAuth();

    expect(await auth.accessToken()).toBe('first');

    respondWith({ connected: true, access_token: 'second', expires_in: 600 });
    expect(await auth.accessToken()).toBe('second');
  });

  it('reuses a live token instead of minting per request', async () => {
    respondWith({ connected: true, access_token: 'minted', expires_in: 600 });
    const auth = makeAuth();

    await auth.accessToken();
    await auth.accessToken();
    await auth.accessToken();

    expect(calls.length).toBe(1);
  });

  it('mints only once when a sync fires several requests at the same time', async () => {
    respondWith({ connected: true, access_token: 'minted', expires_in: 600 });
    const auth = makeAuth();

    const tokens = await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]);

    expect(tokens).toEqual(['minted', 'minted', 'minted']);
    expect(calls.length).toBe(1);
  });

  it('reports disconnected when the server holds no credential', async () => {
    respondWith({ connected: false });
    const auth = makeAuth();

    expect(await auth.accessToken()).toBeNull();
    expect(auth.isConnected()).toBe(false);
  });

  it('drops the cached token when Drive rejects it', async () => {
    respondWith({ connected: true, access_token: 'first', expires_in: 600 });
    const auth = makeAuth();
    await auth.accessToken();

    auth.invalidate();
    respondWith({ connected: true, access_token: 'second', expires_in: 600 });

    expect(await auth.accessToken()).toBe('second');
  });

  it('clears a token left in storage by an earlier version', async () => {
    sessionStorage.setItem(
      'margin.drive_token',
      JSON.stringify({ access_token: 'ya29.LEFTOVER', obtained_at: Date.now() }),
    );

    makeAuth();

    expect(sessionStorage.getItem('margin.drive_token')).toBeNull();
  });

  it('asks the server, not storage, whether Drive is connected', async () => {
    respondWith({ connected: true, google_email: 'teacher@school.org.il' });
    const auth = makeAuth();

    await auth.refreshStatus();

    expect(calls[0].url).toContain('/drive-auth/status');
    expect(auth.isConnected()).toBe(true);
    expect(auth.googleEmail()).toBe('teacher@school.org.il');
  });

  it('sends the teacher to a consent URL the server built', async () => {
    respondWith({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc' });
    const auth = makeAuth();

    // jsdom refuses real navigation; capture the assignment instead.
    const assigned: string[] = [];
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost:4200',
        pathname: '/courses',
        set href(value: string) {
          assigned.push(value);
        },
        get href() {
          return 'http://localhost:4200/courses';
        },
      },
      writable: true,
    });

    await auth.connect();

    expect(calls[0].url).toContain('/drive-auth/start');
    expect(assigned).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?state=abc']);
  });
});
