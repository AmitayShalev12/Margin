-- Scores per criterion, and the rounds that may not carry one.
--
-- Her form fills in during the year rather than at the end: each round scores
-- whatever the submitted text supports and leaves the rest alone. Two things
-- have to be stored for that to work, and one of them is a refusal.

-- ---------------------------------------------------------------------------
-- Whether a round may be scored at all.
--
-- The rule she gave is specific, and the early half of it is the important
-- half: the first submission is a single paragraph, and it gets comments and
-- *no score*. Scoring begins from the first part of chapter 1, six or seven
-- pages in.
--
--   "יהיה פעם אחת שהם יגישו פסקה, אז את הפסקה צריך להעריך בלי ציון...
--    לתת רק הערות על הפסקה."
--
-- A score on a paragraph is not a small inaccuracy. It is a number a student
-- reads as a verdict on work she has barely started, and no later correction
-- catches up with it.
--
-- Null means nobody has decided, and the app applies the rule from the amount
-- of text. A value means she decided — that is why this is nullable rather
-- than defaulted: "she chose comments-only" and "it is too short to score"
-- are different facts, and the screen says which.
-- ---------------------------------------------------------------------------

alter table public.submission_rounds
  add column if not exists scoring text;

alter table public.submission_rounds
  drop constraint if exists submission_rounds_scoring_check;

alter table public.submission_rounds
  add constraint submission_rounds_scoring_check
  check (scoring is null or scoring in ('comments_only', 'scored'));

comment on column public.submission_rounds.scoring is
  'comments_only / scored when she has decided; null to let the app decide from the amount of text submitted.';

-- ---------------------------------------------------------------------------
-- One score per criterion per submission.
--
-- Per submission rather than per round: the form is one document that follows
-- the work, not a new sheet each time. `round_number` records which round last
-- moved a score, and `previous_points` keeps the number it moved *from* — so
-- "עלה ב־3 נקודות" is a fact on the row rather than a subtraction against a
-- history that may not have loaded.
--
-- `points` is nullable and that is the whole design. Null is "not assessable
-- yet", which is a real and common state — the research chapter does not exist
-- in November — and it must never render as a zero.
-- ---------------------------------------------------------------------------

create table if not exists public.grading_criterion_scores (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.submissions (id) on delete cascade,
  category_id     uuid not null references public.grading_form_categories (id) on delete cascade,

  -- Null = not assessable yet. Never a zero standing in for "don't know".
  points          integer,
  -- The value before this round moved it, so the change is readable on its own.
  previous_points integer,

  -- draft = provisional, from a partial paper. final = she has settled it.
  status          text not null default 'draft'
                    check (status in ('draft', 'final')),

  -- What changed since the previous round, in the words shown to her:
  -- "הוסיפה סקירה של שני מחקרים עדכניים, והשערות המחקר מוגדרות עכשיו."
  change_note     text,

  -- Which round last moved this score.
  round_number    integer not null default 1,

  origin          text not null default 'ai'
                    check (origin in ('ai', 'teacher')),
  -- Her hand on it. Once true, no generated score overwrites it.
  edited_by_teacher boolean not null default false,

  scored_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One score per criterion per submission. The form has one line per
  -- criterion, so a second row would be a second form.
  unique (submission_id, category_id)
);

create index if not exists grading_criterion_scores_submission_idx
  on public.grading_criterion_scores (submission_id);

-- A score must be within the criterion it scores. Enforced in the app rather
-- than here, because the maximum lives on `grading_form_categories` and a
-- cross-row check would need a trigger — noted so the absence is deliberate.
alter table public.grading_criterion_scores
  drop constraint if exists grading_criterion_scores_points_check;

alter table public.grading_criterion_scores
  add constraint grading_criterion_scores_points_check
  check (points is null or points >= 0);

-- ---------------------------------------------------------------------------
-- Row level security, same shape as every other table hanging off a
-- submission: the owning teacher, and nobody else.
-- ---------------------------------------------------------------------------

alter table public.grading_criterion_scores enable row level security;

drop policy if exists grading_criterion_scores_owner on public.grading_criterion_scores;

create policy grading_criterion_scores_owner on public.grading_criterion_scores
  for all
  using (public.owns_submission(submission_id))
  with check (public.owns_submission(submission_id));

comment on table public.grading_criterion_scores is
  'One score per rubric criterion per submission, filled in progressively as the work arrives. points null = not assessable yet.';

-- ---------------------------------------------------------------------------
-- Criteria the model may never score.
--
-- Two of hers are permanently hers: 2.2 (שילוב מקורות חב"ד בהשקפה חסידית) and
-- 4.2 (הגשה נאה), which she explained means typesetting — "אני אוכל להעריך את
-- זה בעצמי". Five of the hundred points.
--
-- A column rather than a list of her criterion numbers in the code. Her rubric
-- is not the only rubric, and "2.2 is unscoreable" is true of her form and of
-- nothing else; hardcoding it would quietly mis-handle the next teacher's 2.2.
-- Default false, and she marks them.
-- ---------------------------------------------------------------------------

alter table public.grading_form_categories
  add column if not exists manual_only boolean not null default false;

comment on column public.grading_form_categories.manual_only is
  'True when only the teacher may score this criterion — the model leaves it blank rather than guessing.';
