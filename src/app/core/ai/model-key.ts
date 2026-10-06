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
  /** The model she chose, or null for the one the server is configured with. */
  model: string | null;
}

/** One model her key may be pointed at, as Google listed it. */
export interface ModelOption {
  id: string;
  label: string;
  /** Paid-only, and several times the price of Flash. */
  pro: boolean;
}

interface ModelListing {
  models: ModelOption[];
  /** The server's own pin, so the screen can mark it as the default. */
  fallback: string;
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
  /**
   * Google knows the key and does not know this model. Almost always a model
   * that was retired or renamed since the list was loaded.
   */
  model_unavailable: 'המודל הזה לא זמין במפתח הזה. אפשר לרענן את הרשימה ולבחור אחר.',
  /**
   * Pro tiers are paid-only, so a model choice without her own key could never
   * run. Said plainly rather than stored and quietly ignored.
   */
  needs_own_key: 'כדי לבחור מודל צריך מפתח משלך — המפתח המשותף מריץ רק את מודל ברירת המחדל.',
  unavailable: 'לא הצלחתי לקבל את רשימת המודלים מגוגל. אפשר לנסות שוב.',
  key_rejected: 'המפתח לא התקבל אצל Google.',
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

  /** Null until asked for. Empty is a real answer; null is "not loaded". */
  private readonly _models = signal<ModelOption[] | null>(null);
  private readonly _fallback = signal<string | null>(null);

  readonly models = this._models.asReadonly();
  /** The model id her runs use: her choice, else the server's pin. */
  readonly activeModel = computed(() => this._status()?.model ?? this._fallback());
  readonly onDefaultModel = computed(() => !this._status()?.model);

  /**
   * True once she is on a Pro model, so the screen can keep saying what it
   * costs rather than warning once at the moment she picks it and never again.
   */
  readonly onProModel = computed(() => {
    const id = this.activeModel();
    return !!id && (this._models() ?? []).some((m) => m.id === id && m.pro);
  });

  /** Whether the app can talk to functions at all. */
  readonly available = this.supabase.isConfigured;

  async refresh(): Promise<void> {
    if (!this.available) return;
    await this.run(() => callFunction<ModelKeyStatus>(this.supabase, 'model-key', { read: true }));
  }

  /**
   * The models this key may be pointed at, asked of Google.
   *
   * Not hardcoded, because a list in the repo is a claim about Google's
   * catalogue that nobody updates — and it would be wrong within the month.
   * Listing costs nothing and spends no quota, so this is safe to call even on
   * a key with no credit left.
   */
  async loadModels(): Promise<boolean> {
    if (!this.available) return false;

    this._busy.set(true);
    this._error.set(null);
    try {
      const listing = await callFunction<ModelListing>(this.supabase, 'model-key', { list: true });
      this._models.set(listing.models);
      this._fallback.set(listing.fallback);
      return true;
    } catch (error) {
      const code = error instanceof FunctionError ? error.code : '';
      this._error.set(MESSAGES[code] ?? FALLBACK);
      return false;
    } finally {
      this._busy.set(false);
    }
  }

  /** Her model choice. Null puts her back on the server's default. */
  async chooseModel(id: string | null): Promise<boolean> {
    return this.run(() => callFunction<ModelKeyStatus>(this.supabase, 'model-key', { model: id }));
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
