-- Row-level security, exercised against the real policies.
--
-- Everything else in the suite runs in jsdom against a fake or the browser
-- storage adapter, neither of which has any notion of a policy. RLS is the
-- only thing standing between one teacher's students' work and another's, so
-- it is asserted here against actual Postgres with the actual migrations
-- applied.
--
--   supabase start && supabase test db
--
-- The whole file runs in a transaction that is rolled back, so it leaves
-- nothing behind.

begin;
select plan(44);

-- ---------------------------------------------------------------------------
-- Two teachers, each with a course, an assignment, a student and a submission.
-- Created as the table owner, which bypasses RLS — these are fixtures, not
-- assertions about what a teacher may write.
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ronit@school.org.il'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dafna@school.org.il');

insert into public.courses (id, teacher_id, name, year)
values
  ('c0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'שיטות מחקר כמותיות', 'תשפ״ו'),
  ('c0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002',
   'ספרות', 'תשפ״ו');

insert into public.students (id, teacher_id, full_name)
values
  ('50000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'נועה ברקוביץ׳'),
  ('50000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'יעל כהן');

insert into public.assignments (id, course_id, title)
values
  ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000a', 'סמינריון'),
  ('a0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', 'עבודת סיום');

insert into public.submissions (id, assignment_id, student_id)
values
  ('50b00000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
   '50000000-0000-4000-8000-00000000000a'),
  ('50b00000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000b',
   '50000000-0000-4000-8000-00000000000b');

insert into public.submission_rounds (id, submission_id, round_number)
values
  ('40000000-0000-4000-8000-00000000000a', '50b00000-0000-4000-8000-00000000000a', 1),
  ('40000000-0000-4000-8000-00000000000b', '50b00000-0000-4000-8000-00000000000b', 1);

-- `scope` is not null with no default. The value is the real pair the app
-- consents to, so the fixture matches what `drive-auth` actually writes.
insert into public.google_credentials (teacher_id, refresh_token, scope)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'not-a-real-token',
        'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly');

-- ---------------------------------------------------------------------------
-- Signed in as the first teacher.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is(auth.uid(), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'the JWT subject is what auth.uid() reports');

-- Reads: her own rows, and only hers.

select is(
  (select count(*) from public.courses),
  1::bigint,
  'a signed-in teacher sees exactly her own courses');

select is(
  (select name from public.courses),
  'שיטות מחקר כמותיות',
  'and it is hers, not the other teacher''s');

select is(
  (select count(*) from public.students),
  1::bigint,
  'students are scoped to her too');

select is(
  (select count(*) from public.assignments),
  1::bigint,
  'assignments come through owns_course');

select is(
  (select count(*) from public.submissions),
  1::bigint,
  'submissions come through owns_assignment');

select is(
  (select count(*) from public.submission_rounds),
  1::bigint,
  'rounds come through owns_submission');

-- Writes: the ordinary app path has to work, or RLS has locked the teacher out
-- of her own data, which is the failure this file exists to catch.

select lives_ok(
  $$insert into public.annotations (submission_id, round_id, anchor, kind, body)
    values ('50b00000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000a',
            '{"block_id":"b-intro","block_index":0,"start":0,"end":4,"quote":"טקסט"}'::jsonb,
            'language', 'הערה')$$,
  'she can write an annotation onto her own submission');

select is(
  (select count(*) from public.annotations),
  1::bigint,
  'and read it back');

select lives_ok(
  $$update public.annotations set status = 'accepted'$$,
  'she can accept it');

select lives_ok(
  $$insert into public.learning_feedback_logs
      (teacher_id, target_type, target_id, action, ai_text, final_text)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'annotation',
            '40000000-0000-4000-8000-00000000000a', 'edited', 'ניסוח ארוך', 'קצר')$$,
  'she can record a learning-loop decision');

select lives_ok(
  $$insert into public.teacher_style_examples (teacher_id, source, teacher_text)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'past_feedback',
            'קודם השאלה, אחר כך ההשערה.')$$,
  'she can add a style example');

select lives_ok(
  $$update public.courses set drive_folder_id = 'folder-abc'$$,
  'she can point her course at a Drive folder');

-- The rest of what the app writes.
--
-- Added after the first version of this file, and every one of them is a table
-- where a wrong policy costs the teacher work she has already done: her course
-- rules, the grading form built from her decisions, the year-end form, the
-- message to the student. Several are written by `provisionMissing` at
-- startup, where a refusal reads as a missing row rather than as a permission.

select lives_ok(
  $$insert into public.course_rules (course_id, kind, title, body)
    values ('c0000000-0000-4000-8000-00000000000a', 'structure',
            'סדר הפרקים', 'שיטה לפני ממצאים.')$$,
  'she can write a course rule');

