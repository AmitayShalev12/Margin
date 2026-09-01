-- The same RLS assertions as `rls.test.sql`, in a form that runs against the
-- hosted project with no local tooling at all.
--
-- Paste it whole into the SQL editor at
--   https://supabase.com/dashboard/project/cqmzcvaitiumnqyrttpe/sql/new
-- and press run. It prints a pass/fail line per assertion.
--
-- Why this exists alongside the pgTAP file: pgTAP is not installed on the
-- hosted project, and `supabase test db` runs pg_prove inside a Docker
-- container. This version needs neither — only a SQL prompt. Keep the two
-- files in the same order and wording so they stay diffable; `rls.test.sql`
-- stays the one CI would run.
--
-- ---------------------------------------------------------------------------
-- On running this against production
--
-- It writes into `auth.users` and half a dozen tables, and it must not leave
-- any of that behind. So it does not end with `rollback` — it ends by raising
-- an exception, which aborts the transaction and unwinds every write no matter
-- how the client is configured. A `rollback` statement can be skipped (a
-- client in autocommit, an editor that splits statements, a dropped
-- connection mid-script); an exception cannot.
--
-- The results are carried out in the exception message, which is why the run
-- ends in red. **Red is the success case here.** Read the message.
-- ---------------------------------------------------------------------------

do $$
declare
  teacher_a  uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  teacher_b  uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  course_a   uuid := 'c0000000-0000-4000-8000-00000000000a';
  course_b   uuid := 'c0000000-0000-4000-8000-00000000000b';
  student_a  uuid := '50000000-0000-4000-8000-00000000000a';
  student_b  uuid := '50000000-0000-4000-8000-00000000000b';
  assign_a   uuid := 'a0000000-0000-4000-8000-00000000000a';
  assign_b   uuid := 'a0000000-0000-4000-8000-00000000000b';
  sub_a      uuid := '50b00000-0000-4000-8000-00000000000a';
  sub_b      uuid := '50b00000-0000-4000-8000-00000000000b';
  round_a    uuid := '40000000-0000-4000-8000-00000000000a';
  round_b    uuid := '40000000-0000-4000-8000-00000000000b';
  cat_a      uuid := 'ca000000-0000-4000-8000-00000000000a';

  report  text := '';
  passed  int := 0;
  failed  int := 0;
  n       bigint;
  s       text;
  u       uuid;

  -- Results are accumulated into `report` rather than a table, and each
  -- assertion resets the role before recording. A helper function would have
  -- to be security definer to write anywhere while the session is acting as
  -- `authenticated` — and that would run the assertions themselves as the
  -- owner, with RLS bypassed, which is the one thing this file must not do.
