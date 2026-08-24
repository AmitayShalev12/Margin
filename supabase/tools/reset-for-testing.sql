-- Wipes every record in the app, so the next test starts from nothing.
--
-- For development. It does not ask whose rows these are and it does not check
-- what is in them: it empties the tables. Run it against your own project.
--
-- ⚠ DO THE MARKERS FIRST — before you run this, not after.
--
-- Margin puts a small numbered glyph beside every sentence it comments on,
-- because Google will not anchor a comment through any public API. Removing a
-- marker again needs two independent agreements: the marker number recorded on
-- the annotation, and the document re-read to confirm that position still
-- holds that glyph. That is deliberate — a recorded position alone goes stale
-- the moment she types above it, and a search alone cannot tell Margin's glyph
-- from one a student pasted.
--
-- Wiping the database destroys the first half of that pair. The glyphs stay in
-- the document and nothing can take them out but hand-editing. So: press
-- **הסרת הסימונים מהמסמך** on the send screen for each test paper, and only
-- then run this.
--
-- Comments already posted are not removed either, by this or by the app —
-- Drive lets Margin create a comment and nothing else. Delete them in the
-- document, or start each round from a fresh copy of the test doc.
--
-- What this does NOT touch:
--   • your sign-in — `auth.users` is left alone, so you stay signed in
--   • your Google Drive connection — see the optional section at the end
--   • anything in Drive itself: documents, comments, markers, revisions

-- ---------------------------------------------------------------------------
-- The reset. One statement: `cascade` settles the foreign-key order, and
-- `restart identity` matters for nothing here but costs nothing either.
-- ---------------------------------------------------------------------------

truncate table
  public.annotations,
  public.grading_form_entries,
  public.grading_form_categories,
  public.student_emails,
  public.student_grading_forms,
  public.reliability_checks,
  public.submission_rounds,
  public.submissions,
  public.assignments,
  public.course_students,
  public.course_materials,
  public.course_rules,
  public.courses,
  public.students,
  public.learning_feedback_logs,
  public.teacher_style_examples
restart identity cascade;

-- Everything should be zero.
select 'courses' as table_name, count(*) as row_count from public.courses
union all select 'assignments', count(*) from public.assignments
union all select 'students', count(*) from public.students
union all select 'submissions', count(*) from public.submissions
union all select 'submission_rounds', count(*) from public.submission_rounds
union all select 'annotations', count(*) from public.annotations
union all select 'grading_form_categories', count(*) from public.grading_form_categories
union all select 'grading_form_entries', count(*) from public.grading_form_entries
union all select 'student_grading_forms', count(*) from public.student_grading_forms
union all select 'student_emails', count(*) from public.student_emails
union all select 'reliability_checks', count(*) from public.reliability_checks
union all select 'course_rules', count(*) from public.course_rules
union all select 'course_materials', count(*) from public.course_materials
union all select 'course_students', count(*) from public.course_students
union all select 'learning_feedback_logs', count(*) from public.learning_feedback_logs
union all select 'teacher_style_examples', count(*) from public.teacher_style_examples;

-- Then reload the app. It will open on the empty course screen, asking for a
-- course name — the same thing a brand-new teacher sees.

-- ---------------------------------------------------------------------------
-- OPTIONAL — also disconnect Google Drive.
--
-- Left out of the reset above on purpose: this is the one thing whose setup is
-- slow to redo. Clearing it means going through the Google consent screen
-- again, and it is worth doing only when you are testing the connection flow
-- itself.
--
-- `google_oauth_states` is single-use CSRF state and is safe to clear at any
-- time; a stale row there can only ever refuse one sign-in attempt.
-- ---------------------------------------------------------------------------

-- truncate table public.google_credentials, public.google_oauth_states;

-- ---------------------------------------------------------------------------
-- OPTIONAL — start over as a different teacher entirely.
--
-- Deletes the account itself, not just its records. Everything above cascades
-- from `auth.users`, so this is the full wipe: you sign up again, connect
-- Drive again, and the app has never seen you.
--
-- Replace the address before uncommenting.
-- ---------------------------------------------------------------------------

-- delete from auth.users where email = 'you@example.com';
