import { TestBed } from '@angular/core/testing';

import { SupabaseService } from '../supabase/supabase';
import { ModelKey } from './model-key';

/**
 * Her own Gemini key.
 *
 * The property worth testing is a negative one: the key goes out once and
 * never comes back. Everything else here is a form with three buttons, but a
 * regression that started echoing the key into the client would look entirely
 * normal on screen — which is exactly the kind of thing that survives a code
 * review and ships.
 */

let sent: { url: string; body: unknown }[] = [];
let reply: { status: number; json: unknown };

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

function make(): ModelKey {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SupabaseService, useValue: new FakeSupabase() }],
  });
  return TestBed.inject(ModelKey);
}

beforeEach(() => {
  sent = [];
  reply = { status: 200, json: { set: true, hint: 'a1b2' } };

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.json,
      text: async () => JSON.stringify(reply.json),
    } as unknown as Response;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('saving her key', () => {
  it('sends it once and keeps nothing but the hint', async () => {
    const service = make();

    await service.save('AIzaSyExampleKeyValue12345');

    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ api_key: 'AIzaSyExampleKeyValue12345' });

    // What the client holds afterwards, in full.
    expect(service.status()).toEqual({ set: true, hint: 'a1b2' });
    expect(JSON.stringify(service.status())).not.toContain('AIzaSyExample');
  });

  it('trims what she pasted', async () => {
    const service = make();

    await service.save('  AIzaSyExampleKeyValue12345\n');

    expect(sent[0].body).toEqual({ api_key: 'AIzaSyExampleKeyValue12345' });
  });

  it('does not call out for an empty key', async () => {
    const service = make();

    expect(await service.save('   ')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  /**
   * The usual mistake is pasting the wrong credential entirely. "Invalid"
   * alone would leave her re-pasting the same wrong thing.
   */
  it('says what a rejected key probably was', async () => {
    reply = { status: 400, json: { error: 'bad_key' } };
    const service = make();

    expect(await service.save('nope')).toBe(false);
    expect(service.error()).toContain('Google AI Studio');
  });

  it('reports a save it could not complete rather than claiming success', async () => {
    reply = { status: 500, json: { error: 'server_error' } };
    const service = make();

    expect(await service.save('AIzaSyExampleKeyValue12345')).toBe(false);
    expect(service.error()).toBeTruthy();
    expect(service.usingOwnKey()).toBe(false);
  });
});

describe('what the screen knows about the key', () => {
  it('knows nothing until it has asked', () => {
    const service = make();

    // Null is "not looked yet", which is not the same as "no key" and must not
    // render as one.
    expect(service.status()).toBeNull();
    expect(service.usingOwnKey()).toBe(false);
  });

  it('asks for a status without sending anything secret', async () => {
    const service = make();

    await service.refresh();

    expect(sent[0].body).toEqual({ read: true });
  });

  it('reports the shared key as a working state, not an error', async () => {
    reply = { status: 200, json: { set: false, hint: null } };
    const service = make();

    await service.refresh();

    expect(service.usingOwnKey()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('goes back to the shared key when she clears hers', async () => {
    const service = make();
    await service.save('AIzaSyExampleKeyValue12345');
    expect(service.usingOwnKey()).toBe(true);

    reply = { status: 200, json: { set: false, hint: null } };
    await service.clear();

    expect(sent.at(-1)?.body).toEqual({ clear: true });
    expect(service.usingOwnKey()).toBe(false);
  });
});
