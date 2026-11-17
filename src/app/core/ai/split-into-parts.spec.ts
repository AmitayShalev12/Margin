import { splitIntoParts } from './annotation-generator';

const paragraph = (count: number) => ({ type: 'paragraph', text: Array(count).fill('מילה').join(' ') });
const heading = (text: string) => ({ type: 'heading', text });

describe('splitIntoParts', () => {
  it('leaves a paper of ordinary length whole', () => {
    const blocks = [heading('מבוא'), paragraph(1000), paragraph(1500)];
    expect(splitIntoParts(blocks)).toEqual([blocks]);
  });

  it('cuts a long paper into parts that together are the whole paper, in order', () => {
    const blocks = Array.from({ length: 40 }, () => paragraph(300));
    const parts = splitIntoParts(blocks);

    expect(parts.length).toBe(5);
    expect(parts.flat()).toEqual(blocks);
    for (const part of parts) {
      const words = part.reduce((sum, b) => sum + b.text.split(' ').length, 0);
      expect(words).toBeLessThanOrEqual(2500);
    }
  });

  it('keeps a heading with the text under it', () => {
    const blocks = [paragraph(2400), heading('שיטה'), paragraph(2400)];
    const parts = splitIntoParts(blocks);

    expect(parts.length).toBe(2);
    expect(parts[1][0]).toEqual(heading('שיטה'));
  });

  it('gives one very long paragraph a part of its own instead of cutting it', () => {
    const blocks = [paragraph(500), paragraph(4000), paragraph(500)];
    const parts = splitIntoParts(blocks);

    expect(parts.flat()).toEqual(blocks);
    expect(parts.some((part) => part.length === 1 && part[0] === blocks[1])).toBe(true);
  });
});
