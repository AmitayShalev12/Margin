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

| Phase | Scope                                                         | State       |
| ----- | ------------------------------------------------------------- | ----------- |
| 1     | Project setup, data model, SQL schema, routed shell           | ✅ done     |
| 2     | Core screens (dashboard, submissions, review, courses, style) | ✅ done     |
| 3     | Google Drive integration                                      | ✅ done     |
| 4     | AI feedback engine, learning loop, grading forms, email       | in progress |
| 5     | Reliability / authenticity module                             | —           |

Phase 4 so far: **AI-drafted annotations** (below). The learning loop, grading
forms and student email are still to come.

`DataStore` starts out holding the seeded records in
`src/app/core/mock/seed-data.ts`, layers anything durable over them on boot,
and writes every change straight back out. Synced records and seeded ones are
the same model types, so the screens can't tell them apart.

### Persistence

Durable storage sits behind a `Repository` port with two adapters:

- **`SupabaseRepository`** — the real one. Every write is a plain upsert on the
  primary key, because the model's field names _are_ the column names. That is
  what makes a re-sync idempotent: the same Drive file updates its row instead
  of inserting a second.
- **`LocalRepository`** — browser storage, used only while the project still
  holds placeholder credentials, so the app is usable and a reload is
  non-destructive before it is configured. It holds records, never credentials.

Hydration runs as an app initializer, so the first screen renders with durable
records already in place rather than flashing the seed and correcting itself.
Persisted records win by id, which means review work on a _seeded_ submission
survives a reload exactly as work on a synced one does.

Writes are fire-and-forget — the signal updates immediately so the screen never
waits on the network — and a failure surfaces on `DataStore.persistError`
rather than being swallowed.

Two consequences worth knowing:

- Seed ids are real UUIDs, resolved through `seedId()`. The `id` columns are
  `uuid`, so a demonstration record with a friendly id could never be
  persisted; routing them through one function keeps the seed literals legible
  anyway.
- "Last synced" is not a record of its own. It is the most recent
  `last_synced_at` stamped on a submission, so it comes back with them.

`persistence.spec.ts` simulates a reload by tearing the injector down and
rebuilding it over the same storage — new `DataStore`, new signals — so
anything that comes back did so because it was persisted.

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

Drive's OAuth is owned by two Edge Functions rather than by the browser. The
refresh token — a long-lived key to a teacher's Drive — is stored in a
service-role-only table and never sent to the client, which receives only
short-lived access tokens minted on demand. Real students' work flows through
this, so it is worth understanding before changing any of it.

```
browser                    drive-auth (Edge Function)          Google
  │                              │                                │
  ├─ POST /start ───────────────►│ records single-use state       │
  │◄──────── { consent url } ────┤                                │
  ├─ follow url ─────────────────┼───────────────────────────────►│
  │                              │◄──── code ─────────────────────┤
  │                              ├─ exchange ────────────────────►│
  │                              │◄──── refresh + access token ───┤
  │◄──── 302 back to the app ────┤ stores refresh token           │
  │                                                                │
  ├─ POST /drive-token ─────────►│ refresh grant ────────────────►│
  │◄──── short-lived access token ┤                                │
```

**1. Enable the APIs.** In the Google Cloud project behind your OAuth client,
enable both **Google Drive API** and **Google Docs API**. Drive alone is not
enough — its plain-text export throws away the headings the review screen
groups by, so the document itself is read through the Docs API.

**2. Point the OAuth client at the function.** Its authorised redirect URI is
the callback, not the app:

```
https://<project-ref>.supabase.co/functions/v1/drive-auth/callback
```

Both scopes are read-only:

```
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/documents.readonly
```

**3. Deploy the functions with their secrets.**

```bash
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... MARGIN_FUNCTIONS_URL=https://<project-ref>.supabase.co/functions/v1 MARGIN_ALLOWED_ORIGINS=http://localhost:4200
```

```bash
supabase functions deploy drive-auth drive-token
```

`MARGIN_ALLOWED_ORIGINS` is the allow-list for both CORS and the post-consent
redirect — an open redirect there would hand Google's authorization code to
whoever asked for it, so it is checked rather than echoed.

`drive-auth` is deployed with `verify_jwt = false` (see `supabase/config.toml`)
because Google calls its callback with no Supabase session. Each route
authenticates itself instead: `start`, `status` and the delete verify the
caller's JWT, and `callback` is authenticated by the single-use state row it
redeems.

### Where the credential lives

|                     | Refresh token                           | Access token                         |
| ------------------- | --------------------------------------- | ------------------------------------ |
| Lifetime            | until revoked                           | ~1 hour, trimmed by 2 minutes        |
| Stored in           | `google_credentials`, service-role only | a private field on `GoogleDriveAuth` |
| Reaches the browser | never                                   | yes, in memory only                  |

`google_credentials` and `google_oauth_states` have RLS enabled with **no
policies at all**, which denies every anon and authenticated request, and their
grants are revoked as well. Do not add a policy to either table — the Edge
Functions reach them with the service role, which bypasses RLS.

Nothing credential-shaped is written to `localStorage` or `sessionStorage`, and
`google-auth.spec.ts` holds that line by spying on `Storage.prototype.setItem`
across a full mint and asserting nothing is written.

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

## Drafting annotations

The model call lives in the `annotate` Edge Function, so the API key never
reaches the browser — the same posture as the Drive credential.

