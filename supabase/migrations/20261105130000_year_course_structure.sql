-- ===========================================================================
-- Tasks in order, and three groups of rules.
--
-- A task is an assignment: it already has a title and a due date, and a
-- student's paper already belongs to one. Up to fifteen per course, enforced by
-- the app. Existing assignments have no position and sort by creation date.
--
-- A rule with no group is one of hers, which is what every rule was until now.
-- Both columns are additive and nullable; nothing existing changes.
-- ===========================================================================

alter table public.assignments
  add column if not exists sort_order integer;

alter table public.course_rules
  add column if not exists rule_group text
    check (rule_group is null or rule_group in ('work', 'ministry', 'own'));
