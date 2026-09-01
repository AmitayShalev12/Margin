-- ===========================================================================
-- The model's answer to her objection, per criterion.
--
-- The other half of "משא ומתן כזה": she replies to the reasoning, and it
-- answers — either revising the score or saying why it stands.
--
-- One exchange, not a thread. She writes, it answers, and if she is still not
-- satisfied she edits her note and asks again. A growing transcript per
-- criterion would be seventeen conversations to read back before signing a
-- grade, which is more work than the form saves.
--
-- No column records which note the reply answered, because it never needs
-- one: editing `teacher_note` clears `model_reply` outright. An answer to a
-- sentence she has since rewritten is not stale, it is wrong, and the only
-- safe thing to do with it is delete it.
-- ===========================================================================

alter table public.grading_criterion_scores
  add column if not exists model_reply text;

comment on column public.grading_criterion_scores.model_reply is
  'The model''s response to the teacher''s note on this criterion. Cleared whenever her note changes, so it always answers the note currently beside it.';
