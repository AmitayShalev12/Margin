-- ===========================================================================
-- Which Gemini model her runs use.
--
-- Beside the key rather than in the code, so that changing it is one click and
-- not a deploy. That matters more than it sounds: the model pinned in
-- `model-config.ts` is a guess about what is good and cheap *today*, and
-- Google ships a new Flash generation every few months. A constant means the
-- app is stuck on whatever was current the last time somebody pushed.
--
-- Null means "the one the server is configured with", which is the working
-- default and what every account has until somebody deliberately changes it.
-- A teacher who never opens this setting is not making a choice, and should
-- not be treated as having made one — which is why this is nullable rather
-- than defaulted to today's model id. If the server default moves, she moves
-- with it; a row defaulted at insert time would pin her to the past.
--
-- Deliberately unconstrained text. The list of valid ids lives at Google and
-- changes without warning, so a CHECK here would start refusing models that
-- work. The app validates against a live `models` call instead, which is the
-- only source that can be right.
--
-- It sits on `model_credentials` because a model choice is only meaningful
-- with a key to spend: the Pro tiers are paid-only, and the shared free-tier
-- key cannot run them whatever this column says.
-- ===========================================================================

alter table public.model_credentials
  add column if not exists model text;

comment on column public.model_credentials.model is
  'Gemini model id for this teacher''s runs. Null means the server default in model-config.ts. Unconstrained on purpose: the valid set lives at Google.';
