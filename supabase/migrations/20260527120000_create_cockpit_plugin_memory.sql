create table public.cockpit_plugin_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  namespace text not null,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, namespace, key)
);

create index cockpit_plugin_memory_user_namespace_idx
  on public.cockpit_plugin_memory (user_id, namespace, updated_at desc);

alter table public.cockpit_plugin_memory enable row level security;

grant select, insert, update, delete on public.cockpit_plugin_memory to authenticated;

create policy "cockpit_plugin_memory_select_own"
  on public.cockpit_plugin_memory
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "cockpit_plugin_memory_insert_own"
  on public.cockpit_plugin_memory
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "cockpit_plugin_memory_update_own"
  on public.cockpit_plugin_memory
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "cockpit_plugin_memory_delete_own"
  on public.cockpit_plugin_memory
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
