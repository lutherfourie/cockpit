create table public.cockpit_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.cockpit_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index cockpit_chat_messages_user_session_idx
  on public.cockpit_chat_messages (user_id, session_id, created_at desc);

alter table public.cockpit_chat_messages enable row level security;

grant select, insert, update, delete on public.cockpit_chat_messages to authenticated;

create policy "cockpit_chat_messages_select_own"
  on public.cockpit_chat_messages
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "cockpit_chat_messages_insert_own"
  on public.cockpit_chat_messages
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "cockpit_chat_messages_update_own"
  on public.cockpit_chat_messages
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "cockpit_chat_messages_delete_own"
  on public.cockpit_chat_messages
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
