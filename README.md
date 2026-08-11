# Margin — מרג'ין

A teacher-facing web app for reviewing long-form written assignments.

Students hand their work in the way they already do — into a shared Google
Drive folder. There is no student-facing app. Margin pulls the work out of
Drive, and the teacher reviews it by adding **inline comments in the margin of
the document itself**, the way she would in Google Docs comment mode. The AI
drafts the first pass of those comments in her own writing style, and learns
from every edit she makes to them.

The entire interface is Hebrew and right-to-left.

---

## Status

| Phase | Scope                                                         | State   |
| ----- | ------------------------------------------------------------- | ------- |
| 1     | Project setup, data model, SQL schema, routed shell           | ✅ done |
| 2     | Core screens (dashboard, submissions, review, courses, style) | ✅ done |
| 3     | Google Drive integration                                      | ✅ done |
| 4     | AI feedback engine, learning loop, grading forms, email       | next    |
| 5     | Reliability / authenticity module                             | —       |

`DataStore` starts out holding the seeded records in
`src/app/core/mock/seed-data.ts` and takes real ones from `SyncService` as they
arrive from Drive. Both are the same model types, so the screens can't tell
them apart.

Persistence is still the open piece: synced records live in memory, and the
watched folder id is the only thing written to `localStorage`. Writing these
through Supabase is a matter of saving the same records — nothing needs
reshaping.

Grading forms and student email are still placeholders — they belong to
Phase 4.

---

## Running it locally

```bash
npm install
npm start
```

Then open <http://localhost:4200>.

Supabase credentials live in `src/environments/`. Out of the box they hold
placeholders, and `SupabaseService.isConfigured` is `false` — the app runs
fine, it just has no live data. Fill in
`src/environments/environment.development.ts` with your project's URL and anon
key (Supabase dashboard → Project Settings → API) to connect.

Other scripts:

```bash
npm run build
npm test
```

---

## Connecting Google Drive

The Drive integration needs three things set up once, outside this repo.

**1. Enable the APIs.** In the Google Cloud project behind your OAuth client,
enable both **Google Drive API** and **Google Docs API**. Drive alone is not
enough — its plain-text export throws away the headings the review screen
groups by, so the document itself is read through the Docs API.

**2. Configure the Google provider in Supabase.** Authentication → Providers →
Google, with your client id and secret. Add the redirect URI Supabase gives you
to the OAuth client's authorised redirects.

**3. Grant the scopes.** Both are read-only:

```
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/documents.readonly
```

Then, in the app: **קורסים** → **חיבור לגוגל**, and paste the folder's Drive URL
into **בחירת תיקייה**. The folder is verified before it is saved, so a mistyped
id says so rather than looking like an empty folder.

### How a file becomes a submission

`SyncService` lists the watched folder and, for each file:

- **Works out whose it is.** The owning Google account is checked against
  `Student.drive_account_email` first; failing that, the file name has to
  contain every part of exactly one student's name. Anything matching neither
  is _reported_, not guessed at — attributing a paper to the wrong student is
  worse than asking. Unattributed files show up in the sync line.
- **Captures the metadata verbatim.** Owner, creator, created and modified
  times, and the full revision list land on the submission, with the untouched
  API payloads in `drive_metadata_raw`. Phase 3 draws no conclusions from any
  of it; Phase 5 does. Worth knowing: Drive's revision list for a Google Doc is
  much coarser than the editor's own version history, so the snapshot carries a
  `revisions_truncated` flag rather than letting a short list read as evidence.
- **Extracts the text, for Google Docs only.** A `.docx` sitting in Drive keeps
  its metadata but gets `document_blocks: null` — a mangled approximation of
  the text would be worse than none.

On a later sync, a file whose `modifiedTime` hasn't moved is skipped entirely.
When it has moved, what happens depends on whether the teacher has already sent
notes: if she has, the edit opens a **new round** so the round she annotated is
never overwritten; if she hasn't, the current round's text is refreshed in
place, because there is no history to protect yet.

### Extraction and the anchors

`docs-extract.ts` is written around one constraint: annotation offsets are
character positions into `block.text`, so extraction must not quietly rewrite
the text. It does **not** collapse runs of spaces, trim inside a paragraph,
normalise non-breaking spaces, or reformat Latin/numeric notation — `(r = .42,
p < .01)` has to arrive exactly as written or the bidi isolation has nothing to
isolate. The only edits are dropping the newline Docs appends to every
paragraph, and mapping two control characters (soft line break, page break) to
`\n` one-for-one so no offset shifts. There are tests for each of those.

Heading levels are the one place extraction has to make a judgement. Students
are inconsistent — some use `HEADING_1` for sections under a `TITLE`, some use
`HEADING_2` under a `HEADING_1` title. Rather than a fixed table, the
_shallowest heading depth that occurs more than once_ is taken to be the section
level: a depth used repeatedly is structure, a depth used once is a title.
`TITLE` and `SUBTITLE` never compete for it. That is what keeps the review
screen's grouping working across both conventions.

---

## Applying the database schema

