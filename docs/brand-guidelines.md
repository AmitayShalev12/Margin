# Margin — Brand Guidelines v1.1

The design system as it exists in `src/styles`, written down. The tokens are the source of truth; this
document explains them and the rules around them. Three of those rules are enforced by
`src/app/design-system.spec.ts`, so breaking them fails the test suite rather than shipping silently.

## Quick Reference

| | |
|---|---|
| **Direction** | "Ink on paper" — cool, quiet, slightly green-grey paper, a deep pine accent, honey for annotated text |
| **Accent** | Pine `#1f5e5a` — and pine means *hers* |
| **Highlight** | Honey `#f6e7ba` — a span of her student's text that has a comment on it |
| **Type** | Heebo — one modern Hebrew sans for headings, documents, navigation and forms |
| **Language** | Hebrew, right-to-left, addressed to her in the feminine second person (את) |
| **Contrast** | Every text colour clears WCAG AA (4.5:1) on every background it sits on |

---

## 1. Color Palette

Every colour in a component stylesheet comes from a token in `src/styles/_tokens.scss`. The only other
place a literal colour may appear is `src/styles/_categories.scss`, the categorical palette below.

### Primary Colors

Pine is the accent and the primary action. On the scoring sheet it also marks what belongs to the
teacher: her reply, her turn in a discussion, the criteria only she can score.

| Token | Hex | Use |
|---|---|---|
| `--c-accent` | `#1f5e5a` | Primary buttons, links, focus rings, what is hers |
| `--c-accent-strong` | `#163f3c` | Hover on primary; text on a pine tint |
| `--c-accent-soft` | `#e3efec` | Pine tint: selected nav item, her turn, focus halo |
| `--c-accent-line` | `#bcd6d1` | Borders on pine-tinted surfaces |
| `--c-on-accent` | `#ffffff` | Text and icons on a solid pine fill |

### Secondary Colors

Honey marks annotated text in the document — the sentence a comment is about.

| Token | Hex | Use |
|---|---|---|
| `--c-mark` | `#f6e7ba` | Highlight behind an annotated span; text selection |
| `--c-mark-strong` | `#e7ce7f` | The underline beneath a highlight |
| `--c-mark-ink` | `#6a5417` | Text on a honey highlight |
| `--c-handled` | `#eef2ec` | Wash for a highlight she has already dealt with |

### Neutral Palette

| Token | Hex | Use |
|---|---|---|
| `--c-paper` | `#f5f6f3` | Page background |
| `--c-surface` | `#ffffff` | Cards, fields, panels |
| `--c-surface-sunk` | `#ecefe9` | Recessed areas: an expanded criteria list, default button fill |
| `--c-line` | `#e1e5dd` | A card's own border |
| `--c-line-strong` | `#c8cec4` | Field borders, ghost buttons |
| `--c-line-soft` | `#eef1ec` | The hairline between rows *inside* a card |
| `--c-ink` | `#141a1c` | Body text |
| `--c-ink-2` | `#3b464a` | Secondary emphasis, form labels |
| `--c-ink-3` | `#646e71` | Quiet text: hints, meta, counts, timestamps, placeholders |
| `--c-ink-4` | `#9aa2a4` | **Not for text.** Borders, fills and hover edges only |

`--c-line-soft` is lighter than `--c-line` on purpose: a list inside a card should read as one object,
not as a stack of boxes.

### Semantic Colors

| Token | Hex | Use |
|---|---|---|
| `--c-attention` / `-soft` | `#96582f` / `#f7ece2` | Needs her: drafts, warnings, the Pro-model cost notice |
| `--c-danger` / `-soft` | `#8c3b3b` / `#f7e9e9` | Something failed, or will be lost |
| `--c-ok` / `-soft` | `#3d6b4f` / `#e6efe8` | Saved, sent, done |

The categorical palette in `_categories.scss` gives each annotation kind (ניסוח, מבנה, מקורות, תוכן,
חיזוק, עיצוב) an `ink`, two tints and an `fg` text colour. Every `fg` passes AA on its own tints. Neutral
entries reference the ink and paper tokens rather than copying their hex.

### Accessibility

Measured, not estimated. "Paper", "surface" and "sunk" are the three backgrounds text sits on; sunk is
the darkest and the hardest test.

| Text | on paper | on surface | on sunk |
|---|---|---|---|
| `--c-ink` | 16.21 | 17.58 | 15.15 |
| `--c-ink-2` | 8.96 | 9.72 | 8.37 |
| `--c-ink-3` | 4.83 | 5.24 | **4.51** |
| `--c-accent` | 6.90 | 7.48 | 6.44 |

