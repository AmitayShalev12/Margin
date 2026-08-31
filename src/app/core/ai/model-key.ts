import { Injectable, computed, inject, signal } from '@angular/core';

import { FunctionError, callFunction } from '../supabase/function-call';
import { SupabaseService } from '../supabase/supabase';

/**
 * Her own Gemini key — set it, replace it, clear it.
 *
 * The key itself never lives here. It is typed, sent once to `model-key`, and
 * from then on this holds two harmless facts: whether one is set, and its last
 * four characters. That is enough for her to tell one key from another and
 * useless to anyone who obtains it.
 *
 * The reason for the whole feature is quota. The shared free-tier key hits a
 * per-minute limit as soon as two papers are marked in a row, and a rate limit
 * she can do nothing about reads to her as the app being broken. On her own
 * key it is her quota to spend.
 */

export interface ModelKeyStatus {
  set: boolean;
  /** Last four characters, or null when no key is set. */
  hint: string | null;
}

/**
 * What she is told when saving fails, by the code the function returned.
 *
 * `bad_key` is the one that earns its wording: the usual mistake is pasting
 * the wrong credential entirely — a Supabase key, half a URL — and "invalid"
 * alone would leave her re-pasting the same wrong thing.
 */
const MESSAGES: Record<string, string> = {
  bad_key: 'זה לא נראה כמו מפתח Gemini. העתיקי את המפתח מ־Google AI Studio, בלי רווחים.',
  not_signed_in: 'צריך להתחבר מחדש כדי לשמור מפתח.',
  server_misconfigured: 'השרת לא מוגדר לשמירת מפתחות. זו תקלה אצלנו, לא אצלך.',
  server_error: 'לא הצלחתי לשמור את המפתח. אפשר לנסות שוב.',
};

const FALLBACK = 'לא הצלחתי לשמור את המפתח. אפשר לנסות שוב.';

@Injectable({ providedIn: 'root' })
export class ModelKey {
  private readonly supabase = inject(SupabaseService);

  private readonly _status = signal<ModelKeyStatus | null>(null);
  private readonly _busy = signal(false);
  private readonly _error = signal<string | null>(null);

  /** Null until it has been asked for — "unknown", not "no key". */
  readonly status = this._status.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly error = this._error.asReadonly();

  readonly usingOwnKey = computed(() => this._status()?.set === true);

  /** Whether the app can talk to functions at all. */
  readonly available = this.supabase.isConfigured;

  async refresh(): Promise<void> {
    if (!this.available) return;
    await this.run(() => callFunction<ModelKeyStatus>(this.supabase, 'model-key', { read: true }));
  }

  async save(key: string): Promise<boolean> {
    const trimmed = key.trim();
    if (!trimmed) return false;

    return this.run(() =>
      callFunction<ModelKeyStatus>(this.supabase, 'model-key', { api_key: trimmed }),
    );
  }

  /** Back to the shared key, which is a working state rather than an outage. */
  async clear(): Promise<boolean> {
    return this.run(() =>
      callFunction<ModelKeyStatus>(this.supabase, 'model-key', { clear: true }),
    );
  }

  private async run(call: () => Promise<ModelKeyStatus>): Promise<boolean> {
    this._busy.set(true);
    this._error.set(null);

    try {
      this._status.set(await call());
      return true;
    } catch (error) {
      const code = error instanceof FunctionError ? error.code : '';
      this._error.set(MESSAGES[code] ?? FALLBACK);
      return false;
    } finally {
      this._busy.set(false);
    }
  }
}
