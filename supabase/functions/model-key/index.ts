/**
 * The teacher's own Gemini key: set it, clear it, ask whether one is set.
 *
 * She asked to be able to change the key herself, which is reasonable — the
 * shared free-tier key hits a per-minute limit as soon as two papers are
 * marked in a row, and on her own key that is her quota to spend.
 *
 * What this deliberately does not do is give the key to the browser. It goes
 * in and never comes back out: `GET` answers with whether one exists and the
 * last four characters, which is enough for her to tell one key from another
 * and useless to anybody else. An API key is a spending credential, and the
 * same rule that keeps the Drive refresh token server-side applies to it.
 *
 * POST /model-key  { api_key }   → { set: true, hint }
 * POST /model-key  { clear: true } → { set: false }
 * GET  /model-key                → { set, hint }
 *
 * Deploy with `verify_jwt = true`; the explicit `callerId` check below is the
 * belt to that braces — without a caller there is no row to address.
 */
import { Env, callerId, corsHeaders, db, json, readEnv } from '../_shared/google.ts';

interface KeyRow {
  hint: string;
}

/**
 * What a Gemini key looks like, loosely.
 *
 * Checked so that a paste of the wrong thing — a Supabase anon key, half a
 * URL, her email — is refused at the point she can still see what she pasted,
 * rather than surfacing an hour later as a failed marking run she reads as the
 * app being broken. Deliberately loose: Google has changed the prefix before,
 * and a validator that is stricter than reality locks her out of a key that
 * works.
 */
function looksLikeKey(value: string): boolean {
  return value.length >= 20 && value.length <= 200 && !/\s/.test(value);
}

/** The last four characters. Identifies a key to whoever pasted it, alone. */
function hintFor(key: string): string {
  return key.slice(-4);
}

Deno.serve(async (request: Request) => {
  let env: Env;
  try {
    env = readEnv();
  } catch (error) {
    console.error('model-key: environment incomplete', error);
    return json({ error: 'server_misconfigured' }, 500, {});
  }

  const allowed = (Deno.env.get('MARGIN_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const headers = corsHeaders(request.headers.get('Origin'), allowed);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const teacherId = await callerId(request, env);
  if (!teacherId) return json({ error: 'not_signed_in' }, 401, headers);

  try {
    if (request.method === 'GET') {
      const rows = await db<KeyRow[]>(
        env,
        // `select=hint` and nothing else. The key column is never named in a
        // read path, so no future change to this handler can start returning it.
        `model_credentials?teacher_id=eq.${teacherId}&select=hint`,
      );
      const row = rows?.[0];
      return json({ set: !!row, hint: row?.hint ?? null }, 200, headers);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, headers);
    }

    let body: { api_key?: unknown; clear?: unknown; read?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad_request' }, 400, headers);
    }

    // The app's function helper only speaks POST, so the status read has a
    // POST spelling as well. Same answer, same two harmless fields.
    if (body.read === true) {
      const rows = await db<KeyRow[]>(
        env,
        `model_credentials?teacher_id=eq.${teacherId}&select=hint`,
      );
      const row = rows?.[0];
      return json({ set: !!row, hint: row?.hint ?? null }, 200, headers);
    }

    if (body.clear === true) {
      await db(env, `model_credentials?teacher_id=eq.${teacherId}`, { method: 'DELETE' });
      // Back to the shared key, which is a working state and not an outage.
      return json({ set: false, hint: null }, 200, headers);
    }

    const key = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (!looksLikeKey(key)) return json({ error: 'bad_key' }, 400, headers);

    await db(env, 'model_credentials', {
      method: 'POST',
      body: JSON.stringify({
        teacher_id: teacherId,
        api_key: key,
        hint: hintFor(key),
        updated_at: new Date().toISOString(),
      }),
      prefer: 'resolution=merge-duplicates',
    });

    return json({ set: true, hint: hintFor(key) }, 200, headers);
  } catch (error) {
    // The message is never echoed: a failure from PostgREST on this table can
    // quote the row it was writing, and that row holds the key.
    console.error('model-key failed', error);
    return json({ error: 'server_error' }, 500, headers);
  }
});
