-- ===========================================================================
-- A Drive folder per student.
--
-- Asked for with the home screen: "דף הבית מכיל את רשימת התלמידות וכתובת
-- התיקיות שלהם... כרגע מפאנל נפרד של שיוך תיקייה לקורס-תלמידה."
--
-- Until now a folder was a property of the course: one watched folder holding
-- everyone's work. That is one way she runs it, and not the way she described
-- here — a folder per girl, which is also how a student who shares a folder
-- rather than a file actually hands work in.
--
-- On `students` rather than on a join table, because the roster is already
-- per course: a student row belongs to one course, so student-and-course is
-- the grain this column already has. A join table would add a second place
-- for the same fact to live and a second place for it to go stale.
--
-- Null is the ordinary state and stays supported: the course-wide folder and
-- "shared with me" both work without it.
-- ===========================================================================

alter table public.students
  add column if not exists drive_folder_id text;

comment on column public.students.drive_folder_id is
  'This student''s own Drive folder, when she has one. Null means her work arrives through the course folder or by sharing.';
