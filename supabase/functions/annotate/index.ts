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
  describeQuota,
  responseSchema,
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
  /** The register she chose: gentle, balanced or direct. Wording only. */
  tone?: 'gentle' | 'balanced' | 'direct';
  assignment_title: string;
  assignment_brief: string | null;
  blocks: RequestBlock[];
  rules: { kind: string; body: string; origin: string }[];
  materials: { kind: string; title: string; notes: string | null; content: string | null }[];
  /**
   * The authorities she defers to — the Hebrew Academy, a style guide, a
   * departmental standard. Where "correct" comes from for this course.
   *
   * Sent as names and notes, not as fetched pages: nothing here opens a URL,
   * and the prompt says so, because a model told to "read from" a link it
   * cannot open will cheerfully invent what it found there. What it does have
   * is its own knowledge of a named authority, which for something like the
   * Academy is substantial — and her note beside it, which is verbatim.
   */
  sources: { title: string; url: string | null; notes: string | null }[];
  /**
   * Whether this round may carry scores at all.
   *
   * `comments_only` and the model returns none — her first submission is a
   * single paragraph and gets comments and no number. Sent rather than decided
   * server-side, because the decision may be hers and the reason lives with the
   * round.
   */
  scoring: 'comments_only' | 'scored';
  /**
   * Her rubric, as the model is allowed to see it.
   *
   * Criteria she alone judges are **absent from this list**, not flagged
   * within it. A model that cannot see 2.2 cannot score 2.2; an instruction
   * not to score it is a request, and requests are followed most of the time.
   *
   * `key` is her own criterion number where she has one — she says "2.1" out
   * loud, and a uuid echoed back through a model is a uuid that comes back
   * subtly wrong.
   */
  rubric: { key: string; name: string; section: string | null; max_points: number | null }[];
  /**
   * What each criterion stood at before this round, so the model can say what
   * changed rather than only what the score now is.
   */
  previous_scores: { key: string; points: number | null }[];
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

  /**
   * The authorities, and the honest limits on them.
   *
   * Two instructions matter here and they pull in opposite directions, so both
   * are stated. Prefer these where they apply — that is the whole point of her
   * naming them. And where none of them covers the question, answer anyway
   * from ordinary academic judgement rather than staying silent, but do not
   * dress that answer up as coming from an authority that never said it.
   */
  /**
   * How gently to put it.
   *
   * The sentence that matters is the second one in each. A tone setting is an
   * instruction about wording, and a model reading "be gentle" without it will
   * quietly start leaving the hard things out — which is the one failure that
   * cannot be seen from the outside: she would be reading a review that had
   * been softened by hiding half of it, with nothing on screen to say so.
   */
  const TONE: Record<string, string> = {
    gentle:
      `# How to put it\n` +
      `Gently. These students are early in their research writing and a blunt ` +
      `note reads as a verdict on them rather than on a paragraph. Lead with ` +
      `what the sentence is trying to do, then what would make it work.\n` +
      `Raise exactly the same things you otherwise would. Gentleness is about ` +
      `wording, never about leaving something out: a missing citation is still ` +
      `a missing citation, and softening it into silence would hand her a ` +
      `review with half of it hidden.`,
    balanced:
      `# How to put it\n` +
      `Plainly and without hedging, the way a teacher writes in a margin. ` +
      `Neither softened nor sharpened.`,
    direct:
      `# How to put it\n` +
      `Directly. Name the problem in the first clause and do not cushion it — ` +
      `these students are near the end of their degree and can take it.\n` +
      `Direct is not unkind. It is still about the paragraph and never about ` +
      `the student, and a comment that would sting to read on your own work at ` +
      `midnight is the wrong comment however true it is.`,
  };

  if (body.tone && TONE[body.tone]) parts.push(TONE[body.tone]);

  /**
   * The rubric, and the two refusals that go with it.
   *
   * Criteria she alone judges never reach this list, so there is nothing here
   * to disobey about them. What is left needs saying plainly: a criterion the
   * submitted text cannot support gets `points: null`, not a low number. The
   * failure mode of a scoring model is not refusing to score — it is scoring
   * everything, generously and immediately, off half a chapter.
   */
  if (body.scoring === 'scored' && body.rubric?.length) {
    parts.push(
      `# The rubric you are scoring against\n` +
        `Score each criterion out of the points beside it, using the paper as submitted.\n` +
        /**
         * Said first, and as a count, because omission was the actual failure.
         *
         * The paragraph below tells the model that null is the expected answer
         * for most criteria early on — and a model that has nothing to score
         * reads that as permission to say nothing at all. It returned
         * `"scores": []`, which is not "I could not judge these yet": it is
         * indistinguishable from the whole feature being broken, and that is
         * how it reached the teacher.
         *
         * An entry per criterion with `points: null` is the answer that
         * carries the same meaning and can be told apart from silence.
         */
        `Return exactly one object for every criterion listed below — ` +
        `${body.rubric.length} of them, in the order given, whatever you conclude about ` +
        `each. Never return an empty array and never omit a criterion: if the paper ` +
        `supports no judgement anywhere yet, return all ${body.rubric.length} with ` +
        `"points": null. Saying nothing is not an available answer.\n` +
        `This paper is unfinished and will be resubmitted. Where the text does not yet ` +
        `support a judgement — the chapter is not written, the data are not in — return ` +
        `"points": null and say in the note what is missing. Null is the expected answer ` +
        `for most criteria early on. A low score and "not written yet" are opposite ` +
        `claims, and a student reads the first as a verdict.\n` +
        `Never exceed a criterion's maximum. Never invent a criterion that is not listed.\n` +
        /**
         * Her request, in her own framing:
         *
         *   "שעל כל פרמטר יהיה לו גם הסבר למה הוא נותן את הציון הזה... נגיד
         *    נתן על מאמרים עדכניים חמש מתוך שמונה, שיכתוב לי, לא כל המקורות
         *    היו עדכניים... כאילו כמו שאני שואלת אותו והוא עונה לי."
         *
         * So: addressed to her, specific to this paper, and grounded in what
         * is actually on the page. A rationale that would fit any paper —
         * "the sources could be stronger" — is worse than none, because it
         * looks like reasoning and cannot be checked against anything.
         */
        `For every criterion also write "rationale": why this paper earned this ` +
        `score, in Hebrew, addressed to her, in one or two sentences.\n` +
        `Ground it in this paper. Name what you actually saw — which sources were ` +
        `dated, which section was missing, which claim went unsupported — the way ` +
        `you would answer her if she asked you directly. A sentence that would fit ` +
        `any paper is worth nothing to her: she cannot check it against anything.\n` +
        `Where the points are null the rationale says what is not there yet, not ` +
        `what is wrong with it.\n` +
        body.rubric
          .map((c) => {
            const section = c.section ? `${c.section} · ` : '';
            const outOf = c.max_points === null ? '' : ` (מתוך ${c.max_points})`;
            return `- [${c.key}] ${section}${c.name}${outOf}`;
          })
          .join('\n'),
    );

    const previous = body.previous_scores?.filter((s) => s.points !== null) ?? [];
    if (previous.length) {
      parts.push(
        `# Where each criterion stood after the previous round\n` +
          `Say what changed, in the note, for anything that moved: what she added or ` +
          `improved. A score that moved with no account of why cannot be defended to a ` +
          `student. Where nothing changed, keep the score and say so briefly.\n` +
          previous.map((s) => `- [${s.key}] ${s.points}`).join('\n'),
      );
    }
  }

  if (body.sources?.length) {
    parts.push(
      `# Authorities she trusts\n` +
        `Where one of these covers the question, follow it over your own judgement — this is ` +
        `where "correct" comes from for this course.\n` +
        `You cannot open these pages. Use what you already know of each named authority, plus ` +
        `her note beside it. Never quote or cite a specific rule, page or wording as coming ` +
        `from one of them unless you are certain of it.\n` +
        `Where none of them covers the question, use ordinary academic judgement and say the ` +
        `comment plainly — but do not attribute it to any of these.\n` +
        body.sources
          .map((s) => {
            const url = s.url ? ` (${s.url})` : '';
            const note = s.notes ? ` — ${s.notes}` : '';
            return `- ${s.title}${url}${note}`;
          })
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
  if (code === 'rate_limited' || code === 'daily_cap' || code === 'token_cap') return 429;
  if (code === 'credits_exhausted') return 429;
  /**
   * Not 401, deliberately.
   *
   * The client reads 401 and 403 from a function as "your Margin session
   * expired" and asks her to sign in again — which would be the wrong screen
   * entirely for a Gemini key Google refused.
   */
  if (code === 'key_rejected') return 422;
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
/** Whether a backoff plus another attempt still fits in what is left. */
function affordable(waitMs: number, remainingMs: number): boolean {
  return waitMs + MODEL_CONFIG.minAttemptMs <= remainingMs;
}

async function generate(
  apiKey: string,
  body: AnnotateRequest,
): Promise<
  { ok: true; text: string } | { ok: false; code: AnnotateErrorCode; quota?: string | null }
> {
  const requestBody = buildRequestBody({
    config: MODEL_CONFIG,
    systemInstruction: `${INSTRUCTIONS}\n\n${knowledgeBase(body)}`,
    input: documentMessage(body),
    schema: responseSchema(body.allowed_kinds, body.scoring === 'scored'),
  });

  let lastCode: AnnotateErrorCode = 'generation_failed';

  /**
   * The clock, not just the attempt count.
   *
   * Everything below is bounded by what is left of the budget: the attempt
   * itself is aborted when the budget runs out, and a retry is only started if
   * there is room for it. Without this the function is killed by the platform
   * mid-generation and the teacher gets a 504 — no code, no Hebrew, and no way
   * to tell "too slow" from "broken".
   */
  let lastQuota: string | null = null;
  const startedAt = Date.now();
  const remaining = () => MODEL_CONFIG.budgetMs - (Date.now() - startedAt);

  for (let attempt = 0; attempt < MODEL_CONFIG.maxAttempts; attempt++) {
    if (remaining() < MODEL_CONFIG.minAttemptMs) {
      console.error('annotate: out of budget before attempt', attempt);
      return { ok: false, code: 'timed_out' };
    }

    let response: Response;
    // Aborted rather than left to be killed: an attempt that overruns still
    // leaves time to answer.
    const abort = new AbortController();
    const guard = setTimeout(() => abort.abort(), remaining());

    try {
      response = await fetch(MODEL_CONFIG.endpoint, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abort.signal,
      });
    } catch (error) {
      if (abort.signal.aborted) {
        console.error('annotate: attempt exceeded the budget');
        return { ok: false, code: 'timed_out' };
      }
      console.error('annotate: network failure', error);
      lastCode = 'generation_failed';
      const wait = MODEL_CONFIG.backoffBaseMs * 2 ** attempt;
      if (attempt < MODEL_CONFIG.maxAttempts - 1 && affordable(wait, remaining())) {
        await sleep(wait);
        continue;
      }
      return { ok: false, code: lastCode, quota: lastQuota };
    } finally {
      clearTimeout(guard);
    }

    if (response.ok) {
      const outcome = classifyInteraction((await response.json()) as Interaction);
      return outcome.ok ? { ok: true, text: outcome.text } : { ok: false, code: outcome.code };
    }

    const errorBody = await response.text();
    const rateCode = classifyRateLimit(response.status, errorBody);
    lastCode = rateCode ?? 'generation_failed';
    // Kept for the answer: which ceiling, on which model, and how big it is.
    lastQuota = describeQuota(errorBody);

    const wait = retryDelayMs(errorBody, attempt, MODEL_CONFIG.backoffBaseMs);

    /**
     * A retry has to fit, backoff included.
     *
     * Gemini's `retry_delay` can ask for thirty seconds, and three attempts
     * around two such waits cannot finish inside the platform's limit. Sleeping
     * anyway would spend the rest of the budget and be killed mid-generation,
     * which is how this arrived as a 504 rather than as "try again in a
     * minute".
     */
    if (
      !isRetryable(response.status, rateCode) ||
      attempt === MODEL_CONFIG.maxAttempts - 1 ||
      !affordable(wait, remaining())
    ) {
      if (lastCode !== 'daily_cap') {
        console.error('annotate: model call failed', response.status, errorBody.slice(0, 400));
      }
      return { ok: false, code: lastCode, quota: lastQuota };
    }

    await sleep(wait);
  }

  return { ok: false, code: lastCode, quota: lastQuota };
}

/**
 * The signed-in teacher's own Gemini key, if she has saved one.
 *
 * Service-role read against a table the browser cannot touch, keyed on the
 * caller's own id, so a teacher can only ever spend her own quota. Returns
 * null for anything at all that goes wrong — no key, no session, no table —
 * because every one of those means "use the shared key", not "stop".
 */
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
    // Logged without the response body, which would carry the key.
    console.error('annotate: could not read the teacher key, using the shared one', error);
    return null;
  }
}

