import { TestBed } from '@angular/core/testing';

import { EmailGenerator } from '../communication/email-generator';
import { DataStore } from '../data/data-store';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { seedId } from '../mock/seed-data';
import { FunctionError, TRANSPORT_MESSAGES, callFunction } from './function-call';
import { SupabaseService } from './supabase';
import { seedStore } from '../mock/seed-store';

/**
 * Telling the causes apart.
 *
 * All of these used to arrive as *"משהו השתבש. אפשר לנסות שוב"* — including the
 * three where trying again cannot possibly help. A teacher following that
 * instruction on an undeployed function is in a loop she has no way out of, and
 * the person she asks has nothing to go on either.
 */

const NOA = seedId('sub-noa');

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  session = () => ({ access_token: 'jwt' });
  hasSession = true;
  client = {
    auth: {
      getSession: async () => ({
        data: { session: this.hasSession ? { access_token: 'jwt' } : null },
      }),
    },
  };
}

describe('callFunction', () => {
  const realFetch = globalThis.fetch;
  let supabase: FakeSupabase;

  beforeEach(() => {
    supabase = new FakeSupabase();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function answering(status: number, body: unknown) {
    globalThis.fetch = (async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      })) as typeof fetch;
  }

  async function codeOf(run: () => Promise<unknown>): Promise<FunctionError> {
    try {
      await run();
    } catch (error) {
      return error as FunctionError;
    }
    throw new Error('expected a failure');
  }

  const call = () => callFunction(supabase as unknown as SupabaseService, 'student-email', {});

  it('names a function that was never deployed', async () => {
    answering(404, { code: 404, message: 'Requested function was not found' });

    const error = await codeOf(call);

    expect(error.code).toBe('not_deployed');
    // And says so, rather than inviting a retry that cannot work.
    expect(TRANSPORT_MESSAGES['not_deployed']).toContain('לא הועלתה לשרת');
    expect(TRANSPORT_MESSAGES['not_deployed']).not.toContain('לנסות שוב');
  });

  /**
   * The one that cost a round trip.
   *
   * An undeployed function does not reach the `not_deployed` branch from a
   * browser: its 404 comes back without CORS headers, so the fetch throws
   * before the status can be read. A message naming only the network sent a
   * real investigation after a connection problem that did not exist.
   */
  it('names deployment first when the browser blocks the answer', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const error = await codeOf(call);
    const message = TRANSPORT_MESSAGES['unreachable'];

    expect(error.code).toBe('unreachable');
    // The URL, because opening it is a page load rather than a fetch — the one
    // check CORS cannot interfere with. 401 means deployed, 404 means not.
    expect(error.detail).toContain('https://project.supabase.co/functions/v1/student-email');
    expect(message).toContain('לא הועלתה לשרת');
    // Ahead of the other two, which it also names rather than guessing.
    expect(message.indexOf('לא הועלתה')).toBeLessThan(message.indexOf('חיבור לאינטרנט'));
    expect(message).toContain('כתובות המורשות');
  });

  it('names a missing server key, which is a setting and not a failure', async () => {
    answering(500, { error: 'missing_api_key' });

    expect((await codeOf(call)).code).toBe('missing_api_key');
  });

  it('names an expired session', async () => {
    answering(401, { message: 'Invalid JWT' });
    expect((await codeOf(call)).code).toBe('not_signed_in');

    supabase.hasSession = false;
    expect((await codeOf(call)).code).toBe('not_signed_in');
  });

  /** The function's own codes survive, so domain wording still wins. */
  it('passes a real generation failure through untouched', async () => {
    answering(422, { error: 'safety_blocked' });
    expect((await codeOf(call)).code).toBe('safety_blocked');

    answering(429, { error: 'daily_cap' });
    expect((await codeOf(call)).code).toBe('daily_cap');
  });

  it('keeps the raw line, whatever the cause', async () => {
    answering(500, 'upstream exploded');

    const error = await codeOf(call);

    expect(error.code).toBe('server_error');
    expect(error.detail).toContain('student-email 500');
    expect(error.detail).toContain('upstream exploded');
  });
});

describe('what the teacher is told', () => {
  const realFetch = globalThis.fetch;
  let generator: EmailGenerator;
  let store: DataStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: new FakeSupabase() },
        { provide: Repository, useClass: LocalRepository },
      ],
    });
    store = TestBed.inject(DataStore);
    // The app starts empty; these are the fixture records the test reads.
    seedStore(store);
    generator = TestBed.inject(EmailGenerator);
    store.setAnnotationStatus(seedId('an-4'), 'accepted');
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
  });

  it('says the function is not deployed instead of blaming the drafting', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Requested function was not found' }), {
        status: 404,
      })) as typeof fetch;

    await generator.generate(NOA);

    expect(generator.message()).toBe(TRANSPORT_MESSAGES['not_deployed']);
    // The message that used to cover every one of these.
    expect(generator.message()).not.toContain('משהו השתבש');
    // And the raw line beneath it, so the next report needs no guessing.
    expect(generator.detail()).toContain('student-email 404');
  });

  it('keeps the drafting wording when the drafting is what failed', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'daily_cap' }), { status: 429 })) as typeof fetch;

    await generator.generate(NOA);

    expect(generator.message()).toContain('המכסה היומית');
  });

  it('clears the last failure when she tries again', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    await generator.generate(NOA);
    expect(generator.detail()).not.toBeNull();

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ variants: [{ key: 'short', subject: 'נושא', body: 'גוף ההודעה' }] }),
        { status: 200 },
      )) as typeof fetch;

    await generator.generate(NOA);

    expect(generator.message()).toBeNull();
    expect(generator.detail()).toBeNull();
  });
});
