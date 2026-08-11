/**
 * Drafts inline annotations for one submission round.
 *
 * The model API key lives here and nowhere else — same posture as the Drive
 * credential in `drive-auth`. The browser sends the document and the course's
 * knowledge base; it gets back comments and one plain-language restatement of
 * the batch.
 *
 * What this function deliberately does NOT do: resolve anchors. It returns
 * quotes, and the client locates them in its own copy of the block text. That
 * keeps offset arithmetic next to the code that renders from it, and means a
 * quote the model altered fails to resolve rather than silently landing on the
 * wrong words.
 *
 * The provider lives in `_shared/model-config.ts` and the request/response
 * shaping in `_shared/gemini.ts`. This file owns only the environment, the
 * HTTP call, and the retry loop.
 *
 * Deploy with `verify_jwt = true` — only a signed-in teacher may spend quota.
 */
import {
  buildRequestBody,
  classifyInteraction,
  classifyRateLimit,
  isRetryable,
  parseAnnotationPayload,
  retryDelayMs,
  type Interaction,
} from '../_shared/gemini.ts';
import { MODEL_CONFIG, type AnnotateErrorCode } from '../_shared/model-config.ts';

// ---------------------------------------------------------------------------
// Wire contract. Canonical definition: src/app/core/ai/contract.ts.
// ---------------------------------------------------------------------------

interface RequestBlock {
  id: string;
  type: string;
  level?: number;
  text: string;
}

