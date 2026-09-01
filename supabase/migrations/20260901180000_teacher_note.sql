-- ===========================================================================
-- Her reply to the model's reasoning, per criterion.
--
-- ליאורה, after the rationale landed:
--
--   "אופציה שלי להוסיף הערות בנוסף, או נגיד להגיב לו... אם הוא אומר, זה הסיבה
--    שנתתי ציון כזה וכזה, אז אני אולי יכולה להגיב לו... שתהיה אופציה כזאת,
--    למשא ומתן כזה."
--
-- A column of her own rather than an edit of `rationale`, and the distinction
-- is the point. The rationale is the record of what the model actually said;
-- overwriting it would erase the thing she is replying to, and a disagreement
-- with both halves collapsed into one paragraph is not a negotiation, it is a
-- single voice with no way to tell whose it is.
--
-- So: two columns, two authors, both kept. Hers is the one that wins, and the
-- one that goes on the form.
-- ===========================================================================

alter table public.grading_criterion_scores
  add column if not exists teacher_note text;

comment on column public.grading_criterion_scores.teacher_note is
  'The teacher''s own note on this criterion — her reply to the model''s rationale, or a remark of her own. Always hers, never generated.';
