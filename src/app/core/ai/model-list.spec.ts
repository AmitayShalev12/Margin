import { usableForMarking } from '../../../../supabase/functions/_shared/models.ts';

/**
 * Which of Google's models end up in the dropdown.
 *
 * Driven by a real `models` response taken from the project's own key on
 * 6 October 2026, because the thing being tested is a judgement about Google's
 * actual catalogue and a made-up fixture would only test the regex against
 * itself.
 *
 * The filter is a substring denylist, which is blunt by design: the catalogue
 * changes without warning and a list of permitted ids would be wrong within
 * the month. Both directions of failure are worth a test. Letting an image
 * generator through puts a model in front of a teacher that cannot mark an
 * essay; filtering too hard makes a model she is entitled to use quietly
 * disappear, which is the harder one to notice.
 */

function model(name: string, methods: string[] = ['generateContent']) {
  return { name: `models/${name}`, displayName: name, supportedGenerationMethods: methods };
}

describe('which models are offered for marking', () => {
  it('keeps every general text model in the catalogue', () => {
    const wanted = [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-pro-latest',
    ];

    for (const id of wanted) {
      expect(usableForMarking(model(id)), id).toBe(true);
    }
  });

  /**
   * Everything else the key lists. These answer with audio, pictures, music or
   * robot joint angles; a dropdown about marking essays should not offer them.
   */
  it('drops the models that do not write text', () => {
    const unwanted = [
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-pro-preview-tts',
      'gemini-3.8-flash-tts',
      'gemini-3.8-flash-lite-tts',
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-flash-image',
      'gemini-3-pro-image',
      'gemini-3-pro-image-preview',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-image-preview',
      'gemini-3.1-flash-lite-image',
      'nano-banana-pro-preview',
      'gemini-nano-banana-2.1',
      'lyria-3.5',
      'lyria-3-pro-preview',
      'lyria-3-clip-preview',
      'gemini-3.5-transcribe',
      'gemini-robotics-er-2-preview',
      'gemini-2.5-computer-use-preview-10-2025',
      'antigravity-preview-latest',
      'deep-research-pro-preview-12-2025',
      'gemini-omni-flash-preview',
      'gemini-omni-1.1-flash',
      'gemini-3.1-pro-preview-customtools',
      'gemma-4-31b-it',
    ];

    for (const id of unwanted) {
      expect(usableForMarking(model(id)), id).toBe(false);
    }
  });

  /** An embedding model is not a writing model, whatever its name suggests. */
  it('drops anything that cannot answer a prompt at all', () => {
    expect(usableForMarking(model('text-embedding-004', ['embedContent']))).toBe(false);
    expect(usableForMarking(model('gemini-3.8-flash', ['countTokens']))).toBe(false);
    expect(usableForMarking({ name: '', displayName: '' })).toBe(false);
    expect(usableForMarking({ name: 'models/gemini-3.8-flash' })).toBe(false);
  });

  /**
   * The count, as a whole. A change to the denylist that quietly halves the
   * list would pass every test above that still happened to name a survivor.
   */
  it('offers fifteen of the forty-five the key listed', () => {
    const catalogue = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-pro-preview-tts',
      'gemma-4-26b-a4b-it',
      'gemma-4-31b-it',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-pro-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash-image',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview-customtools',
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-flash-lite',
      'gemini-3-pro-image-preview',
      'gemini-3-pro-image',
      'nano-banana-pro-preview',
      'gemini-3.1-flash-image-preview',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-nano-banana-2.1',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-omni-flash-preview',
      'gemini-omni-1.1-flash',
      'gemini-3.5-transcribe',
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'lyria-3-clip-preview',
      'lyria-3-pro-preview',
      'lyria-3.5',
      'gemini-3.1-flash-tts-preview',
      'gemini-3.8-flash-tts',
      'gemini-3.8-flash-lite-tts',
      'gemini-robotics-er-2-preview',
      'gemini-2.5-computer-use-preview-10-2025',
      'antigravity-preview-05-2026',
      'antigravity-preview-09-2026',
      'antigravity-preview-latest',
      'deep-research-max-preview-04-2026',
      'deep-research-preview-04-2026',
      'deep-research-pro-preview-12-2025',
    ];

    expect(catalogue).toHaveLength(45);
    expect(catalogue.map((id) => model(id)).filter(usableForMarking)).toHaveLength(15);
  });
});
