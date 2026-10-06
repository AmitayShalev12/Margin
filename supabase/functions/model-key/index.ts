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
 * It also carries her model choice, which belongs here for the same reason:
 * the model is a property of the key that will pay for it, and the Pro tiers
 * are paid-only. Which models exist is asked of Google on each listing rather
 * than hardcoded — a list in the repo is a claim about Google's catalogue that
 * nobody updates, and it would be wrong within the month.
 *
 * POST /model-key  { api_key }    → { set: true, hint, model }
 * POST /model-key  { clear: true } → { set: false, model: null }
 * POST /model-key  { list: true }  → { models: [{ id, label, pro }] }
 * POST /model-key  { model }       → { set, hint, model }
 * GET  /model-key                 → { set, hint, model }
 *
 * Deploy with `verify_jwt = true`; the explicit `callerId` check below is the
 * belt to that braces — without a caller there is no row to address.
 */
import { Env, callerId, corsHeaders, db, json, readEnv } from '../_shared/google.ts';
import { MODEL_CONFIG } from '../_shared/model-config.ts';
import { listModels, modelIsUsable } from '../_shared/models.ts';

interface KeyRow {
  hint: string;
  model: string | null;
}

/** The row plus the key itself, for the paths that need to spend it. */
interface KeyRowWithSecret extends KeyRow {
  api_key: string;
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
        // `select=hint,model` and nothing else. The key column is never named
        // in a read path, so no future change to this handler can start
        // returning it.
        `model_credentials?teacher_id=eq.${teacherId}&select=hint,model`,
      );
      const row = rows?.[0];
      return json({ set: !!row, hint: row?.hint ?? null, model: row?.model ?? null }, 200, headers);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, headers);
    }

    let body: {
      api_key?: unknown;
      clear?: unknown;
      read?: unknown;
      list?: unknown;
      model?: unknown;
    };
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
        `model_credentials?teacher_id=eq.${teacherId}&select=hint,model`,
      );
      const row = rows?.[0];
      return json({ set: !!row, hint: row?.hint ?? null, model: row?.model ?? null }, 200, headers);
    }

    /**
     * Which models this key may be pointed at, straight from Google.
     *
     * Asked on her key when she has one and on the shared key otherwise, since
     * the catalogue differs by account — and the point of the screen is what
     * *her* runs can use, not what some other project can.
     */
    if (body.list === true) {
      const rows = await db<KeyRowWithSecret[]>(
        env,
        `model_credentials?teacher_id=eq.${teacherId}&select=api_key,hint,model`,
      );
      const apiKey = rows?.[0]?.api_key ?? Deno.env.get(MODEL_CONFIG.apiKeyEnvVar);
      if (!apiKey) return json({ error: 'server_misconfigured' }, 500, headers);

      const listed = await listModels(apiKey);
      if (!listed.ok) return json({ error: listed.code }, 502, headers);

      // The server's own pin travels with the list, so the screen can mark it
      // as the default rather than having to know it.
      return json({ models: listed.models, fallback: MODEL_CONFIG.model }, 200, headers);
    }

    /**
     * Her model choice. Null puts her back on the server's default, which is a
     * working state and the one she started in.
     *
     * A choice needs her own key: the row has nowhere to live without one, and
     * the Pro tiers it exists to reach are paid-only anyway. Saying so beats
     * storing a preference that silently never applies.
     */
    if ('model' in body) {
      const rows = await db<KeyRowWithSecret[]>(
        env,
        `model_credentials?teacher_id=eq.${teacherId}&select=api_key,hint,model`,
      );
      const row = rows?.[0];
      if (!row) return json({ error: 'needs_own_key' }, 409, headers);

      const chosen = typeof body.model === 'string' ? body.model.trim() : null;

      /**
       * Checked against a live listing before it is stored. A model id that is
       * merely saved looks exactly like one that works, right up to a marking
       * run failing for a reason she cannot connect to a dropdown she touched
       * last week.
       */
      if (chosen && !(await modelIsUsable(row.api_key, chosen))) {
        return json({ error: 'model_unavailable' }, 400, headers);
      }

      await db(env, `model_credentials?teacher_id=eq.${teacherId}`, {
        method: 'PATCH',
        body: JSON.stringify({ model: chosen }),
      });

      return json({ set: true, hint: row.hint, model: chosen }, 200, headers);
    }

    if (body.clear === true) {
      await db(env, `model_credentials?teacher_id=eq.${teacherId}`, { method: 'DELETE' });
      // Back to the shared key, which is a working state and not an outage.
      // The model choice goes with it: it was a property of the key that was
      // going to pay for it, and the shared key cannot run a Pro model.
      return json({ set: false, hint: null, model: null }, 200, headers);
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

    return json({ set: true, hint: hintFor(key), model: null }, 200, headers);
  } catch (error) {
    // The message is never echoed: a failure from PostgREST on this table can
    // quote the row it was writing, and that row holds the key.
    console.error('model-key failed', error);
    return json({ error: 'server_error' }, 500, headers);
  }
});
