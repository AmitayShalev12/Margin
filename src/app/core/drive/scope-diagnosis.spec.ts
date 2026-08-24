import { TestBed } from '@angular/core/testing';

import { SupabaseService } from '../supabase/supabase';
import { DriveApi, DriveError } from './drive-api';
import { GoogleDriveAuth } from './google-auth';

/**
 * Telling "you never granted this permission" apart from "you cannot see that
 * folder".
 *
 * Google reports both as 403, and a teacher who unticks a box on the consent
 * screen gets a working connection to the right account that quietly refuses
 * half its calls. Pointed at the folder — which is what the old wording did —
 * she can check ownership all afternoon and find nothing wrong with it.
 */

const DRIVE = 'https://www.googleapis.com/auth/drive.readonly';
const DOCS = 'https://www.googleapis.com/auth/documents.readonly';

class FakeSupabase {
  isConfigured = true;
  functionsUrl = 'https://project.supabase.co/functions/v1';
  session = () => ({ access_token: 'jwt' });
  client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
}

function boot() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SupabaseService, useValue: new FakeSupabase() }],
  });
  return { auth: TestBed.inject(GoogleDriveAuth), api: TestBed.inject(DriveApi) };
}

describe('a partial Google consent', () => {
  const realFetch = globalThis.fetch;

  /** Mints a token reporting only the scopes given. */
  function mintWith(missing: string[]) {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          connected: true,
          access_token: 'minted',
          expires_in: 600,
          missing_scopes: missing,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
  }

  /** Mints a token reporting the exact scope string Google issued. */
  function mintGranting(scope: string, missing: string[] = []) {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          connected: true,
          access_token: 'minted',
          expires_in: 600,
          scope,
          missing_scopes: missing,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('is not reported as a healthy connection', async () => {
    mintWith([DOCS]);
    const { auth } = boot();
    await auth.accessToken();

    // Connected is true — the token is real and the account is right.
    expect(auth.isConnected()).toBe(true);
    // But it does not work, and that has to be visible.
    expect(auth.isIncomplete()).toBe(true);
  });

  it('names the missing permission in words she can act on', async () => {
    mintWith([DOCS]);
    const { auth } = boot();
    await auth.accessToken();

    const message = auth.missingScopeMessage()!;
    expect(message).toContain('קריאת תוכן המסמכים');
    expect(message).toContain('להתחבר מחדש');
    // Not a scope URL.
    expect(message).not.toContain('googleapis.com');
  });

  it('says nothing when everything was granted', async () => {
    mintWith([]);
    const { auth } = boot();
    await auth.accessToken();

    expect(auth.isIncomplete()).toBe(false);
    expect(auth.missingScopeMessage()).toBeNull();
  });

  it('notices a permission withdrawn later, on the next mint', async () => {
    mintWith([]);
    const { auth } = boot();
    await auth.accessToken();
    expect(auth.isIncomplete()).toBe(false);

    // She removed the app's access to Docs from her Google account page.
    mintWith([DOCS]);
    auth.invalidate();
    await auth.accessToken();

    expect(auth.isIncomplete()).toBe(true);
  });
});

describe('what a 403 from Drive is blamed on', () => {
  const realFetch = globalThis.fetch;

  /** First call mints a token, every call after answers the Drive request. */
  function driveReplies(status: number, body: unknown) {
    let minted = false;
    globalThis.fetch = (async () => {
      if (!minted) {
        minted = true;
        return new Response(
          JSON.stringify({ connected: true, access_token: 'minted', expires_in: 600 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Drive's actual shape for a token that lacks the scope. */
  const SCOPE_REFUSAL = {
    error: {
      code: 403,
      message: 'Request had insufficient authentication scopes.',
      status: 'PERMISSION_DENIED',
      details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
    },
  };

  /** Drive's shape for a file the account genuinely cannot read. */
  const ACL_REFUSAL = {
    error: {
      code: 403,
      message: 'The user does not have sufficient permissions for this file.',
      errors: [{ reason: 'insufficientFilePermissions' }],
    },
  };

  it('blames the consent, not the folder, when the token is too small', async () => {
    driveReplies(403, SCOPE_REFUSAL);
    const { api } = boot();

    const error = await api.listFolder('folder-1').catch((e: unknown) => e as DriveError);

    expect(error).toBeInstanceOf(DriveError);
    expect((error as DriveError).kind).toBe('insufficient_scope');
    expect((error as DriveError).hebrew).toContain('לא כולל את כל ההרשאות');
    // The sentence that sent an hour down the wrong path.
    expect((error as DriveError).hebrew).not.toContain('אין הרשאה לתיקייה');
  });

  it('still blames the folder when the folder really is the problem', async () => {
    driveReplies(403, ACL_REFUSAL);
    const { api } = boot();

    const error = await api.listFolder('folder-1').catch((e: unknown) => e as DriveError);

    expect((error as DriveError).kind).toBe('forbidden');
    expect((error as DriveError).hebrew).toContain('אין הרשאה לתיקייה');
  });

  /**
   * A newly created OAuth client enables no APIs. Until Drive is switched on
   * in the Cloud project every call is refused, whatever the folder and
   * whatever the scopes — and it reads as a permissions problem.
   */
  it('blames the Cloud project when the Drive API was never enabled', async () => {
    driveReplies(403, {
      error: {
        code: 403,
        message:
          'Google Drive API has not been used in project 1234567890 before or it is disabled.',
        errors: [{ reason: 'accessNotConfigured' }],
      },
    });
    const { api } = boot();

    const error = await api.listFolder('folder-1').catch((e: unknown) => e as DriveError);

    expect((error as DriveError).kind).toBe('api_disabled');
    expect((error as DriveError).hebrew).toContain('לא הופעל בפרויקט של גוגל');
    expect((error as DriveError).hebrew).toContain('אין לזה קשר לתיקייה');
  });

  it('keeps a wrong folder id a wrong folder id', async () => {
    driveReplies(404, { error: { code: 404, message: 'File not found: nope.' } });
    const { api } = boot();

    const error = await api.listFolder('nope').catch((e: unknown) => e as DriveError);

    expect((error as DriveError).kind).toBe('not_found');
    expect((error as DriveError).hebrew).toContain('לא נמצאה תיקייה');
  });

  /** Google's explanation is what makes the failure diagnosable at all. */
  it('carries Google’s own words into the error, for the console', async () => {
    driveReplies(403, SCOPE_REFUSAL);
    const { api } = boot();

    const error = await api.listFolder('folder-1').catch((e: unknown) => e as DriveError);
    expect((error as DriveError).message).toContain('insufficient authentication scopes');
  });
});

/**
 * Whether she may comment, read from the grant rather than from the server's
 * verdict on it.
 *
 * `missing_scopes` is computed inside the Edge Functions against their own copy
 * of the required list. Between widening that list and deploying them, the
 * server reports nothing missing and Google refuses every write — which is
 * exactly how a teacher ended up watching a save fail with a 403 the app had
 * already promised her would not happen.
 */
describe('permission to comment', () => {
  const realFetch = globalThis.fetch;
  const WRITE = 'https://www.googleapis.com/auth/drive';

  function mint(payload: Record<string, unknown>) {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ connected: true, access_token: 'm', expires_in: 600, ...payload }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * The trap worth a test of its own: `…/auth/drive.readonly` *contains*
   * `…/auth/drive`. A substring check would read a read-only grant as
   * permission to write on a student's document.
   */
  it('does not mistake a read-only grant for a writable one', async () => {
    mint({ scope: `${DRIVE} ${DOCS}`, missing_scopes: [] });
    const { auth } = boot();
    await auth.accessToken();

    expect(auth.needsCommentConsent()).toBe(true);
  });

  it('sees the permission when it really was granted', async () => {
    mint({ scope: `${WRITE} ${DOCS}`, missing_scopes: [] });
    const { auth } = boot();
    await auth.accessToken();

    expect(auth.needsCommentConsent()).toBe(false);
  });

  /** With no grant string to read, the server's verdict is all there is. */
  it('falls back to the server when the grant is not reported', async () => {
    mint({ missing_scopes: [WRITE] });
    const { auth } = boot();
    await auth.accessToken();

    expect(auth.needsCommentConsent()).toBe(true);
  });
});
