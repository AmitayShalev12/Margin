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
  /**
   * How long the whole call may take, retries and backoff included.
   *
   * Supabase kills a function request that has sent nothing for 150 seconds,
   * and this call sends nothing until the model answers. Killed, it returns a
   * 504 the teacher cannot act on — no code, no Hebrew, nothing about whether
   * to try again.
   *
   * So the budget sits *inside* the limit and the function gives up in time to
   * say so itself. Attempts are bounded by the clock rather than only by
   * `maxAttempts`: three generations plus two backoffs of up to thirty seconds
   * each cannot fit in 150 seconds, and that combination is exactly what a
   * rate-limited run produces.
   */
  budgetMs: number;
  /**
   * The least time worth starting another attempt with. Below this, a retry
   * would be killed mid-flight and lose the chance to report at all.
   */
  minAttemptMs: number;
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
  // 150s is the platform's limit; the rest is room to write the answer.
  budgetMs: 132_000,
  minAttemptMs: 25_000,
};

/**
 * Failures the teacher needs told apart. The Edge Function returns the code;
 * the client turns it into Hebrew, the same split as `DriveError`.
 */
export type AnnotateErrorCode =
  | 'safety_blocked'
  | 'rate_limited'
  /**
   * The account is out of credit. A 429, and not a rate limit at all.
   *
   * "Your prepayment credits are depleted" arrives with the same status as
   * "too many requests per minute", and the app spent an afternoon telling a
   * teacher to wait a moment and try again — advice that could never work, for
   * a problem no amount of waiting touches. Nothing in the app can fix it and
   * nothing in the app should pretend otherwise: it is a billing page.
   */
  | 'credits_exhausted'
  /**
   * Google refused the key itself.
   *
   * Worth its own code now that she can paste her own: a key with a typo, a
   * revoked one, or one from the wrong project is the likeliest thing to go
   * wrong on that screen, and "something went wrong drafting comments" would
   * send her looking anywhere but at the key she just saved.
   */
  | 'key_rejected'
  /**
   * The tokens-per-minute ceiling, which is a different problem from the
   * requests-per-minute one and has a different answer.
   *
   * A request can exceed it on its own: one long paper plus her rules, her
   * sources and sixty style examples is a great many tokens, and when that is
   * the limit, waiting changes nothing — the next attempt is the same size and
   * fails identically. Told apart because "try again in a minute" is advice
   * that cannot work here, and following it looks like the app lying.
   */
  | 'token_cap'
  | 'daily_cap'
  | 'bad_response'
  | 'generation_failed'
  /** The budget ran out. Distinct from a failure: nothing went wrong, it was slow. */
  | 'timed_out';