interface AnnotateRequest {
  /**
   * The categories the model may use. Sent by the client rather than restated
   * here, so there is one source of truth (src/app/core/ai/contract.ts) and no
   * chance of this function offering a kind the review screen can't colour.
   */
  allowed_kinds: string[];
  student_name: string;
  round_number: number;
  course_name: string;
  assignment_title: string;
  assignment_brief: string | null;
  blocks: RequestBlock[];
  rules: { kind: string; body: string; origin: string }[];
  materials: { kind: string; title: string; notes: string | null; content: string | null }[];
  style_examples: { source: string; student_text: string | null; teacher_text: string }[];
  /** Past accept/edit/dismiss decisions — the strongest signal of her voice. */
  style_edits: {
    ai_text: string;
    final_text: string;
    change_note: string | null;
    context_excerpt: string | null;
  }[];
  style_accepted: { ai_text: string; context_excerpt: string | null }[];
  style_dismissed: { ai_text: string; context_excerpt: string | null }[];
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Two things here are load-bearing and worth not "tidying" later:
 *
 *  - The coverage instruction. The teacher is the filter; the model filtering
 *    first would silently drop the specific, minor language notes that are the
 *    whole point of a dense first pass.
 *  - The verbatim-notation rule. `(r = .42, p < .01)` has to come back exactly
 *    as written or the quote won't resolve to an anchor and the comment is
 *    thrown away.
 */
const INSTRUCTIONS = `You draft first-pass margin comments on Hebrew student research papers, for a teacher to review.

Write every comment in Hebrew, in her voice. The examples of her own writing later in this prompt are the target: short, direct, usually one sentence and at most two. She opens with a question rather than a verdict, asks for the specific missing number rather than announcing that reporting is incomplete, and leaves praise where praise is due.

Coverage, not curation. Flag every specific spot you can justify — she is the filter, and a comment she dismisses costs her one tap, while a comment you withheld costs her the catch entirely. Do not rank, do not decide what is "important enough", and do not stop at a handful. A full paper normally warrants dozens of comments.

This is quantitative methods in education. Watch for, in addition to prose:
- statistical claims stated more strongly than the design supports (correlational data described as causal, "proved", "no doubt")
- results reported without the test value, significance level, or effect size
- methodology detail that is missing or in the wrong order — sampling described as random when the procedure says otherwise, instruments before participants, reliability asserted without the coefficient
- claims attributed to "studies" or "the literature" with no citation, and figures quoted with no source

Anchor each comment to the shortest span that carries the problem — a phrase or a clause, not a whole paragraph. Quote it EXACTLY as it appears in the block, character for character, including spacing and punctuation. A quote that does not appear verbatim in its block is discarded.

Reproduce any statistical or Latin notation exactly as the document writes it — (r = .42, p < .01), Cronbach's alpha, SEL, APA. Never re-space, re-order, translate or re-punctuate it, in the quote or in your comment. It is rendered inside right-to-left text and any change corrupts it.

Do not comment on the same span twice. Do not comment on the paper's title.

Finally, write one short paragraph in Hebrew for the teacher, in the second person, describing what you flagged and why — the themes and roughly how many of each, not a list. She reads this before she reads the comments, to decide whether the pass is aimed correctly. Two or three sentences.`;

/**
 * The course's reference material.
 *
 * This used to carry a `cache_control` breakpoint so it was billed once per
 * course rather than once per submission. That was Anthropic-specific and has
 * been dropped: at free-tier volumes the rate limit binds long before cost
 * does. REVISIT if this ever moves to a paid tier — the split is already the
 * right one (stable knowledge base first, volatile document second), so
 * reinstating caching is a matter of marking the boundary, not restructuring.
 */
function knowledgeBase(body: AnnotateRequest): string {
  const parts: string[] = [];

  parts.push(`# Course\n${body.course_name} — ${body.assignment_title}`);
  if (body.assignment_brief) parts.push(`# The task as set\n${body.assignment_brief}`);

  const teacherRules = body.rules.filter((r) => r.origin === 'teacher');
  const webRules = body.rules.filter((r) => r.origin !== 'teacher');

  if (teacherRules.length) {
    parts.push(
      `# Her rules for this course\nThese are hers and they win over anything else here.\n` +
        teacherRules.map((r) => `- (${r.kind}) ${r.body}`).join('\n'),
    );
  }
  if (webRules.length) {
    parts.push(
      `# General academic conventions\nBackground only — defer to her rules above.\n` +
        webRules.map((r) => `- ${r.body}`).join('\n'),
    );
  }

  for (const material of body.materials) {
    const heading =
      material.kind === 'syllabus'
        ? 'Syllabus'
        : material.kind === 'model_assignment'
          ? 'Model assignment'
          : material.kind === 'example_correction'
            ? 'An example of a correction she wrote'
            : 'Reference material';
    const notes = material.notes ? ` (${material.notes})` : '';
    parts.push(`# ${heading}: ${material.title}${notes}\n${material.content ?? ''}`.trim());
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

  if (body.style_edits?.length) {
    parts.push(
      `# How she rewrites drafted comments\nThe left side is what was drafted; the right is what she kept. Match the right.\n` +
        body.style_edits
          .map(
            (e) =>
              `- Drafted: ${e.ai_text}\n  Kept: ${e.final_text}` +
              `${e.change_note ? `\n  (${e.change_note})` : ''}` +
              `${e.context_excerpt ? `\n  On: "${e.context_excerpt}"` : ''}`,
          )
          .join('\n'),
    );
  }

  if (body.style_accepted?.length) {
    parts.push(
      `# Comments she kept exactly as drafted\nThese landed. Write more like them.\n` +
        body.style_accepted
          .map((e) => `- ${e.ai_text}${e.context_excerpt ? `\n  On: "${e.context_excerpt}"` : ''}`)
          .join('\n'),
    );
  }

  /**
   * The only evidence of what she does *not* want raised.
   *
   * It has to be framed narrowly. She dismisses a comment because that comment
   * was wrong on that text, not because the whole category is unwelcome —
   * reading it as "stop flagging sources" would quietly undo the coverage
   * instruction, which is the one thing this prompt cannot afford to lose.
   */
  if (body.style_dismissed?.length) {
    parts.push(
      `# Comments she threw away\nShe read these and decided they were not worth her student's attention. Avoid drafting their like — but treat each as a judgement about that specific comment on that specific text, not as a whole category to stop raising.\n` +
        body.style_dismissed
          .map((e) => `- ${e.ai_text}${e.context_excerpt ? `\n  On: "${e.context_excerpt}"` : ''}`)
          .join('\n'),
    );
  }

  return parts.join('\n\n');
}

function documentMessage(body: AnnotateRequest): string {
  const blocks = body.blocks
    .map((b) => {
      const label = b.type === 'heading' ? `heading level ${b.level ?? 1}` : b.type;
      return `<block id="${b.id}" type="${label}">\n${b.text}\n</block>`;
    })
    .join('\n\n');

  return `Student: ${body.student_name}. Revision round ${body.round_number}.\n\nThe paper:\n\n${blocks}`;
}

// ---------------------------------------------------------------------------
// HTTP plumbing
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

/** HTTP status for each failure, so the client can branch without parsing prose. */
function statusFor(code: AnnotateErrorCode): number {
  if (code === 'safety_blocked') return 422;
  if (code === 'rate_limited' || code === 'daily_cap') return 429;
  return 502;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls the model, retrying only what a retry could fix.
 *
 * A per-minute rate limit backs off and tries again; the daily cap gives up
 * immediately, because on the free tier there is nothing to wait for within
 * the request.
 */
async function generate(
  apiKey: string,
  body: AnnotateRequest,
): Promise<{ ok: true; text: string } | { ok: false; code: AnnotateErrorCode }> {
  const requestBody = buildRequestBody({
    config: MODEL_CONFIG,
    systemInstruction: `${INSTRUCTIONS}\n\n${knowledgeBase(body)}`,
    input: documentMessage(body),
    kinds: body.allowed_kinds,
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
      console.error('annotate: network failure', error);
      lastCode = 'generation_failed';
      if (attempt < MODEL_CONFIG.maxAttempts - 1) {
        await sleep(MODEL_CONFIG.backoffBaseMs * 2 ** attempt);
        continue;
      }
      return { ok: false, code: lastCode };
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
        console.error('annotate: model call failed', response.status, errorBody.slice(0, 400));
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

  let body: AnnotateRequest;
  try {
    body = (await request.json()) as AnnotateRequest;
  } catch {
    return json({ error: 'bad_request' }, 400, headers);
  }

  if (!body.blocks?.length) return json({ error: 'no_document' }, 400, headers);
  if (!body.allowed_kinds?.length) return json({ error: 'no_kinds' }, 400, headers);

  try {
    const generated = await generate(apiKey, body);
    if (!generated.ok) {
      return json({ error: generated.code }, statusFor(generated.code), headers);
    }

    const payload = parseAnnotationPayload(generated.text);
    if (!payload.ok) {
      return json({ error: payload.code }, statusFor(payload.code), headers);
    }

    return json({ summary: payload.summary, annotations: payload.annotations }, 200, {
      ...headers,
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    console.error('annotate failed', error);
    return json({ error: 'generation_failed' }, 502, headers);
  }
});
