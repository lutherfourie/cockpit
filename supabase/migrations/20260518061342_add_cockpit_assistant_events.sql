create table public.cockpit_assistant_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.cockpit_sessions(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
      'artifact',
      'promotion',
      'parked_item',
      'handoff'
    )
  ),
  role text check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index cockpit_assistant_events_user_session_idx
  on public.cockpit_assistant_events (user_id, session_id, created_at desc);

alter table public.cockpit_assistant_events enable row level security;

grant select, insert on public.cockpit_assistant_events to authenticated;

create policy "cockpit_assistant_events_select_own"
  on public.cockpit_assistant_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "cockpit_assistant_events_insert_own"
  on public.cockpit_assistant_events
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.cockpit_assistant_events;
