create extension if not exists pgcrypto;

create table public.cockpit_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  active_goal text,
  next_action text,
  proof_needed text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.parking_lot_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.cockpit_sessions(id) on delete cascade,
  content text not null,
  source text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.cockpit_sessions(id) on delete cascade,
  target text not null,
  prompt text not null,
  created_at timestamptz not null default now()
);

create index cockpit_sessions_user_status_idx
  on public.cockpit_sessions (user_id, status, updated_at desc);

create index parking_lot_items_user_session_idx
  on public.parking_lot_items (user_id, session_id, created_at desc);

create index handoffs_user_session_idx
  on public.handoffs (user_id, session_id, created_at desc);

alter table public.cockpit_sessions enable row level security;
alter table public.parking_lot_items enable row level security;
alter table public.handoffs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.cockpit_sessions to authenticated;
grant select, insert, update, delete on public.parking_lot_items to authenticated;
grant select, insert, update, delete on public.handoffs to authenticated;

create policy "cockpit_sessions_select_own"
  on public.cockpit_sessions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "cockpit_sessions_insert_own"
  on public.cockpit_sessions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "cockpit_sessions_update_own"
  on public.cockpit_sessions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "cockpit_sessions_delete_own"
  on public.cockpit_sessions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy "parking_lot_items_select_own"
  on public.parking_lot_items
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "parking_lot_items_insert_own"
  on public.parking_lot_items
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "parking_lot_items_update_own"
  on public.parking_lot_items
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "parking_lot_items_delete_own"
  on public.parking_lot_items
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy "handoffs_select_own"
  on public.handoffs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "handoffs_insert_own"
  on public.handoffs
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "handoffs_update_own"
  on public.handoffs
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "handoffs_delete_own"
  on public.handoffs
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
