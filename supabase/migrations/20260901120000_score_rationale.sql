-- ===========================================================================
-- Why each criterion got the score it got.
--
-- Asked for by ליאורה after testing:
--
--   "אני אשמח שאנחנו נבקש מקלוד שעל כל פרמטר יהיה לו גם הסבר למה הוא נותן את
--    הציון הזה... נגיד נתן על מאמרים עדכניים חמש מתוך שמונה, שיכתוב לי, לא כל
--    המקורות היו עדכניים... כדי שנוכל לעקוב אחרי הרציונל שלו."
--
-- Distinct from `change_note`, which answers a different question. That one
-- says what moved since the previous round; this says why the number is what
-- it is at all, and it is wanted on every criterion every time, including the
-- ones that have never moved.
--
-- `rationale_points` is the score the explanation was written for, and it is
-- the whole reason this is two columns rather than one. She can now override
-- any score by hand, and an explanation of 5 sitting under a 7 she typed
-- herself is worse than no explanation: it reads as a justification of her own
-- number, in a voice that never made that judgement. Storing what it was
-- written for lets the screen say so instead.
-- ===========================================================================

alter table public.grading_criterion_scores
  add column if not exists rationale text,
  add column if not exists rationale_points integer;

comment on column public.grading_criterion_scores.rationale is
  'The model''s own reasoning for this score, in its words. Never the teacher''s.';

comment on column public.grading_criterion_scores.rationale_points is
  'The score the rationale was written for. When it differs from points, the teacher has changed the score and the explanation no longer describes it.';
