-- ===========================================================================
-- The message templates she writes herself, one row per slot.
-- Additive: a new table, and nothing existing changes.
-- ===========================================================================

create table if not exists public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  slot       integer not null check (slot between 1 and 20),
  title      text not null default '',
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, slot)
);

alter table public.message_templates enable row level security;

create policy message_templates_owner on public.message_templates
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());
