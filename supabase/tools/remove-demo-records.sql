-- Removes the demonstration course, roster and papers from a real account.
--
-- Margin used to provision a fictional course, a class of invented students
-- and their marked-up papers into every account on first sign-in, so that the
-- screens had something to show and the foreign keys had something to point
-- at. The app no longer does that — it starts empty — but any account that
-- signed in before this change still holds those rows, owned by the teacher
-- and indistinguishable from her own work.
--
-- ⚠ READ THIS FIRST. Everything cascades from `courses`, and real work synced
-- from Drive was attached to the *demonstration* assignment — because that was
-- the only assignment there was. So this deletes those submissions, their
-- rounds, and any comments drafted against them, along with the fixtures.
-- Nothing in Drive is touched: the documents and any comments already posted
-- into them stay exactly as they are, and a sync after this re-creates the
-- submissions against the assignment you make yourself.
--
-- The demonstration ids are literal constants from `seed-data.ts`, never
-- generated, so this cannot reach a record that was made in the app. The
-- `::text` cast is not decoration: `id` is a `uuid`, and `uuid like '...'` is
-- not an operator Postgres has.
--
-- Run the two parts SEPARATELY, in the Supabase SQL editor. Each execution
-- there is its own transaction and only the last statement's result is shown,
-- so a preview select sitting above the deletes would neither be visible nor
-- protect anything.

-- ===========================================================================
-- PART 1 — what is about to go. Run this on its own and read it.
-- ===========================================================================

select 'courses' as table_name, count(*) as row_count from public.courses
 where id = 'c0000000-0000-4000-8000-000000000001'
union all
select 'students', count(*) from public.students
 where id::text like '00000000-0000-4000-8000-%'
union all
select 'submissions (incl. real ones on the demo assignment)', count(*)
  from public.submissions
 where assignment_id = 'a5000000-0000-4000-8000-000000000001'
union all
select 'annotations on them', count(*)
  from public.annotations a
  join public.submissions s on s.id = a.submission_id
 where s.assignment_id = 'a5000000-0000-4000-8000-000000000001'
union all
select 'style examples', count(*) from public.teacher_style_examples
 where id::text like '00000000-0000-4000-8000-%'
union all
select 'feedback logs', count(*) from public.learning_feedback_logs
 where id::text like '00000000-0000-4000-8000-%';

-- ===========================================================================
-- PART 2 — the deletion. Run this only after reading Part 1.
-- ===========================================================================

-- The course takes its rules, materials, assignment, grading headings and
-- everything hanging off them with it — every one of those foreign keys is
-- `on delete cascade`.
delete from public.courses
 where id = 'c0000000-0000-4000-8000-000000000001';

-- The roster, and by cascade any submission still pointing at one of them.
delete from public.students
 where id::text like '00000000-0000-4000-8000-%';

-- `learning_feedback_logs.course_id` is `on delete set null`, so these survive
-- the course being removed. They are decisions about comments that no longer
-- exist, on papers nobody wrote.
delete from public.learning_feedback_logs
 where id::text like '00000000-0000-4000-8000-%';

-- Style examples with no course were never reached by the cascade either.
delete from public.teacher_style_examples
 where id::text like '00000000-0000-4000-8000-%';

-- What is left. Every count should be zero.
select 'courses' as table_name, count(*) as row_count from public.courses
 where id = 'c0000000-0000-4000-8000-000000000001'
union all
select 'students', count(*) from public.students
 where id::text like '00000000-0000-4000-8000-%'
union all
select 'submissions', count(*) from public.submissions
 where assignment_id = 'a5000000-0000-4000-8000-000000000001';
