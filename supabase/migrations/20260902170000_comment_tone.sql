-- ===========================================================================
-- How gently the drafted comments are put.
--
-- Asked for as "an option to choose how graceful it is". A first-year student
-- handing in her first chapter and a fourth-year finishing a seminar paper
-- need the same problems named, and not in the same words.
--
-- On the course rather than on the teacher, because that is where the
-- difference actually lives: the same teacher is gentler with a class meeting
-- research writing for the first time than with one submitting its final
-- paper. Each course-year carries its own, and there are several now.
--
-- The one thing this must never do is change *what* is said. A gentler
-- setting that quietly stopped mentioning a missing citation would be worse
-- than useless — it would be a teacher trusting a review that had been
-- softened by hiding half of it. The prompt says so in as many words; the
-- column only picks the register.
-- ===========================================================================

alter table public.courses
  add column if not exists comment_tone text not null default 'balanced';

alter table public.courses
  drop constraint if exists courses_comment_tone_check;

alter table public.courses
  add constraint courses_comment_tone_check
  check (comment_tone in ('gentle', 'balanced', 'direct'));

comment on column public.courses.comment_tone is
  'Register for drafted comments: gentle, balanced or direct. Changes how a problem is worded, never whether it is raised.';
