import { isMarkerEditBatch } from './drive-api';
import {
  MARKER_HEX,
  MAX_MARKER,
  isMarker,
  markerChar,
  markerColour,
  markerNumber,
} from './markers';

/**
 * Margin now adds characters to a student's paper. This file is the argument
 * that it cannot do anything else.
 */

const DOC = 'https://docs.googleapis.com/v1/documents/abc123:batchUpdate';

describe('the marker glyph', () => {
  it('is one character, whatever the number', () => {
    for (const n of [1, 9, 20, 21, 35, 36, 50]) {
      const glyph = markerChar(n)!;
      expect(glyph).not.toBeNull();
      // One code point — the whole safety envelope rests on this.
      expect([...glyph].length).toBe(1);
      expect(markerNumber(glyph)).toBe(n);
    }
  });

  /**
   * A European digit inside right-to-left text forms its own left-to-right run
   * and drags the neutrals around it. The glyph carries its number without one.
   */
  it('contains no digit', () => {
    for (let n = 1; n <= MAX_MARKER; n++) {
      expect(markerChar(n)!).not.toMatch(/[0-9]/);
    }
  });

  it('refuses a number it cannot render as one character', () => {
    expect(markerChar(0)).toBeNull();
    expect(markerChar(51)).toBeNull();
    expect(markerChar(-1)).toBeNull();
    expect(markerChar(1.5)).toBeNull();
  });

  it('does not mistake ordinary writing for a marker', () => {
    for (const text of ['1', '(1)', 'א', 'נועה', '.', ' ', '', '①②']) {
      expect(isMarker(text)).toBe(false);
    }
    expect(isMarker('①')).toBe(true);
  });

  /** The same hues the screen already uses, not a second vocabulary. */
  it('carries the category colour from the stylesheet', () => {
    expect(MARKER_HEX.language).toBe('#2b6f6a');
    expect(MARKER_HEX.praise).toBe('#4a7a55');

    const rgb = markerColour('language');
    expect(rgb.red).toBeCloseTo(0x2b / 255, 5);
    expect(rgb.green).toBeCloseTo(0x6f / 255, 5);
    expect(rgb.blue).toBeCloseTo(0x6a / 255, 5);
  });
});

/**
 * The rule that replaced "never modify the document": every permitted edit is
 * bounded to a single character, and an insertion may only be a marker.
 */
describe('what may be sent to the document', () => {
  const insert = (text = '①', index = 12) => ({
    requests: [{ insertText: { location: { index }, text } }],
  });

  it('allows inserting one marker glyph', () => {
    expect(isMarkerEditBatch(DOC, insert())).toBe(true);
    expect(isMarkerEditBatch(DOC, insert('㊿'))).toBe(true);
  });

  it('allows colouring and removing exactly one character', () => {
    const style = {
      requests: [{ updateTextStyle: { range: { startIndex: 12, endIndex: 13 }, textStyle: {} } }],
    };
    const remove = {
      requests: [{ deleteContentRange: { range: { startIndex: 12, endIndex: 13 } } }],
    };

    expect(isMarkerEditBatch(DOC, style)).toBe(true);
    expect(isMarkerEditBatch(DOC, remove)).toBe(true);
  });

  /** The whole point: her writing cannot be inserted over, restyled or removed. */
  it('refuses anything that could reach her text', () => {
    const forbidden = [
      // Text that is not a marker.
      { insertText: { location: { index: 1 }, text: 'שלום' } },
      { insertText: { location: { index: 1 }, text: '① ' } },
      { insertText: { location: { index: 1 }, text: '①①' } },
      { insertText: { location: { index: 1 }, text: '[1]' } },
      // More than one character.
      { deleteContentRange: { range: { startIndex: 1, endIndex: 40 } } },
      { deleteContentRange: { range: { startIndex: 1, endIndex: 3 } } },
      { updateTextStyle: { range: { startIndex: 1, endIndex: 60 }, textStyle: {} } },
      // Whole-document operations that cannot be bounded at all.
      { replaceAllText: { containsText: { text: 'הוכיחו' }, replaceText: 'הראו' } },
      { updateParagraphStyle: { range: { startIndex: 1, endIndex: 2 }, paragraphStyle: {} } },
      { replaceImage: { imageObjectId: 'i', uri: 'https://example.invalid/a.png' } },
      { acceptSuggestion: { suggestionId: 's' } },
      { deleteParagraphBullets: { range: { startIndex: 1, endIndex: 2 } } },
    ];

    for (const request of forbidden) {
      expect(isMarkerEditBatch(DOC, { requests: [request] })).toBe(false);
    }
  });

  it('refuses a destructive request hidden among marker edits', () => {
    const mixed = {
      requests: [
        { insertText: { location: { index: 12 }, text: '①' } },
        { deleteContentRange: { range: { startIndex: 1, endIndex: 900 } } },
      ],
    };

    expect(isMarkerEditBatch(DOC, mixed)).toBe(false);
  });

  it('refuses a request carrying a second key beside a permitted one', () => {
    const smuggled = {
      requests: [
        {
          insertText: { location: { index: 12 }, text: '①' },
          deleteContentRange: { range: { startIndex: 1, endIndex: 900 } },
        },
      ],
    };

    expect(isMarkerEditBatch(DOC, smuggled)).toBe(false);
  });

  it('refuses a zero-width or reversed range', () => {
    for (const range of [
      { startIndex: 12, endIndex: 12 },
      { startIndex: 13, endIndex: 12 },
      { startIndex: -1, endIndex: 0 },
    ]) {
      expect(isMarkerEditBatch(DOC, { requests: [{ deleteContentRange: { range } }] })).toBe(false);
    }
  });

  it('refuses marker edits aimed anywhere else', () => {
    for (const url of [
      'https://www.googleapis.com/drive/v3/files/abc123',
      'https://docs.googleapis.com/v1/documents/abc123',
      'https://docs.googleapis.com.evil.invalid/v1/documents/abc123:batchUpdate',
    ]) {
      expect(isMarkerEditBatch(url, insert())).toBe(false);
    }
  });
});

