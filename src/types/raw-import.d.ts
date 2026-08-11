/**
 * Vite inlines a module imported with `?raw` as its source text. Used by the
 * specs that assert one file's contents against another — for example that the
 * annotation kinds restated in the Edge Function still match the app's.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
