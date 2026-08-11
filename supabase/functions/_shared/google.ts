/**
 * Shared helpers for the two Drive functions.
 *
 * Everything here runs on the server. The Google client secret and the
 * service-role key are read from the function environment and never leave it.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Read-only, and only what the app actually uses. */
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
].join(' ');

export interface Env {
  supabaseUrl: string;
  serviceRoleKey: string;
  clientId: string;
  clientSecret: string;
  /** Public URL of the functions host, used to build the OAuth callback. */
  functionsUrl: string;
  /** App origins allowed to start a connection and request a token. */
  allowedOrigins: string[];
}

export function readEnv(): Env {
  const get = (name: string): string => {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
  };

  return {
    supabaseUrl: get('SUPABASE_URL'),
    serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY'),
    clientId: get('GOOGLE_CLIENT_ID'),
    clientSecret: get('GOOGLE_CLIENT_SECRET'),
    functionsUrl: get('MARGIN_FUNCTIONS_URL'),
    allowedOrigins: get('MARGIN_ALLOWED_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  // Echo the origin only when it is one we know; never `*`, because these
  // endpoints are authenticated and credentialed.
  const allow = origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Resolves the caller's Supabase user from their JWT.
 *
 * Returns null for anything that isn't a valid, current session — the
 * functions treat that as "not signed in" rather than trusting any claim in
 * the request body.
 */
export async function callerId(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: header, apikey: env.serviceRoleKey },
  });
  if (!response.ok) return null;

  const user = (await response.json()) as { id?: string };
  return user.id ?? null;
}

/** A service-role REST call. Bypasses RLS, so it is only ever used here. */
export async function db<T>(
  env: Env,
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    'content-type': 'application/json',
  };
  if (init.prefer) headers['Prefer'] = init.prefer;

  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`Database request failed (${response.status}): ${await response.text()}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeWithGoogle(
  env: Env,
  body: Record<string, string>,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      ...body,
    }),
  });
  return (await response.json()) as GoogleTokenResponse;
}

export function callbackUrl(env: Env): string {
  return `${env.functionsUrl.replace(/\/$/, '')}/drive-auth/callback`;
}
