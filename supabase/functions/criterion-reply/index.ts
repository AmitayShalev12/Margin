/**
 * Answers the teacher's objection to one criterion's score.
 *
 * The other half of the exchange she asked for: "אם הוא אומר, זה הסיבה שנתתי
 * ציון כזה וכזה, אז אני אולי יכולה להגיב לו... למשא ומתן כזה." She writes why
 * she disagrees; this re-reads the paper against that one criterion and either
 * revises the score or says why it stands.
 *
 * Its own function rather than a mode of `annotate`, because the work is a
 * fraction of the size: one criterion, no comment drafting, no rubric-wide
 * pass. Running a full annotate to answer one objection would spend a minute
 * and most of a quota to change one number.
 *
 * The instruction that matters is the one telling it to hold its ground. A
 * model that concedes to every objection is not a second opinion, it is an
 * expensive way for her to type a number — and the score it caves to would
 * carry a rationale implying something checked it.
 *
 * POST /criterion-reply → { reply, points, changed, rationale }
 */
import {
  Interaction,
  JsonSchema,
  buildRequestBody,
  classifyInteraction,
  classifyRateLimit,
  describeQuota,
  isRetryable,
  retryDelayMs,
} from '../_shared/gemini.ts';
import { MODEL_CONFIG, type AnnotateErrorCode } from '../_shared/model-config.ts';

interface ReplyRequest {
  criterion: { name: string; section: string | null; max_points: number | null };
  /** The score as it stands, and the reasoning she is answering. */
  points: number | null;
  rationale: string | null;
  /** Her objection, verbatim. */
  note: string;
  /** The paper, as blocks. Trimmed by the client to what is worth sending. */
  blocks: { type: string; text: string }[];
  course_name: string;
  assignment_title: string;
}

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    /** Addressed to her, in Hebrew. The part she actually reads. */
    reply: { type: 'string' },
    /**
     * The score after considering her point — the same number when it is not
     * persuaded, which must be an available answer and not a grudging one.
     */
    points: { type: 'integer', nullable: true },
    /** The reasoning for the score as it now stands. */
    rationale: { type: 'string' },
  },
  required: ['reply', 'points', 'rationale'],
};

const INSTRUCTIONS = [
  'You are helping an experienced teacher mark a seminar paper in Hebrew.',
  'She has read your reasoning for one criterion and written back. Answer her.',
  '',
  'Answer in Hebrew, addressed to her, in two or three sentences. No preamble.',
  '',
  'She is the authority here and she knows this student and this course far',
  'better than you do. Where she is right, say so plainly and revise the score.',
  '',
  'But do not simply agree. If the paper still does not support what she is',
  'arguing, say so and keep the score, and point at what in the text made you',
  'score it that way — she asked for a second opinion, and one that folds at',
  'the first objection is not a second opinion at all. "You are right" when you',
  'do not think she is, is the least useful sentence you could write.',
  '',
  'Where she is telling you something you had no way to know — that a source is',
  'standard in her field, that the assignment asked for something specific —',
  'take it, and say that is what changed your mind.',
  '',
  'Never exceed the criterion maximum. `points` may be null when the paper',
  'still does not support any judgement; say what is missing.',
].join('\n');

function prompt(body: ReplyRequest): string {
  const outOf = body.criterion.max_points === null ? '' : ` (מתוך ${body.criterion.max_points})`;
  const section = body.criterion.section ? `${body.criterion.section} · ` : '';

  return [
    `# The course`,
    `${body.course_name} — ${body.assignment_title}`,
    ``,
    `# The criterion`,
    `${section}${body.criterion.name}${outOf}`,
    ``,
    `# The score you gave`,
    body.points === null ? 'לא ניתן ניקוד' : String(body.points),
    ``,
    `# What you said about it`,
    body.rationale ?? '(no rationale was recorded)',
    ``,
    `# What she wrote back`,
    body.note,
    ``,
    `# The paper`,
    body.blocks.map((b) => b.text).join('\n'),
  ].join('\n');
}

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

/** Her own key when she has one, the shared key otherwise. Never returned. */
async function teacherKey(request: Request): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !serviceRole || !authorization?.startsWith('Bearer ')) return null;

  try {
    const who = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: serviceRole },
    });
    if (!who.ok) return null;

    const { id } = (await who.json()) as { id?: string };
    if (!id) return null;

    const rows = await fetch(
      `${url}/rest/v1/model_credentials?teacher_id=eq.${id}&select=api_key`,
      { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
    );
    if (!rows.ok) return null;

    const [row] = (await rows.json()) as { api_key?: string }[];
    return row?.api_key ?? null;
  } catch (error) {
    console.error('criterion-reply: could not read the teacher key', error);
    return null;
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

  const hers = await teacherKey(request);
  const apiKey = hers ?? Deno.env.get(MODEL_CONFIG.apiKeyEnvVar);
  if (!apiKey) return json({ error: 'missing_api_key' }, 500, headers);
  const keySource = hers ? 'teacher' : 'shared';

  let body: ReplyRequest;
  try {
    body = (await request.json()) as ReplyRequest;
  } catch {
    return json({ error: 'bad_request', key_source: keySource }, 400, headers);
  }

  if (!body.note?.trim()) return json({ error: 'no_note', key_source: keySource }, 400, headers);
  if (!body.criterion?.name) {
    return json({ error: 'no_criterion', key_source: keySource }, 400, headers);
  }

  const requestBody = buildRequestBody({
    config: MODEL_CONFIG,
    systemInstruction: INSTRUCTIONS,
    input: prompt(body),
    schema: SCHEMA,
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
      console.error('criterion-reply: network failure', error);
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

      let parsed: { reply?: unknown; points?: unknown; rationale?: unknown };
      try {
        parsed = JSON.parse(outcome.text) as typeof parsed;
      } catch {
        return json({ error: 'bad_response', key_source: keySource }, 502, headers);
      }

      const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
      if (!reply) return json({ error: 'bad_response', key_source: keySource }, 502, headers);

      /**
       * Clamped here as well as in the client. A revised score that overruns
       * the criterion would put the form over 100 with nothing on screen
       * looking wrong, and this is the closer of the two to the model.
       */
      const max = body.criterion.max_points;
      const raw = typeof parsed.points === 'number' ? parsed.points : null;
      const points = raw === null ? null : Math.max(0, max === null ? raw : Math.min(raw, max));

      return json(
        {
          reply,
          points,
          changed: points !== body.points,
          rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
          key_source: keySource,
        },
        200,
        { ...headers, 'Cache-Control': 'no-store' },
      );
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
