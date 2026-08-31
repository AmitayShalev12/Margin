import { readZipParts } from '../import/zip';
import { crc32, writeZip } from './zip-writer';

/**
 * The writer, checked against the reader this repo already has.
 *
 * A round trip is the assertion worth making. Word is the real consumer and it
 * is not here to ask, so the next best evidence is an independently written
 * parser — one that walks the central directory, follows the offsets into the
 * local headers and would fail on exactly the byte-layout mistakes that are
 * easy to make here — reading back what was written.
 */

const AT = new Date('2026-08-31T10:30:00Z');

describe('CRC-32', () => {
  /** The standard check value: the digest of "123456789". */
  it('agrees with the published check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('gives zero for nothing', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('writing an archive', () => {
  it('reads back through the reader, part for part', async () => {
    const zip = writeZip(
      [
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'word/document.xml', data: '<w:document>שלום</w:document>' },
      ],
      AT,
    );

    const parts = await readZipParts(zip.buffer as ArrayBuffer, [
      '[Content_Types].xml',
      'word/document.xml',
    ]);

    expect(parts.get('[Content_Types].xml')).toBe('<Types/>');
    // The part that actually matters for a Hebrew form: multi-byte text has to
    // survive the length fields, which count bytes and not characters.
    expect(parts.get('word/document.xml')).toBe('<w:document>שלום</w:document>');
  });

  it('survives content long enough to grow the buffer several times', async () => {
    const long = 'א'.repeat(20_000);
    const zip = writeZip([{ name: 'word/document.xml', data: long }], AT);

    const parts = await readZipParts(zip.buffer as ArrayBuffer, ['word/document.xml']);
    expect(parts.get('word/document.xml')).toBe(long);
  });

  it('starts with the local-header signature and ends with the directory one', () => {
    const zip = writeZip([{ name: 'a.xml', data: 'x' }], AT);

    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...zip.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  /**
   * The same inputs must give the same bytes. The timestamp is a parameter for
   * this reason — a writer that reaches for the clock cannot be tested on its
   * output, only on its behaviour.
   */
  it('is reproducible', () => {
    const once = writeZip([{ name: 'a.xml', data: 'x' }], AT);
    const twice = writeZip([{ name: 'a.xml', data: 'x' }], AT);

    expect([...once]).toEqual([...twice]);
  });

  it('writes an empty archive without inventing an entry', () => {
    expect(writeZip([], AT).length).toBe(22);
  });
});