/**
 * Bidi: a marker sits inside Hebrew and next to Latin statistical notation.
 *
 * Measured in the DOM rather than reasoned about, the way the review screen's
 * bidi handling has been since Phase 2. The failure this guards against is not
 * theoretical — a European digit inside right-to-left text forms its own
 * left-to-right run and drags the neutral characters around it, so `(r = .42,
 * p < .01)` can come apart with a number beside it.
 */
describe('a marker inside right-to-left text', () => {
  const SENTENCE = 'נמצא קשר חיובי מובהק (r = .42, p < .01) בין המשתנים.';

  function render(text: string): HTMLElement {
    const host = document.createElement('div');
    host.setAttribute('dir', 'rtl');
    host.style.font = '16px serif';
    host.textContent = text;
    document.body.appendChild(host);
    return host;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * The characters, in the order they are actually read on screen. jsdom does
   * not lay text out, so this asserts the property that survives without a
   * layout engine: the marker adds exactly one code point and disturbs no
   * other character's order in the string the browser is handed.
   */
  it('adds one character and reorders nothing around it', () => {
    const marker = markerChar(3)!;
    const at = SENTENCE.indexOf('(r = .42');
    const marked = SENTENCE.slice(0, at) + marker + SENTENCE.slice(at);

    const plain = render(SENTENCE).textContent!;
    const withMarker = render(marked).textContent!;

    // Exactly one code point more.
    expect([...withMarker].length).toBe([...plain].length + 1);
    // The notation is intact, character for character.
    expect(withMarker).toContain('(r = .42, p < .01)');
    // And removing the marker again gives back the original exactly.
    expect(withMarker.split(marker).join('')).toBe(plain);
  });

  it('leaves the statistic contiguous wherever the marker is placed', () => {
    const marker = markerChar(7)!;

    for (const at of [0, 10, SENTENCE.indexOf('בין'), SENTENCE.length]) {
      const marked = SENTENCE.slice(0, at) + marker + SENTENCE.slice(at);
      const rendered = render(marked).textContent!;

      // The Latin run is never split by the insertion.
      expect(rendered).toContain('(r = .42, p < .01)');
      expect(rendered.split(marker).join('')).toBe(SENTENCE);
    }
  });

  /**
   * The reason the glyph carries no digit. A bracketed number would put an
   * EN run right beside the existing one, and the two would merge.
   */
  it('introduces no left-to-right run of its own', () => {
    for (let n = 1; n <= MAX_MARKER; n++) {
      const glyph = markerChar(n)!;
      // No European digits, no Latin letters — nothing with strong LTR
      // directionality that could join the notation beside it.
      expect(glyph).not.toMatch(/[0-9A-Za-z]/);
    }
  });
});
