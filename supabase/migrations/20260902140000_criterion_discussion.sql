-- ===========================================================================
-- The argument over a criterion, kept in order.
--
-- It started as one exchange — her note, its answer — and she asked for the
-- rest of it: "make the 'להגיב להסבר' a back and forth conversation and give
-- it the option to change the score there". Which is what a negotiation
-- actually is. One round is a comment box; several is a discussion she can
-- follow back afterwards and see how the number moved.
--
-- A jsonb array rather than a table of turns. The whole thread is read and
-- written together, always in order, and never queried across criteria — so a
-- table would buy joins and a policy for something that is only ever one
-- column of one row. It inherits the row's RLS by sitting inside it.
--
-- Each turn is `{ role, text, at }`, plus `points` on the turns that moved the
-- score. That is what makes the thread readable a month later: not just who
-- said what, but which sentence changed the mark.
-- ===========================================================================

alter table public.grading_criterion_scores
  add column if not exists discussion jsonb not null default '[]'::jsonb;

-- The single exchange becomes the first turns of the thread, in the order it
-- happened. Nothing she wrote is lost to the new shape.
update public.grading_criterion_scores
   set discussion = (
         case when teacher_note is null or btrim(teacher_note) = '' then '[]'::jsonb
              else jsonb_build_array(jsonb_build_object(
                     'role', 'teacher',
                     'text', teacher_note,
                     'at', to_char(coalesce(updated_at, now()) at time zone 'utc',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
         end
         ||
         case when model_reply is null or btrim(model_reply) = '' then '[]'::jsonb
              else jsonb_build_array(jsonb_build_object(
                     'role', 'model',
                     'text', model_reply,
                     'at', to_char(coalesce(updated_at, now()) at time zone 'utc',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                     'points', to_jsonb(points)))
         end
       )
 where discussion = '[]'::jsonb
   and (teacher_note is not null or model_reply is not null);

-- Dropped only after the backfill above has moved them.
alter table public.grading_criterion_scores drop column if exists teacher_note;
alter table public.grading_criterion_scores drop column if exists model_reply;

comment on column public.grading_criterion_scores.discussion is
  'The exchange over this criterion, oldest first. Each turn is {role: teacher|model, text, at}, with points on the turns that changed the score.';
