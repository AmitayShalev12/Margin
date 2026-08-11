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
| 2     | Core screens (dashboard, submissions, review, courses, style) | next    |
| 3     | Google Drive integration                                      | —       |
| 4     | AI feedback engine, learning loop, grading forms, email       | —       |
| 5     | Reliability / authenticity module                             | —       |

Phase 1 deliberately ships **empty routed pages**. What is real is the data
model, the schema, the RTL shell and the design system.

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
      navigation.ts  the nav destinations, shared by rail and tab bar
      supabase/      the single Supabase client + auth signals
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
