import { TestBed } from '@angular/core/testing';

import { SupabaseService } from '../supabase/supabase';
import { DriveApi } from './drive-api';
import { GoogleDriveAuth } from './google-auth';

/**
 * What Margin actually asks Google for when it looks at "Shared with me".
 *
 * The whole feature rests on one API fact, and it is worth pinning rather than
 * trusting: a document a student shares with the teacher is in no folder of
 * the teacher's at all. Its parents are the student's, and Drive only reports
 * parents the caller can see — so `'folderId' in parents` cannot find it, no
 * matter how the folder is configured. `sharedWithMe` is a separate corpus and
 * the only way to reach those files.
 *
 * Two things then matter about the query, and both are asserted here because
 * neither would fail loudly if it broke. It must be scoped to named accounts
 * during a sync — a bare `sharedWithMe` would enumerate every document anyone
 * has ever shared with her, which is both noise and far more of her Drive than
 * this app has any business reading. And the broad listing, which she asks for
 * by hand, must at least be bounded to things that can be a paper.
 */

class FakeSupabase {
  isConfigured = true;
  functionsUrl = 'https://project.supabase.co/functions/v1';
  session = () => ({ access_token: 'jwt' });
  client = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } };
}

describe('the shared-with-me query', () => {
  const realFetch = globalThis.fetch;
  let urls: string[] = [];

  /** Every Drive URL asked for, with the minted token call answered first. */
  function record() {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/functions/v1/')) {
        return new Response(
          JSON.stringify({
            connected: true,
            access_token: 'minted',
            expires_in: 600,
            scope: 'https://www.googleapis.com/auth/drive',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      urls.push(url);
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }

  function api(): DriveApi {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: new FakeSupabase() }],
    });
    // Warms the connection so the first Drive call has a token.
    TestBed.inject(GoogleDriveAuth);
    return TestBed.inject(DriveApi);
  }

  /** The `q` Drive was actually sent, decoded. */
  function query(url: string): string {
    return new URL(url).searchParams.get('q') ?? '';
  }

  beforeEach(() => {
    urls = [];
    record();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('asks the shared corpus by owner, never for everything shared with her', async () => {
    await api().listSharedByOwners(['noa.b@school.org.il', 'shira@gmail.com']);

    expect(urls.length).toBe(1);
    const q = query(urls[0]);

    expect(q).toContain('sharedWithMe');
    expect(q).toContain('trashed = false');
    // Both accounts, and the query is narrowed to them.
    expect(q).toContain("'noa.b@school.org.il' in owners");
    expect(q).toContain("'shira@gmail.com' in owners");
    expect(q).toContain(' in owners');
  });

  /**
   * A class of thirty in one `or` chain makes a URL long enough to be refused,
   * and a refusal here would look exactly like "nobody shared anything".
   */
  it('splits a large roster across several queries rather than one long one', async () => {
    const roster = Array.from({ length: 30 }, (_, i) => `student${i}@school.org.il`);
    await api().listSharedByOwners(roster);

    expect(urls.length).toBeGreaterThan(1);
    const asked = urls
      .flatMap((url) => [...query(url).matchAll(/'([^']+)' in owners/g)])
      .map((m) => m[1]);
    expect(new Set(asked).size).toBe(30);
  });

  it('asks Google nothing at all when no account has been confirmed', async () => {
    await api().listSharedByOwners([]);
    expect(urls.length).toBe(0);
  });

  it('drops duplicate and blank addresses instead of asking twice', async () => {
    await api().listSharedByOwners(['Noa@School.org.il', 'noa@school.org.il', '  ', '']);

    const asked = [...query(urls[0]).matchAll(/'([^']+)' in owners/g)].map((m) => m[1]);
    expect(asked).toEqual(['noa@school.org.il']);
  });

  /**
   * The one broad read, and it happens only because she pressed a button. It
   * is still bounded to documents: her shared surface holds spreadsheets,
   * photos and folders, and none of them is a paper.
   */
  it('bounds the browse-everything listing to documents', async () => {
    await api().listSharedDocuments();

    const q = query(urls[0]);
    expect(q).toContain('sharedWithMe');
    expect(q).toContain("mimeType = 'application/vnd.google-apps.document'");
    expect(q).not.toContain(' in owners');
    // Newest first, so a bounded read returns this term's work.
    expect(new URL(urls[0]).searchParams.get('orderBy')).toBe('modifiedTime desc');
  });

  /**
   * `q` is a small language, and a stray quote in a value would not fail — it
   * would change what was asked for. A query that silently means something
   * else is the failure this codebase keeps refusing to leave lying around.
   */
  it('escapes a quote in an address rather than letting it end the literal', async () => {
    await api().listSharedByOwners(["od'd@school.org.il"]);

    const q = query(urls[0]);
    expect(q).toContain("'od\\'d@school.org.il' in owners");
  });
});
