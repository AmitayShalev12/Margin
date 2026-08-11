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
