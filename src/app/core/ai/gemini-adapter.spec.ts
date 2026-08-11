import {
  buildRequestBody,
  classifyInteraction,
  classifyRateLimit,
  extractText,
  isRetryable,
  parseAnnotationPayload,
  responseSchema,
  retryDelayMs,
  type Interaction,
} from '../../../../supabase/functions/_shared/gemini.ts';
import { MODEL_CONFIG } from '../../../../supabase/functions/_shared/model-config.ts';
import { GENERATED_KINDS } from './contract';

/**
 * Drives real Interactions API payload shapes through the adapter the Edge
 * Function uses. The function's own `Deno.serve` entry point can't run here,
 * but everything that decides what a response *means* is pure and does.
 */

function interaction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    status: 'completed',
    steps: [
      {
        type: 'model_output',
        content: [{ type: 'text', text: '{"summary":"סיכום","annotations":[]}' }],
      },
    ],
    usage: { total_tokens: 49 },
    ...overrides,
  };
}

describe('model configuration', () => {
  it('stays on a free-tier Flash model — Pro tiers are paid-only', () => {
    expect(MODEL_CONFIG.model).toBe('gemini-3.6-flash');
    expect(MODEL_CONFIG.model).toContain('flash');
    expect(MODEL_CONFIG.model).not.toContain('pro');
  });

  it('reads its key from an environment variable, never a literal', () => {
    expect(MODEL_CONFIG.apiKeyEnvVar).toBe('GEMINI_API_KEY');
    expect(JSON.stringify(MODEL_CONFIG)).not.toMatch(/AIza|sk-|key=/i);
  });
});

describe('buildRequestBody', () => {
  const body = buildRequestBody({
    config: MODEL_CONFIG,
    systemInstruction: 'instructions + knowledge base',
    input: 'the paper',
    kinds: [...GENERATED_KINDS],
  });

  it('asks for JSON constrained by a schema rather than hoping for prose', () => {
    expect(body.response_format.mime_type).toBe('application/json');
    expect(body.response_format.schema.required).toEqual(['summary', 'annotations']);
  });

  it('constrains the category to the kinds the client allows', () => {
    const kind = body.response_format.schema.properties.annotations.items.properties.kind;
    expect(kind.enum).toEqual([...GENERATED_KINDS]);
  });

  it('requires every field the client needs to anchor a comment', () => {
    const item = body.response_format.schema.properties.annotations.items;
    expect(item.required).toEqual(['block_id', 'quote', 'kind', 'body']);
  });

  it('uses lowercase JSON Schema types, not the old OpenAPI-style casing', () => {
    const schema = JSON.stringify(body.response_format.schema);
    expect(schema).not.toMatch(/"OBJECT"|"STRING"|"ARRAY"/);
    expect(body.response_format.schema.type).toBe('object');
  });

  it('turns off server-side storage of the interaction', () => {
    // The API stores by default; student writing shouldn't persist there.
    expect(body.store).toBe(false);
  });

  it('sends the model and generation settings from the one config location', () => {
    expect(body.model).toBe(MODEL_CONFIG.model);
    expect(body.generation_config.max_output_tokens).toBe(MODEL_CONFIG.maxOutputTokens);
    expect(body.generation_config.thinking_level).toBe(MODEL_CONFIG.thinkingLevel);
  });

  it('puts the knowledge base in the system instruction and the paper in the input', () => {
    expect(body.system_instruction).toContain('knowledge base');
    expect(body.input).toBe('the paper');
  });
});

describe('responseSchema', () => {
  it('rejects nothing when given the full kind list', () => {
    const schema = responseSchema([...GENERATED_KINDS]);
    expect(schema.properties.annotations.items.properties.kind.enum).toHaveLength(7);
  });
});

describe('extractText', () => {
  it('reads the convenience field when present', () => {
    expect(extractText({ output_text: 'hello' })).toBe('hello');
  });

  it('falls back to the steps array', () => {
    expect(extractText(interaction())).toBe('{"summary":"סיכום","annotations":[]}');
  });

  it('joins multiple text parts of a model output', () => {
    const text = extractText({
      steps: [
        {
          type: 'model_output',
          content: [
            { type: 'text', text: '{"summary":"א",' },
            { type: 'text', text: '"annotations":[]}' },
          ],
        },
      ],
    });
    expect(text).toBe('{"summary":"א","annotations":[]}');
  });

  it('ignores steps that are not model output', () => {
    const text = extractText({
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'the paper' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'answer' }] },
      ],
    });
    expect(text).toBe('answer');
  });

  it('survives a response with no steps at all', () => {
    expect(extractText({})).toBe('');
  });
});

