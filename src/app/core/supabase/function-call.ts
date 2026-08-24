import { SupabaseService } from './supabase';

/**
 * Calling an Edge Function, with the failure kept.
 *
 * The three generators each had their own copy of this, and each copy threw
 * away the one thing that separates the causes: `throw new Error(body.error ??
 * 'generation_failed')`. A function that was never deployed, a missing API key
 * on the server, an expired session and a model that genuinely failed all
 * arrived at the screen as *"משהו השתבש. אפשר לנסות שוב"* — and trying again
 * fixes exactly one of those four.
 *
 * This is the same lesson the Drive errors taught twice: the status code and
 * the response body are right there, and reading them is the difference
 * between a one-line fix and an afternoon.
 */

export class FunctionError extends Error {
  constructor(
    /** Domain code from the function, or a transport one from below. */
    readonly code: string,
    readonly status: number | null,
    /** Raw, for showing in small print. Never the only thing she is told. */
    readonly detail: string,
  ) {
    super(code);
    this.name = 'FunctionError';
  }
}

/**
 * Causes that are nothing to do with the request she made, in her terms.
 *
 * Each says what happened and whether trying again could possibly help —
 * because "אפשר לנסות שוב" on an undeployed function is a loop she cannot get
 * out of by following the instruction.
 */
export const TRANSPORT_MESSAGES: Record<string, string> = {
  not_deployed:
    'הפונקציה הזו עדיין לא הועלתה לשרת, ולכן אין מי שיענה לבקשה. זו העלאה חד־פעמית, ואין לזה שום קשר לעבודה עצמה.',
  /**
   * Three causes the browser refuses to tell apart, most likely first.
   *
   * A function that was never deployed lands here rather than on
   * `not_deployed`: the gateway's 404 carries no CORS headers, so the browser
   * blocks it before the status can be read. Naming only the network sent a
   * real investigation looking for a connection problem that did not exist.
   */
  unreachable:
    'לא הצלחתי להגיע לפונקציה הזו. הסיבה השכיחה ביותר היא שהיא עדיין לא הועלתה לשרת — הדפדפן חוסם את התשובה לפני שאפשר לקרוא אותה, ולכן זה נראה כמו תקלת רשת. אם פונקציות אחרות כן עובדות, זו כמעט תמיד הסיבה. אחרת: אין חיבור לאינטרנט, או שכתובת האתר הזו לא ברשימת הכתובות המורשות בשרת.',
  not_signed_in: 'ההתחברות פגה. צריך להתחבר שוב.',
  missing_api_key: 'המפתח של מנוע הניסוח לא מוגדר בשרת. זו הגדרה חד־פעמית שנעשית פעם אחת.',
  server_error: 'השרת החזיר שגיאה. הפירוט למטה.',
};

/**
 * POSTs to an Edge Function with the teacher's session, or throws a
 * `FunctionError` that names what actually went wrong.
 */
export async function callFunction<T>(
  supabase: SupabaseService,
  name: string,
  body: unknown,
): Promise<T> {
  const { data } = await supabase.client.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new FunctionError('not_signed_in', null, 'no session');

  const url = `${supabase.functionsUrl}/${name}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    /**
     * Everything the browser refuses to distinguish arrives here: offline, a
     * blocked CORS response, and — the common one — a function that was never
     * deployed, whose 404 comes back without the headers that would let us read
     * it. The wording names all three, deployment first.
     *
     * The URL is carried because it is the one thing that settles it from the
     * outside: opening it is a page load rather than a fetch, so CORS cannot
     * hide the answer. A deployed function answers 401 for the missing header;
     * one that was never uploaded answers 404.
     */
    throw new FunctionError('unreachable', null, `${String(cause)} — ${url}`);
  }

  if (response.ok) return (await response.json()) as T;

  const text = await response.text().catch(() => '');
  let served: { error?: string; message?: string } = {};
  try {
    served = JSON.parse(text) as typeof served;
  } catch {
    // Not JSON. The text itself is the detail.
  }

  const detail = `${name} ${response.status}: ${(served.error ?? served.message ?? text ?? '').slice(0, 200)}`;

  // A function that isn't there answers 404 through the gateway, with no code
  // of ours in the body. Reporting that as a generation failure sent a real
  // investigation after the model.
  if (response.status === 404) throw new FunctionError('not_deployed', 404, detail);
  if (response.status === 401 || response.status === 403) {
    throw new FunctionError('not_signed_in', response.status, detail);
  }

  // The function's own code when it gave one, so domain failures — safety
  // blocks, rate limits, the daily cap — keep their own wording.
  if (served.error) throw new FunctionError(served.error, response.status, detail);

  throw new FunctionError('server_error', response.status, detail);
}
