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
export function responseSchema(kinds: string[]) {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
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
    required: ['summary', 'annotations'],
  };
}

export function buildRequestBody(options: {
  config: ModelConfig;
  systemInstruction: string;
  input: string;
  kinds: string[];
}) {
  return {
    model: options.config.model,
    input: options.input,
    system_instruction: options.systemInstruction,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: responseSchema(options.kinds),
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
): { ok: true; summary: string; annotations: unknown[] } | { ok: false; code: AnnotateErrorCode } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad_response' };
  }

  if (!parsed || typeof parsed !== 'object') return { ok: false, code: 'bad_response' };

  const payload = parsed as { summary?: unknown; annotations?: unknown };
  if (!Array.isArray(payload.annotations)) return { ok: false, code: 'bad_response' };

  return {
    ok: true,
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    annotations: payload.annotations,
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
  if (status !== 429) return null;

  const haystack = body.toLowerCase();
  const daily =
    haystack.includes('perday') ||
    haystack.includes('per day') ||
    haystack.includes('per_day') ||
    haystack.includes('daily');

  return daily ? 'daily_cap' : 'rate_limited';
}

/** Whether another attempt could plausibly succeed. */
export function isRetryable(status: number, code: AnnotateErrorCode | null): boolean {
  if (code === 'daily_cap') return false;
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

/**
 * Honours a `retryDelay` if the API supplied one, else exponential backoff.
 * Google returns retry hints as strings like `"7s"` in `error.details`.
 */
export function retryDelayMs(body: string, attempt: number, baseMs: number): number {
  const match = /"retry(?:_)?delay"\s*:\s*"?(\d+(?:\.\d+)?)s"?/i.exec(body);
  if (match) return Math.min(30_000, Math.ceil(Number(match[1]) * 1000));
  return Math.min(30_000, baseMs * 2 ** attempt);
}