```bash
supabase secrets set GEMINI_API_KEY=...
```

```bash
supabase functions deploy annotate
```

### The provider is a cost decision, and it lives in one file

`supabase/functions/_shared/model-config.ts` holds the provider, model, key
env var, endpoint and retry policy. `_shared/gemini.ts` is the adapter that
shapes requests and classifies responses. `annotate/index.ts` owns only the
environment, the HTTP call and the retry loop — swapping provider is an edit to
the config plus one new adapter, and nothing client-side moves.

It currently runs **`gemini-3.6-flash`** on Google AI Studio's free tier, which
needs no billing account. Two constraints that come with that:

- **Flash only.** Pro tiers are paid. The model string is asserted in
  `gemini-adapter.spec.ts` so an upgrade can't happen by accident.
- **Free tier means Google may use submitted content to improve their models.**
  Point this at seeded or synthetic documents only. Real student work should
  not go through it until someone decides to move to a paid tier. The request
  sets `store: false` so the interaction isn't persisted server-side, but that
  is a separate matter from training use.

The call uses the **Interactions API** (`POST /v1beta/interactions`), which
replaced `generateContent` and went GA in June 2026 — note if you are working
from older examples, the request shape and the schema's type casing both
differ. Structured output is enforced with
`response_format: { mime_type: 'application/json', schema }`, so the reply
arrives in the shape the client already parses rather than as prose.

Prompt caching was dropped in the move from Claude: `cache_control` was
Anthropic-specific, and at free-tier volumes the rate limit binds long before
cost does. The prompt is still ordered the right way for it — stable knowledge
base first, volatile document second — so reinstating caching on a paid tier is
marking the boundary, not restructuring. There's a `REVISIT` comment on the
knowledge-base builder.

### When it fails

Free-tier limits are per-project and only visible in AI Studio, so the function
reads what the API returns rather than tracking a hardcoded quota. Failures come
back as a code; the client turns it into Hebrew, the same split as `DriveError`:

| Code                | What she is told                                                              |
| ------------------- | ----------------------------------------------------------------------------- |
| `safety_blocked`    | part of the document couldn't be processed automatically — review it directly |
| `rate_limited`      | too many requests in a row, try again shortly (retried with backoff first)    |
| `daily_cap`         | the daily quota is spent, try tomorrow — **not** retried                      |
| `bad_response`      | the reply arrived truncated; retry                                            |
| `generation_failed` | anything else                                                                 |

`safety_blocked` earns its own message because SEL coursework legitimately
discusses distress and family difficulty, and a content filter will occasionally
stop on a perfectly ordinary paper. The teacher needs telling that the document
is fine and the automatic pass isn't.

One caveat worth knowing: Google documents safety filtering thoroughly for the
old `generateContent` shape but not for the Interactions API, which says only
that filtered content "results in modified output or status change". So
`looksSafetyBlocked()` scans for the vocabulary a filter would use rather than
matching one documented field, and a completed-but-empty reply is treated as a
block. A false positive costs a slightly wrong message on a batch that failed
anyway; missing it costs the teacher a useful explanation.

### Quotes in, offsets out

The function returns **quotes**, not offsets. The client locates each quote in
its own copy of the block text and builds the `TextAnchor` — the same shape
Phase 2 renders from and Phase 3 extracts for.

The rule is: a comment anchors to exactly the words it quoted, or it is thrown
away. Nothing searches approximately or trims to fit. `anchor-resolver.ts`
rejects a draft when the quote isn't in the named block, appears twice in it
(no way to know which was meant), names a block that doesn't exist, uses a
category the review screen has no colour for, or duplicates a span already
taken. Rejections are counted and shown to the teacher rather than silently
shortening the batch — a pass where half the quotes failed to resolve is a
signal about the generation, not something to hide.

**Anchors also refuse to bisect bidi-isolated notation.** An anchor that
started or ended part-way through `(r = .42, p < .01)` would split the isolate
in two when rendered and scramble it. Anchoring to the whole run, or around it,
is fine; cutting into it is rejected.

### Categories

The model may only use the seven kinds the app already models — the five
coloured ones plus `formatting` and `other`. `GENERATED_KINDS` in
`core/ai/contract.ts` is the single source of truth: the client sends it as
`allowed_kinds` and the function builds its JSON-schema enum from what it
receives, so there is no second list to drift.

### One confirmation per batch

Before the comments become hers to work through, the teacher reads one
plain-language restatement of what was flagged and why — stored on
`SubmissionRound.ai_summary`, confirmed by stamping `ai_summary_confirmed_at`.
Until she confirms, the review screen shows the restatement and a category
breakdown, and the comment column stays folded away. That is what makes it one
pass rather than forty individual judgements. Declining discards the batch
outright rather than leaving her to sift it.

### Comment text is bidi-isolated too

Phase 2 isolated Latin and numeric runs in the _document_; comment bodies and
quoted spans were rendered as plain interpolation. Drafted comments quote the
document's statistics constantly, so `(r = .42, p < .01)` inside a comment came
out with its brackets reversed. The `app-bidi-text` component applies the same
`splitLtrRuns` treatment to comment bodies, quotes and the batch summary.

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
      ai/            drafting annotations: contract, anchor resolution, generator
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
  functions/         Edge Functions — they own the Drive OAuth credential
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
