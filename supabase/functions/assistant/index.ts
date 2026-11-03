/**
 * The in-app assistant: she asks in Hebrew, it answers and proposes actions.
 *
 * "Connect it to real app capabilities so it can carry out requests, rather
 * than only explaining how users could do them." The model answers in the
 * shape `_shared/assistant.ts` defines — a reply and a list of allowlisted
 * actions — and this function returns that to the app, which performs each
 * action as the signed-in teacher and reports what actually happened. Nothing
 * here touches her records.
 *
 * The same Gemini path as `annotate` and `criterion-reply`: her own key and
 * model when she has set them, the shared key otherwise, the same retry budget
 * and the same error codes — so a credits or quota problem reads the same in
 * the assistant as everywhere else.
 *
 * What is sent to Google: her message, the conversation, and the names and ids
 * of her courses and students with counts. Never a paper, never an address.
 *
 * POST /assistant { messages, context } → { reply, actions, key_source }
 */
import {
  ASSISTANT_INSTRUCTIONS,
  ASSISTANT_SCHEMA,
  AssistantRequest,
  assistantPrompt,
  parseAssistantPayload,
  requestProblem,
} from '../_shared/assistant.ts';
import {
  Interaction,
  buildRequestBody,
  classifyInteraction,
  classifyRateLimit,
  describeQuota,
  isRetryable,
  retryDelayMs,
} from '../_shared/gemini.ts';
import { MODEL_CONFIG, type AnnotateErrorCode } from '../_shared/model-config.ts';

function statusFor(code: AnnotateErrorCode): number {
  if (code === 'safety_blocked') return 422;
  if (
    code === 'rate_limited' ||
    code === 'daily_cap' ||
    code === 'token_cap' ||
    code === 'credits_exhausted'
  ) {
    return 429;
  }
  // Not 401: the client reads that from a function as an expired Margin
  // session and would send her to sign in again.
  if (code === 'key_rejected') return 422;
  return 502;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Her own key and model when she has set them, nulls otherwise. Never returned. */
async function teacherCredentials(
  request: Request,
): Promise<{ key: string | null; model: string | null }> {
  const none = { key: null, model: null };
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !serviceRole || !authorization?.startsWith('Bearer ')) return none;

  try {
    const who = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: serviceRole },
    });
    if (!who.ok) return none;

    const { id } = (await who.json()) as { id?: string };
    if (!id) return none;

    const rows = await fetch(
      `${url}/rest/v1/model_credentials?teacher_id=eq.${id}&select=api_key,model`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    if (!rows.ok) return none;

    const [row] = (await rows.json()) as { api_key?: string; model?: string | null }[];
    return { key: row?.api_key ?? null, model: row?.model ?? null };
  } catch (error) {
    // Logged without the response body, which would carry the key.
    console.error('assistant: could not read the teacher credentials, using the shared key', error);
    return none;
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

Deno.serve(async (request: Request) => {
  const allowed = (Deno.env.get('MARGIN_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const headers = cors(request.headers.get('Origin'), allowed);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  const hers = await teacherCredentials(request);
  const apiKey = hers.key ?? Deno.env.get(MODEL_CONFIG.apiKeyEnvVar);
  if (!apiKey) return json({ error: 'missing_api_key' }, 500, headers);

  const config = { ...MODEL_CONFIG, model: hers.model ?? MODEL_CONFIG.model };
  const keySource = hers.key ? 'teacher' : 'shared';

  let body: AssistantRequest;
  try {
    body = (await request.json()) as AssistantRequest;
  } catch {
    return json({ error: 'bad_request', key_source: keySource }, 400, headers);
  }

  const problem = requestProblem(body);
  if (problem) return json({ error: problem, key_source: keySource }, 400, headers);

  const requestBody = buildRequestBody({
    config,
    systemInstruction: ASSISTANT_INSTRUCTIONS,
    input: assistantPrompt(body),
    schema: ASSISTANT_SCHEMA,
  });

  const startedAt = Date.now();
  const remaining = () => MODEL_CONFIG.budgetMs - (Date.now() - startedAt);
  let lastCode: AnnotateErrorCode = 'generation_failed';
  let lastQuota: string | null = null;

  for (let attempt = 0; attempt < MODEL_CONFIG.maxAttempts; attempt++) {
    if (remaining() < MODEL_CONFIG.minAttemptMs) {
      return json({ error: 'timed_out', key_source: keySource }, 429, headers);
    }

    const abort = new AbortController();
    const guard = setTimeout(() => abort.abort(), remaining());

    let response: Response;
    try {
      response = await fetch(MODEL_CONFIG.endpoint, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abort.signal,
      });
    } catch (error) {
      if (abort.signal.aborted) {
        return json({ error: 'timed_out', key_source: keySource }, 429, headers);
      }
      console.error('assistant: network failure', error);
      return json({ error: 'generation_failed', key_source: keySource }, 502, headers);
    } finally {
      clearTimeout(guard);
    }

    if (response.ok) {
      const outcome = classifyInteraction((await response.json()) as Interaction);
      if (!outcome.ok) {
        return json(
          { error: outcome.code, key_source: keySource },
          statusFor(outcome.code),
          headers,
        );
      }

      const payload = parseAssistantPayload(outcome.text);
      if (!payload) return json({ error: 'bad_response', key_source: keySource }, 502, headers);

      return json({ ...payload, key_source: keySource }, 200, {
        ...headers,
        'Cache-Control': 'no-store',
      });
    }

    const errorBody = await response.text();
    lastCode = classifyRateLimit(response.status, errorBody) ?? 'generation_failed';
    lastQuota = describeQuota(errorBody);

    const wait = retryDelayMs(errorBody, attempt, MODEL_CONFIG.backoffBaseMs);
    const affordable = wait + MODEL_CONFIG.minAttemptMs < remaining();

    if (!isRetryable(response.status, lastCode) || attempt === MODEL_CONFIG.maxAttempts - 1) break;
    if (!affordable) break;

    await sleep(wait);
  }

  return json(
    { error: lastCode, key_source: keySource, quota: lastQuota },
    statusFor(lastCode),
    headers,
  );
});
