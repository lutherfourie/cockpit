# RLS Audit

Date: 2026-05-29

## Scope

Audited the migration history under `supabase/migrations/` for all created `public.*` tables. The task requirement was to verify that every public table has row level security scoped to `user_id = (select auth.uid())`, and to add a new migration only if a fix was needed.

Supabase guidance and examples use owner-scoped policies such as `user_id = (select auth.uid())` / `(select auth.uid()) = user_id`, and recommend wrapping `auth.uid()` in `select` so Postgres can cache the function result per statement.

## Public Tables

| Table | Migration | RLS enabled | Grants | Owner-scoped policies | Finding |
| --- | --- | --- | --- | --- | --- |
| `public.cockpit_sessions` | `20260517152032_create_cockpit_memory.sql` | Yes | `select, insert, update, delete` to `authenticated` | `select`, `insert`, `update`, `delete` use `user_id = (select auth.uid())` | Compliant |
| `public.parking_lot_items` | `20260517152032_create_cockpit_memory.sql` | Yes | `select, insert, update, delete` to `authenticated` | `select`, `insert`, `update`, `delete` use `user_id = (select auth.uid())` | Compliant |
| `public.handoffs` | `20260517152032_create_cockpit_memory.sql` | Yes | `select, insert, update, delete` to `authenticated` | `select`, `insert`, `update`, `delete` use `user_id = (select auth.uid())` | Compliant |
| `public.cockpit_chat_messages` | `20260517194708_add_cockpit_chat_messages.sql` | Yes | `select, insert, update, delete` to `authenticated` | `select`, `insert`, `update`, `delete` use `user_id = (select auth.uid())` | Compliant |
| `public.cockpit_assistant_events` | `20260518061342_add_cockpit_assistant_events.sql` | Yes | `select, insert` to `authenticated` | `select` and `insert` use `user_id = (select auth.uid())` | Compliant as an append-only table |

## Notes

- The migration history contains exactly five `create table public.*` statements, all listed above.
- No migration disables row level security for these tables.
- No migration uses the less-performant `user_id = auth.uid()` form.
- No migration grants update or delete on `public.cockpit_assistant_events`; the table is append-only for authenticated users, and its exposed operations are covered by owner-scoped policies.
- `public.cockpit_assistant_events` is added to `supabase_realtime` after RLS is enabled and owner-scoped `select` / `insert` policies are defined.

## Conclusion

No corrective migration is needed. Every public table currently created by the Supabase migrations has RLS enabled and authenticated access scoped to `user_id = (select auth.uid())` for each granted operation.