select lives_ok(
  $$insert into public.course_materials (course_id, kind, title)
    values ('c0000000-0000-4000-8000-00000000000a', 'syllabus', 'סילבוס הקורס')$$,
  'she can write a course material');

select lives_ok(
  $$insert into public.grading_form_categories (id, course_id, name, origin)
    values ('ca000000-0000-4000-8000-00000000000a',
            'c0000000-0000-4000-8000-00000000000a', 'שיטת המחקר', 'starting')$$,
  'she can create a grading-form heading');

-- `starting` was added to the constraint after the first version of the schema.
-- Without this, a database one migration behind rejects every heading the app
-- writes — and the grading form fails on a value, not a permission.
select lives_ok(
  $$update public.grading_form_categories set origin = 'learned'
    where id = 'ca000000-0000-4000-8000-00000000000a'$$,
  'a heading can move from starting to learned');

-- The write that failed in production, twice, on accept and on decline.
select lives_ok(
  $$insert into public.grading_form_entries (submission_id, category_id, body)
    values ('50b00000-0000-4000-8000-00000000000a',
            'ca000000-0000-4000-8000-00000000000a', 'המדגם אינו אקראי.')$$,
  'she can add a line to the grading form');

-- The rubric scores. Same `owns_submission` chain, one table newer — and the
-- table where a hole in that helper would surface next.
select lives_ok(
  $$insert into public.grading_criterion_scores (submission_id, category_id, points, status)
    values ('50b00000-0000-4000-8000-00000000000a',
            'ca000000-0000-4000-8000-00000000000a', 6, 'draft')$$,
  'she can score a criterion on her own submission');

-- Null points is the ordinary state, not an edge case: the research chapter
-- does not exist in November, and the column has to say so rather than zero.
select lives_ok(
  $$update public.grading_criterion_scores set points = null, change_note = 'עוד אין פרק מחקרי'
    where submission_id = '50b00000-0000-4000-8000-00000000000a'$$,
  'a criterion can go back to having no score at all');

select lives_ok(
  $$insert into public.student_grading_forms (student_id, course_id, year, summary)
    values ('50000000-0000-4000-8000-00000000000a',
            'c0000000-0000-4000-8000-00000000000a', 'תשפ״ו', 'שנה טובה מאוד.')$$,
  'she can write the student''s year-end form');

select lives_ok(
  $$insert into public.student_emails (submission_id, student_id, subject, body)
    values ('50b00000-0000-4000-8000-00000000000a',
            '50000000-0000-4000-8000-00000000000a', 'על העבודה', 'נועה, קראתי את העבודה.')$$,
  'she can draft the message to the student');

-- Posting a comment records its Drive id on the annotation. If this column were
-- refused, the comment would reach the student and Margin would not know it
-- had — and the next send would post it a second time.
select lives_ok(
  $$update public.annotations set posted_comment_id = 'AAAAxyz', posted_at = now()$$,
  'she can record that a comment reached the document');

-- The marker number is written the moment Drive accepts the glyph. Refused, the
-- marker sits in the student's document with nothing recording that it is ours
-- — so removal could not find it and a re-send would add a second one.
select lives_ok(
  $$update public.annotations set marker_number = 1$$,
  'she can record the marker placed in the document');

-- The most sensitive table in the schema: observations about whether a
-- teenager's work is her own. A hole here does not lose work, it shows one
-- teacher what another wrote about a student.
select lives_ok(
  $$insert into public.reliability_checks (submission_id, round_id, file_creator_email, flags)
    values ('50b00000-0000-4000-8000-00000000000a',
            '40000000-0000-4000-8000-00000000000a',
            'noa@school.org.il',
            '[{"code":"creator_mismatch","severity":"attention","message":"x","evidence":null}]'::jsonb)$$,
  'she can record an authenticity check on her own submission');

select lives_ok(
  $$update public.reliability_checks set dismissed = true, dismissed_note = 'דיברנו, הכול בסדר'$$,
  'she can dismiss one after looking into it');

-- Writes onto someone else's rows have to fail. `with check` rejects these,
-- and an insert that fails the check raises rather than silently vanishing.

select throws_ok(
  $$insert into public.courses (teacher_id, name, year)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'לא שלי', 'תשפ״ו')$$,
  '42501',
  null,
  'she cannot create a course owned by another teacher');

select throws_ok(
  $$insert into public.annotations (submission_id, round_id, anchor, kind, body)
    values ('50b00000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-00000000000b',
            '{"block_id":"b","block_index":0,"start":0,"end":1,"quote":"x"}'::jsonb,
            'language', 'הערה על עבודה של תלמידה אחרת')$$,
  '42501',
  null,
  'she cannot annotate another teacher''s submission');

