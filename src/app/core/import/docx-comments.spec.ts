import { DocxError, readDocxComments } from './docx-comments';

/**
 * Read against real bytes, not a mock.
 *
 * The whole point of this module is that it opens a file Word wrote, so a test
 * that hands it a pre-parsed object would prove nothing about the part that
 * can actually break. Each case below builds an honest ZIP — local headers,
 * central directory, end record — and lets the parser find its own way in.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// -- a minimal ZIP writer, for the fixtures only -----------------------------

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** Stored entries only — compression is the parser's job, not the fixture's. */
function zip(files: Record<string, string>): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const sum = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, sum, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

// -- the fixtures ------------------------------------------------------------

function comments(entries: { id: string; author: string; text: string }[]): string {
  const body = entries
    .map(
      (c) =>
        `<w:comment w:id="${c.id}" w:author="${c.author}" w:date="2025-06-01T10:00:00Z">` +
        `<w:p><w:r><w:t>${c.text}</w:t></w:r></w:p></w:comment>`,
    )
    .join('');
  return `<?xml version="1.0"?><w:comments xmlns:w="${W}">${body}</w:comments>`;
}

/** A paragraph with a commented span in the middle of it. */
function document(before: string, anchored: string, after: string, id = '1'): string {
  return (
    `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p>` +
    `<w:r><w:t>${before}</w:t></w:r>` +
    `<w:commentRangeStart w:id="${id}"/>` +
    `<w:r><w:t>${anchored}</w:t></w:r>` +
    `<w:commentRangeEnd w:id="${id}"/>` +
    `<w:r><w:t>${after}</w:t></w:r>` +
    `</w:p></w:body></w:document>`
  );
}

function docx(files: Record<string, string>): ArrayBuffer {
  return zip({ '[Content_Types].xml': '<Types/>', ...files });
}

describe('reading comments out of a Word document', () => {
  it('reads the note and the sentence it was written about', async () => {
    const file = docx({
      'word/comments.xml': comments([
        { id: '1', author: 'רינה כהן', text: 'המשפט הזה ארוך מדי. אפשר לפצל לשניים.' },
      ]),
      'word/document.xml': document('בפרק זה ', 'נבחן הקשר בין המשתנים השונים', ' ונראה כי.'),
    });

    const { comments: found } = await readDocxComments(file);

    expect(found.length).toBe(1);
    expect(found[0].body).toBe('המשפט הזה ארוך מדי. אפשר לפצל לשניים.');
    expect(found[0].quote).toBe('נבחן הקשר בין המשתנים השונים');
    expect(found[0].author).toBe('רינה כהן');
  });

  /**
   * The pairing is the point. A note on its own teaches tone; a note beside
   * the sentence that provoked it teaches when she says it.
   */
  it('pairs each note with its own anchor, not the previous one', async () => {
    const body =
      `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p>` +
      `<w:commentRangeStart w:id="1"/><w:r><w:t>ראשון</w:t></w:r><w:commentRangeEnd w:id="1"/>` +
      `<w:r><w:t> באמצע </w:t></w:r>` +
      `<w:commentRangeStart w:id="2"/><w:r><w:t>שני</w:t></w:r><w:commentRangeEnd w:id="2"/>` +
      `</w:p></w:body></w:document>`;

    const file = docx({
      'word/comments.xml': comments([
        { id: '1', author: 'רינה', text: 'הערה א' },
        { id: '2', author: 'רינה', text: 'הערה ב' },
      ]),
      'word/document.xml': body,
    });

    const { comments: found } = await readDocxComments(file);
    expect(found.map((c) => [c.body, c.quote])).toEqual([
      ['הערה א', 'ראשון'],
      ['הערה ב', 'שני'],
    ]);
  });

  /** Word splits a sentence across runs wherever it likes. */
  it('joins a span Word split into several runs', async () => {
    const body =
      `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p>` +
      `<w:commentRangeStart w:id="1"/>` +
      `<w:r><w:t>הקשר בין </w:t></w:r><w:r><w:t>המשתנים</w:t></w:r>` +
      `<w:commentRangeEnd w:id="1"/></w:p></w:body></w:document>`;

    const file = docx({
      'word/comments.xml': comments([{ id: '1', author: 'רינה', text: 'לנסח מחדש' }]),
      'word/document.xml': body,
    });

    expect((await readDocxComments(file)).comments[0].quote).toBe('הקשר בין המשתנים');
  });

  it('keeps a comment that was never anchored, with no quote', async () => {
    const file = docx({
      'word/comments.xml': comments([{ id: '9', author: 'רינה', text: 'עבודה יפה בסך הכול.' }]),
      'word/document.xml': document('טקסט', 'אחר', 'לגמרי', '1'),
    });

    const { comments: found } = await readDocxComments(file);
    expect(found[0].body).toBe('עבודה יפה בסך הכול.');
    expect(found[0].quote).toBeNull();
  });

  /**
   * A paper marked by more than one person — a colleague, a co-teacher, or the
   * student herself. She is the only one who can say which are hers.
   */
  it('counts the authors so she can say which are hers', async () => {
    const file = docx({
      'word/comments.xml': comments([
        { id: '1', author: 'רינה', text: 'א' },
        { id: '2', author: 'רינה', text: 'ב' },
        { id: '3', author: 'מיכל', text: 'ג' },
      ]),
      'word/document.xml': document('a', 'b', 'c'),
    });

    expect((await readDocxComments(file)).authors).toEqual([
      { name: 'רינה', count: 2 },
      { name: 'מיכל', count: 1 },
    ]);
  });

  it('drops an empty comment rather than learning from it', async () => {
    const file = docx({
      'word/comments.xml': comments([
        { id: '1', author: 'רינה', text: '' },
        { id: '2', author: 'רינה', text: 'זו כן הערה' },
      ]),
      'word/document.xml': document('a', 'b', 'c'),
    });

    const { comments: found } = await readDocxComments(file);
    expect(found.map((c) => c.body)).toEqual(['זו כן הערה']);
  });

  /** Not an error: she picked a document she never marked up. */
  it('returns nothing for a document with no comments at all', async () => {
    const file = docx({ 'word/document.xml': document('a', 'b', 'c') });

    const { comments: found, authors } = await readDocxComments(file);
    expect(found).toEqual([]);
    expect(authors).toEqual([]);
  });

  it('says so in Hebrew when the file is not a Word document', async () => {
    const notAZip = new TextEncoder().encode('%PDF-1.7 this is a pdf').buffer;

    await expect(readDocxComments(notAZip)).rejects.toBeInstanceOf(DocxError);
    await expect(readDocxComments(notAZip)).rejects.toMatchObject({
      hebrew: expect.stringContaining('Word'),
    });
  });
});
