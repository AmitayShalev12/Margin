-- ===========================================================================
-- Saved conversations with the assistant.
--
-- Kept in the database rather than the browser: sessions now end with the
-- browser, and a shared computer must not keep her chats. Additive.
-- ===========================================================================

create table if not exists public.assistant_conversations (
  id         uuid primary key,
  teacher_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title      text not null default '',
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_conversations_teacher_idx
  on public.assistant_conversations (teacher_id, updated_at desc);

alter table public.assistant_conversations enable row level security;

create policy assistant_conversations_owner on public.assistant_conversations
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());
