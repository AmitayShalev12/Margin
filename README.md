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
| 5     | Reliability / authenticity module                             | ✅ done     |

Phase 4: **AI-drafted annotations**, the **learning loop** that conditions them
on her own edits, the **grading forms**, the **student email**, and **posting
her comments onto the student's document** (all below).

### Two shortcuts into the learning loop

The loop learns her voice one review at a time, which takes a year. **הסגנון
שלי** holds two ways of getting there faster.

**Importing the papers she marked up before this existed.** A teacher with a
decade behind her already has hundreds of comments in her own words, sitting in
Word documents. `core/import/` reads them out — a `.docx` is a ZIP of XML
parts, so it carries a small ZIP reader (`DecompressionStream` does the
inflating; ZIP64 and encryption are refused rather than half-read) and a
comment extractor. The fiddly half is the anchor: Word marks a commented span
with `commentRangeStart`/`End` as _siblings_, not as a wrapper, so the range
cannot be read off the tree shape — the document is walked in order with a set
of open ids, and overlapping anchors fall out of that for free. Pairing each
note with the sentence that provoked it is what makes it a style example rather
than a tone sample.

It asks which authors are hers, because a paper can carry a colleague's
comments or the student's own replies, and learning to write in someone else's
voice is worse than learning nothing. Re-importing the same document adds
nothing — the id is derived from the pair's own text. The file is read in the
browser and dropped; nothing about the student's document is stored.
`docx-comments.spec.ts` builds real ZIP bytes rather than mocking the parse.

**Sources.** The authorities she defers to — the Hebrew Academy, a style guide
— stored as `course_materials` of kind `reference`, which needed no new table.
They reach the prompt in their own field rather than as background reading,
because a source decides what is _correct_ while a syllabus is context.

Worth being exact about what that does and does not mean: **nothing opens the
link.** What reaches the model is the name and her note beside it, and the
prompt says so in as many words — a model told to "read from" a page it cannot
open will cheerfully invent what it found there. It leans on what it already
knows of a named authority, is told never to attribute a specific rule or
wording to one unless it is certain, and where no source covers the question it
is told to use ordinary judgement and _not_ dress it up as coming from one. The
card says the same thing to the teacher.

Phase 5 ships **four** of the seven authenticity flags in the data model, and
deliberately not the other three. `bulk_paste`, `few_revisions` and any
editing-session analysis are refused outright — not hidden behind a setting,
not with softer wording. Drive reports consolidated revisions rather than
sessions, so a paper written honestly over three weeks is indistinguishable
from one pasted in at midnight, and there is no phrasing that makes that
comparison fair when a student carries the cost of being wrong. What ships
rests on fields Drive reports accurately — who created the file, who owns it,
which accounts edited it — plus text similarity against work submitted here.

The panel states which checks it did not perform and why, because an
authenticity report that lists only its findings reads as a clean bill of
health. See `src/app/core/reliability/checks.ts`.

### The app starts empty

`DataStore` holds nothing until it is filled — by her, or by a sync. There is
no demonstration course, no example roster and no marked-up sample papers.

That is a deliberate reversal. Margin used to ship with a fictional course and
class, and provision copies of them into every account on first sign-in, so
that the screens had something to show and the foreign keys had something to
point at. It read convincingly and it was wrong twice over: the records were
indistinguishable from her own work while being nobody's, and the ones that
lived only as constants were refused by every key that later pointed at them —
which RLS reports as a permissions error rather than an absence, because
`owns_submission` and its siblings are `exists` clauses. That cost four
separate debugging sessions.

So `course` and `assignment` are **nullable**, and the compiler asks about it
at each of the fourteen places that care. `courses.html` is where the first
course, the first assignment and the roster are made, and every one of them is
written the instant it is made — never held in memory to be saved later.

The fixtures still exist for tests, in `src/app/core/mock/seed-data.ts`.
Nothing under `src/app` imports them: a spec that wants them calls
`seedStore()`, which installs them through `applySnapshot` — the same path a
real load takes, so a test cannot pass against merge rules the app does not
use.

An account that signed in before this change still holds the provisioned rows.
`supabase/tools/remove-demo-records.sql` removes them, and says in its header
what else goes with them.

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
records already in place rather than rendering empty and correcting itself.
Persisted records win by id.