begin
-- An unexpected failure anywhere below — a missing grant, a column added since
-- — must still produce the report rather than a bare error with no results, so
-- the whole run sits in a nested block. Body indentation is left as it is to
-- keep this a one-line change.
begin
  -- -------------------------------------------------------------------------
  -- Fixtures. Written as the owner, which bypasses RLS on purpose: these are
  -- the world the assertions run against, not claims about what a teacher may
  -- write. Both teachers are fabricated ids that cannot collide with a real
  -- account.
  -- -------------------------------------------------------------------------

  insert into auth.users (id, instance_id, aud, role, email)
  values
    (teacher_a, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'rls-test-a@example.invalid'),
    (teacher_b, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'rls-test-b@example.invalid');

  insert into public.courses (id, teacher_id, name, year)
  values (course_a, teacher_a, 'שיטות מחקר כמותיות', 'תשפ״ו'),
         (course_b, teacher_b, 'ספרות', 'תשפ״ו');

  insert into public.students (id, teacher_id, full_name)
  values (student_a, teacher_a, 'נועה ברקוביץ׳'),
         (student_b, teacher_b, 'יעל כהן');

  insert into public.assignments (id, course_id, title)
  values (assign_a, course_a, 'סמינריון'),
         (assign_b, course_b, 'עבודת סיום');

  insert into public.submissions (id, assignment_id, student_id)
  values (sub_a, assign_a, student_a),
         (sub_b, assign_b, student_b);

  insert into public.submission_rounds (id, submission_id, round_number)
  values (round_a, sub_a, 1), (round_b, sub_b, 1);

  -- `scope` is not null with no default. The value is the real pair the app
  -- consents to, so the fixture matches what `drive-auth` actually writes.
  insert into public.google_credentials (teacher_id, refresh_token, scope)
  values (teacher_a, 'not-a-real-token',
          'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly');

  -- -------------------------------------------------------------------------
  -- Signed in as the first teacher.
  -- -------------------------------------------------------------------------

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', teacher_a), true);
  set local role authenticated;

  select auth.uid() into u;
  reset role;
  if u = teacher_a then passed := passed + 1; report := report || E'  ok    the JWT subject is what auth.uid() reports\n';
  else failed := failed + 1; report := report || E'  FAIL  the JWT subject is what auth.uid() reports\n'; end if;

  -- Reads: her own rows, and only hers.

  set local role authenticated;
  select count(*) into n from public.courses;
  reset role;
  if n = 1 then passed := passed + 1; report := report || E'  ok    a signed-in teacher sees exactly her own courses\n';
  else failed := failed + 1; report := report || format(E'  FAIL  a signed-in teacher sees exactly her own courses (saw %s)\n', n); end if;

  set local role authenticated;
  select name into s from public.courses;
  reset role;
  if s = 'שיטות מחקר כמותיות' then passed := passed + 1; report := report || E'  ok    and it is hers, not the other teacher''s\n';
  else failed := failed + 1; report := report || format(E'  FAIL  and it is hers, not the other teacher''s (saw %s)\n', s); end if;

  set local role authenticated;
  select count(*) into n from public.students;
  reset role;
  if n = 1 then passed := passed + 1; report := report || E'  ok    students are scoped to her too\n';
  else failed := failed + 1; report := report || format(E'  FAIL  students are scoped to her too (saw %s)\n', n); end if;

  set local role authenticated;
  select count(*) into n from public.assignments;
  reset role;
  if n = 1 then passed := passed + 1; report := report || E'  ok    assignments come through owns_course\n';
  else failed := failed + 1; report := report || format(E'  FAIL  assignments come through owns_course (saw %s)\n', n); end if;

  set local role authenticated;
  select count(*) into n from public.submissions;
  reset role;
  if n = 1 then passed := passed + 1; report := report || E'  ok    submissions come through owns_assignment\n';
  else failed := failed + 1; report := report || format(E'  FAIL  submissions come through owns_assignment (saw %s)\n', n); end if;

  set local role authenticated;
  select count(*) into n from public.submission_rounds;
  reset role;
  if n = 1 then passed := passed + 1; report := report || E'  ok    rounds come through owns_submission\n';
  else failed := failed + 1; report := report || format(E'  FAIL  rounds come through owns_submission (saw %s)\n', n); end if;

  -- Writes she must be able to make. If these fail, RLS has locked the teacher
  -- out of her own data, which is the failure this file exists to catch.

  begin
    set local role authenticated;
    insert into public.annotations (submission_id, round_id, anchor, kind, body)
    values (sub_a, round_a,
            '{"block_id":"b-intro","block_index":0,"start":0,"end":4,"quote":"טקסט"}'::jsonb,
            'language', 'הערה');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can write an annotation onto her own submission\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can write an annotation onto her own submission [%s: %s]\n', sqlstate, sqlerrm);
  end;

  set local role authenticated;
  select count(*) into n from public.annotations;
  reset role;
  if n = 1 then passed := passed + 1; report := report || E'  ok    and read it back\n';
  else failed := failed + 1; report := report || format(E'  FAIL  and read it back (saw %s)\n', n); end if;

  begin
    set local role authenticated;
    update public.annotations set status = 'accepted';
    reset role;
    passed := passed + 1; report := report || E'  ok    she can accept it\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can accept it [%s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.learning_feedback_logs
      (teacher_id, target_type, target_id, action, ai_text, final_text)
    values (teacher_a, 'annotation', round_a, 'edited', 'ניסוח ארוך', 'קצר');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can record a learning-loop decision\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can record a learning-loop decision [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- Undo deletes the log entry rather than superseding it, so a delete is now
  -- something the app actually issues here. Aimed at another teacher's row it
  -- must remove nothing.
  begin
    set local role authenticated;
    delete from public.learning_feedback_logs where teacher_id = teacher_b;
    reset role;
    passed := passed + 1; report := report || E'  ok    a delete cannot reach another teacher\'s learning log\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  a delete cannot reach another teacher\'s learning log [%s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.teacher_style_examples (teacher_id, source, teacher_text)
    values (teacher_a, 'past_feedback', 'קודם השאלה, אחר כך ההשערה.');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can add a style example\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can add a style example [%s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    update public.courses set drive_folder_id = 'folder-abc';
    reset role;
    passed := passed + 1; report := report || E'  ok    she can point her course at a Drive folder\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can point her course at a Drive folder [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- The rest of what the app writes.
  --
  -- These were added after the first version of this file, and every one of
  -- them is a table where a wrong policy costs the teacher work she has
  -- already done: her course rules, the grading form built from her decisions,
  -- the year-end form, the message to the student. `provisionMissing` writes
  -- several of them at startup, where a refusal reads as a missing row rather
  -- than as a permission — which is exactly the confusion this file exists to
  -- remove.

  begin
    set local role authenticated;
    insert into public.course_rules (course_id, teacher_id, kind, title, body)
    values (course_a, teacher_a, 'structure', 'סדר הפרקים', 'שיטה לפני ממצאים.');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can write a course rule\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can write a course rule [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- Owned by the teacher now, not by one course, so a rule she means
  -- everywhere is one record rather than a copy per course. A row with no
  -- course is therefore not a row with no owner.
  begin
    set local role authenticated;
    insert into public.course_rules (course_id, teacher_id, kind, title, body)
    values (null, teacher_a, 'sources', 'APA', 'מהדורה שביעית.');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can write a rule for every course she teaches
';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can write a rule for every course she teaches [%s: %s]
', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.course_rules (course_id, teacher_id, kind, title, body)
    values (null, teacher_b, 'sources', 'APA', 'כלל של מורה אחרת.');
    reset role;
    failed := failed + 1; report := report || E'  FAIL  a global rule cannot be planted on another teacher [it was allowed]
';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    a global rule cannot be planted on another teacher
';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  a global rule cannot be planted on another teacher [wrong error %s: %s]
', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.course_materials (course_id, teacher_id, kind, title)
    values (course_a, teacher_a, 'syllabus', 'סילבוס הקורס');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can write a course material\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can write a course material [%s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.grading_form_categories (id, course_id, name, origin)
    values (cat_a, course_a, 'שיטת המחקר', 'starting');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can create a grading-form heading\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can create a grading-form heading [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- `starting` was added to the constraint after the first version of the
  -- schema. Without this, a database one migration behind rejects every
  -- heading the app writes — and the grading form fails on a value, not a
  -- permission, which is a very different afternoon.
  begin
    set local role authenticated;
    update public.grading_form_categories set origin = 'learned' where id = cat_a;
    reset role;
    passed := passed + 1; report := report || E'  ok    a heading can move from starting to learned\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  a heading can move from starting to learned [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- The write that failed in production, twice, on accept and on decline.
  begin
    set local role authenticated;
    insert into public.grading_form_entries (submission_id, category_id, body)
    values (sub_a, cat_a, 'המדגם אינו אקראי.');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can add a line to the grading form\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can add a line to the grading form [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- The rubric scores. Same `owns_submission` chain, one table newer.
  begin
    set local role authenticated;
    insert into public.grading_criterion_scores (submission_id, category_id, points, status)
    values (sub_a, cat_a, 6, 'draft');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can score a criterion on her own submission\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can score a criterion on her own submission [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- Null points is the ordinary state: the research chapter does not exist in
  -- November, and the column says so rather than showing a zero.
  begin
    set local role authenticated;
    update public.grading_criterion_scores set points = null, change_note = 'עוד אין פרק מחקרי'
    where submission_id = sub_a;
    reset role;
    passed := passed + 1; report := report || E'  ok    a criterion can go back to having no score at all\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  a criterion can go back to having no score at all [%s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.student_grading_forms (student_id, course_id, year, summary)
    values (student_a, course_a, 'תשפ״ו', 'שנה טובה מאוד.');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can write the student''s year-end form\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can write the student''s year-end form [%s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.student_emails (submission_id, student_id, subject, body)
    values (sub_a, student_a, 'על העבודה', 'נועה, קראתי את העבודה.');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can draft the message to the student\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can draft the message to the student [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- Posting a comment records its Drive id on the annotation. If this column
  -- were refused, the comment would reach the student and Margin would not
  -- know it had — and the next send would post it a second time.
  begin
    set local role authenticated;
    update public.annotations set posted_comment_id = 'AAAAxyz', posted_at = now();
    reset role;
    passed := passed + 1; report := report || E'  ok    she can record that a comment reached the document\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can record that a comment reached the document [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- The marker number is written the moment Drive accepts the glyph.
  -- Refused, the marker sits in the student's document with nothing
  -- recording that it is ours — removal could not find it, and a re-send
  -- would add a second one.
  begin
    set local role authenticated;
    update public.annotations set marker_number = 1;
    reset role;
    passed := passed + 1; report := report || E'  ok    she can record the marker placed in the document
';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can record the marker placed in the document [%s: %s]
', sqlstate, sqlerrm);
  end;

  -- The most sensitive table in the schema: observations about whether a
  -- teenager's work is her own. A hole here does not lose work, it shows one
  -- teacher what another wrote about a student.
  begin
    set local role authenticated;
    insert into public.reliability_checks (submission_id, round_id, file_creator_email)
    values (sub_a, round_a, 'noa@school.org.il');
    reset role;
    passed := passed + 1; report := report || E'  ok    she can record an authenticity check on her own submission\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can record an authenticity check on her own submission [%s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    update public.reliability_checks set dismissed = true;
    reset role;
    passed := passed + 1; report := report || E'  ok    she can dismiss one after looking into it\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she can dismiss one after looking into it [%s: %s]\n', sqlstate, sqlerrm);
  end;

  -- Writes onto another teacher's rows. `with check` rejects these outright,
  -- so the expected outcome is error 42501 and not silence.

  begin
    set local role authenticated;
    insert into public.courses (teacher_id, name, year) values (teacher_b, 'לא שלי', 'תשפ״ו');
    reset role;
    failed := failed + 1; report := report || E'  FAIL  she cannot create a course owned by another teacher [no error raised]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    she cannot create a course owned by another teacher\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she cannot create a course owned by another teacher [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.annotations (submission_id, round_id, anchor, kind, body)
    values (sub_b, round_b, '{"block_id":"b","block_index":0,"start":0,"end":1,"quote":"x"}'::jsonb,
            'language', 'הערה על עבודה של תלמידה אחרת');
    reset role;
    failed := failed + 1; report := report || E'  FAIL  she cannot annotate another teacher''s submission [no error raised]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    she cannot annotate another teacher''s submission\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she cannot annotate another teacher''s submission [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  -- The scores table hangs off the same helper, checked the same way.
  begin
    set local role authenticated;
    insert into public.grading_criterion_scores (submission_id, category_id, points)
    values (sub_b, cat_a, 9);
    reset role;
    failed := failed + 1; report := report || E'  FAIL  she cannot score another teacher\'s submission [no error raised]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    she cannot score another teacher\'s submission\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she cannot score another teacher\'s submission [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  -- The same chain one table further out. `grading_form_entries` is guarded by
  -- `owns_submission`, so it is the place a hole in that helper would show.
  begin
    set local role authenticated;
    insert into public.grading_form_entries (submission_id, category_id, body)
    values (sub_b, cat_a, 'שורה על עבודה של תלמידה אחרת');
    reset role;
    failed := failed + 1; report := report || E'  FAIL  she cannot add a grading line to another teacher''s submission [no error raised]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    she cannot add a grading line to another teacher''s submission\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she cannot add a grading line to another teacher''s submission [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.student_emails (submission_id, student_id, subject, body)
    values (sub_b, student_b, 'לא שלי', 'הודעה לתלמידה של מורה אחרת');
    reset role;
    failed := failed + 1; report := report || E'  FAIL  she cannot draft a message on another teacher''s submission [no error raised]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    she cannot draft a message on another teacher''s submission\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she cannot draft a message on another teacher''s submission [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.reliability_checks (submission_id, file_creator_email)
    values (sub_b, 'x@y.com');
    reset role;
    failed := failed + 1; report := report || E'  FAIL  she cannot record an authenticity check on another teacher''s student [no error raised]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    she cannot record an authenticity check on another teacher''s student\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she cannot record an authenticity check on another teacher''s student [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    insert into public.learning_feedback_logs (teacher_id, target_type, target_id, action, ai_text)
    values (teacher_b, 'annotation', round_b, 'edited', 'x');
    reset role;
    failed := failed + 1; report := report || E'  FAIL  she cannot write into another teacher''s learning log [no error raised]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    she cannot write into another teacher''s learning log\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  she cannot write into another teacher''s learning log [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  -- An update aimed at another teacher's row is not an error — `using` simply
  -- matches nothing. Worth pinning both halves: silence here is correct, and a
  -- policy change that made it succeed would not raise either.

  begin
    set local role authenticated;
    update public.courses set name = 'שוניתי' where id = course_b;
    reset role;
    passed := passed + 1; report := report || E'  ok    updating another teacher''s course raises nothing...\n';
  exception when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  updating another teacher''s course raises nothing... [%s: %s]\n', sqlstate, sqlerrm);
  end;

  select name into s from public.courses where id = course_b;
  if s = 'ספרות' then passed := passed + 1; report := report || E'  ok    ...and changes nothing\n';
  else failed := failed + 1; report := report || format(E'  FAIL  ...and changes nothing (name is now %s)\n', s); end if;

  -- -------------------------------------------------------------------------
  -- The Drive refresh token. Not policy-protected but grant-protected: RLS on,
  -- no policies at all, and select revoked from the client roles outright — so
  -- a policy added by mistake later still cannot expose it.
  -- -------------------------------------------------------------------------

  begin
    set local role authenticated;
    perform refresh_token from public.google_credentials;
    reset role;
    failed := failed + 1; report := report || E'  FAIL  a teacher cannot read her own Google refresh token [it was readable]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    a teacher cannot read her own Google refresh token\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  a teacher cannot read her own Google refresh token [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  -- The Gemini key: a spending credential, held exactly like the Drive token.
  begin
    set local role authenticated;
    perform api_key from public.model_credentials;
    reset role;
    failed := failed + 1; report := report || E'  FAIL  a teacher cannot read her own model API key [it was readable]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    a teacher cannot read her own model API key\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  a teacher cannot read her own model API key [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  begin
    set local role authenticated;
    perform 1 from public.google_oauth_states;
    reset role;
    failed := failed + 1; report := report || E'  FAIL  nor the OAuth state table [it was readable]\n';
  exception when insufficient_privilege then
    reset role;
    passed := passed + 1; report := report || E'  ok    nor the OAuth state table\n';
  when others then
    reset role;
    failed := failed + 1; report := report || format(E'  FAIL  nor the OAuth state table [wrong error %s: %s]\n', sqlstate, sqlerrm);
  end;

  -- -------------------------------------------------------------------------
  -- The second teacher sees her own world, and none of the first one's.
  -- -------------------------------------------------------------------------

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', teacher_b), true);

  set local role authenticated;
  select name into s from public.courses;
  reset role;
  if s = 'ספרות' then passed := passed + 1; report := report || E'  ok    the other teacher sees her own course\n';
  else failed := failed + 1; report := report || format(E'  FAIL  the other teacher sees her own course (saw %s)\n', s); end if;

  set local role authenticated;
  select count(*) into n from public.annotations;
  reset role;
  if n = 0 then passed := passed + 1; report := report || E'  ok    and none of the first teacher''s annotations\n';
  else failed := failed + 1; report := report || format(E'  FAIL  and none of the first teacher''s annotations (saw %s)\n', n); end if;

  -- -------------------------------------------------------------------------
  -- Signed out. This is the case the app could not previously tell apart from
  -- "no work yet": the read succeeds and returns nothing.
  -- -------------------------------------------------------------------------

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into n from public.courses;
  reset role;
  if n = 0 then passed := passed + 1; report := report || E'  ok    an unauthenticated read returns no rows rather than an error\n';
  else failed := failed + 1; report := report || format(E'  FAIL  an unauthenticated read returns no rows rather than an error (saw %s)\n', n); end if;

exception when others then
  -- Something outside an assertion went wrong. Record it and fall through to
  -- the report, which is more use than the raw error on its own.
  failed := failed + 1;
  report := report || format(E'  ABORTED  the run stopped here [%s: %s]\n', sqlstate, sqlerrm);
end;

  -- -------------------------------------------------------------------------
  -- Report, and unwind. The exception is the rollback: everything above is
  -- discarded, and the message below is the only thing that survives.
  -- -------------------------------------------------------------------------

  raise exception E'\n\nRLS RESULTS — % passed, % failed\n\n%\n%',
    passed, failed, report,
    case when failed = 0
      then E'All assertions passed. This error is deliberate: it is what rolls the test data back.'
      else E'Some assertions FAILED — see the lines above. Nothing was written either way.'
    end;
end $$;
