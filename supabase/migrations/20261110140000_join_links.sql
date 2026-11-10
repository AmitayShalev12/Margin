-- ===========================================================================
-- Join links, and the two student details the sign-up form collects.
--
-- A link opens a public form for one course. The `join` Edge Function reads it
-- and writes the student with the service role; the browser only ever sees the
-- course name. Teachers manage their own links through RLS.
--
-- ID number and address were deliberately not stored before. The owner chose to
-- store them for the sign-up form. They stay out of every AI request.
-- Additive: one new table, two nullable columns.
-- ===========================================================================

alter table public.students
  add column if not exists id_number text,
  add column if not exists address text;

create table if not exists public.join_links (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique,
  teacher_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  course_id       uuid not null references public.courses (id) on delete cascade,
  expires_at      timestamptz not null,
  max_submissions integer not null default 100 check (max_submissions between 1 and 500),
  submissions     integer not null default 0,
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists join_links_teacher_idx on public.join_links (teacher_id);

alter table public.join_links enable row level security;

-- Her own links, for courses that are hers. The counter is written only by the
-- function, which uses the service role.
create policy join_links_owner on public.join_links
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid() and public.owns_course(course_id));