Writes are fire-and-forget — the signal updates immediately so the screen never
waits on the network — and a failure surfaces on `DataStore.persistError`
rather than being swallowed.

Two consequences worth knowing:

- Fixture ids are real UUIDs, resolved through `seedId()`. The `id` columns are
  `uuid`, so a fixture with a friendly id could never stand in for a real
  record; routing them through one function keeps the literals legible anyway.
- "Last synced" is not a record of its own. It is the most recent
  `last_synced_at` stamped on a submission, so it comes back with them.

`persistence.spec.ts` simulates a reload by tearing the injector down and
rebuilding it over the same storage — new `DataStore`, new signals — so
anything that comes back did so because it was persisted.

Sending is two separate acts, deliberately. Comments are posted onto the
student's Google Doc, and the covering message is handed to the teacher's own
mail client — neither is a side effect of the other, and neither is recorded as
having happened until it has.

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

The scopes:

```
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/documents.readonly
```

**These are no longer read-only, and the first one is worth understanding
before you grant it — more so now that the work is not hers.**

Drive is organised **course → year**: a course folder holds one folder per
year, and `courses.drive_folder_id` points at the year folder where submissions
arrive. Each student keeps her own document and moves it into that folder, so
the file stays owned by her and the teacher holds it only as an editor. One
`courses` row is one course-year, and a unique index on
`(teacher_id, name, year)` stops the same year being set up twice and splitting
its submissions between two rows.

That makes the scope question sharper rather than softer. `drive.file` grants
per-file access to files **the app created or the user explicitly picked**, and
under this model the app creates nothing at all — every document belongs to a
student and arrives by being moved into a folder. So `drive.file` would cover
precisely none of it, and the broad `drive` scope is not a convenience here but
the only scope under which the app can read a student's document or comment on
it. It is stated rather than widened quietly, and what the app actually does
with it is still enforced in code: `DriveApi` issues exactly one kind of
non-GET request, and any other write target throws before a request is built.

Margin posts the teacher's comments onto the student's document, and Drive
publishes no comment-only scope: `comments.create` accepts `drive` or
`drive.file` and nothing else. `drive.file` was the first choice and does not
work here — it grants per-file access only to files the app created or the user
picked, and Google is explicit that it does _not_ extend to files inside a
picked folder. Every submission arrives by enumerating a shared folder by id, so
`drive.file` would cover none of them. That leaves `drive`, which is a
**restricted** scope: fine in Testing mode with named test users, and subject to
a CASA security assessment before any production verification.

So the token can do more than the app does, and the gap is closed in code rather
than by assurance. `DriveApi` issues exactly one kind of non-GET request —
creating a comment on a file — and any other write target throws
`DriveWriteRefused` before a request is built. `comment-poster.spec.ts` asserts
it, both directly and across a full send. Margin cannot edit a student's
writing, suggest an edit to it, or change who can see it.

`documents.readonly` stays read-only and stays separate: the Docs API is only
ever read, and the Drive scope does not cover it.

**Reading work students share directly needs no new scope.**

Not every student moves her file into the year folder; some simply press Share
and type the teacher's address. That document is in no folder of the teacher's
at all — its parent is the student's own Drive, and Drive reports only parents
the caller can see, so `'folderId' in parents` cannot find it however the
folder is configured. Those files live in a separate corpus, reached with
`q=sharedWithMe`.

Reaching it required **no scope change**: `sharedWithMe` is covered by the
`drive` scope already granted, and would also be covered by `drive.readonly`.
`drive.file` cannot reach it — it sees only files the app created or the user
picked — which is the same reason it does not work for the folder. So the
grant is unchanged, and it is the narrowest that works for this too.

What did change is how much of her Drive gets read, and the answer is
deliberately as little as possible:

- **A sync never lists "Shared with me".** It asks Drive for documents owned by
  the specific addresses she has confirmed against students
  (`'noa@…' in owners or 'shira@…' in owners`), chunked so the URL stays a sane
  length. Everything else anyone has ever shared with her is never enumerated.
- **The broad listing happens only when she asks for it**, from
  **מסמכים ששותפו איתך** on the course screen, and is bounded to document mime
  types and to five pages, newest first. It exists for the bootstrap case: the
  first document a girl shares comes from an account Margin has never seen.
