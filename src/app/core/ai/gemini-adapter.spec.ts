import {
  buildRequestBody,
  classifyInteraction,
  classifyRateLimit,
  describeQuota,
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
    schema: responseSchema([...GENERATED_KINDS]),
  });

  it('asks for JSON constrained by a schema rather than hoping for prose', () => {
    expect(body.response_format.mime_type).toBe('application/json');
    expect(body.response_format.schema.required).toEqual(['summary', 'annotations']);
  });

  it('constrains the category to the kinds the client allows', () => {
    const item = body.response_format.schema.properties?.['annotations'].items;
    expect(item?.properties?.['kind'].enum).toEqual([...GENERATED_KINDS]);
  });

  it('requires every field the client needs to anchor a comment', () => {
    const item = body.response_format.schema.properties?.['annotations'].items;
    expect(item?.required).toEqual(['block_id', 'quote', 'kind', 'body']);
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
    const item = schema.properties?.['annotations'].items;
    expect(item?.properties?.['kind'].enum).toHaveLength(7);
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

  /**
   * The bug this file did not catch.
   *
   * Scores were in the schema, at length in the prompt, and returned by the
   * model — and the parser dropped them, so every grading form stayed empty
   * while nothing anywhere reported a failure. These tests passed throughout:
   * they asserted on the fields the parser kept and never on the one it lost.
   */
  it('keeps the rubric scores', () => {
    const result = parseAnnotationPayload(
      '{"summary":"ס","annotations":[],' +
        '"scores":[{"key":"2.1","points":6,"note":"סקירה רחבה"},' +
        '{"key":"3.1","points":null,"note":"הפרק טרם נכתב"}]}',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scores).toHaveLength(2);
    expect(result.scores[0]).toMatchObject({ key: '2.1', points: 6 });
    // Null survives as null: "not judgeable yet" is an answer, not a zero.
    expect(result.scores[1]).toMatchObject({ key: '3.1', points: null });
  });

  /** A comments-only round has no scores in its schema at all. Not an error. */
  it('gives an empty list when the reply carries no scores', () => {
    const result = parseAnnotationPayload('{"summary":"ס","annotations":[]}');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scores).toEqual([]);
  });

  it('ignores a scores field that is not a list', () => {
    const result = parseAnnotationPayload('{"summary":"ס","annotations":[],"scores":"nope"}');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scores).toEqual([]);
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

/**
 * Which ceiling a 429 hit.
 *
 * All three arrive as 429 and mean different things to her. The token one is
 * the reason this exists: a single request can breach it on its own, so
 * "try again in a minute" is advice she could follow all afternoon without it
 * ever working, and a retry spends two more requests failing identically.
 */
describe('telling the free-tier limits apart', () => {
  const body = (quota: string) =>
    JSON.stringify({
      error: {
        code: 429,
        message: 'Resource has been exhausted',
        details: [{ violations: [{ quotaId: quota }] }],
      },
    });

  it('reads the daily cap', () => {
    expect(classifyRateLimit(429, body('GenerateRequestsPerDayPerProject-FreeTier'))).toBe(
      'daily_cap',
    );
  });

  it('reads the tokens-per-minute ceiling', () => {
    expect(
      classifyRateLimit(429, body('GenerateContentInputTokensPerModelPerMinute-FreeTier')),
    ).toBe('token_cap');
  });

  it('treats anything else as the ordinary per-minute limit', () => {
    expect(classifyRateLimit(429, body('GenerateRequestsPerMinutePerProject-FreeTier'))).toBe(
      'rate_limited',
    );
  });

  it('says nothing about a response that is not a 429', () => {
    expect(classifyRateLimit(500, body('whatever'))).toBeNull();
  });

  /** Retrying it spends two more requests to fail in exactly the same way. */
  it('never retries a ceiling the same request would breach again', () => {
    expect(isRetryable(429, 'token_cap')).toBe(false);
    expect(isRetryable(429, 'daily_cap')).toBe(false);
    expect(isRetryable(429, 'rate_limited')).toBe(true);
  });
});

/**
 * The quota Google names when it refuses.
 *
 * `limit=0` is the whole point of reading it. A brand new key hitting a limit
 * on its first run has not exhausted an allowance — it never had one, which is
 * what a model outside the free tier looks like. That is neither waited out
 * nor fixed by a shorter paper, and without this the app cannot tell it apart
 * from either.
 */
describe('reading the quota out of a refusal', () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      details: [
        {
          violations: [
            {
              quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
              quotaDimensions: { model: 'gemini-3.6-flash', location: 'global' },
              quotaValue: '0',
            },
          ],
        },
      ],
    },
  });

  it('names the ceiling, the model and the limit', () => {
    const described = describeQuota(body);

    expect(described).toContain('PerMinutePerProjectPerModel');
    expect(described).toContain('model=gemini-3.6-flash');
    // Never had one, rather than used one up.
    expect(described).toContain('limit=0');
  });

  it('says nothing about a body that names no quota', () => {
    expect(describeQuota('{"error":{"code":500}}')).toBeNull();
  });

  it('survives a body that is not JSON at all', () => {
    expect(describeQuota('<html>502 Bad Gateway</html>')).toBeNull();
  });
});
