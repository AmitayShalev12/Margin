-- Her rubric, as a rubric: sections and points, not just headings.
--
-- `grading_form_categories` held a flat list of names, which is what a form
-- learned from past years looks like. The real form she marks against is a
-- rubric with a fixed structure — four sections, seventeen sub-criteria, and a
-- maximum score on each, summing to 100:
--
--   1. נושא העבודה והתקציר  10      3. פרק מחקרי       43
--   2. פרק תאורטי           42      4. דרך ההגשה        5
--
-- Two columns rather than a second table. The nesting is exactly two levels
-- deep and never grows, and a section's total is the sum of its children — so
-- a `section` label on each row says everything a parent row would, without a
-- second set of ids, policies and orphan cases to keep straight.
--
-- Both are nullable: a course whose headings came from her past forms has no
-- point values, and that is a real state rather than a missing one. Anything
-- reading `max_points` has to handle null and say "not scored out of anything"
-- instead of showing a zero.

alter table public.grading_form_categories
  add column if not exists section    text,
  add column if not exists max_points integer;

alter table public.grading_form_categories
  drop constraint if exists grading_form_categories_max_points_check;

-- A criterion worth nothing is a mistake, not a criterion. Bounded above at
-- 100 because the whole form is 100.
alter table public.grading_form_categories
  add constraint grading_form_categories_max_points_check
  check (max_points is null or (max_points > 0 and max_points <= 100));

-- `imported` joins the origin list: read out of the rubric document she
-- already marks against, which is neither learned from history nor a starting
-- guess nor typed by hand here.
alter table public.grading_form_categories
  drop constraint if exists grading_form_categories_origin_check;

alter table public.grading_form_categories
  add constraint grading_form_categories_origin_check
  check (origin in ('learned', 'teacher', 'starting', 'imported'));

comment on column public.grading_form_categories.section is
  'The section heading this criterion sits under, e.g. פרק תאורטי. Null for a flat list of learned headings.';

comment on column public.grading_form_categories.max_points is
  'Points this criterion is worth on her rubric. Null when the form carries no point values.';

comment on column public.grading_form_categories.origin is
  'starting = the default set, no history existed yet; learned = carried over from her own past forms; teacher = she wrote it; imported = read out of her own rubric document.';

-- ---------------------------------------------------------------------------
-- How the final grade is composed.
--
-- Her form ends with a block the rubric knows nothing about: the paper is 65%
-- of the grade, the class presentation 10%, and ongoing tasks through the year
-- 25% — that last one a number she enters herself, since nothing in Margin
-- ever sees it.
--
-- On `courses` rather than in a table of its own: it is three numbers that
-- belong to a course-year, they are read together or not at all, and they are
-- never queried across courses. `jsonb` keeps the labels she wrote next to the
-- percentages, so a form that weights a fourth thing next year needs no
-- migration.
--
-- Nullable, and meaning it: a course with no weighting has no final-grade
-- arithmetic, and the screen must say so rather than dividing by a default.
-- ---------------------------------------------------------------------------

alter table public.courses
  add column if not exists grade_weights jsonb;

comment on column public.courses.grade_weights is
  'How the final grade is composed, as [{name, percent}] read from her rubric document. Null when the course has no weighting.';
