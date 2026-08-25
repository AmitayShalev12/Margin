/**
 * Just enough of the ZIP format to open a `.docx`.
 *
 * A Word document is a ZIP holding XML parts, so reading her old marked-up
 * papers means reading a ZIP. That is normally a library's job — this is a
 * hundred lines instead, because the alternative is a dependency carrying a
 * general-purpose archiver into a bundle that needs to open two files out of
 * one archive, and because `DecompressionStream` does the only hard part.
 *
 * Deliberately narrow: it reads the central directory, finds entries by name,
 * and inflates them. No writing, no encryption, no ZIP64, no spanning. An
 * archive that needs any of those is reported rather than half-read.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Stored and deflated. Every other method is refused by name. */
const STORED = 0;
const DEFLATED = 8;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Finds the end-of-central-directory record.
 *
 * It sits at the very end unless the archive carries a trailing comment, so
 * the tail is scanned backwards. The comment length field is two bytes, which
 * bounds the search at 64KB plus the record itself.
 */
function findEocd(view: DataView): number {
  const maxComment = 0xffff;
  const start = Math.max(0, view.byteLength - maxComment - 22);

  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new ZipError('Not a ZIP archive: no end-of-central-directory record');
}

function readEntries(view: DataView): Map<string, Entry> {
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  if (offset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }

  const entries = new Map<string, Entry>();
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('Damaged ZIP: central directory entry expected');
    }

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);

    const name = decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength),
    );

    entries.set(name, {
      name,
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  // `deflate-raw` rather than `deflate`: ZIP stores the deflate payload with
  // no zlib header, and asking for the wrong one fails on the first byte.
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The named parts of an archive, as text.
 *
 * Asked for by name rather than enumerated: a `.docx` holds fonts, images and
 * settings this app has no business reading, and naming the two parts it wants
 * keeps it from accidentally growing an appetite for the rest.
 */
export async function readZipParts(
  data: ArrayBuffer,
  wanted: readonly string[],
): Promise<Map<string, string>> {
  const view = new DataView(data);
  const entries = readEntries(view);
  const decoder = new TextDecoder();
  const parts = new Map<string, string>();

  for (const name of wanted) {
    const entry = entries.get(name);
    if (!entry) continue;

    if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_SIGNATURE) {
      throw new ZipError(`Damaged ZIP: no local header for ${name}`);
    }

    // The local header repeats the name and extra fields, and its extra field
    // is often a different length from the central one — so the data offset
    // has to be computed from the local header, never from the central entry.
    const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
    const start = entry.localHeaderOffset + 30 + nameLength + extraLength;

    const raw = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize);

    if (entry.method === STORED) {
      parts.set(name, decoder.decode(raw));
    } else if (entry.method === DEFLATED) {
      parts.set(name, decoder.decode(await inflate(raw)));
    } else {
      throw new ZipError(`Unsupported compression method ${entry.method} for ${name}`);
    }
  }

  return parts;
}
