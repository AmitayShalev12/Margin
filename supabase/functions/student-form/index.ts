/**
 * Writes the year-end form the student actually receives.
 *
 * The internal grading form is not it. Her own notes are terse, addressed to
 * herself, and often about what is missing — "אין אלפא", "מדגם נוחות, לא
 * אקראי". A student reading that verbatim reads a list of failures. What she
 * sends is the same content, addressed to the girl, in a register she has
 * spent years arriving at.
 *
 * So this function does not "soften" or "rewrite politely" on general
 * principle. It is given her own past pairs — the internal notes for a
 * submission beside the wording that actually went out for it — and asked to
 * apply the same transformation. Where no history exists yet, it falls back to
 * her writing samples and says so in the prompt rather than inventing a house
 * style.
 *
 * Same provider config and adapter as `annotate`. Deploy with
 * `verify_jwt = true`.
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
// Wire contract. Canonical definition: src/app/core/grading/contract.ts.
// ---------------------------------------------------------------------------

interface StudentFormRequest {
  student_name: string;
  course_name: string;
  year: string;
  /** Her headings, in her order. The form comes back under these. */
  categories: { id: string; name: string; description: string | null }[];
  /** The internal lines, by category — her own words, not to be sent as-is. */
  entries: { category_id: string; body: string; quote: string | null }[];
  /**
   * How she has made this translation before: the internal notes for one
   * submission, beside what was actually sent about it. The whole point.
   */
  translations: { internal: string[]; student: string }[];
  style_examples: { teacher_text: string; student_text: string | null }[];
}

function sectionSchema(categoryIds: string[]) {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            // Constrained to her real headings, so a section can always be
            // traced back to the internal category it came from.
            category_id: { type: 'string', enum: categoryIds },
            title: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['category_id', 'title', 'body'],
        },
      },
    },
    required: ['summary', 'sections'],
  };
}

const INSTRUCTIONS = `You write the year-end feedback form that a Hebrew-speaking teacher sends to one of her students.

You are given her internal grading form for that student. It is not what she sends. Internal notes are shorthand written to herself — often just the gap, with no sentence around it. Your job is to say the same things to the student, the way this teacher says them.

If examples of her own past translations appear below, they are the specification. Match what they do: how long her sentences run, whether she names the problem or asks about it, where she puts encouragement, what she leaves out entirely. Do not average them into something safer or more formal than she is.

Write in Hebrew, in the second person, to the student by name. Never write about her in the third person.

Hold to these regardless:
- Every section is grounded in what is actually on the internal form. Invent no praise and no criticism that is not there.
- An internal note that names something missing becomes a concrete thing she can do, not a verdict about her.
- Keep any statistical or Latin notation exactly as written — (r = .42, p < .01), SEL, APA. It sits inside right-to-left text and any re-spacing corrupts it.
- A category with nothing under it gets no section. Do not pad.
- No grades, marks or scores. This form is words.

Then write one short closing paragraph — the summary — that says how the year went overall. Two or three sentences, warm without being effusive, and honest about what is still worth working on.`;

function knowledgeBase(body: StudentFormRequest): string {
  const parts: string[] = [];

  parts.push(`# Student\n${body.student_name} — ${body.course_name}, ${body.year}`);

  parts.push(
    `# Her headings\n` +
      body.categories
        .map((c) => `- [${c.id}] ${c.name}${c.description ? ` — ${c.description}` : ''}`)
        .join('\n'),
  );

  if (body.translations.length) {
    parts.push(
      `# How she has translated her own notes before\nThe left side is what she wrote for herself; the right is what the student actually received. Reproduce this transformation.\n` +
        body.translations
          .map(
            (t, i) =>
              `## Example ${i + 1}\nHer notes:\n${t.internal.map((n) => `- ${n}`).join('\n')}\nWhat she sent:\n${t.student}`,
          )
          .join('\n\n'),
    );
  } else {
    // Saying this out loud matters: without it the model fills the gap with a
    // generic institutional register, which is the exact failure mode here.
    parts.push(
      `# No past translations are available yet\nThere is no history of her student-facing wording for this course. Stay as close as you can to the voice in her own writing below, and prefer her plainness over anything that sounds like a school report.`,
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

function internalForm(body: StudentFormRequest): string {
  const byCategory = body.categories
    .map((category) => {
      const lines = body.entries.filter((e) => e.category_id === category.id);
      if (!lines.length) return null;
      return (
        `<category id="${category.id}" name="${category.name}">\n` +
        lines
          .map((l) => `- ${l.body}${l.quote ? `\n  (on: "${l.quote}")` : ''}`)
          .join('\n') +
        `\n</category>`
      );
    })
    .filter(Boolean)
    .join('\n\n');

  return `Her internal grading form for ${body.student_name}:\n\n${byCategory}`;
}

// ---------------------------------------------------------------------------
// HTTP plumbing — same shape as `annotate`.
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
  body: StudentFormRequest,
): Promise<{ ok: true; text: string } | { ok: false; code: AnnotateErrorCode }> {
  const requestBody = buildRequestBody({
    config: MODEL_CONFIG,
    systemInstruction: `${INSTRUCTIONS}\n\n${knowledgeBase(body)}`,
    input: internalForm(body),
    schema: sectionSchema(body.categories.map((c) => c.id)),
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
      console.error('student-form: network failure', error);
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
        console.error('student-form: model call failed', response.status, errorBody.slice(0, 400));
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

  let body: StudentFormRequest;
  try {
    body = (await request.json()) as StudentFormRequest;
  } catch {
    return json({ error: 'bad_request' }, 400, headers);
  }

  if (!body.entries?.length) return json({ error: 'no_entries' }, 400, headers);
  if (!body.categories?.length) return json({ error: 'no_categories' }, 400, headers);

  try {
    const generated = await generate(apiKey, body);
    if (!generated.ok) return json({ error: generated.code }, statusFor(generated.code), headers);

    let payload: { summary?: unknown; sections?: unknown };
    try {
      payload = JSON.parse(generated.text) as typeof payload;
    } catch {
      return json({ error: 'bad_response' }, 502, headers);
    }

    if (!Array.isArray(payload.sections)) {
      return json({ error: 'bad_response' }, 502, headers);
    }

    return json(
      { summary: typeof payload.summary === 'string' ? payload.summary : '', sections: payload.sections },
      200,
      { ...headers, 'Cache-Control': 'no-store' },
    );
  } catch (error) {
    console.error('student-form failed', error);
    return json({ error: 'generation_failed' }, 502, headers);
  }
});
