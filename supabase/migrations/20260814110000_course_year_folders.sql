-- Drive organised course → year, for work the teacher does not own.
--
-- The old model assumed one folder per course and, in practice, that the
-- documents lived on the teacher's own account. The real workflow is the other
-- way round: each student keeps her own document and moves it into a year
-- folder the teacher shares with her. The file stays hers.
--
-- Two consequences for this table.
--
-- `drive_course_folder_id` is the course's root folder — the one that holds a
-- folder per year. `drive_folder_id` keeps its meaning, "where submissions for
-- this course arrive", which under the new structure is the *year* folder. So
-- existing rows are already correct and are left exactly as they are: the new
-- column is simply unknown for them, which is true.
--
-- The unique index is what stops two years colliding. One row per course-year
-- was already the shape — `year` has been on this table since the first
-- migration — but nothing enforced it, so the same course could be created
-- twice for one year and each copy would collect half the submissions.

alter table public.courses
  add column if not exists drive_course_folder_id text;

comment on column public.courses.drive_course_folder_id is
  'The course root folder in Drive, holding one folder per year. drive_folder_id is the year folder inside it, where submissions arrive.';

-- Nulls are distinct in Postgres, so a course with no year could still be
-- duplicated — `year` is not null, so that cannot arise here.
create unique index if not exists courses_teacher_name_year_idx
  on public.courses (teacher_id, name, year);
