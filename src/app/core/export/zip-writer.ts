/**
 * A minimal ZIP writer, which is what a `.docx` actually is.
 *
 * The counterpart to `core/import/zip.ts`, which reads them. Together they are
 * maybe two hundred lines and no dependency — a library for this would be a
 * megabyte and a supply chain, on a project whose whole job is handling other
 * people's students' unpublished work.
 *
 * Stores rather than deflates. `CompressionStream` exists, but it is async and
 * the saving on a two-page form is a few kilobytes; Word reads stored entries
 * perfectly well, and a synchronous writer is one that cannot half-finish.
 */

/** The standard CRC-32 table, built once. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes — `word/document.xml`. */
  name: string;
  data: string | Uint8Array;
}

/**
 * MS-DOS packed date and time, which is the only timestamp ZIP has.
 *
 * Two seconds of resolution and no year before 1980. Passed in rather than
 * read from the clock so an export is reproducible and a test can assert on
 * the bytes.
 */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** Grows on demand, so no caller has to size the archive in advance. */
class Bytes {
  private buffer = new Uint8Array(1024);
  length = 0;

  private room(extra: number) {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  u16(value: number) {
    this.room(2);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
  }

  u32(value: number) {
    this.room(4);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
    this.buffer[this.length++] = (value >>> 16) & 0xff;
    this.buffer[this.length++] = (value >>> 24) & 0xff;
  }

  raw(bytes: Uint8Array) {
    this.room(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  done(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

export function writeZip(entries: readonly ZipEntry[], at: Date): Uint8Array {
  const utf8 = new TextEncoder();
  const { time, date } = dosStamp(at);
  const out = new Bytes();

  const written = entries.map((entry) => {
    const name = utf8.encode(entry.name);
    const data = typeof entry.data === 'string' ? utf8.encode(entry.data) : entry.data;
    const offset = out.length;

    out.u32(0x04034b50);
    out.u16(20); // version needed
    // Bit 11 declares the name is UTF-8. Hebrew never appears in these paths,
    // but a reader that guesses at the encoding is a reader that can be wrong.
    out.u16(0x0800);
    out.u16(0); // stored
    out.u16(time);
    out.u16(date);
    const sum = crc32(data);
    out.u32(sum);
    out.u32(data.length);
    out.u32(data.length);
    out.u16(name.length);
    out.u16(0); // no extra field
    out.raw(name);
    out.raw(data);

    return { name, size: data.length, crc: sum, offset };
  });

  const directoryAt = out.length;

  for (const entry of written) {
    out.u32(0x02014b50);
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0x0800);
    out.u16(0);
    out.u16(time);
    out.u16(date);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(entry.offset);
    out.raw(entry.name);
  }

  const directorySize = out.length - directoryAt;

  out.u32(0x06054b50);
  out.u16(0); // this disk
  out.u16(0); // disk holding the directory
  out.u16(written.length);
  out.u16(written.length);
  out.u32(directorySize);
  out.u32(directoryAt);
  out.u16(0); // no comment

  return out.done();
}
