-- ===========================================================================
-- Margin — initial schema
--
-- Tenancy: the teacher is the tenant. Root tables carry `teacher_id`
-- referencing auth.users; everything else inherits ownership through a
-- parent, resolved by the helper functions below so policies stay one-liners.
--
-- Enum-like columns are `text` with CHECK constraints rather than Postgres
-- enums — adding a status later is then a one-line constraint change instead
-- of a type migration.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table public.students (
  id                  uuid primary key default gen_random_uuid(),
  teacher_id          uuid not null references auth.users (id) on delete cascade,
  full_name           text not null,
  email               text,
  class_name          text,
  -- The Google account she submits from; the reliability module compares the
  -- file's creator against this.
  drive_account_email text,
  notes               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index students_teacher_idx on public.students (teacher_id);

create table public.courses (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  year            text not null,
  description     text,
  drive_folder_id text,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index courses_teacher_idx on public.courses (teacher_id);

-- The teacher's own rules for a course, plus general conventions pulled from
-- the web (kept distinguishable via `origin` so hers always take precedence).
create table public.course_rules (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  kind       text not null check (kind in ('structure', 'sources', 'language', 'formatting', 'content', 'other')),
  title      text not null,
  body       text not null,
  origin     text not null default 'teacher' check (origin in ('teacher', 'web')),
  source_url text,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index course_rules_course_idx on public.course_rules (course_id);

-- Syllabus, model assignments, examples of her own corrections. `content`
-- holds the extracted text that is actually fed to the model.
create table public.course_materials (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete cascade,
  kind          text not null check (kind in ('syllabus', 'model_assignment', 'example_correction', 'reference')),
  title         text not null,
  notes         text,
  content       text,
  drive_file_id text,
  external_url  text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index course_materials_course_idx on public.course_materials (course_id);

create table public.course_students (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, student_id)
);

create table public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references public.courses (id) on delete cascade,
  title              text not null,
  brief              text,
  due_at             timestamptz,
  drive_folder_id    text,
  expected_min_words integer,
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index assignments_course_idx on public.assignments (course_id);

-- ---------------------------------------------------------------------------
-- Submissions and their revision rounds
-- ---------------------------------------------------------------------------

create table public.submissions (
  id                   uuid primary key default gen_random_uuid(),
  assignment_id        uuid not null references public.assignments (id) on delete cascade,
  student_id           uuid not null references public.students (id) on delete cascade,
  status               text not null default 'new'
                         check (status in ('new', 'in_review', 'notes_sent', 'student_revised', 'resubmitted', 'finalized')),
  current_round        integer not null default 1,
  title                text,

  -- Google Drive linkage + raw metadata (populated in Phase 3, analysed in Phase 5)
  drive_file_id        text,
  drive_file_name      text,
  drive_mime_type      text,
  drive_web_view_link  text,
  drive_owner_email    text,
  drive_creator_email  text,
  drive_created_at     timestamptz,
  drive_modified_at    timestamptz,
  drive_revision_count integer,
  drive_metadata_raw   jsonb,

  last_synced_at       timestamptz,
  word_count           integer,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (assignment_id, student_id)
);

create index submissions_assignment_idx on public.submissions (assignment_id);
create index submissions_student_idx on public.submissions (student_id);
create index submissions_status_idx on public.submissions (status);
create unique index submissions_drive_file_idx on public.submissions (drive_file_id) where drive_file_id is not null;

-- One row per revision cycle, so earlier rounds are never overwritten.
create table public.submission_rounds (
  id                      uuid primary key default gen_random_uuid(),
  submission_id           uuid not null references public.submissions (id) on delete cascade,
  round_number            integer not null,
  document_text           text,
  -- Structured blocks with stable ids; annotations anchor to these.
  document_blocks         jsonb,
  drive_revision_id       text,
  received_at             timestamptz not null default now(),
  notes_sent_at           timestamptz,
  -- Plain-language restatement the teacher confirms before annotations land.
  ai_summary              text,
  ai_summary_confirmed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (submission_id, round_number)
);

create index submission_rounds_submission_idx on public.submission_rounds (submission_id);

-- ---------------------------------------------------------------------------
-- Annotations — the inline margin comments
-- ---------------------------------------------------------------------------

create table public.annotations (
  id                  uuid primary key default gen_random_uuid(),
  submission_id       uuid not null references public.submissions (id) on delete cascade,
  round_id            uuid not null references public.submission_rounds (id) on delete cascade,
  -- { block_id, block_index, start, end, quote }
  anchor              jsonb not null,
  kind                text not null default 'other'
                        check (kind in ('language', 'structure', 'sources', 'content', 'formatting', 'praise', 'other')),
  body                text not null,
  ai_body             text,
  origin              text not null default 'ai' check (origin in ('ai', 'teacher')),
  edited_by_teacher   boolean not null default false,
  status              text not null default 'pending'
                        check (status in ('pending', 'accepted', 'edited', 'dismissed', 'resolved')),
  confidence          real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- FK added after grading_form_categories is created, below.
  grading_category_id uuid,
  resolved_in_round   integer,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index annotations_submission_idx on public.annotations (submission_id);
create index annotations_round_idx on public.annotations (round_id);
create index annotations_status_idx on public.annotations (status);

-- ---------------------------------------------------------------------------
-- Grading forms
-- ---------------------------------------------------------------------------

-- Headings on the teacher's internal form, mostly learned from her own forms
-- from previous years.
create table public.grading_form_categories (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  name        text not null,
  description text,
  origin      text not null default 'learned' check (origin in ('learned', 'teacher')),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index grading_form_categories_course_idx on public.grading_form_categories (course_id);

alter table public.annotations
  add constraint annotations_grading_category_fkey
  foreign key (grading_category_id) references public.grading_form_categories (id) on delete set null;

create table public.grading_form_entries (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions (id) on delete cascade,
  category_id       uuid not null references public.grading_form_categories (id) on delete cascade,
  annotation_id     uuid references public.annotations (id) on delete set null,
  body              text not null,
  ai_body           text,
  origin            text not null default 'ai' check (origin in ('ai', 'teacher')),
  edited_by_teacher boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index grading_form_entries_submission_idx on public.grading_form_entries (submission_id);
create index grading_form_entries_category_idx on public.grading_form_entries (category_id);

-- The year-end, student-facing form. Deliberately separate from the internal
-- one — Phase 4 learns how the teacher translates between them.
create table public.student_grading_forms (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students (id) on delete cascade,
  course_id         uuid not null references public.courses (id) on delete cascade,
  year              text not null,
  -- [{ title, body, category_id }]
  sections          jsonb not null default '[]'::jsonb,
  summary           text,
  status            text not null default 'draft' check (status in ('draft', 'approved', 'sent')),
  edited_by_teacher boolean not null default false,
  source_entry_ids  uuid[] not null default '{}',
  approved_at       timestamptz,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (student_id, course_id, year)
);

-- ---------------------------------------------------------------------------
-- Style learning
-- ---------------------------------------------------------------------------

create table public.teacher_style_examples (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references auth.users (id) on delete cascade,
  course_id    uuid references public.courses (id) on delete cascade,
  source       text not null check (source in ('past_feedback', 'past_email', 'past_grading_form', 'manual')),
  student_text text,
  teacher_text text not null,
  tags         text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index teacher_style_examples_teacher_idx on public.teacher_style_examples (teacher_id);

-- The training signal: what the AI wrote vs. what the teacher kept.
create table public.learning_feedback_logs (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null references auth.users (id) on delete cascade,
  course_id       uuid references public.courses (id) on delete set null,
  target_type     text not null check (target_type in ('annotation', 'grading_entry', 'student_email', 'student_grading_form')),
  target_id       uuid not null,
  action          text not null check (action in ('accepted', 'edited', 'dismissed')),
  ai_text         text not null,
  final_text      text,
  change_note     text,
  context_excerpt text,
  created_at      timestamptz not null default now()
);

create index learning_feedback_logs_teacher_idx on public.learning_feedback_logs (teacher_id, created_at desc);
create index learning_feedback_logs_target_idx on public.learning_feedback_logs (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Student email
-- ---------------------------------------------------------------------------

create table public.student_emails (
  id                    uuid primary key default gen_random_uuid(),
  submission_id         uuid not null references public.submissions (id) on delete cascade,
  student_id            uuid not null references public.students (id) on delete cascade,
  round_id              uuid references public.submission_rounds (id) on delete set null,
  subject               text not null,
  body                  text not null,
  -- [{ key, label, subject, body }] — the 2–3 phrasing options offered
  variants              jsonb not null default '[]'::jsonb,
  selected_variant_key  text,
  ai_body               text,
  edited_by_teacher     boolean not null default false,
  status                text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'failed')),
  sent_at               timestamptz,
  error_message         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index student_emails_submission_idx on public.student_emails (submission_id);

-- ---------------------------------------------------------------------------
-- Reliability / authenticity (analysed in Phase 5)
-- ---------------------------------------------------------------------------

create table public.reliability_checks (
  id                    uuid primary key default gen_random_uuid(),
  submission_id         uuid not null references public.submissions (id) on delete cascade,
  round_id              uuid references public.submission_rounds (id) on delete cascade,
  checked_at            timestamptz not null default now(),
  file_creator_email    text,
  file_owner_email      text,
  -- [{ email, display_name, first_edit_at, last_edit_at, revision_count, unfamiliar }]
  editors               jsonb not null default '[]'::jsonb,
  revision_summary      jsonb,
  max_similarity        real check (max_similarity is null or (max_similarity >= 0 and max_similarity <= 1)),
  similar_submission_id uuid references public.submissions (id) on delete set null,
  -- [{ code, severity, message, evidence }]
  flags                 jsonb not null default '[]'::jsonb,
  dismissed             boolean not null default false,
  dismissed_note        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index reliability_checks_submission_idx on public.reliability_checks (submission_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'students', 'courses', 'course_rules', 'course_materials', 'assignments',
    'submissions', 'submission_rounds', 'annotations', 'grading_form_categories',
    'grading_form_entries', 'student_grading_forms', 'teacher_style_examples',
    'student_emails', 'reliability_checks'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership helpers
--
-- security definer so the policies below can resolve the parent row without
-- each lookup re-triggering RLS on the parent table.
-- ---------------------------------------------------------------------------

create or replace function public.owns_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.teacher_id = auth.uid()
  );
$$;

create or replace function public.owns_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id and s.teacher_id = auth.uid()
  );
$$;

create or replace function public.owns_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignments a
    join public.courses c on c.id = a.course_id
    where a.id = p_assignment_id and c.teacher_id = auth.uid()
  );
$$;

create or replace function public.owns_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    join public.courses c on c.id = a.course_id
    where s.id = p_submission_id and c.teacher_id = auth.uid()
  );
$$;

create or replace function public.owns_round(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.owns_submission((select r.submission_id from public.submission_rounds r where r.id = p_round_id));
$$;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Every table is deny-by-default; a single policy per table grants the owning
-- teacher full access. Students never authenticate — there is no student app.
-- ---------------------------------------------------------------------------

alter table public.students               enable row level security;
alter table public.courses                enable row level security;
alter table public.course_rules           enable row level security;
alter table public.course_materials       enable row level security;
alter table public.course_students        enable row level security;
alter table public.assignments            enable row level security;
alter table public.submissions            enable row level security;
alter table public.submission_rounds      enable row level security;
alter table public.annotations            enable row level security;
alter table public.grading_form_categories enable row level security;
alter table public.grading_form_entries   enable row level security;
alter table public.student_grading_forms  enable row level security;
alter table public.teacher_style_examples enable row level security;
alter table public.learning_feedback_logs enable row level security;
alter table public.student_emails         enable row level security;
alter table public.reliability_checks     enable row level security;

-- Root tables: ownership is on the row itself.
create policy students_owner on public.students
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy courses_owner on public.courses
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy teacher_style_examples_owner on public.teacher_style_examples
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy learning_feedback_logs_owner on public.learning_feedback_logs
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- Course-scoped.
create policy course_rules_owner on public.course_rules
  for all to authenticated
  using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

create policy course_materials_owner on public.course_materials
  for all to authenticated
  using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

create policy course_students_owner on public.course_students
  for all to authenticated
  using (public.owns_course(course_id) and public.owns_student(student_id))
  with check (public.owns_course(course_id) and public.owns_student(student_id));

create policy assignments_owner on public.assignments
  for all to authenticated
  using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

create policy grading_form_categories_owner on public.grading_form_categories
  for all to authenticated
  using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

create policy student_grading_forms_owner on public.student_grading_forms
  for all to authenticated
  using (public.owns_course(course_id))
  with check (public.owns_course(course_id));

-- Submission-scoped.
create policy submissions_owner on public.submissions
  for all to authenticated
  using (public.owns_assignment(assignment_id))
  with check (public.owns_assignment(assignment_id));

create policy submission_rounds_owner on public.submission_rounds
  for all to authenticated
  using (public.owns_submission(submission_id))
  with check (public.owns_submission(submission_id));

create policy annotations_owner on public.annotations
  for all to authenticated
  using (public.owns_submission(submission_id))
  with check (public.owns_submission(submission_id));

create policy grading_form_entries_owner on public.grading_form_entries
  for all to authenticated
  using (public.owns_submission(submission_id))
  with check (public.owns_submission(submission_id));

create policy student_emails_owner on public.student_emails
  for all to authenticated
  using (public.owns_submission(submission_id))
  with check (public.owns_submission(submission_id));

create policy reliability_checks_owner on public.reliability_checks
  for all to authenticated
  using (public.owns_submission(submission_id))
  with check (public.owns_submission(submission_id));
