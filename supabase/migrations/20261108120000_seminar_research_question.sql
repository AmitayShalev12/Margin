-- ===========================================================================
-- Seminar courses, and each student's research question in them.
--
-- The question belongs to a student in one course, so it sits on the enrollment.
-- Additive: new nullable or defaulted columns, and nothing existing changes.
-- ===========================================================================

alter table public.courses
  add column if not exists is_seminar boolean not null default false,
  add column if not exists asks_research_question boolean not null default false;

alter table public.course_students
  add column if not exists research_question text;
