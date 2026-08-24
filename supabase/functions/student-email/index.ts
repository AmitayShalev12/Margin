/**
 * Drafts the message that goes to the student with a round of comments.
 *
 * Three options, in her voice, all three grounded in the comments she actually
 * stood behind. The register differs between them; the voice does not — which
 * is why her rewrites of *previous emails* are handed over as the specification
 * rather than as inspiration. There is no such thing as an "email voice" here,
 * and asking for one is how a tool that spent a year learning to sound like her
 * ends up sounding like a school.
 *
 * Same provider config and adapter as `annotate` and `student-form`. Deploy
 * with `verify_jwt = true`.
 */
import {
  buildRequestBody,
  classifyInteraction,
  classifyRateLimit,
  isRetryable,
  retryDelayMs,
  type Interaction,
} from '../_shared/gemini.ts';
import { MODEL_CONFIG, type AnnotateErrorCode } from '../_shared/model-config.ts';

// ---------------------------------------------------------------------------
// Wire contract. Canonical definition: src/app/core/communication/contract.ts.
// ---------------------------------------------------------------------------

interface VariantBrief {
  key: string;
  label: string;
  brief: string;
}

interface EmailRequest {
  student_name: string;
  first_name: string;
  course_name: string;
  assignment_title: string;
  round_number: number;
  summary: string | null;
  comments: { kind: string; body: string; quote: string | null }[];
  variants: VariantBrief[];
  style_examples: { source: string; student_text: string | null; teacher_text: string }[];
  style_edits: { ai_text: string; final_text: string; change_note: string | null }[];
  email_edits: { ai_text: string; final_text: string; change_note: string | null }[];
}

function variantSchema(keys: string[]) {
  return {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', enum: keys },
            subject: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['key', 'subject', 'body'],
        },
      },
    },
    required: ['variants'],
  };
}

const INSTRUCTIONS = `You draft the email a Hebrew-speaking teacher sends to one of her students along with a round of comments on the student's paper.

She will read every option before anything is sent, pick one, and usually edit it. Draft for that: something she can send after changing a word or two, not something she has to rewrite.

Write in Hebrew, in the second person, addressing the student by her first name. Sign off the way her own writing below signs off. If none of it shows a sign-off, end with the message itself rather than inventing a formula — she can add her name, and a wrong one is worse than none.

Hold to these in every option:
- Everything you say comes from the comments listed below. Invent no praise, no criticism, and no instruction that is not there.
- The comments themselves already live in the document. The message does not reproduce them one by one; it says what the round was about and what to do next.
- Never mention that any of this was drafted automatically, and never refer to the comments as "the system's" or "the AI's". They are hers.
- Keep any statistical or Latin notation exactly as written — (r = .42, p < .01), SEL, APA. It sits inside right-to-left text and any re-spacing corrupts it.
- No grades, marks, scores or deadlines. None of that is in the record you were given.
- Plain paragraphs. No bullet lists, no headings, no bold.

The subject line is short and specific to the paper, not "משוב על העבודה".

Return one entry per requested key. The three must be genuinely different messages — if two of them could be sent interchangeably, the set is wrong.`;

function knowledgeBase(body: EmailRequest): string {
  const parts: string[] = [];

  parts.push(
    `# This message\nTo ${body.first_name} (${body.student_name}) — ${body.course_name}, ${body.assignment_title}, round ${body.round_number}.`,
  );

  parts.push(
    `# The options to draft\n` +
      body.variants.map((v) => `- [${v.key}] ${v.label}: ${v.brief}`).join('\n'),
  );

  // Her own email rewrites first, and said to be the specification: this is the
  // only evidence of how she writes *to* a student rather than *about* a
  // sentence, and without it the model reaches for an institutional register.
  if (body.email_edits.length) {
    parts.push(
      `# How she rewrites drafted emails\nThe left side was drafted for her; the right is what she actually sent. This is the specification for length, warmth, sign-off and how much she explains. Match it.\n` +
        body.email_edits
          .map(
            (e, i) =>
              `## Rewrite ${i + 1}${e.change_note ? ` (${e.change_note})` : ''}\nDrafted:\n${e.ai_text}\nShe sent:\n${e.final_text}`,
          )
          .join('\n\n'),
    );
  } else {
    parts.push(
      `# No past emails of hers are available yet\nThere is no record of her rewriting a drafted email. Take the voice from her comment rewrites and her own writing below, and prefer her plainness over anything that sounds like a letter from a school.`,
    );
  }

  if (body.style_edits.length) {
    parts.push(
      `# How she rewrites drafted comments\nSame voice at a smaller scale — how blunt she is, whether she asks or tells, what she cuts.\n` +
        body.style_edits
          .map(
            (e) =>
              `- Drafted: ${e.ai_text}\n  She wrote: ${e.final_text}${e.change_note ? ` (${e.change_note})` : ''}`,
          )
          .join('\n'),
    );
  }

  if (body.style_examples.length) {
    parts.push(
      `# Her own writing\n` +
        body.style_examples
          .map((e) =>
            e.student_text
              ? `On "${e.student_text}" she wrote: ${e.teacher_text}`
              : `She wrote: ${e.teacher_text}`,
          )
          .join('\n'),
    );
  }

  return parts.join('\n\n');
}