- **A shared file is attributed by a confirmed account, or by an exact naming
  convention — never by a loose name match.** Students are asked to name their
  file `שם התלמידה - שם העבודה`: the left side has to be a girl on the roster,
  the right side is whatever she called her paper. Drive's `contains` is
  _prefix_ matching on `name`, so the query itself enforces "the name begins
  with hers" and `file-name.ts` enforces the rest — exactly, with every
  separator tried in turn so `בת-אל כהן - עבודה` splits at the right dash.

  The strictness is the point. A file in the year folder may be matched on a
  name appearing anywhere in it, because putting it there is the teacher's own
  assertion that it is coursework. Her shared list asserts nothing — it holds
  memos, colleagues' drafts and years of paperwork — so the convention is what
  stands in for that assertion, and `הערכת מורה — נועה ברקוביץ׳` is refused
  where `נועה ברקוביץ׳ - עבודת גמר` is accepted. It cannot tell a paper from a
  document _about_ that student named the same way; nothing in a file name can.

  The convention is also what carries a girl's very first paper, before any
  account is on file — which is why a roster alone is enough to sync from, with
  no folder and no confirmed account. The work's name lands on
  `submissions.title`.

`shared-with-me.spec.ts` pins the query shape — scoped by owner during a sync,
never bare — and `sync-flow.spec.ts` pins the attribution rule and the case
where a student both shares her document and drops it in the folder.

**Comments anchor through the Docs API, not the Drive API.**

`documents.batchUpdate` gained `InsertCommentRequest`, which takes a real
`startIndex`/`endIndex` range and produces a comment the editor treats as its
own. It is in **Developer Preview**, which needs a Google Workspace account
(consumer Gmail is not eligible) and enrolment in the Workspace Developer
Preview Program — so Margin tries it first and falls back to an unanchored
Drive comment when the account is not enrolled. Both are successful sends; the
send screen says which one happened, because the difference is the whole value
to the student. It needs no new scope: `documents.batchUpdate` accepts the
`drive` scope already granted.

`documents.batchUpdate` is also the most dangerous endpoint this app could
call — the request that inserts a comment sits in the same union as
`deleteContentRange`, `replaceAllText`, `insertText` and every style change. So
the write guard inspects the **body**, not just the URL: a batch is permitted
only if every request in it is `insertComment` and nothing else. A student's
writing cannot be altered through this path, and `docs-write-guard.spec.ts`
asserts it against every destructive request type, including one smuggled in
beside a legitimate insertion.

Ranges are looked up, never computed. A paragraph's characters are not
contiguous from its start index — inline objects and footnote references occupy
an index and contribute no text — so `extractDocument` records the true index of
every character as it reads them, in the same traversal that produces the
blocks. A character Google reported no position for is refused rather than
guessed at.

**Margin inserts numbered markers into the student's document.** This is the
one place it adds anything to her writing, and it reverses the rule the rest of
this section describes — so the rule became a _shape_ that is enforced, rather
than a prohibition.

It exists because Google will not anchor a comment: the Drive endpoint ignores
its own anchor field and labels the result "התוכן המקורי נמחק", and the Docs
endpoint that anchors properly is behind a Developer Preview needing a
Workspace account. Without either, a comment has no connection to the sentence
it is about. So the connection is made the way a teacher with a red pen makes
it — a small coloured number by the line, the same number on the note.

What bounds it, all checked in `markers.spec.ts`:

- **One character per marker.** `①`, not `[1]`. A single glyph is a single
  index to insert, colour and remove, which is why the guard can refuse any
  request touching more than one character. `isMarkerEditBatch` permits exactly
  three request types — `insertText` whose text _is_ a marker glyph,
  `updateTextStyle` over one character, `deleteContentRange` over one
  character — and refuses `replaceAllText`, paragraph and table operations,
  image replacement and suggestion handling outright.
- **No digits.** A European digit inside right-to-left text forms its own
  left-to-right run and drags the neutrals around it. The enclosed glyphs carry
  a number without one, so `(r = .42, p < .01)` survives a marker beside it —
  measured, not assumed.
- **Back to front.** Every insertion shifts every index after it, so markers go
  in descending order and the positions measured beforehand stay valid.
- **Idempotent.** `annotations.marker_number` records what was placed. A
  re-send after further review leaves existing glyphs untouched and continues
  the numbering.
