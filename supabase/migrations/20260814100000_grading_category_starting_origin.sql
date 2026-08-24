-- Tells a starting heading apart from one learned from her own past forms.
--
-- `buildCategories` falls back to a fixed set when a course has no history to
-- learn from, and stamped those rows `origin: 'learned'` because the column
-- allowed nothing else. So the record said the app had derived her headings
-- from her previous years when it had done no such thing — the same failure as
-- a grading form built from fixtures: plausible-looking output rather than an
-- error, which is the kind that goes unnoticed for months.
--
-- Nothing in the app reads this column yet. It is being corrected now precisely
-- because nothing depends on it, and because next year's `buildCategories`
-- reads this year's rows back as history.

alter table public.grading_form_categories
  drop constraint if exists grading_form_categories_origin_check;

alter table public.grading_form_categories
  add constraint grading_form_categories_origin_check
  check (origin in ('learned', 'teacher', 'starting'));

comment on column public.grading_form_categories.origin is
  'starting = the default set, no history existed yet; learned = carried over from her own past forms; teacher = she wrote it.';
