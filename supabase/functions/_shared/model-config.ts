/**
 * The model behind the annotation pass — one place, on purpose.
 *
 * This is a **cost decision, not a technical one**: Google AI Studio's free
 * tier needs no billing account, which is what makes the drafting pass free to
 * run while the app is still being built. It is expected to change.
 *
 * Swapping provider should be an edit here plus one new adapter beside
 * `gemini.ts` — nothing in `annotate/index.ts` and nothing client-side.
 *
 * ⚠️ Free tier means Google may use submitted content to improve their models.
 * Keep this pointed at seeded or synthetic documents until someone decides to
 * move to a paid tier. Real student work should not go through it as it
 * stands.
 */

export type ModelProvider = 'gemini';

export interface ModelConfig {
  provider: ModelProvider;
  /**
   * `gemini-3.6-flash` is the current free-tier flagship (checked against
   * ai.google.dev, August 2026). Newer Gemini releases at the time of writing
   * are specialised — Live, TTS, Omni video — not general text models.
   *
   * Must stay on a Flash-tier model: Pro tiers are paid-only.
   */
  model: string;
  /** Env var holding the key. Read server-side only, never sent to a client. */
  apiKeyEnvVar: string;
  endpoint: string;
  maxOutputTokens: number;
  /** `minimal` | `low` | `medium` | `high` — depth of the model's reasoning. */
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high';
  /** Attempts for a retryable failure (rate limit, transient 5xx). */
  maxAttempts: number;
  /** Base delay for exponential backoff, in milliseconds. */
  backoffBaseMs: number;
}

export const MODEL_CONFIG: ModelConfig = {
  provider: 'gemini',
  model: 'gemini-3.6-flash',
  apiKeyEnvVar: 'GEMINI_API_KEY',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions',
  maxOutputTokens: 32000,
  thinkingLevel: 'medium',
  // Free-tier per-minute limits are tight and not published per model — they
  // are per-project, visible only in AI Studio — so this backs off on what the
  // API actually returns rather than tracking a hardcoded quota.
  maxAttempts: 3,
  backoffBaseMs: 1500,
};

/**
 * Failures the teacher needs told apart. The Edge Function returns the code;
 * the client turns it into Hebrew, the same split as `DriveError`.
 */
export type AnnotateErrorCode =
  'safety_blocked' | 'rate_limited' | 'daily_cap' | 'bad_response' | 'generation_failed';
