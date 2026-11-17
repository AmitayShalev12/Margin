-- A rubric per task, and rule groups she names herself.
--
-- 1. A grading criterion may belong to one task. Criteria with no task are the
--    course's general rubric, as before; a task that has criteria of its own is
--    scored against those instead.
alter table public.grading_form_categories
  add column if not exists assignment_id uuid references public.assignments (id) on delete cascade;

create index if not exists grading_form_categories_assignment_idx
  on public.grading_form_categories (assignment_id)
  where assignment_id is not null;

-- 2. Rule groups are hers to name and add. The three built-in keys stay valid;
--    any other key is a group she made, listed on the course.
alter table public.course_rules
  drop constraint if exists course_rules_rule_group_check;

alter table public.courses
  add column if not exists rule_groups jsonb;

comment on column public.courses.rule_groups is
  'Ordered [{key, title}] for this course''s rule groups. Null means the three built-in groups with their default titles.';
