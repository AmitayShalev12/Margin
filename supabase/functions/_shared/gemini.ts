import type { AnnotateErrorCode, ModelConfig } from './model-config.ts';

/**
 * Adapter for Google's Interactions API (`POST /v1beta/interactions`), which
 * replaced `generateContent` and went GA in June 2026.
 *
 * Everything here is pure — no `Deno`, no `fetch` — so the unit tests can
 * import it and drive real payload shapes through it. `annotate/index.ts` owns
 * the network and the environment.
 */

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * The shape the client already expects back, expressed as JSON Schema.
 *
 * The Interactions API takes standard JSON Schema with lowercase type names —
 * not the older OpenAPI-style uppercase (`OBJECT`, `STRING`) that
 * `generateContent` used.
 *
 * `kinds` comes from the request rather than being restated: the client's
 * `GENERATED_KINDS` is the single source of truth for which categories the
 * review screen can colour.
 */
/** Just enough JSON Schema for what these functions ask the model for. */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  /**
   * Gemini's structured output takes the OpenAPI subset, where a nullable
   * field is a flag rather than `type: ['integer', 'null']`. It matters here:
   * "the text does not support a judgement yet" has to be expressible, and a
   * schema that cannot say null forces the model to invent a number.
   */
  nullable?: boolean;
}

/**
 * The shape the model must answer in.
 *
 * `scored` decides whether the scores array is part of the schema at all.
 * Leaving it out of the shape is stronger than instructing the model to send
 * an empty one: a round that may not be scored cannot come back scored, so the
 * paragraph submission has no path to a number even if the prompt is misread.
 */
export function responseSchema(kinds: string[], scored = false): JsonSchema {
  const scores: JsonSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        // Nullable on purpose: "the text does not support a judgement yet" is
        // an answer, and a required number would force a guess instead.
        points: { type: 'integer', nullable: true },
        note: { type: 'string' },
        /**
         * Why this score, in the model's own words. Required, including when
         * the points are null — "the chapter is not written yet" is exactly
         * the reasoning she wants to be able to follow.
         */
        rationale: { type: 'string' },
      },
      required: ['key', 'points', 'note', 'rationale'],
    },
  };

  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      ...(scored ? { scores } : {}),
      annotations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            block_id: { type: 'string' },
            quote: { type: 'string' },
            kind: { type: 'string', enum: kinds },
            body: { type: 'string' },
          },
          required: ['block_id', 'quote', 'kind', 'body'],
        },
      },
    },
    required: scored ? ['summary', 'annotations', 'scores'] : ['summary', 'annotations'],
  };
}

export function buildRequestBody(options: {
  config: ModelConfig;
  systemInstruction: string;
  input: string;
  /**
   * The shape the model must answer in. `responseSchema` builds the one for
   * annotations; the student-facing form passes its own.
   */
  schema: JsonSchema;
}) {
  return {
    model: options.config.model,
    input: options.input,
    system_instruction: options.systemInstruction,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: options.schema,
    },
    generation_config: {
      max_output_tokens: options.config.maxOutputTokens,
      thinking_level: options.config.thinkingLevel,
    },
    // The API stores interactions server-side by default. Student writing has
    // no business persisting in a vendor's conversation store, so this is
    // explicitly off.
    store: false,
  };
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

interface InteractionContent {
  type?: string;
  text?: string;
}

interface InteractionStep {
  type?: string;
  content?: InteractionContent[];
}

export interface Interaction {
  status?: string;
  steps?: InteractionStep[];
  output_text?: string;
  usage?: Record<string, unknown>;
}

export type GeminiOutcome =
  | { ok: true; text: string; usage: Record<string, unknown> | null }
  | { ok: false; code: AnnotateErrorCode };

/**
 * Pulls the model's text out of an interaction.
 *
 * `output_text` is the documented convenience field; the steps array is the
 * canonical form and is used when the convenience field is absent.
 */
