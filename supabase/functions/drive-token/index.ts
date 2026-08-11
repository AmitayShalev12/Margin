/**
 * Mints a short-lived Drive access token for the signed-in teacher.
 *
 * The refresh token stays here. The browser receives an access token that
 * expires within the hour and is held in memory only — so the worst a stolen
 * client-side credential buys is the remainder of that window, against
 * read-only scopes.
 *
 * POST /drive-token   (Supabase JWT) → { access_token, expires_in, scope }
 *                                    → { connected: false } when not connected
 *
 * Deploy with `verify_jwt = true`, or leave the explicit check below to do it.
 */
import {
  Env,
  callerId,
  corsHeaders,
  db,
  exchangeWithGoogle,
  json,
  readEnv,
} from '../_shared/google.ts';

interface CredentialRow {
  refresh_token: string;
  scope: string;
  google_email: string | null;
}

/**
 * Access tokens are handed out with a little of their life already spent, so a
 * client that caches until `expires_in` still refreshes before Google starts
 * rejecting it mid-sync.
 */
const SAFETY_MARGIN_SECONDS = 120;

Deno.serve(async (request: Request) => {
  let env: Env;
  try {
    env = readEnv();
  } catch (error) {
    return json({ error: String(error) }, 500);
  }

  const cors = corsHeaders(request.headers.get('Origin'), env.allowedOrigins);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  try {
    const teacherId = await callerId(request, env);
    if (!teacherId) return json({ error: 'unauthorized' }, 401, cors);

    const rows = await db<CredentialRow[]>(
      env,
      `google_credentials?teacher_id=eq.${teacherId}&select=refresh_token,scope,google_email`,
    );
    const credential = rows?.[0];
    if (!credential) return json({ connected: false }, 200, cors);

    const token = await exchangeWithGoogle(env, {
      refresh_token: credential.refresh_token,
      grant_type: 'refresh_token',
    });

    if (!token.access_token) {
      // The teacher revoked access at Google's end, or the grant expired.
      // Drop the dead credential so the app asks her to reconnect rather than
      // retrying a token that can never work again.
      if (token.error === 'invalid_grant') {
        await db(env, `google_credentials?teacher_id=eq.${teacherId}`, { method: 'DELETE' });
        return json({ connected: false, reason: 'revoked' }, 200, cors);
      }
      console.error('drive-token exchange failed', token.error, token.error_description);
      return json({ error: 'exchange_failed' }, 502, cors);
    }

    const expiresIn = Math.max(60, (token.expires_in ?? 3600) - SAFETY_MARGIN_SECONDS);

    return json(
      {
        connected: true,
        access_token: token.access_token,
        expires_in: expiresIn,
        scope: token.scope ?? credential.scope,
        google_email: credential.google_email,
      },
      200,
      // Belt and braces: never let a proxy or the browser cache a credential.
      { ...cors, 'Cache-Control': 'no-store' },
    );
  } catch (error) {
    console.error('drive-token failed', error);
    return json({ error: 'internal_error' }, 500, cors);
  }
});
