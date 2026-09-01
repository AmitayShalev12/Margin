-- ===========================================================================
-- Rules and materials that belong to the teacher, not to one course.
--
-- Asked for once there were several courses: "add global rules and examples to
-- multiple courses". APA is APA in every course she teaches, and a model paper
-- worth showing is worth showing in all of them. Until now every rule was
-- owned by exactly one course, so keeping three courses in step meant typing
-- the same rule three times and remembering all three when it changed.
--
-- Shared, not copied — her decision. One record, used everywhere, so fixing a
-- typo fixes it for every course rather than leaving two stale duplicates
-- behind in courses she was not looking at.
--
-- The shape: `teacher_id` becomes the owner and `course_id` becomes optional.
--
--   course_id not null → this course only
--   course_id null     → all her courses
--
-- That also simplifies the policies rather than complicating them. They were
-- `owns_course(course_id)`, an exists-subquery against another table; they are
-- now a plain column comparison, and a row with no course is no longer a row
-- with no owner.
-- ===========================================================================

alter table public.course_rules
  add column if not exists teacher_id uuid references auth.users (id) on delete cascade;

alter table public.course_materials
  add column if not exists teacher_id uuid references auth.users (id) on delete cascade;

-- Backfill from the course each row already belongs to, before the column is
-- required. Every existing row has a course, so none of them is left orphaned.
update public.course_rules r
   set teacher_id = c.teacher_id
  from public.courses c
 where c.id = r.course_id and r.teacher_id is null;

update public.course_materials m
   set teacher_id = c.teacher_id
  from public.courses c
 where c.id = m.course_id and m.teacher_id is null;

alter table public.course_rules   alter column teacher_id set not null;
alter table public.course_materials alter column teacher_id set not null;

-- Optional from here: null means "every course of mine".
alter table public.course_rules     alter column course_id drop not null;
alter table public.course_materials alter column course_id drop not null;

create index if not exists course_rules_teacher_idx on public.course_rules (teacher_id);
create index if not exists course_materials_teacher_idx on public.course_materials (teacher_id);

-- The policies follow the owner rather than the course.
drop policy if exists course_rules_owner on public.course_rules;
create policy course_rules_owner on public.course_rules
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists course_materials_owner on public.course_materials;
create policy course_materials_owner on public.course_materials
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

comment on column public.course_rules.course_id is
  'The course this rule applies to, or null for every course the teacher owns.';
comment on column public.course_materials.course_id is
  'The course this material belongs to, or null for every course the teacher owns.';
