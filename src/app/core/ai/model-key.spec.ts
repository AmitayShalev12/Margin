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

/**
 * Choosing the model.
 *
 * The pin in `model-config.ts` is a guess about what is good and cheap on the
 * day it was written, and the catalogue moves under it. What is tested here is
 * that the list is *asked for* rather than carried in the app, and that the
 * default remains reachable — a setting she can enter and not leave is worse
 * than no setting.
 */
describe('choosing the model', () => {
  const LISTING = {
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', pro: false },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', pro: true },
    ],
    fallback: 'gemini-3.6-flash',
  };

  it('asks the server for the list instead of carrying one', async () => {
    const service = make();
    reply = { status: 200, json: LISTING };

    await service.loadModels();

    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ list: true });
    expect(service.models()?.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.1-pro-preview',
    ]);
  });

  it('reports the server default until she chooses', async () => {
    const service = make();
    reply = { status: 200, json: { set: true, hint: 'a1b2', model: null } };
    await service.refresh();
    reply = { status: 200, json: LISTING };
    await service.loadModels();

    expect(service.activeModel()).toBe('gemini-3.6-flash');
    expect(service.onDefaultModel()).toBe(true);
    expect(service.onProModel()).toBe(false);
  });

  it('sends her choice and then reports it as active', async () => {
    const service = make();
    reply = { status: 200, json: LISTING };
    await service.loadModels();

    reply = { status: 200, json: { set: true, hint: 'a1b2', model: 'gemini-3.1-pro-preview' } };
    await service.chooseModel('gemini-3.1-pro-preview');

    expect(sent.at(-1)?.body).toEqual({ model: 'gemini-3.1-pro-preview' });
    expect(service.activeModel()).toBe('gemini-3.1-pro-preview');
    expect(service.onDefaultModel()).toBe(false);
  });

  /**
   * The cost warning has to keep being true after the moment she picked it.
   * A warning shown once, as she clicks, is one she has forgotten by the time
   * the bill does the talking.
   */
  it('keeps saying a Pro model is a Pro model', async () => {
    const service = make();
    reply = { status: 200, json: LISTING };
    await service.loadModels();
    reply = { status: 200, json: { set: true, hint: 'a1b2', model: 'gemini-3.1-pro-preview' } };
    await service.chooseModel('gemini-3.1-pro-preview');

    expect(service.onProModel()).toBe(true);

    // And stops the moment she moves off it.
    reply = { status: 200, json: { set: true, hint: 'a1b2', model: 'gemini-3.8-flash' } };
    await service.chooseModel('gemini-3.8-flash');
    expect(service.onProModel()).toBe(false);
  });

  /** The way back. Null is a choice, not a blank. */
  it('can go back to the default', async () => {
    const service = make();
    reply = { status: 200, json: { set: true, hint: 'a1b2', model: null } };

    await service.chooseModel(null);

    expect(sent.at(-1)?.body).toEqual({ model: null });
    expect(service.onDefaultModel()).toBe(true);
  });

  /**
   * A model id that is merely stored looks exactly like one that works, right
   * up to a marking run failing for a reason she cannot connect to a dropdown
   * she touched last week. The server refuses it; this says so in her words.
   */
  it('says so when the model is not available on her key', async () => {
    const service = make();
    reply = { status: 400, json: { error: 'model_unavailable' } };

    const saved = await service.chooseModel('gemini-9-imaginary');

    expect(saved).toBe(false);
    expect(service.error()).toContain('לא זמין');
  });

  it('explains that a model choice needs her own key', async () => {
    const service = make();
    reply = { status: 409, json: { error: 'needs_own_key' } };

    await service.chooseModel('gemini-3.1-pro-preview');

    expect(service.error()).toContain('מפתח משלך');
  });
});