function round(body: EmailRequest): string {
  const comments = body.comments
    .map((c) => `- [${c.kind}] ${c.body}${c.quote ? `\n  (on: "${c.quote}")` : ''}`)
    .join('\n');

  return (
    `The comments she stood behind on this round, in the order they appear in the paper:\n\n${comments}` +
    (body.summary ? `\n\nHow she summarised the round to herself:\n${body.summary}` : '')
  );
}

// ---------------------------------------------------------------------------
// HTTP plumbing — same shape as `annotate` and `student-form`.
// ---------------------------------------------------------------------------

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  const allow = origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function statusFor(code: AnnotateErrorCode): number {
  if (code === 'safety_blocked') return 422;
  if (code === 'rate_limited' || code === 'daily_cap') return 429;
  return 502;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function generate(
  apiKey: string,
  body: EmailRequest,
): Promise<{ ok: true; text: string } | { ok: false; code: AnnotateErrorCode }> {
  const requestBody = buildRequestBody({
    config: MODEL_CONFIG,
    systemInstruction: `${INSTRUCTIONS}\n\n${knowledgeBase(body)}`,
    input: round(body),
    schema: variantSchema(body.variants.map((v) => v.key)),
  });

  let lastCode: AnnotateErrorCode = 'generation_failed';

  for (let attempt = 0; attempt < MODEL_CONFIG.maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(MODEL_CONFIG.endpoint, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      console.error('student-email: network failure', error);
      if (attempt < MODEL_CONFIG.maxAttempts - 1) {
        await sleep(MODEL_CONFIG.backoffBaseMs * 2 ** attempt);
        continue;
      }
      return { ok: false, code: 'generation_failed' };
    }

    if (response.ok) {
      const outcome = classifyInteraction((await response.json()) as Interaction);
      return outcome.ok ? { ok: true, text: outcome.text } : { ok: false, code: outcome.code };
    }

    const errorBody = await response.text();
    const rateCode = classifyRateLimit(response.status, errorBody);
    lastCode = rateCode ?? 'generation_failed';

    if (!isRetryable(response.status, rateCode) || attempt === MODEL_CONFIG.maxAttempts - 1) {
      if (lastCode !== 'daily_cap') {
        console.error('student-email: model call failed', response.status, errorBody.slice(0, 400));
      }
      return { ok: false, code: lastCode };
    }

    await sleep(retryDelayMs(errorBody, attempt, MODEL_CONFIG.backoffBaseMs));
  }

  return { ok: false, code: lastCode };
}

Deno.serve(async (request: Request) => {
  const allowedOrigins = (Deno.env.get('MARGIN_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const headers = cors(request.headers.get('Origin'), allowedOrigins);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  const apiKey = Deno.env.get(MODEL_CONFIG.apiKeyEnvVar);
  if (!apiKey) return json({ error: 'missing_api_key' }, 500, headers);

  let body: EmailRequest;
  try {
    body = (await request.json()) as EmailRequest;
  } catch {
    return json({ error: 'bad_request' }, 400, headers);
  }

  // Nothing to write a message about is a real state, not an error the teacher
  // caused: she has not finished the review yet.
  if (!body.comments?.length) return json({ error: 'no_comments' }, 400, headers);
  if (!body.variants?.length) return json({ error: 'bad_request' }, 400, headers);

  try {
    const generated = await generate(apiKey, body);
    if (!generated.ok) return json({ error: generated.code }, statusFor(generated.code), headers);

    let payload: { variants?: unknown };
    try {
      payload = JSON.parse(generated.text) as typeof payload;
    } catch {
      return json({ error: 'bad_response' }, 502, headers);
    }

    if (!Array.isArray(payload.variants) || !payload.variants.length) {
      return json({ error: 'bad_response' }, 502, headers);
    }

    return json({ variants: payload.variants }, 200, { ...headers, 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('student-email failed', error);
    return json({ error: 'generation_failed' }, 502, headers);
  }
});
