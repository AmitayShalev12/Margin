-- ===========================================================================
-- Google Drive credentials, held server-side.
--
-- The refresh token is a long-lived key to a teacher's Drive. It is therefore
-- never sent to the browser: the Edge Functions in `supabase/functions` own
-- the OAuth exchange and mint short-lived access tokens on demand.
--
-- Both tables below are locked to the service role. RLS is enabled with *no
-- policies at all*, which denies every authenticated and anonymous request,
-- and the grants are revoked as well so a misconfigured policy later can't
-- quietly open them up. The service role bypasses RLS, which is how the Edge
-- Functions reach them.
-- ===========================================================================

create table public.google_credentials (
  teacher_id    uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  -- Which scopes the teacher actually consented to, so the app can tell the
  -- difference between "not connected" and "connected without Docs access".
  scope         text not null,
  google_email  text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Single-use, expiring CSRF state for the OAuth round trip. Kept in the
-- database rather than signed into the URL so it can be invalidated the
-- moment it is redeemed.
create table public.google_oauth_states (
  state       text primary key,
  teacher_id  uuid not null references auth.users (id) on delete cascade,
  redirect_to text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes'
);

create index google_oauth_states_expiry_idx on public.google_oauth_states (expires_at);

alter table public.google_credentials enable row level security;
alter table public.google_oauth_states enable row level security;

-- Deliberately no policies: with RLS on and none defined, every request from
-- anon or authenticated is denied. Do not add a policy to these tables.

revoke all on public.google_credentials from anon, authenticated;
revoke all on public.google_oauth_states from anon, authenticated;

create trigger google_credentials_set_updated_at
  before update on public.google_credentials
  for each row execute function public.set_updated_at();

-- Housekeeping: redeemed states are deleted by the callback, but abandoned
-- ones would otherwise accumulate.
create or replace function public.purge_expired_oauth_states()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.google_oauth_states where expires_at < now();
$$;

revoke all on function public.purge_expired_oauth_states() from anon, authenticated;
