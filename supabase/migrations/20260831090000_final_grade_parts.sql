-- The two parts of the grade that Margin never sees.
--
-- Her form composes the final grade from three things:
--
--   ציון העבודה 65%  ·  פרזנטציה 10%  ·  מטלות שוטפות 25%
--
-- Only the first is anything the app can know. The presentation happens in a
-- classroom, and the ongoing tasks are a term's worth of work that never came
-- through Drive — "זה אני אכניס באופן ידני את החלק הזה".
--
-- Per submission rather than per student: a submission is already one student
-- on one assignment, which is exactly the scope a final grade has.
--
-- Nullable, and that is the whole point. Null means she has not entered it,
-- and the final grade must not be computed until both are in — two thirds of a
-- weighted grade is not a draft of it, it is a wrong grade carrying the
-- authority of a number.

alter table public.submissions
  add column if not exists presentation_score integer,
  add column if not exists ongoing_score integer;

alter table public.submissions
  drop constraint if exists submissions_presentation_score_check;

alter table public.submissions
  add constraint submissions_presentation_score_check
  check (presentation_score is null or (presentation_score >= 0 and presentation_score <= 100));

alter table public.submissions
  drop constraint if exists submissions_ongoing_score_check;

alter table public.submissions
  add constraint submissions_ongoing_score_check
  check (ongoing_score is null or (ongoing_score >= 0 and ongoing_score <= 100));

comment on column public.submissions.presentation_score is
  'Her mark out of 100 for the class presentation. Null until she enters it; nothing in Margin can observe it.';

comment on column public.submissions.ongoing_score is
  'Her mark out of 100 for the year''s ongoing tasks. Null until she enters it.';