describe('classifyInteraction', () => {
  it('accepts a completed interaction with text', () => {
    const outcome = classifyInteraction(interaction());
    expect(outcome).toMatchObject({ ok: true });
    if (outcome.ok) expect(outcome.text).toContain('annotations');
  });

  it('reports a safety block when the payload carries a safety signal', () => {
    const outcome = classifyInteraction({
      status: 'failed',
      steps: [{ type: 'model_output', content: [] }],
      // Shape isn't precisely documented for this API, so the adapter looks
      // for the vocabulary a filter would use.
      ...({ block_reason: 'safety' } as Record<string, unknown>),
    });
    expect(outcome).toEqual({ ok: false, code: 'safety_blocked' });
  });

  it('reports a safety block for the old-style finish reason too', () => {
    const outcome = classifyInteraction({
      status: 'failed',
      ...({ candidates: [{ finishReason: 'SAFETY' }] } as Record<string, unknown>),
    });
    expect(outcome).toEqual({ ok: false, code: 'safety_blocked' });
  });

  it('reports a safety block for prohibited content', () => {
    const outcome = classifyInteraction({
      status: 'failed',
      ...({ reason: 'PROHIBITED_CONTENT' } as Record<string, unknown>),
    });
    expect(outcome).toEqual({ ok: false, code: 'safety_blocked' });
  });

  it('treats a completed-but-empty reply as a silent block', () => {
    // The likeliest way a filter presents without a documented field.
    const outcome = classifyInteraction({ status: 'completed', steps: [] });
    expect(outcome).toEqual({ ok: false, code: 'safety_blocked' });
  });

  it('treats a truncated generation as a bad response, not a partial batch', () => {
    const outcome = classifyInteraction(
      interaction({ status: 'incomplete', output_text: '{"summary":"א","annot' }),
    );
    expect(outcome).toEqual({ ok: false, code: 'bad_response' });
  });

  it('treats a budget stop the same way', () => {
    const outcome = classifyInteraction(
      interaction({ status: 'budget_exceeded', output_text: '{"summ' }),
    );
    expect(outcome).toEqual({ ok: false, code: 'bad_response' });
  });

  it('falls back to a generic failure when text arrived under a non-completed status', () => {
    const outcome = classifyInteraction(interaction({ status: 'cancelled' }));
    expect(outcome).toEqual({ ok: false, code: 'generation_failed' });
  });
});

describe('parseAnnotationPayload', () => {
  it('parses the shape the client expects', () => {
    const result = parseAnnotationPayload(
      '{"summary":"סיכום","annotations":[{"block_id":"b1","quote":"q","kind":"language","body":"b"}]}',
    );
    expect(result).toMatchObject({ ok: true, summary: 'סיכום' });
    if (result.ok) expect(result.annotations).toHaveLength(1);
  });

  it('rejects truncated JSON rather than throwing', () => {
    expect(parseAnnotationPayload('{"summary":"א","annot')).toEqual({
      ok: false,
      code: 'bad_response',
    });
  });

  it('rejects a reply missing the annotations array', () => {
    expect(parseAnnotationPayload('{"summary":"א"}')).toEqual({
      ok: false,
      code: 'bad_response',
    });
  });

  it('tolerates a missing summary rather than losing the batch over it', () => {
    const result = parseAnnotationPayload('{"annotations":[]}');
    expect(result).toMatchObject({ ok: true, summary: '' });
  });
});

describe('rate limiting', () => {
  it('tells the daily cap apart from a per-minute limit', () => {
    const perMinute = JSON.stringify({
      error: { code: 429, message: 'Quota exceeded for quota metric requests per minute' },
    });
    const perDay = JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded',
        details: [{ quotaId: 'GenerateRequestsPerDayPerProject-FreeTier' }],
      },
    });

    expect(classifyRateLimit(429, perMinute)).toBe('rate_limited');
    expect(classifyRateLimit(429, perDay)).toBe('daily_cap');
  });

  it('is not a rate limit at any other status', () => {
    expect(classifyRateLimit(500, 'boom')).toBeNull();
    expect(classifyRateLimit(200, '')).toBeNull();
  });

  it('retries a per-minute limit but never the daily cap', () => {
    expect(isRetryable(429, 'rate_limited')).toBe(true);
    expect(isRetryable(429, 'daily_cap')).toBe(false);
  });

  it('retries transient server errors and gives up on client errors', () => {
    expect(isRetryable(503, null)).toBe(true);
    expect(isRetryable(500, null)).toBe(true);
    expect(isRetryable(400, null)).toBe(false);
    expect(isRetryable(403, null)).toBe(false);
  });

  it('honours a retry delay the API supplied', () => {
    const body = JSON.stringify({
      error: {
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }],
      },
    });
    expect(retryDelayMs(body, 0, 1500)).toBe(7000);
  });

  it('backs off exponentially when no delay was given', () => {
    expect(retryDelayMs('{}', 0, 1500)).toBe(1500);
    expect(retryDelayMs('{}', 1, 1500)).toBe(3000);
    expect(retryDelayMs('{}', 2, 1500)).toBe(6000);
  });

  it('caps the wait so a request cannot hang for minutes', () => {
    expect(retryDelayMs('{"retryDelay":"600s"}', 0, 1500)).toBe(30_000);
    expect(retryDelayMs('{}', 10, 1500)).toBe(30_000);
  });
});
