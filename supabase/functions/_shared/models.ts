/**
 * Which models the key can actually use, asked of Google rather than guessed.
 *
 * The alternative was a hardcoded list, and it would have been wrong within
 * the month. Checking an id against a live `models` call is the only way to be
 * right about this: Google adds a Flash generation every few months, renames
 * previews, and retires ids on its own schedule. A list in the repo is a claim
 * about Google's catalogue that nobody updates.
 *
 * It also costs nothing. Listing models spends no credits and is not subject
 * to the generation quota, so this stays cheap even on an exhausted key.
 */

/** One model the key may be pointed at. */
export interface ModelOption {
  /** The id used in a request body, e.g. `gemini-3.8-flash`. */
  id: string;
  /** Google's own name for it, e.g. "Gemini 3.8 Flash". */
  label: string;
  /**
   * Whether this is a Pro-tier model, which is paid-only and several times the
   * price of Flash. Carried so the screen can say so before she picks one,
   * rather than after a bill arrives.
   */
  pro: boolean;
}

const LIST_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';

interface ListedModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

/**
 * Model ids that answer with something other than text, or are not general
 * writing models at all.
 *
 * Matched on the id, which is the stable part — display names get rewritten.
 * A substring list is a blunt instrument and will one day hide a model it
 * should not, but the failure is a missing option rather than a broken run,
 * and the alternative is offering a teacher an image generator and a robotics
 * model in a dropdown about marking essays.
 *
 * `omni` is here because those are the audio/video variants; `customtools`
 * because it is the same model wired for tool calling, which this never does.
 */
const NOT_FOR_MARKING = [
  'embedding',
  'aqa',
  'tts',
  'image',
  'banana',
  'lyria',
  'transcribe',
  'robotics',
  'computer-use',
  'antigravity',
  'deep-research',
  'omni',
  'customtools',
  'gemma',
];

/**
 * Pro means paid. Matched on the id rather than the display name because
 * "Gemini Pro Latest" and `gemini-pro-latest` agree today and may not tomorrow.
 */
function isPro(id: string): boolean {
  return /(^|[-.])pro($|[-.])/.test(id);
}

export function usableForMarking(model: ListedModel): boolean {
  const id = (model.name ?? '').replace(/^models\//, '');
  if (!id) return false;
  if (!(model.supportedGenerationMethods ?? []).includes('generateContent')) return false;
  return !NOT_FOR_MARKING.some((word) => id.includes(word));
}

export type ModelListOutcome =
  | { ok: true; models: ModelOption[] }
  | { ok: false; code: 'key_rejected' | 'unavailable' };

/**
 * The text models this key may use, newest-looking first.
 *
 * Order is Google's, which puts older families first; reversed here so the
 * current generation is at the top of the list rather than the bottom. That is
 * presentation, not a claim about which is best — the version numbers are
 * visible and she can read them.
 */
export async function listModels(apiKey: string): Promise<ModelListOutcome> {
  let response: Response;
  try {
    response = await fetch(LIST_ENDPOINT, { headers: { 'x-goog-api-key': apiKey } });
  } catch (error) {
    console.error('models: could not reach Google', error);
    return { ok: false, code: 'unavailable' };
  }

  if (response.status === 400 || response.status === 403) {
    return { ok: false, code: 'key_rejected' };
  }
  if (!response.ok) {
    console.error('models: unexpected status', response.status);
    return { ok: false, code: 'unavailable' };
  }

  let body: { models?: ListedModel[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, code: 'unavailable' };
  }

  const models = (body.models ?? []).filter(usableForMarking).map((model) => {
    const id = (model.name ?? '').replace(/^models\//, '');
    return { id, label: model.displayName || id, pro: isPro(id) };
  });

  return { ok: true, models: models.reverse() };
}

/**
 * Whether this id is one the key can use.
 *
 * Checked before saving, because the failure it prevents is the worst kind
 * this app has: a model id that is merely stored looks exactly like one that
 * works, right up to the next marking run failing for a reason she has no way
 * to connect to a dropdown she touched last week.
 */
export async function modelIsUsable(apiKey: string, id: string): Promise<boolean> {
  const listed = await listModels(apiKey);
  return listed.ok && listed.models.some((model) => model.id === id);
}