The schema lives in `supabase/migrations/`. With the
[Supabase CLI](https://supabase.com/docs/guides/cli) linked to your project:

```bash
supabase db push
```

Or paste the contents of the migration into the SQL editor in the Supabase
dashboard.

---

## Project structure

```
src/
  app/
    core/
      models/        TypeScript interfaces — one file per entity group
      data/          the in-memory store the screens read from
      drive/         OAuth, the Drive/Docs clients, extraction, sync
      mock/          seeded records the store starts out holding
      presentation/  model records → what the screens actually show
      navigation.ts  the nav destinations, shared by rail and tab bar
      supabase/      the single Supabase client + auth signals
      viewport.ts    the one breakpoint that JS has to know about
    features/        one folder per routed screen
    shared/ui/       small presentational components (icon, page header)
  environments/      Supabase URL + anon key
  styles/            design tokens, base reset, shared primitives
supabase/
  migrations/        SQL schema with RLS policies
```

### Model conventions

Model fields use `snake_case`, matching the Postgres columns exactly, so rows
from `supabase-js` are usable as-is with no mapping layer.

The **teacher is the tenant**. Root tables (`courses`, `students`,
`teacher_style_examples`, `learning_feedback_logs`) carry `teacher_id`
referencing `auth.users`; every other table inherits ownership through a
parent. RLS resolves that chain through the `owns_course` / `owns_submission`
helper functions, so each policy stays a one-liner. Students never
authenticate — there is no student app, so there are no student-facing
policies.

### The entities, and why they exist

| Model                                      | Purpose                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `Course`, `CourseRule`, `CourseMaterial`   | The knowledge base the AI reasons from: her rules, syllabus, model work, example corrections |
| `Student`, `Assignment`                    | Who submits, and what they submit against                                                    |
| `Submission`                               | One student's work on one assignment, across **all** its revision rounds                     |
| `SubmissionRound`                          | One revision cycle, with its own copy of the document — history is never overwritten         |
| `Annotation`                               | An inline comment anchored to a text span, with AI-vs-teacher provenance and a status        |
| `GradingFormCategory` / `GradingFormEntry` | The teacher's internal grading form, organised under categories learned from past years      |
| `StudentGradingForm`                       | The year-end student-facing form — separate, because the wording differs                     |
| `TeacherStyleExample`                      | Samples of her real writing, used to teach the model her voice                               |
| `LearningFeedbackLog`                      | Every accept / edit / dismiss, before and after — the training signal                        |
| `StudentEmail`                             | A generated message with phrasing options, never sent without approval                       |
| `ReliabilityCheck`                         | Authenticity signals from Drive metadata and text similarity (Phase 5)                       |

Two shapes worth calling out:

- **The revision cycle is iterative.** `SubmissionStatus` is
  `new → in_review → notes_sent → student_revised → resubmitted → finalized`,
  and it can loop. Comments carry `resolved_in_round`, so a later round can
  show that an earlier note was addressed.
- **Anchors survive edits.** `TextAnchor` stores the block id, character
  offsets _and_ the quoted text, so a comment can be re-located after the
  student rewrites the paragraph around it.

---

## Design direction

Calm and uncluttered. This is a trust-building tool for one teacher, not a
consumer app and not an admin dashboard. The working rule for every screen:
**one primary focus, everything secondary behind progressive disclosure**, and
plain Hebrew instead of status codes.

- **Palette** — "ink on paper": cool, slightly green-grey paper, deep pine
  accent, muted honey for annotated spans. Defined in `src/styles/_tokens.scss`.
- **Type** — Frank Ruhl Libre (Hebrew serif) for document and display text,
  Assistant (Hebrew sans) for UI. Both are Hebrew-first typefaces, so the
  letterforms are designed rather than adapted.
- **RTL** — `dir="rtl" lang="he"` at the root, and all layout uses CSS logical
  properties (`padding-inline`, `inset-inline-start`, `border-inline-end`), so
  the reading flow is genuinely right-to-left rather than a mirrored LTR
  layout. Navigation avoids directional glyphs for the same reason. Numbers,
  dates and Latin file names are isolated with `.ltr` / `.bidi-isolate` so they
  don't scramble the bidi flow.
- **Mobile-first** — every breakpoint is `min-width`, so the 375px layout is
  the base. Navigation is a bottom tab bar with four destinations plus "עוד";
  the desktop rail only appears at 1024px, on the inline-start (right) edge.
- **Category colour-coding** — each comment category owns a hue, declared once
  in `src/styles/_categories.scss` as four custom properties (`--k-ink`,
  `--k-wash`, `--k-soft`, `--k-fg`). A highlight in the document, its comment
  card and its legend chip all read the same variables, so they cannot drift
  apart. Submission statuses work the same way, grouped by who holds the work:
  amber waits on the teacher, pine is in progress, blue is with the student,
  grey is done.

### The review screen

The core screen, and the one worth reading the code for.

Comments are anchored by character offset into a block's plain text, never
baked into pre-marked HTML — `renderBlock()` slices the text at each anchor at
render time. That is what lets a comment survive the student rewriting the
paragraph around it, and it is why dismissing a comment removes the highlight
from the document rather than leaving a dead span.

Two more things happen at render time rather than in the data:

- **Sections** are derived from the document's own level-2 headings
  (`sectionsOf()`), because a real Drive document is the only structure Phase 3
  can count on. Comments are grouped by section and collapsed, so a paper with
  forty notes doesn't arrive as one flat list.
- **Bidi isolation** is detected, not marked up: `splitLtrRuns()` finds runs
  containing Latin letters and isolates them, so `(r = .42, p < .01)` keeps its
  brackets the right way round inside Hebrew. Sentence-final punctuation is
  trimmed back out of the isolate so it stays with the Hebrew sentence.

Desktop renders comment bubbles in a margin column beside the document; mobile
renders a grouped list below it and opens a tapped highlight in a bottom
sheet. These are genuinely different markup, not one hidden by CSS — hence
`core/viewport.ts`.