-- The scores table hangs off the same helper, so it is checked the same way.
select throws_ok(
  $$insert into public.grading_criterion_scores (submission_id, category_id, points)
    values ('50b00000-0000-4000-8000-00000000000b',
            'ca000000-0000-4000-8000-00000000000a', 9)$$,
  '42501',
  'new row violates row-level security policy for table "grading_criterion_scores"',
  'she cannot score another teacher''s submission');

-- The same chain one table further out. `grading_form_entries` is guarded by
-- `owns_submission`, so it is where a hole in that helper would show.
select throws_ok(
  $$insert into public.grading_form_entries (submission_id, category_id, body)
    values ('50b00000-0000-4000-8000-00000000000b',
            'ca000000-0000-4000-8000-00000000000a', 'שורה על עבודה של תלמידה אחרת')$$,
  '42501',
  null,
  'she cannot add a grading line to another teacher''s submission');

select throws_ok(
  $$insert into public.student_emails (submission_id, student_id, subject, body)
    values ('50b00000-0000-4000-8000-00000000000b',
            '50000000-0000-4000-8000-00000000000b', 'לא שלי', 'הודעה לתלמידה של מורה אחרת')$$,
  '42501',
  null,
  'she cannot draft a message on another teacher''s submission');

select throws_ok(
  $$insert into public.reliability_checks (submission_id, file_creator_email)
    values ('50b00000-0000-4000-8000-00000000000b', 'x@y.com')$$,
  '42501',
  null,
  'she cannot record an authenticity check on another teacher''s student');

select throws_ok(
  $$insert into public.learning_feedback_logs
      (teacher_id, target_type, target_id, action, ai_text)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'annotation',
            '40000000-0000-4000-8000-00000000000b', 'edited', 'x')$$,
  '42501',
  null,
  'she cannot write into another teacher''s learning log');

-- Undo deletes the log entry rather than superseding it, so a delete is now
-- something the app actually issues against this table. Aimed at another
-- teacher's row it must remove nothing: a reversal that reached across
-- accounts would quietly erase the record of a decision that was never hers.

select lives_ok(
  $$delete from public.learning_feedback_logs
     where teacher_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  'a delete aimed at another teacher''s learning log raises nothing');

select is(
  (select count(*)::int from public.learning_feedback_logs
    where teacher_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'and it removed nothing of hers, because she can never see it');

-- An update aimed at another teacher's row is not an error — it simply matches
-- nothing, which is what `using` does. Worth pinning: silence here is correct,
-- and a future policy change that made it succeed would not raise either.

select lives_ok(
  $$update public.courses set name = 'שוניתי' where id = 'c0000000-0000-4000-8000-00000000000b'$$,
  'updating another teacher''s course raises nothing...');

set local role postgres;
select is(
  (select name from public.courses where id = 'c0000000-0000-4000-8000-00000000000b'),
  'ספרות',
  '...and changes nothing');

-- ---------------------------------------------------------------------------
-- The Drive refresh token. Not policy-protected but grant-protected: the table
-- has RLS on and no policies at all, and select is revoked from the client
-- roles outright, so a policy added by mistake later still cannot expose it.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select refresh_token from public.google_credentials$$,
  '42501',
  null,
  'a teacher cannot read her own Google refresh token');

select throws_ok(
  $$select * from public.google_oauth_states$$,
  '42501',
  null,
  'nor the OAuth state table');

-- Her Gemini key is a spending credential and is held the same way: RLS on,
-- no policies, grants revoked. She can set it and replace it through the
-- `model-key` function, and cannot read it back from anywhere.

select throws_ok(
  $$select api_key from public.model_credentials$$,
  '42501',
  null,
  'a teacher cannot read her own model API key');

select throws_ok(
  $$insert into public.model_credentials (teacher_id, api_key, hint)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'AIzaSyPlanted', 'nted')$$,
  '42501',
  null,
  'nor plant one directly, bypassing the function that validates it');

-- ---------------------------------------------------------------------------
-- The second teacher sees her own world, and none of the first one's.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select name from public.courses),
  'ספרות',
  'the other teacher sees her own course');

select is(
  (select count(*) from public.annotations),
  0::bigint,
  'and none of the first teacher''s annotations');

-- ---------------------------------------------------------------------------
-- Signed out. This is the case the app could not previously tell apart from
-- "no work yet": anon reads succeed and return nothing.
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '';

select is(
  (select count(*) from public.courses),
  0::bigint,
  'an unauthenticated read returns no rows rather than an error');

select * from finish();
rollback;