Semantic colours on their own tints: attention 4.83, danger 6.34, ok 5.24, and the honey highlight's
text on honey 5.90. On white: attention 5.62, danger 7.49.

`--c-ink-4` measures about 2.5:1 and is never used for text. Anything meant to read quieter than
`--c-ink-3` gets there with size and weight, not by fading below readability.

---

## 2. Typography

### Font Stack

One family, Heebo, drawn for Hebrew first and hinted to stay crisp at 13px. It replaced Frank Ruhl
Libre (a book serif, which a usability review said read like religious print) and Assistant, so
headings, documents, navigation, buttons and forms now share one clean, modern voice. Headings use
weight 600: a sans at the serif's 500 sits too close to body text.

```css
--font-heading: 'Heebo';  /* --font-doc: documents, page and section titles */
--font-body: 'Heebo';     /* --font-ui: everything else */
--font-mono: ui-monospace, 'Cascadia Mono', 'Consolas', monospace;  /* model ids, raw output */
```

### Type Scale

| Token | Size | Use |
|---|---|---|
| `--fs-2xl` | 28px | Page title, desktop |
| `--fs-xl` | 22px | Page title, mobile |
| `--fs-lg` | 18px | Section title (`.section-title`) |
| `--fs-md` | 16px | Document text |
| `--fs-base` | 15px | Body and UI text, buttons, fields |
| `--fs-sm` | 13px | Hints, meta, labels, small buttons, sub-titles |
| `--fs-xs` | 12px | Chips and tags |

Line heights: `--lh-tight` 1.25 for headings, `--lh-normal` 1.55 for UI, `--lh-doc` 1.9 for documents,
which get read closely.

### Heading hierarchy

| Level | Element | Look |
|---|---|---|
| Page title | `app-page-header` (`h1`) | 22 → 28px, weight 600 |
| Section | `h2.section-title` | 18px, weight 600 |
| Sub-group | `h3.sub-title` | 13px, weight 600, `--c-ink-2` |
| Quiet label | `.section-label` | 13px, weight 600, `--c-ink-3` |

---

## 3. Logo Usage

### Variants

The wordmark is the word **Margin** in Heebo, weight 700, always left-to-right, with the
Hebrew tagline **הערות בשוליים** beneath it in the desktop nav rail. On mobile the wordmark sits in the
top bar alone.

### Don'ts

- Don't set it in any other face
- Don't mirror it for RTL — it is a Latin word and reads left to right
- Don't recolour it; it is `--c-ink`

---

## 4. Voice & Tone

### Brand Personality

| Trait | What it means here |
|---|---|
| **Quiet** | The app recedes and her students' work is the foreground. No celebration, no exclamation marks. |
| **Honest** | It never claims what it did not do. A criterion nobody scored says טרם, never `0/4`. |
| **Hers** | Her words and decisions come first. Anything the system wrote says so. |
| **Precise** | Names, not ids. Counts in correct Hebrew. The step that fixes a problem, not just its name. |

### Voice Chart

| | Do | Don't |
|---|---|---|
| Address | את — "אפשר לבחור", "שאישרת" | Impersonal or masculine forms |
| Failure | Say what will fix it: "צריך לטעון קרדיטים ב־AI Studio — המתנה לא תעזור כאן." | "נסי שוב" when waiting changes nothing |
| Its own text | "ההסבר של המערכת" | Presenting the model's words as hers |
| Missing data | "טרם", "עוד לא נבדק" | A zero that means "nothing yet" |

### Tone by Context

| Context | Tone | Example |
|---|---|---|
| Empty state | Calm, says what will fill it | "עוד אין תלמידות. אפשר להוסיף אותן במסך הקורסים, או לחבר את הדרייב והן ייקלטו מהתיקיות." |
| Waiting on her | Specific, names the next move | "נשארו רק הסעיפים שרק את מנקדת: עריכה ועימוד." |
| Cost or risk | Stated plainly, stays on screen | "מודל Pro עולה פי כמה ממודל Flash, וכל בדיקה קוראת עבודה שלמה." |
| Error | What happened, then what to do | "זה לא נראה כמו קישור לתיקייה בדרייב. אפשר להעתיק את הכתובת מהדפדפן." |

### Counting in Hebrew

A number before a noun is never `${n} קבצים`. Use `count()` from `core/presentation/count.ts` (or the
`count` pipe in templates). At one, the noun, the number word and the verb all change; two takes the
construct form.

```ts
count(n, { one: 'קובץ אחד שנקלט', two: 'שני קבצים שנקלטו', many: '# קבצים שנקלטו' })
count(n, { one: 'נמצאה הערה אחת', many: 'נמצאו # הערות' })   // verb first: # marks the number
```

