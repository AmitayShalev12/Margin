-- ===========================================================================
-- The teacher's own Gemini key, held server-side.
--
-- Asked for so she can use her own quota instead of sharing one — the shared
-- free-tier key runs into a per-minute limit the moment two papers are marked
-- in a row, and a rate limit she cannot do anything about is indistinguishable
-- to her from the app being broken.
--
-- Locked down exactly like `google_credentials`, and for the same reason: an
-- API key is a spending credential. RLS is on with **no policies at all**,
-- which denies every anonymous and authenticated request, and the grants are
-- revoked as well so that a policy added later by mistake cannot quietly open
-- it up. Only the service role reaches it, which means only the Edge
-- Functions do.
--
-- The browser therefore never holds the key, never receives it back after
-- saving it, and never calls Gemini directly. What the settings screen can
-- learn about it is one boolean — whether one is set — and that is served by
-- a function that returns exactly that and nothing else.
-- ===========================================================================

create table if not exists public.model_credentials (
  teacher_id uuid primary key references auth.users (id) on delete cascade,
  -- The key itself. Written by the `model-key` function, read by `annotate`.
  api_key    text not null,
  -- Shown back to her so she can tell one key from another without seeing
  -- either: "…a1b2". Four characters identifies a key to the person who
  -- pasted it and is useless to anyone else.
  hint       text not null,
  updated_at timestamptz not null default now()
);

alter table public.model_credentials enable row level security;

-- Deliberately no policies. Do not add one to this table.

revoke all on public.model_credentials from anon, authenticated;

create trigger model_credentials_set_updated_at
  before update on public.model_credentials
  for each row execute function public.set_updated_at();

comment on table public.model_credentials is
  'Per-teacher Gemini API key. Service role only — never readable by the browser.';