export function extractText(interaction: Interaction): string {
  if (typeof interaction.output_text === 'string' && interaction.output_text.trim()) {
    return interaction.output_text;
  }

  return (interaction.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

/**
 * Looks for any sign the generation was stopped by a content filter.
 *
 * Google documents safety filtering thoroughly for the old `generateContent`
 * shape (`finishReason: "SAFETY"`, `promptFeedback.blockReason`) but not for
 * the Interactions API, which says only that filtered content "results in
 * modified output or status change". So rather than pattern-match one field
 * that may not exist, this scans the payload for the vocabulary a filter would
 * use, and the caller treats "no usable text" as a block either way.
 *
 * The cost of a false positive is a slightly wrong message on a batch that
 * failed regardless; the cost of missing it is the teacher being told nothing
 * useful. Worth erring this way round.
 */
export function looksSafetyBlocked(interaction: Interaction): boolean {
  const haystack = JSON.stringify(interaction ?? {}).toLowerCase();
  return (
    haystack.includes('"safety') ||
    haystack.includes('block_reason') ||
    haystack.includes('blockreason') ||
    haystack.includes('prohibited_content') ||
    haystack.includes('"blocked"') ||
    haystack.includes('image_safety') ||
    haystack.includes('spii')
  );
}

/**
 * Classifies a completed HTTP 200 response.
 *
 * Interaction `status` values: `in_progress`, `requires_action`, `completed`,
 * `failed`, `cancelled`, `incomplete`, `budget_exceeded`, `queued`.
 */
export function classifyInteraction(interaction: Interaction): GeminiOutcome {
  const text = extractText(interaction);
  const status = interaction.status ?? '';

  if (status === 'completed' && text.trim()) {
    return { ok: true, text, usage: (interaction.usage as Record<string, unknown>) ?? null };
  }

  if (looksSafetyBlocked(interaction)) return { ok: false, code: 'safety_blocked' };

  // Ran out of room mid-JSON. The partial can't be parsed, and half a batch
  // would be worse than none — the teacher is told it failed and can retry.
  if (status === 'incomplete' || status === 'budget_exceeded') {
    return { ok: false, code: 'bad_response' };
  }

  // Completed but empty is the most likely way a silent filter presents.
  if (!text.trim()) return { ok: false, code: 'safety_blocked' };

  return { ok: false, code: 'generation_failed' };
}

/** Parses the model's JSON, guarding against a schema-shaped-but-wrong reply. */
export function parseAnnotationPayload(
  text: string,
):
  | { ok: true; summary: string; annotations: unknown[]; scores: unknown[] }
  | { ok: false; code: AnnotateErrorCode } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad_response' };
  }

  if (!parsed || typeof parsed !== 'object') return { ok: false, code: 'bad_response' };

  const payload = parsed as { summary?: unknown; annotations?: unknown; scores?: unknown };
  if (!Array.isArray(payload.annotations)) return { ok: false, code: 'bad_response' };

  return {
    ok: true,
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    annotations: payload.annotations,
    /**
     * The scores, which this used to drop on the floor.
     *
     * They were asked for in the schema, described at length in the prompt and
     * returned by the model — and then discarded here, so the client saw
     * `undefined` every time and the whole grading form stayed empty. Nothing
     * failed anywhere, which is why it took three guesses to find.
     *
     * Absent is not an error: a comments-only round has no scores array in its
     * schema at all, and an empty list is the right answer there.
     */
    scores: Array.isArray(payload.scores) ? payload.scores : [],
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Tells a per-minute rate limit apart from the daily cap.
 *
 * Both come back as 429. Per-minute is worth retrying in a moment; the daily
 * cap is not — on the free tier the teacher is done until it resets, and she
 * should be told that rather than watching a spinner retry into the same wall.
 *
 * Free-tier limits are per-project and only visible in AI Studio, so this
 * reads what the response says instead of counting against a hardcoded quota.
 */
export function classifyRateLimit(status: number, body: string): AnnotateErrorCode | null {
  /**
   * A key Google will not accept, told apart from everything else.
   *
   * Now that she pastes her own, this is the likeliest failure on that screen
   * and the one she can actually act on.
   */
  if (status === 401 || status === 403) return 'key_rejected';

  if (status !== 429) return null;

  const haystack = body.toLowerCase();

  /**
   * Checked before the rate limits, because it wears their status code.
   *
   * Google answers a depleted balance with 429 RESOURCE_EXHAUSTED — the same
   * as a per-minute cap — and only the message tells them apart. Read the
   * message: the two need opposite advice, and one of them is not something
   * waiting can solve.
   */
  if (
    haystack.includes('prepayment credit') ||
    haystack.includes('credits are depleted') ||
    haystack.includes('billing')
  ) {
    return 'credits_exhausted';
  }

  const daily =
    haystack.includes('perday') ||
    haystack.includes('per day') ||
    haystack.includes('per_day') ||
    haystack.includes('daily');

  if (daily) return 'daily_cap';

  /**
   * Google names the quota it refused on, and the token one is worth telling
   * apart: `..._free_tier_input_token_count` is a ceiling a single request can
   * breach by itself, so retrying and waiting both fail identically. The
   * answer there is a smaller request, not a later one.
   */
  const tokens =
    haystack.includes('token_count') ||
    haystack.includes('tokens per') ||
    haystack.includes('inputtokens');

  return tokens ? 'token_cap' : 'rate_limited';
}

/** Whether another attempt could plausibly succeed. */
export function isRetryable(status: number, code: AnnotateErrorCode | null): boolean {
  if (code === 'daily_cap') return false;
  // Neither is a transient condition. Retrying spends two more attempts to be
  // refused in exactly the same way.
  if (code === 'credits_exhausted' || code === 'key_rejected') return false;
  // The same request would breach the same token ceiling. Retrying spends two
  // more of her requests to fail in exactly the same way.
  if (code === 'token_cap') return false;
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

/**
 * Honours a `retryDelay` if the API supplied one, else exponential backoff.
 * Google returns retry hints as strings like `"7s"` in `error.details`.
 */
/**
 * The quota Google actually refused on, in a few words.
 *
 * A 429 body names the violation — `quotaId`, the model it applies to, and the
 * limit itself — and all of it was being thrown away, leaving three very
 * different situations looking identical.
 *
 * `quotaValue: "0"` is the one worth the whole function. It does not mean she
 * has used her allowance up; it means she never had one, which is what a brand
 * new key on a model outside the free tier looks like. Waiting cannot fix that
 * and neither can a smaller paper: it is the wrong model for the key.
 *
 * Quota metadata only. No part of the key or the paper is in here.
 */
export function describeQuota(body: string): string | null {
  const id = /"quotaId"\s*:\s*"([^"]{1,120})"/.exec(body)?.[1];
  const value = /"quotaValue"\s*:\s*"?(\d{1,12})"?/.exec(body)?.[1];
  const model = /"model"\s*:\s*"([^"]{1,80})"/.exec(body)?.[1];

  const parts = [id, model && `model=${model}`, value !== undefined && `limit=${value}`].filter(
    Boolean,
  );

  return parts.length ? parts.join(' ') : null;
}

export function retryDelayMs(body: string, attempt: number, baseMs: number): number {
  const match = /"retry(?:_)?delay"\s*:\s*"?(\d+(?:\.\d+)?)s"?/i.exec(body);
  if (match) return Math.min(30_000, Math.ceil(Number(match[1]) * 1000));
  return Math.min(30_000, baseMs * 2 ** attempt);
}
