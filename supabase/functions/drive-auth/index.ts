/**
 * Owns the Google OAuth round trip for Drive.
 *
 * The point of doing it here rather than through Supabase's Google provider is
 * that the refresh token — a long-lived key to a teacher's Drive — is never
 * handed to the browser. The client gets a consent URL and, later, short-lived
 * access tokens from `drive-token`. Nothing durable.
 *
 * Routes:
 *   POST   /drive-auth/start     (Supabase JWT) → { url } to send the teacher to
 *   GET    /drive-auth/callback  (Google)       → stores the refresh token, redirects back
 *   POST   /drive-auth/status    (Supabase JWT) → { connected, google_email, scope }
 *   DELETE /drive-auth           (Supabase JWT) → forgets the stored credential
 *
 * Deploy with `verify_jwt = false`: Google calls the callback with no Supabase
 * session, so each route checks its own caller. `start`, `status` and the
 * delete verify the JWT explicitly; `callback` is authenticated by the
 * single-use state row it redeems.
 */
import {
  DRIVE_SCOPES,
  Env,
  GOOGLE_AUTH_URL,
  callbackUrl,
  callerId,
  corsHeaders,
  db,
  exchangeWithGoogle,
  json,
  readEnv,
} from '../_shared/google.ts';

interface StateRow {
  state: string;
  teacher_id: string;
  redirect_to: string;
  expires_at: string;
}

Deno.serve(async (request: Request) => {
  let env: Env;
  try {
    env = readEnv();
  } catch (error) {
    return json({ error: String(error) }, 500);
  }

  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env.allowedOrigins);
  const url = new URL(request.url);
  const route = url.pathname.split('/').filter(Boolean).pop();

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    if (route === 'callback') return await handleCallback(request, env, url);
    if (request.method === 'POST' && route === 'start')
      return await handleStart(request, env, cors);
    if (request.method === 'POST' && route === 'status')
      return await handleStatus(request, env, cors);
    if (request.method === 'DELETE') return await handleDisconnect(request, env, cors);
    return json({ error: 'Not found' }, 404, cors);
  } catch (error) {
    console.error('drive-auth failed', error);
    return json({ error: 'internal_error' }, 500, cors);
  }
});

/**
 * Builds the consent URL and records a single-use state bound to this teacher.
 *
 * Returns the URL as JSON rather than redirecting: the caller has to send a
 * bearer token, and a browser following a redirect wouldn't.
 */
async function handleStart(request: Request, env: Env, cors: Record<string, string>) {
  const teacherId = await callerId(request, env);
  if (!teacherId) return json({ error: 'unauthorized' }, 401, cors);

  const body = (await request.json().catch(() => ({}))) as { redirect_to?: string };
  const redirectTo = body.redirect_to ?? env.allowedOrigins[0];

  // Only ever bounce back to an origin we control — an open redirect here
  // would hand the authorization code to whoever asked for it.
  if (!env.allowedOrigins.some((allowed) => redirectTo.startsWith(allowed))) {
    return json({ error: 'redirect_not_allowed' }, 400, cors);
  }

  const state = crypto.randomUUID();
  await db(env, 'google_oauth_states', {
    method: 'POST',
    body: JSON.stringify({ state, teacher_id: teacherId, redirect_to: redirectTo }),
  });

  const consent = new URL(GOOGLE_AUTH_URL);
  consent.searchParams.set('client_id', env.clientId);
  consent.searchParams.set('redirect_uri', callbackUrl(env));
  consent.searchParams.set('response_type', 'code');
  consent.searchParams.set('scope', DRIVE_SCOPES);
  consent.searchParams.set('state', state);
  // Required to be issued a refresh token at all, and `consent` makes Google
  // re-issue one rather than assuming the earlier grant still covers us.
  consent.searchParams.set('access_type', 'offline');
  consent.searchParams.set('prompt', 'consent');

  return json({ url: consent.toString() }, 200, cors);
}

/**
 * Google's redirect lands here with the authorization code. This is where the
 * refresh token is captured — server-side, into a table the client cannot
 * read — and it is the only place it ever exists outside Google.
 */
async function handleCallback(request: Request, env: Env, url: URL) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (!state) return json({ error: 'missing_state' }, 400);

  const rows = await db<StateRow[]>(
    env,
    `google_oauth_states?state=eq.${encodeURIComponent(state)}`,
  );
  const row = rows?.[0];

  // Redeem it whatever happens next: a state is good for exactly one attempt.
  await db(env, `google_oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' });

  if (!row) return json({ error: 'invalid_state' }, 400);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return redirect(row.redirect_to, 'expired');
  }
  if (error || !code) return redirect(row.redirect_to, error ?? 'no_code');

  const token = await exchangeWithGoogle(env, {
    code,
    redirect_uri: callbackUrl(env),
    grant_type: 'authorization_code',
  });

  if (!token.refresh_token) {
    // Google withholds it when an earlier grant is still live. `prompt=consent`
    // above is what normally prevents this.
    return redirect(row.redirect_to, 'no_refresh_token');
  }

  const email = await fetchGoogleEmail(token.access_token);

  await db(env, 'google_credentials', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: JSON.stringify({
      teacher_id: row.teacher_id,
      refresh_token: token.refresh_token,
      scope: token.scope ?? DRIVE_SCOPES,
      google_email: email,
      updated_at: new Date().toISOString(),
    }),
  });

  return redirect(row.redirect_to, null);
}

async function handleStatus(request: Request, env: Env, cors: Record<string, string>) {
  const teacherId = await callerId(request, env);
  if (!teacherId) return json({ error: 'unauthorized' }, 401, cors);

  // Note the column list: the refresh token is never selected, so it cannot
  // be returned by accident.
  const rows = await db<{ google_email: string | null; scope: string; connected_at: string }[]>(
    env,
    `google_credentials?teacher_id=eq.${teacherId}&select=google_email,scope,connected_at`,
  );

  const row = rows?.[0];
  return json(
    row
      ? {
          connected: true,
          google_email: row.google_email,
          scope: row.scope,
          connected_at: row.connected_at,
        }
      : { connected: false },
    200,
    cors,
  );
}

async function handleDisconnect(request: Request, env: Env, cors: Record<string, string>) {
  const teacherId = await callerId(request, env);
  if (!teacherId) return json({ error: 'unauthorized' }, 401, cors);

  const rows = await db<{ refresh_token: string }[]>(
    env,
    `google_credentials?teacher_id=eq.${teacherId}&select=refresh_token`,
  );

  // Revoke at Google's end too, so "disconnect" means it rather than just
  // forgetting locally.
  if (rows?.[0]) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${rows[0].refresh_token}`, {
      method: 'POST',
    }).catch(() => undefined);
  }

  await db(env, `google_credentials?teacher_id=eq.${teacherId}`, { method: 'DELETE' });
  return json({ connected: false }, 200, cors);
}

async function fetchGoogleEmail(accessToken: string | undefined): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const info = (await response.json()) as { email?: string };
    return info.email ?? null;
  } catch {
    return null;
  }
}

function redirect(to: string, error: string | null): Response {
  const target = new URL(to);
  target.searchParams.set('drive', error ? 'error' : 'connected');
  if (error) target.searchParams.set('drive_error', error);
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}