### Prohibited Terms

| Avoid |
|---|
| A number before a plural at one: `1 קבצים`, `1 הערות` |
| A database id anywhere in a sentence |
| `0/4` for a criterion nobody has scored |
| "נסי שוב" for credits, quotas or a rejected key |
| A score she has not confirmed, presented as final |

### What to say instead

- A number and a noun: `count()`, so one and two read as Hebrew
- An id: the criterion's or the student's name
- Nothing scored yet: `טרם`
- A failure waiting will not fix: the specific step that will
- An unconfirmed score: marked `טיוטה`

---

## 5. Imagery Guidelines

### Icons

Line icons through `app-icon`, inheriting `currentColor`, sized 20–21px in navigation. No filled icons,
no illustration, no photography: the content is her students' writing.

---

## 6. Design Components

All of these are global, in `src/styles/_primitives.scss`. Component stylesheets compose them; they do
not redefine them. A modifier defined in one component's stylesheet does nothing anywhere else — Angular
scopes it — which is how `.btn-sm` and the form fields both silently failed before.

### Buttons

| Class | Look | Use |
|---|---|---|
| `.btn` | 44px tall, `--r-md`, sunk fill | Base; the comfortable touch target |
| `.btn-primary` | Pine fill, white text | The one main action |
| `.btn-ghost` | Transparent, `--c-line-strong` border | Secondary actions |
| `.btn-plain` | Pine text, no border | Tertiary actions, inline |
| `.btn-sm` | 36px, `--fs-sm` | Inside cards and rows |

`<a class="btn">` is fine for a button that navigates; `.btn` removes the link underline.

### Form fields

```html
<label class="field">
  <span class="label">קישור לתיקייה בדרייב</span>
  <input class="control" />
</label>
```

`.control` is 44px to match `.btn`, with a `--c-line-strong` border, `--r-md` corners and a pine focus
ring. `.label` is scoped to `.field`, because `.label` is also the caption class of the `app-working`
spinner.

### Picker

`.picker` is a row of `.pick` pills choosing one of several (which student, which draft), 36px like
`.btn-sm`, `.is-active` on the chosen one and an optional `.pick-count` inside. It scrolls sideways on a
phone instead of wrapping.

### Dialogs

The quick actions ("הוספת תלמידה", "הוספת קורס") open once-only dialogs that live in the app shell
and are opened from anywhere through `QuickActions`. They are native `<dialog>` elements styled by the
global `.modal` primitives (`.modal-form`, `.modal-actions`, `.modal-choices`, `.check`, `.modal-done`,
`.modal-error`, `.modal-clash`): the browser traps focus, closes on Escape and draws the backdrop.

A page's quick action goes in its header, projected into `app-page-header`:

```html
<app-page-header title="התלמידות שלי">
  <button class="btn btn-primary btn-sm">הוספת תלמידה</button>
</app-page-header>
```

### Navigation

The sidebar is grouped — סקירה, תלמידות ועבודות, הקורס, הגדרות — and each group folds on its own; the
whole rail folds to icons. Open places are kept as tabs above the page (tablet and up), one per
section and one per paper under review. On a phone, the bottom bar holds four places and "עוד"
holds the same groups as the sidebar.

### Spacing Scale

4px base: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 ·
`--s-10` 40 · `--s-12` 48.

### Border Radius

| Token | Size | Use |
|---|---|---|
| `--r-sm` | 6px | Small marks, focus outline |
| `--r-md` | 10px | Buttons, fields, panels |
| `--r-lg` | 14px | Cards |
| `--r-full` | 999px | Chips, pills, the floating back bar |

### Elevation

Soft and paper-like, never heavy: `--sh-1` for cards, `--sh-2` for raised bars, `--sh-3` for anything
floating over content (the back bar, the mobile sheet).

### Enforced by the test suite

`src/app/design-system.spec.ts` fails, naming the file and line, if:

1. a `var(--x)` is used that no file defines;
2. a component stylesheet contains a raw colour literal;
3. text is set in `--c-ink-4`.

---

## Changelog

| Version | Date | Changes |
|---|---|---|
| 1.1 | 2026-11-03 | Heebo replaces Frank Ruhl Libre and Assistant. Dialog primitives, page-header actions, grouped and foldable navigation, tabs. |
| 1.0 | 2026-10-29 | Written down from the codebase after a consistency audit. Form fields, section headings and the soft divider made global; grading form moved onto the token vocabulary; `--c-ink-3` darkened to pass AA; `--c-ink-4` reserved for non-text; Hebrew counts given a helper; three rules enforced by test. |