- **Never at a guessed position.** A span whose quoted text has changed gets no
  marker and is reported, the same rule the anchor resolver follows.
- **Removable.** "הסרת הסימונים מהמסמך" strips them, and needs two independent
  agreements before deleting a character: the recorded number, and the document
  re-read to confirm that index holds that glyph. Neither alone is enough.

**The Drive fallback is unanchored, and that is Google's limit, not a
shortcut.** Drive's
`comments.create` takes an `anchor`, but on a Google Doc it is a trap — the API
stores it, and Workspace editors then treat the comment as unanchored and render
it in the Docs UI as _"Original content deleted"_, which reads to a student as
though her writing had been removed. Google documents the behaviour, it is open
as [issuetracker 491884714](https://issuetracker.google.com/issues/491884714),
and no public Drive or Docs endpoint produces a genuinely anchored comment. So
Margin sends no anchor at all and carries the location where it survives: each
comment opens with the section heading and the quoted sentence.

**Existing connections need re-consent.** A teacher who connected before this
granted `drive.readonly`; that grant stays valid and syncing keeps working, and
only commenting is refused. `missingScopes()` notices, and the send screen
explains what changed and what Margin still will not do — rather than letting
Drive answer with a 403 that reads like a folder permission problem.

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

Then, in the app: **קורסים**, and make the course, the assignment and the
roster — nothing exists until you do, and a sync with no assignment is refused
outright rather than writing submissions with nowhere to attach. Then **חיבור
לגוגל**, and paste the folder's Drive URL into **בחירת תיקייה** (or skip the
folder entirely and let students share their documents with you). The folder is verified before it is saved, so a mistyped
id says so rather than looking like an empty folder.

### How a file becomes a submission

Work arrives two ways, and either alone is enough — a course with no folder
configured still syncs if a student's account has been confirmed, and the
refusal names both sources rather than sending her to fix the wrong one:

1. **The year folder**, listed by id, as before.
2. **Shared with her directly**, fetched per confirmed account from the
   `sharedWithMe` corpus (see the scope section above for what is and isn't
   read).

The folder is listed first, and a document reached both ways is handled once —
a student who shares her paper _and_ drops it in the folder is doing as she was
asked, twice, and used to be reported as a clash for the teacher to resolve.

For each file:

- **Works out whose it is.** The owning Google account is checked against
  `Student.drive_account_email` first; failing that — **and only for a file in
  the folder** — the file name has to contain every part of exactly one
  student's name. Anything matching neither is _reported_, not guessed at —
  attributing a paper to the wrong student is worse than asking. Unattributed
  files show up in the sync line. An unattributable document in her shared list
  is reported nowhere, because nothing about it claimed to be coursework in the
  first place.
- **Captures the metadata verbatim.** Owner, creator, created and modified
  times, and the full revision list land on the submission, with the untouched
  API payloads in `drive_metadata_raw`. Phase 3 draws no conclusions from any
  of it; Phase 5 does. Worth knowing: Drive's revision list for a Google Doc is
  much coarser than the editor's own version history, so the snapshot carries a
  `revisions_truncated` flag rather than letting a short list read as evidence.
- **Follows shortcuts.** A student can put her work in the folder two ways:
  move the file in, or add a shortcut to it. Both look identical in a listing,
  but a shortcut is its own file with its own mime type and no text — ingested
  as-is it becomes a submission with an empty document and nothing to explain
  why. The sync resolves the shortcut to its target; a target it cannot read is
  reported as unattributed rather than stored empty.
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
supabase functions deploy annotate student-form student-email
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
      mock/          fixture records — tests only, nothing in the app reads them
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
  tests/             the RLS suite, run against a real database
  tools/             one-off scripts you run by hand, destructive by nature
```

`supabase/tools/` holds two scripts, both meant for the SQL editor:

- `reset-for-testing.sql` empties every table so the next test run starts from
  nothing, leaving your sign-in and your Drive connection in place. **Remove
  the markers from the test documents before running it** — taking a marker out
  needs the number recorded against the annotation, and wiping the database
  destroys that half of the pair, leaving glyphs nothing can remove but hand
  editing.
- `remove-demo-records.sql` clears the fictional course and class that earlier
  versions provisioned into every account on first sign-in. A one-off; new
  accounts never get them.

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
