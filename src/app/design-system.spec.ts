/**
 * The design system, enforced rather than remembered.
 *
 * Every rule here was broken in shipped code before it was written down, and
 * each break was silent — the build passed, the screen rendered something, and
 * nothing said it was the wrong thing:
 *
 *  - grading-forms.scss used `--line`, `--muted`, `--bg`: names this project
 *    never defined. An undefined custom property makes `border: 1px solid
 *    var(--line)` fall back to currentColor, so the whole scoring sheet was
 *    drawn in ink-black borders. A typo'd `--accent` made one marker purple.
 *  - Stray hex values (a purple, three reds, four copies of one grey) meant a
 *    palette change would have missed them.
 *  - `--c-ink-4` carried 26 lines of real text at 2.2–2.6:1 contrast.
 *
 * See docs/brand-guidelines.md for the rules themselves.
 */

/**
 * The test runner is Node, so `fs` is there at runtime; the spec tsconfig
 * simply has no Node types. Imported dynamically so the type-checker never
 * sees the module name, rather than adding @types/node for one file.
 */
interface Fs {
  readFileSync(path: string, encoding: 'utf-8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
}
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as Fs;

// A module, so the top-level `await` above is allowed.
export {};

interface Source {
  path: string;
  lines: string[];
}

/** Every file under `dir` with one of `extensions`, comments stripped. */
function sources(dir: string, extensions: string[]): Source[] {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((name) => `${dir}/${name}`.replace(/\\/g, '/'))
    .filter((path) => extensions.some((ext) => path.endsWith(ext)))
    .filter((path) => !path.endsWith('.spec.ts'))
    .map((path) => ({ path, lines: withoutComments(path, fs.readFileSync(path, 'utf-8')) }));
}

/**
 * Comments removed but line numbers kept, so a failure points at the right
 * line. Prose about a token ("this used to say var(--line)") is not a use of
 * it, and the files here say exactly that kind of thing.
 */
function withoutComments(path: string, text: string): string[] {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (path.endsWith('.html')) out = out.replace(/<!--[\s\S]*?-->/g, blank);
  else
    out = out.replace(
      /(^|[^:])\/\/[^\n]*/g,
      (m, lead: string) => lead + blank(m.slice(lead.length)),
    );
  return out.split('\n');
}

function where(source: Source, index: number): string {
  return `${source.path}:${index + 1}  ${source.lines[index].trim()}`;
}

const ALL = sources('src', ['.scss', '.css', '.ts', '.html']);
const COMPONENT_STYLES = sources('src/app', ['.scss']);

describe('the design system', () => {
  it('defines every custom property it uses', () => {
    const defined = new Set<string>();
    for (const source of ALL) {
      for (const line of source.lines) {
        for (const m of line.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
      }
    }

    const undefinedUses: string[] = [];
    for (const source of ALL) {
      source.lines.forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!defined.has(m[1])) undefinedUses.push(`${m[1]}  at ${where(source, i)}`);
        }
      });
    }

    expect(undefinedUses, 'custom properties used but never defined').toEqual([]);
  });

  /**
   * Colours come from tokens. A literal in a component stylesheet is a colour
   * that does not move when the palette does — the old ink-3 survived in two
   * places exactly this way. The token file and the categorical palette are
   * where literals belong, and both live in src/styles, outside this scan.
   */
  it('keeps raw colour literals out of component stylesheets', () => {
    const literals: string[] = [];
    for (const source of COMPONENT_STYLES) {
      source.lines.forEach((line, i) => {
        if (/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/.test(line)) literals.push(where(source, i));
      });
    }

    expect(literals, 'use a token from _tokens.scss instead').toEqual([]);
  });

  /**
   * ink-4 measures about 2.5:1 — under every WCAG text threshold. It is for
   * borders, fills and hover edges. Text that should read quieter than ink-3
   * gets there by size and weight instead.
   */
  it('never sets text in the faintest ink', () => {
    const faint: string[] = [];
    for (const source of ALL) {
      source.lines.forEach((line, i) => {
        if (/(^|[\s;{])color\s*:\s*var\(--c-ink-4\)/.test(line)) faint.push(where(source, i));
      });
    }

    expect(faint, 'use --c-ink-3 for quiet text').toEqual([]);
  });
});
