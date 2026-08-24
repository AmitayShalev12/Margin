/**
 * Record ids, generated client-side.
 *
 * Every `id` column in the schema is a `uuid`, so anything the app creates has
 * to be one from the start — a record given a friendly id could never be
 * persisted.
 */
export function newId(): string {
  // crypto.randomUUID needs a secure context, which jsdom does not guarantee.
  return (
    globalThis.crypto?.randomUUID?.() ??
    '00000000-0000-4000-8000-000000000000'.replace(/0/g, () =>
      Math.floor(Math.random() * 16).toString(16),
    )
  );
}

/**
 * A stable UUID derived from something that is already unique — a Drive file
 * id, a submission plus a round number.
 *
 * Derived rather than random because the schema enforces identity on the
 * natural key, not on `id`: `submissions` is unique on `drive_file_id` and
 * `submission_rounds` on `(submission_id, round_number)`. A random id would
 * make the same Drive file a *different* row on a second device, and the
 * upsert would hit the unique index instead of updating the row that is
 * already there.
 *
 * Four FNV-1a streams rather than a hash from `crypto.subtle`, which is async
 * and not guaranteed present under jsdom. This needs to be deterministic and
 * collision-free across a school's file ids, not cryptographic.
 */
export function derivedId(namespace: string, name: string): string {
  const input = `${namespace}:${name}`;
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  });

  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Version 5: derived from a name, not random. Postgres does not care, but
    // anyone reading a row should be able to tell these apart from newId().
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