Deno.serve(async (request: Request) => {
  const allowedOrigins = (Deno.env.get('MARGIN_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const headers = cors(request.headers.get('Origin'), allowedOrigins);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  /**
   * Her key if she has set one, the shared key otherwise.
   *
   * Her own quota is the point: the shared free-tier key hits a per-minute
   * limit as soon as two papers are marked in a row, and that rate limit is
   * indistinguishable to her from the app being broken.
   *
   * Read here and used here. It is never returned, never logged, and never
   * reaches the browser — the settings screen learns only whether one is set.
   *
   * A lookup failure falls through to the shared key rather than failing the
   * run. The alternative is that a hiccup in one table stops her marking, and
   * the shared key is a working state, not a compromise of anything.
   */
  const hers = await teacherKey(request);
  const apiKey = hers ?? Deno.env.get(MODEL_CONFIG.apiKeyEnvVar);
  if (!apiKey) return json({ error: 'missing_api_key' }, 500, headers);

  /**
   * Which key this run spent, reported on every answer including the failures.
   *
   * The fallback above is deliberate — the shared key is a working state and a
   * hiccup reading one table should not stop her marking — but a *silent*
   * fallback is not. She saved her own key, hit the same rate limit, and had
   * no way to tell whether it was in use at all. Which is the same shape as
   * every other bug on this feature: the answer existed server-side and was
   * never carried back.
   *
   * Says which key, never anything about it.
   */
  const keySource = hers ? 'teacher' : 'shared';

  let body: AnnotateRequest;
  try {
    body = (await request.json()) as AnnotateRequest;
  } catch {
    return json({ error: 'bad_request', key_source: keySource }, 400, headers);
  }

  if (!body.blocks?.length) {
    return json({ error: 'no_document', key_source: keySource }, 400, headers);
  }
  if (!body.allowed_kinds?.length) {
    return json({ error: 'no_kinds', key_source: keySource }, 400, headers);
  }

  try {
    const generated = await generate(apiKey, body);
    if (!generated.ok) {
      // The rate-limit case above all: "too many requests" means one thing on
      // her own quota and another entirely on a key shared with everyone.
      return json(
        { error: generated.code, key_source: keySource, quota: generated.quota ?? null },
        statusFor(generated.code),
        headers,
      );
    }

    const payload = parseAnnotationPayload(generated.text);
    if (!payload.ok) {
      return json({ error: payload.code, key_source: keySource }, statusFor(payload.code), headers);
    }

    return json(
      {
        summary: payload.summary,
        annotations: payload.annotations,
        scores: payload.scores,
        key_source: keySource,
      },
      200,
      {
        ...headers,
        'Cache-Control': 'no-store',
      },
    );
  } catch (error) {
    console.error('annotate failed', error);
    return json({ error: 'generation_failed', key_source: keySource }, 502, headers);
  }
});
