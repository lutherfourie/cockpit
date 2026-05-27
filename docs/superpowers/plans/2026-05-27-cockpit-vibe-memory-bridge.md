# Cockpit ↔ Vibe Memory Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-team-driven-development to implement this plan in parallel with a specialist team. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the host-mediated, RLS-scoped, per-plugin memory bridge from spec §7 so a plugin can write lane-execution-scoped state into Cockpit's Supabase memory (one-way, last-write-wins) and the operator can view + delete those entries in a memory panel.

**Architecture:** A new `cockpit_plugin_memory` table (RLS owner-scoped, `unique (user_id, namespace, key)` for upsert/LWW) backs a namespaced `HostMemoryApi`. The host injects a `<plugin.id>`-bound `HostMemoryApi` into each plugin at init; the plugin can never supply its own namespace. The Vibe plugin advertises the `memory` capability and passes its handle through `InProcessVibeService`. A `/api/cockpit/plugin-memory` route lists (grouped by namespace) and deletes entries (consulting the plugin's optional `beforeDelete` veto). A read+delete `PluginMemoryPanel` mounts as a new lower surface.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase SSR (cookie-bound, RLS, no service role), Vitest (node + jsdom), Playwright.

**Spec reference:** [docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md](../specs/2026-05-18-cockpit-vibe-integration-design.md) §7.1–§7.9. (The spec header labels memory "Phase 5"; some in-code comments say "Phase 4" — the numbering drifted. This plan is keyed to **spec Section 7**, not a phase number.)

---

## Context: what already exists (read before starting)

Implementers have zero codebase context — this section orients you. Everything below is **current `master`**; do not re-create it.

- **Contract** `src/lib/plugins/contract/types.ts` — defines `CockpitPlugin` (with optional `memoryBridge?: PluginMemoryBridge`), `PluginHostContext` (with `memory: HostMemoryApi`), `PluginCapability = "discovery" | "execution" | "handoff" | "memory"`. The current `HostMemoryApi` (string-typed) and `PluginMemoryBridge` (`{read, write}`) are **Phase 1 placeholders that are unused** — no plugin advertises `memory`. Task 2 replaces them. The change is type-level only (no data migration).
- **Host** `src/lib/plugins/host/plugin-host.ts` — `PluginHost` class; `constructor(context)`, `load(entries)` calls `instance.init(this.context)` (same context for all plugins today), `generateHandoff`, `dispose`, `getPluginStatus`. `src/lib/plugins/host/get-plugin-host.ts` — process-singleton via `getPluginHost()`; `makeDefaultContext()` returns a context whose `memory` is a **no-op** (`get: async () => null`, etc.) with comment "Real implementation in … (spec Section 7)". `resetPluginHostForTesting()` exists. `src/lib/plugins/host/registry.ts` — `buildPluginRegistry()` builds `new VibePlugin(new InProcessVibeService({ repoRoots }))` when `COCKPIT_PLUGINS` includes `vibe`.
- **Vibe** `src/lib/plugins/vibe/vibe-service.ts` (`VibeService` interface: `listLanes`, `generateHandoff`, `dispose`), `src/lib/plugins/vibe/in-process-vibe-service.ts` (`InProcessVibeService implements VibeService`), `src/lib/plugins/vibe/vibe-plugin.ts` (`VibePlugin implements CockpitPlugin`, `capabilities = ["discovery", "handoff"]`, `init(host)` stores context, delegates to a `VibeService`).
- **Persistence** `src/lib/cockpit/supabase-server.ts` — `isSupabaseConfigured()` and `createSupabaseServerClient()` (returns `null` when unconfigured; cookie-bound SSR client; `auth.uid()` from session cookie — **never** service role). `src/lib/cockpit/storage.ts` — `CockpitMemoryStore` pattern with `SupabaseCockpitMemoryStore(supabase, userId)` + `NullCockpitMemoryStore`. Existing routes resolve a user via `createSupabaseServerClient()` → `auth.getUser()` and fall back to a Null store when absent (see `src/app/api/cockpit/chat/route.ts`).
- **Migrations** `supabase/migrations/*.sql` — owner-scoped RLS idiom: `enable row level security`, `grant …`, four `create policy "<table>_<cmd>_own" … using/with check (user_id = (select auth.uid()))`. Latest timestamp is `20260518061342`. **RLS is verified statically** by `src/lib/cockpit/supabase-rls.test.ts` (reads migration files, regex-asserts policies — no live DB).
- **UI** `src/components/cockpit/cockpit-app.tsx` — `type LowerSurface = "evidence" | "openui" | "handoff" | "review" | "lanes"`; the `LowerSurface` component switches on it; a `"lanes"` case renders `<LaneInventoryPanel />`; a `RailButton` per surface lives in the left rail (`hidden … lg:block`). `src/components/cockpit/lane-inventory-panel.tsx` is the model for a fetch-backed panel. Component tests use jsdom + `createRoot` + `vi.fn()` fetch mocks (see `lane-inventory-panel.test.tsx`). E2E in `tests/e2e/*.spec.ts` (`goto("/")`, click rail button by role, skip on `mobile-chrome`).

**Commands:** `pnpm test` (vitest, `src/**/*.test.{ts,tsx}`), `pnpm test:e2e` (Playwright), `pnpm lint`, `pnpm build`. Read the relevant guide in `node_modules/next/dist/docs/` before writing route/server code.

---

## Wave Analysis

### Specialists

| Role | Expertise | Tasks |
|------|-----------|-------|
| backend-engineer | Postgres migrations + RLS, Supabase server client, plugin host, Next.js route handlers | Tasks 1, 3, 5, 6 |
| plugin-engineer | Plugin contract types, `VibeService`/`InProcessVibeService`/`VibePlugin` wiring | Tasks 2, 4 |
| frontend-engineer | React client panels, cockpit-app surface wiring, Playwright e2e | Tasks 7, 8 |

### Waves

**Wave 1: Foundations** — schema and types everything else binds to
- Task 1 (backend-engineer) — `cockpit_plugin_memory` migration + RLS static test
- Task 2 (plugin-engineer) — contract type rewrite (`HostMemoryApi`, `MemoryEntryMeta`, `PluginMemoryBridge`, `VibeMemoryHandle`)

  *Parallel-safe because:* Task 1 touches only `supabase/migrations/**` + `src/lib/cockpit/supabase-rls.test.ts`; Task 2 touches only `src/lib/plugins/contract/**`. No file overlap, no import relationship.

**Wave 2: Two sides of the bridge** — host-side implementation and plugin-side wiring, against the Wave-1 interface
- Task 3 (backend-engineer) — `PluginMemoryStore` + `createHostMemoryApi` (host side)
- Task 4 (plugin-engineer) — `VibeService.memory` + `InProcessVibeService` + `VibePlugin` (plugin side)

  *Parallel-safe because:* Task 3 creates new files under `src/lib/plugins/host/` (`plugin-memory-store.ts`, `host-memory-api.ts`); Task 4 edits `src/lib/plugins/vibe/{vibe-service,in-process-vibe-service,vibe-plugin}.ts`. They share **no files** and do not import each other — both import only the contract **types** from Wave 1.
  *Depends on Wave 1:* Task 2's `HostMemoryApi`/`MemoryEntryMeta`/`VibeMemoryHandle` types; Task 3 also needs Task 1's table for its real (non-faked) behavior.

**Wave 3: Host wiring** — connect the two sides
- Task 5 (backend-engineer) — per-plugin namespaced memory injection + `confirmPluginMemoryDeletion`

  *Parallel-safe because:* only one task in wave.
  *Depends on Wave 2:* Task 3's `createHostMemoryApi`; Task 4's `memoryBridge` / `memory` capability on `VibePlugin`.

**Wave 4: HTTP + UI** — route and panel, built concurrently against a pinned response contract
- Task 6 (backend-engineer) — `/api/cockpit/plugin-memory` GET (grouped list) + DELETE (veto → delete)
- Task 7 (frontend-engineer) — `PluginMemoryPanel` + cockpit-app `"memory"` lower surface

  *Parallel-safe because:* Task 6 creates `src/app/api/cockpit/plugin-memory/**`; Task 7 creates `src/components/cockpit/plugin-memory-panel.tsx` and edits `cockpit-app.tsx`. No shared files; Task 7 calls the route via `fetch` (tested with mocks) and does not import it. **The response contract is pinned in this plan** (see Task 6 / Task 7 "Wire contract") so they need not block on each other.
  *Depends on:* Task 3 (store) + Task 5 (host delete veto) for Task 6; Task 2 (`MemoryEntryMeta`) + the pinned contract for Task 7.

**Wave 5: Integration smoke**
- Task 8 (frontend-engineer) — Playwright e2e: memory surface mounts + empty state

  *Parallel-safe because:* only one task in wave.
  *Depends on Wave 4:* Task 6 (route returns `{groups:[]}` when no user) + Task 7 (panel + rail button).

### Dependency Graph

```
Task 1 ─┐
        ├─→ Task 3 ─┬─→ Task 5 ─┬─→ Task 6 ─┐
Task 2 ─┤           │           │            ├─→ Task 8
        ├─→ Task 4 ─┘           │            │
        └─────────────→ Task 7 ─────────────┘
```

(Task 6 depends on Task 3 and Task 5; Task 7 depends on Task 2; Task 8 depends on Task 6 and Task 7. Acyclic.)

### Lifetime Plan

| Specialist | Waves | Lifetime strategy |
|---|---|---|
| backend-engineer | 1, 2, 3, 4 | Full-session (work in every wave) |
| plugin-engineer | 1, 2 | Full-session through Wave 2, then shut down (no work after Wave 2) |
| frontend-engineer | 4, 5 | Spawn at Wave 4, run Tasks 7 then 8, shut down after Wave 5 |

---

## File Structure

**Create:**
- `supabase/migrations/20260527120000_create_cockpit_plugin_memory.sql`
- `src/lib/plugins/host/plugin-memory-store.ts`
- `src/lib/plugins/host/plugin-memory-store.test.ts`
- `src/lib/plugins/host/host-memory-api.ts`
- `src/lib/plugins/host/host-memory-api.test.ts`
- `src/lib/plugins/contract/memory-types.test.ts`
- `src/app/api/cockpit/plugin-memory/route.ts`
- `src/app/api/cockpit/plugin-memory/route.test.ts`
- `src/components/cockpit/plugin-memory-panel.tsx`
- `src/components/cockpit/plugin-memory-panel.test.tsx`
- `tests/e2e/plugin-memory.spec.ts`

**Modify:**
- `src/lib/cockpit/supabase-rls.test.ts` — add `cockpit_plugin_memory` to `publicTables`
- `src/lib/plugins/contract/types.ts` — replace `HostMemoryApi` + `PluginMemoryBridge`; add `MemoryEntryMeta` + `VibeMemoryHandle`
- `src/lib/plugins/vibe/vibe-service.ts` — add `memory: VibeMemoryHandle` + `attachHostMemory(api)` to the interface
- `src/lib/plugins/vibe/in-process-vibe-service.ts` — implement `memory` + `attachHostMemory`
- `src/lib/plugins/vibe/vibe-plugin.ts` — add `"memory"` capability + wire `host.memory` into the service at init
- `src/lib/plugins/vibe/in-process-vibe-service.test.ts` — memory pass-through tests
- `src/lib/plugins/vibe/vibe-plugin.test.ts` — capability + wiring tests
- `src/lib/plugins/host/plugin-host.ts` — `memoryFactory` ctor arg; per-plugin memory injection; `confirmPluginMemoryDeletion`
- `src/lib/plugins/host/plugin-host.test.ts` — injection + veto tests
- `src/lib/plugins/host/get-plugin-host.ts` — pass real `createHostMemoryApi` factory
- `src/components/cockpit/cockpit-app.tsx` — add `"memory"` lower surface + rail button

---

## Tasks

### [backend-engineer] Task 1: `cockpit_plugin_memory` migration + RLS static test

**Specialist:** backend-engineer
**Depends on:** None
**Produces:** `supabase/migrations/20260527120000_create_cockpit_plugin_memory.sql` — owner-scoped RLS table with `unique (user_id, namespace, key)`. `src/lib/cockpit/supabase-rls.test.ts` extended to assert the new table's policies.
**Plan approval required:** true (schema migration + RLS policies)

**Files:**
- Create: `supabase/migrations/20260527120000_create_cockpit_plugin_memory.sql`
- Modify: `src/lib/cockpit/supabase-rls.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/cockpit/supabase-rls.test.ts`, add `"cockpit_plugin_memory"` to the `publicTables` array (it is a full CRUD table, so it belongs with the other owner-scoped tables):

```ts
const publicTables = [
  "cockpit_sessions",
  "parking_lot_items",
  "handoffs",
  "cockpit_chat_messages",
  "cockpit_plugin_memory",
];
```

This makes the existing assertions (RLS enabled, `grant select, insert, update, delete`, four owner policies, and the `user_id = (select auth.uid())` occurrence count) require the new migration.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/cockpit/supabase-rls.test.ts`
Expected: FAIL — assertions like `expect(sql).toContain("alter table public.cockpit_plugin_memory enable row level security")` fail because the migration does not exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260527120000_create_cockpit_plugin_memory.sql` (verbatim shape from spec §7.6):

```sql
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
```

Do **not** add a `supabase_realtime` publication line (the spec omits it; the RLS test only expects realtime for `cockpit_assistant_events`). Do **not** use `auth.uid()` without the `(select …)` wrapper, and never reference `service_role` or `user_metadata` (the test asserts their absence).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/cockpit/supabase-rls.test.ts`
Expected: PASS.

- [ ] **Step 5: (If local Supabase is up) apply the migration**

If `pnpm exec supabase status` shows the stack running, run `pnpm exec supabase db reset` (or `pnpm exec supabase migration up`) and confirm it applies with no error. If the stack is down, skip — the static test is the authoritative gate for this plan; note "local Supabase down, migration not applied" in the completion report.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260527120000_create_cockpit_plugin_memory.sql src/lib/cockpit/supabase-rls.test.ts
git commit -m "feat(plugins): add cockpit_plugin_memory table with owner-scoped RLS (spec §7.6)"
```

---

### [plugin-engineer] Task 2: Contract types for the memory bridge

**Specialist:** plugin-engineer
**Depends on:** None
**Produces:** `src/lib/plugins/contract/types.ts` with the §7.7 shapes: `HostMemoryApi` (value `unknown`, `list → MemoryEntryMeta[]`), new `MemoryEntryMeta`, replaced `PluginMemoryBridge` (`{ refresh?, beforeDelete? }`), new `VibeMemoryHandle`. Consumed by Tasks 3, 4, 6, 7.

**Scope note:** This task edits **only** `src/lib/plugins/contract/types.ts` (+ a new test). It does **not** touch `VibeService` (that interface lives in `vibe-service.ts` and is Task 4's). Keeping `VibeService` untouched here keeps the build green: the existing no-op `HostMemoryApi` in `get-plugin-host.ts` and the `makeHostContext` test mock already satisfy the new `HostMemoryApi` shape (`async () => null` ⊆ `Promise<unknown | undefined>`, `async () => []` ⊆ `Promise<MemoryEntryMeta[]>`), and nothing implements the old `PluginMemoryBridge`.

**Files:**
- Create: `src/lib/plugins/contract/memory-types.test.ts`
- Modify: `src/lib/plugins/contract/types.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/contract/memory-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type {
  HostMemoryApi,
  MemoryEntryMeta,
  PluginMemoryBridge,
  VibeMemoryHandle,
} from "./types";

describe("memory bridge contract types (spec §7.7)", () => {
  it("HostMemoryApi takes unknown values and lists MemoryEntryMeta", async () => {
    const api: HostMemoryApi = {
      async set(_key: string, _value: unknown) {},
      async get(_key: string): Promise<unknown | undefined> {
        return undefined;
      },
      async list(_prefix?: string): Promise<MemoryEntryMeta[]> {
        return [];
      },
      async delete(_key: string) {},
    };
    await api.set("run:1", { status: "done" });
    expect(await api.list("run:")).toEqual([]);
  });

  it("MemoryEntryMeta exposes bare key + ISO timestamps", () => {
    const meta: MemoryEntryMeta = {
      key: "run:1",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:00.000Z",
    };
    expect(meta.key).toBe("run:1");
  });

  it("PluginMemoryBridge is host-calls-plugin (refresh / beforeDelete), both optional", async () => {
    const empty: PluginMemoryBridge = {};
    const full: PluginMemoryBridge = {
      async refresh() {},
      async beforeDelete(_key: string): Promise<boolean> {
        return true;
      },
    };
    expect(empty.refresh).toBeUndefined();
    expect(await full.beforeDelete!("k")).toBe(true);
  });

  it("VibeMemoryHandle mirrors HostMemoryApi for the service layer", () => {
    const handle: VibeMemoryHandle = {
      async set() {},
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async delete() {},
    };
    expect(typeof handle.set).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/contract/memory-types.test.ts`
Expected: FAIL — `MemoryEntryMeta` and `VibeMemoryHandle` are not exported; `PluginMemoryBridge` still has `{ read, write }`; `HostMemoryApi` still uses `string` values (type errors at compile, surfaced by vitest).

- [ ] **Step 3: Edit the contract types**

In `src/lib/plugins/contract/types.ts`, **replace** the existing `HostMemoryApi` interface (the block beginning `export interface HostMemoryApi {` with `get(key): Promise<string | null>` etc.) with:

```ts
/**
 * Cockpit-mediated, per-plugin memory API (spec §7.7). The host binds the
 * `<plugin.id>` namespace and injects this at init; the plugin supplies only
 * the bare key. Last-write-wins per (user, namespace, key). No-ops when
 * Supabase is unconfigured or no user is signed in.
 */
export interface HostMemoryApi {
  /** Upsert a value under the host-injected namespace. */
  set(key: string, value: unknown): Promise<void>;
  /** Read back a value the plugin previously wrote, or undefined. */
  get(key: string): Promise<unknown | undefined>;
  /** List entry metadata (not values) under this namespace, newest-first. `prefix` filters keys. */
  list(prefix?: string): Promise<MemoryEntryMeta[]>;
  /** Delete one entry. Idempotent. */
  delete(key: string): Promise<void>;
}

/** Metadata for one plugin-memory entry (spec §7.7). */
export interface MemoryEntryMeta {
  /** Bare key, namespace stripped. */
  key: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}
```

Then **replace** the existing `PluginMemoryBridge` interface (the block with `read`/`write`) with:

```ts
/**
 * Optional capability hook exposed BY the plugin TO Cockpit (host→plugin
 * direction, spec §7.7). Most plugins won't override the defaults.
 */
export interface PluginMemoryBridge {
  /** Host invokes on "refresh from plugin"; plugin re-emits anything that belongs in Cockpit. Default: no-op. */
  refresh?(): Promise<void>;
  /** Host invokes BEFORE deleting a key from the UI; return false to refuse. Default: allow. */
  beforeDelete?(key: string): Promise<boolean>;
}

/**
 * Service-layer handle (spec §7.7). Always present on VibeService.memory; a
 * write before the host wires a HostMemoryApi throws (loud failure), reads
 * are inert. Added to the VibeService interface in the plugin-side task.
 */
export interface VibeMemoryHandle {
  set(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown | undefined>;
  list(prefix?: string): Promise<MemoryEntryMeta[]>;
  delete(key: string): Promise<void>;
}
```

Leave `CockpitPlugin.memoryBridge?: PluginMemoryBridge` as-is (its type now points at the new shape). Leave `PluginHostContext.memory: HostMemoryApi` as-is (now the new shape).

- [ ] **Step 4: Run the new test + the full suite to verify no regressions**

Run: `pnpm test src/lib/plugins/contract`
Expected: PASS (both `types.test.ts` and `memory-types.test.ts`).
Run: `pnpm test`
Expected: PASS — confirm the `HostMemoryApi` change did not break `get-plugin-host.ts`'s no-op or `plugin-host.test.ts`'s `makeHostContext`. (It should not: those stubs satisfy the widened shape. If `pnpm test` surfaces a type error there, **do not** edit those files — report it; Task 5 owns them.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/contract/types.ts src/lib/plugins/contract/memory-types.test.ts
git commit -m "feat(plugins): rewrite memory contract types for the §7.7 bridge"
```

---

### [backend-engineer] Task 3: Host-side `PluginMemoryStore` + `createHostMemoryApi`

**Specialist:** backend-engineer
**Depends on:** Task 1 (`cockpit_plugin_memory` table), Task 2 (`HostMemoryApi`, `MemoryEntryMeta`)
**Produces:** `src/lib/plugins/host/plugin-memory-store.ts` (namespaced CRUD store + `listAllPluginMemoryForUser`) and `src/lib/plugins/host/host-memory-api.ts` (`createHostMemoryApi(namespace)` → `HostMemoryApi`, no-op without Supabase/user). Consumed by Tasks 5 and 6.
**Plan approval required:** true (RLS-scoped data access path; §7.8 namespace-isolation correctness)

**Files:**
- Create: `src/lib/plugins/host/plugin-memory-store.ts`
- Create: `src/lib/plugins/host/plugin-memory-store.test.ts`
- Create: `src/lib/plugins/host/host-memory-api.ts`
- Create: `src/lib/plugins/host/host-memory-api.test.ts`

- [ ] **Step 1: Write the failing test for the store**

Create `src/lib/plugins/host/plugin-memory-store.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  PluginMemoryStore,
  listAllPluginMemoryForUser,
} from "./plugin-memory-store";

type Result = { data: unknown; error: unknown };

function makeSupabaseFake(result: Result) {
  const eqCalls: [string, unknown][] = [];
  const state: {
    upsert?: { row: Record<string, unknown>; opts: unknown };
    like?: [string, unknown];
    deleted: boolean;
  } = { deleted: false };

  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    like: (col: string, val: unknown) => {
      state.like = [col, val];
      return builder;
    },
    order: () => builder,
    maybeSingle: () => Promise.resolve(result),
    upsert: (row: Record<string, unknown>, opts: unknown) => {
      state.upsert = { row, opts };
      return Promise.resolve({ error: null });
    },
    delete: () => {
      state.deleted = true;
      return builder;
    },
    then: (onF: (v: Result) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onF, onR),
  });

  const supabase = { from: () => builder } as unknown as SupabaseClient;
  return { supabase, eqCalls, state };
}

describe("PluginMemoryStore", () => {
  it("set upserts with the host-bound namespace and conflict target", async () => {
    const fake = makeSupabaseFake({ data: null, error: null });
    const store = new PluginMemoryStore(fake.supabase, "user-1", "vibe");
    await store.set("run:1", { status: "done" });
    expect(fake.state.upsert?.row).toMatchObject({
      user_id: "user-1",
      namespace: "vibe",
      key: "run:1",
      value: { status: "done" },
    });
    expect(fake.state.upsert?.opts).toEqual({ onConflict: "user_id,namespace,key" });
  });

  it("get scopes by user_id + namespace + key and returns the value", async () => {
    const fake = makeSupabaseFake({ data: { value: { n: 1 } }, error: null });
    const store = new PluginMemoryStore(fake.supabase, "user-1", "vibe");
    const value = await store.get("run:1");
    expect(value).toEqual({ n: 1 });
    expect(fake.eqCalls).toEqual([
      ["user_id", "user-1"],
      ["namespace", "vibe"],
      ["key", "run:1"],
    ]);
  });

  it("get returns undefined when the row is absent", async () => {
    const fake = makeSupabaseFake({ data: null, error: null });
    const store = new PluginMemoryStore(fake.supabase, "user-1", "vibe");
    expect(await store.get("missing")).toBeUndefined();
  });

  it("list maps rows to MemoryEntryMeta and applies a prefix LIKE", async () => {
    const fake = makeSupabaseFake({
      data: [
        { key: "run:2", created_at: "t1", updated_at: "t2" },
        { key: "run:1", created_at: "t0", updated_at: "t1" },
      ],
      error: null,
    });
    const store = new PluginMemoryStore(fake.supabase, "user-1", "vibe");
    const entries = await store.list("run:");
    expect(entries).toEqual([
      { key: "run:2", createdAt: "t1", updatedAt: "t2" },
      { key: "run:1", createdAt: "t0", updatedAt: "t1" },
    ]);
    expect(fake.state.like).toEqual(["key", "run:%"]);
  });

  it("delete scopes by user_id + namespace + key", async () => {
    const fake = makeSupabaseFake({ data: null, error: null });
    const store = new PluginMemoryStore(fake.supabase, "user-1", "vibe");
    await store.delete("run:1");
    expect(fake.state.deleted).toBe(true);
    expect(fake.eqCalls).toEqual([
      ["user_id", "user-1"],
      ["namespace", "vibe"],
      ["key", "run:1"],
    ]);
  });

  it("listAllPluginMemoryForUser returns rows across namespaces with values", async () => {
    const fake = makeSupabaseFake({
      data: [
        { namespace: "vibe", key: "run:1", value: { a: 1 }, created_at: "t0", updated_at: "t1" },
      ],
      error: null,
    });
    const rows = await listAllPluginMemoryForUser(fake.supabase, "user-1");
    expect(rows).toEqual([
      { namespace: "vibe", key: "run:1", value: { a: 1 }, createdAt: "t0", updatedAt: "t1" },
    ]);
    expect(fake.eqCalls).toEqual([["user_id", "user-1"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/host/plugin-memory-store.test.ts`
Expected: FAIL — `Cannot find module './plugin-memory-store'`.

- [ ] **Step 3: Write `plugin-memory-store.ts`**

Create `src/lib/plugins/host/plugin-memory-store.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemoryEntryMeta } from "../contract/types";

const TABLE = "cockpit_plugin_memory";

export interface PluginMemoryRow {
  namespace: string;
  key: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

/**
 * User-scoped store bound to a single plugin namespace. The namespace is bound
 * at construction by the host (spec §7.7) — a plugin can never write outside
 * it. Every query also scopes `user_id` defensively even though RLS already
 * enforces it (spec §7.8), keeping the (user_id, namespace, updated_at) index hot.
 */
export class PluginMemoryStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
    private readonly namespace: string,
  ) {}

  async set(key: string, value: unknown): Promise<void> {
    await this.supabase.from(TABLE).upsert(
      {
        user_id: this.userId,
        namespace: this.namespace,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,namespace,key" },
    );
  }

  async get(key: string): Promise<unknown | undefined> {
    const { data } = await this.supabase
      .from(TABLE)
      .select("value")
      .eq("user_id", this.userId)
      .eq("namespace", this.namespace)
      .eq("key", key)
      .maybeSingle();
    return data ? (data as { value: unknown }).value : undefined;
  }

  async list(prefix?: string): Promise<MemoryEntryMeta[]> {
    const { data } = await this.supabase
      .from(TABLE)
      .select("key,created_at,updated_at")
      .eq("user_id", this.userId)
      .eq("namespace", this.namespace)
      .like("key", prefix ? `${prefix}%` : "%")
      .order("updated_at", { ascending: false });
    return ((data as { key: string; created_at: string; updated_at: string }[]) ?? []).map(
      (r) => ({ key: r.key, createdAt: r.created_at, updatedAt: r.updated_at }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.supabase
      .from(TABLE)
      .delete()
      .eq("user_id", this.userId)
      .eq("namespace", this.namespace)
      .eq("key", key);
  }
}

/**
 * User-scoped read across ALL namespaces — for the memory-panel UI, which
 * groups entries by plugin id. Distinct from the plugin-facing namespaced
 * `list()` (spec §7.5).
 */
export async function listAllPluginMemoryForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<PluginMemoryRow[]> {
  const { data } = await supabase
    .from(TABLE)
    .select("namespace,key,value,created_at,updated_at")
    .eq("user_id", userId)
    .order("namespace", { ascending: true })
    .order("updated_at", { ascending: false });
  return (
    (data as
      | { namespace: string; key: string; value: unknown; created_at: string; updated_at: string }[]
      | null) ?? []
  ).map((r) => ({
    namespace: r.namespace,
    key: r.key,
    value: r.value,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
```

- [ ] **Step 4: Run store test to verify it passes**

Run: `pnpm test src/lib/plugins/host/plugin-memory-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the host memory api**

Create `src/lib/plugins/host/host-memory-api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createHostMemoryApi } from "./host-memory-api";
import type { PluginMemoryStore } from "./plugin-memory-store";

describe("createHostMemoryApi", () => {
  it("binds the namespace from the host, not the caller, and delegates to the store", async () => {
    const set = vi.fn(async () => {});
    const namespaces: string[] = [];
    const fakeStore = { set } as unknown as PluginMemoryStore;
    const api = createHostMemoryApi("vibe", async (ns) => {
      namespaces.push(ns);
      return fakeStore;
    });
    await api.set("run:1", { ok: true });
    expect(set).toHaveBeenCalledWith("run:1", { ok: true });
    expect(namespaces).toEqual(["vibe"]); // always the bound namespace
  });

  it("no-ops when no store is available (Supabase unconfigured / no user)", async () => {
    const api = createHostMemoryApi("vibe", async () => null);
    await expect(api.set("k", 1)).resolves.toBeUndefined();
    await expect(api.get("k")).resolves.toBeUndefined();
    await expect(api.list()).resolves.toEqual([]);
    await expect(api.delete("k")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/host/host-memory-api.test.ts`
Expected: FAIL — `Cannot find module './host-memory-api'`.

- [ ] **Step 7: Write `host-memory-api.ts`**

Create `src/lib/plugins/host/host-memory-api.ts`:

```ts
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/cockpit/supabase-server";
import type { HostMemoryApi } from "../contract/types";
import { PluginMemoryStore } from "./plugin-memory-store";

/**
 * Resolve a request-scoped, namespaced store, or null when Supabase is not
 * configured / no user is signed in. The namespace is bound here by the host
 * (spec §7.7); the plugin never supplies it.
 */
export type StoreResolver = (namespace: string) => Promise<PluginMemoryStore | null>;

export const defaultStoreResolver: StoreResolver = async (namespace) => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return new PluginMemoryStore(supabase, user.id, namespace);
};

/**
 * Build a HostMemoryApi bound to one plugin namespace. All operations resolve
 * a fresh request-scoped store per call (the SSR client is cookie-bound, so
 * auth.uid() reflects the live request). When no store is available the
 * operations are inert — matching the "memory tools no-op without Supabase +
 * a signed-in user" rule (AGENTS.md).
 */
export function createHostMemoryApi(
  namespace: string,
  resolve: StoreResolver = defaultStoreResolver,
): HostMemoryApi {
  return {
    async set(key, value) {
      const store = await resolve(namespace);
      if (store) await store.set(key, value);
    },
    async get(key) {
      const store = await resolve(namespace);
      return store ? store.get(key) : undefined;
    },
    async list(prefix) {
      const store = await resolve(namespace);
      return store ? store.list(prefix) : [];
    },
    async delete(key) {
      const store = await resolve(namespace);
      if (store) await store.delete(key);
    },
  };
}
```

- [ ] **Step 8: Run both new tests to verify they pass**

Run: `pnpm test src/lib/plugins/host/plugin-memory-store.test.ts src/lib/plugins/host/host-memory-api.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/plugins/host/plugin-memory-store.ts src/lib/plugins/host/plugin-memory-store.test.ts src/lib/plugins/host/host-memory-api.ts src/lib/plugins/host/host-memory-api.test.ts
git commit -m "feat(plugins): namespaced PluginMemoryStore + createHostMemoryApi (spec §7.7/§7.8)"
```

---

### [plugin-engineer] Task 4: Plugin-side bridge — `VibeService.memory` + `InProcessVibeService` + `VibePlugin`

**Specialist:** plugin-engineer
**Depends on:** Task 2 (`VibeMemoryHandle`, `HostMemoryApi`, `MemoryEntryMeta`)
**Produces:** `VibeService` interface gains `memory: VibeMemoryHandle` + `attachHostMemory(api)`. `InProcessVibeService` implements them (pass-through; writes throw before attach). `VibePlugin` advertises the `"memory"` capability and wires `host.memory` into the service at init. Consumed by Task 5.

**Build-green note:** Adding `memory`/`attachHostMemory` to the `VibeService` **interface** and to `InProcessVibeService` happens in this one task, so the build never sees an interface the implementation doesn't satisfy.

**Files:**
- Modify: `src/lib/plugins/vibe/vibe-service.ts`
- Modify: `src/lib/plugins/vibe/in-process-vibe-service.ts`
- Modify: `src/lib/plugins/vibe/vibe-plugin.ts`
- Modify: `src/lib/plugins/vibe/in-process-vibe-service.test.ts`
- Modify: `src/lib/plugins/vibe/vibe-plugin.test.ts`

- [ ] **Step 1: Write the failing tests for the service**

Append to `src/lib/plugins/vibe/in-process-vibe-service.test.ts` (keep existing imports; add `vi` if not present):

```ts
import type { HostMemoryApi } from "../contract/types";

describe("InProcessVibeService.memory", () => {
  it("throws on write before a HostMemoryApi is attached", async () => {
    const svc = new InProcessVibeService({ repoRoots: [] });
    await expect(svc.memory.set("k", 1)).rejects.toThrow(/not attached|not wired/i);
    await expect(svc.memory.delete("k")).rejects.toThrow(/not attached|not wired/i);
  });

  it("reads are inert before attach", async () => {
    const svc = new InProcessVibeService({ repoRoots: [] });
    expect(await svc.memory.get("k")).toBeUndefined();
    expect(await svc.memory.list()).toEqual([]);
  });

  it("passes through to the attached HostMemoryApi", async () => {
    const calls: string[] = [];
    const api: HostMemoryApi = {
      async set(key) {
        calls.push(`set:${key}`);
      },
      async get(key) {
        calls.push(`get:${key}`);
        return { ok: true };
      },
      async list() {
        return [{ key: "run:1", createdAt: "t", updatedAt: "t" }];
      },
      async delete(key) {
        calls.push(`delete:${key}`);
      },
    };
    const svc = new InProcessVibeService({ repoRoots: [] });
    svc.attachHostMemory(api);
    await svc.memory.set("run:1", { a: 1 });
    expect(await svc.memory.get("run:1")).toEqual({ ok: true });
    expect(await svc.memory.list("run:")).toHaveLength(1);
    await svc.memory.delete("run:1");
    expect(calls).toEqual(["set:run:1", "get:run:1", "delete:run:1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/vibe/in-process-vibe-service.test.ts`
Expected: FAIL — `svc.memory` / `svc.attachHostMemory` do not exist.

- [ ] **Step 3: Add `memory` + `attachHostMemory` to the `VibeService` interface**

In `src/lib/plugins/vibe/vibe-service.ts`, extend the imports and the interface:

```ts
import type {
  HandoffArtifact,
  HandoffTarget,
  HostMemoryApi,
  LaneSummary,
  VibeMemoryHandle,
} from "../contract/types";
```

Add these two members to the `VibeService` interface (e.g., just before `dispose()`):

```ts
  /**
   * Service-layer memory handle (spec §7.7). Pass-through to the host-injected
   * HostMemoryApi; writes throw until `attachHostMemory` has been called.
   */
  readonly memory: VibeMemoryHandle;

  /**
   * Called once by the plugin at init with the host-provided, namespace-bound
   * HostMemoryApi. Wires the `memory` handle's pass-through target.
   */
  attachHostMemory(api: HostMemoryApi): void;
```

- [ ] **Step 4: Implement `memory` + `attachHostMemory` on `InProcessVibeService`**

In `src/lib/plugins/vibe/in-process-vibe-service.ts`, extend the type import:

```ts
import type {
  HandoffArtifact,
  HandoffTarget,
  HostMemoryApi,
  LaneSummary,
  VibeMemoryHandle,
} from "../contract/types";
```

Add a private field and the two members to the class (place near the top of the class body / alongside `dispose`):

```ts
  private hostMemory: HostMemoryApi | null = null;

  attachHostMemory(api: HostMemoryApi): void {
    this.hostMemory = api;
  }

  get memory(): VibeMemoryHandle {
    const requireApi = (): HostMemoryApi => {
      if (!this.hostMemory) {
        throw new Error(
          "VibeService memory is not attached: no HostMemoryApi wired at init.",
        );
      }
      return this.hostMemory;
    };
    return {
      set: (key, value) => requireApi().set(key, value),
      delete: (key) => requireApi().delete(key),
      get: async (key) => (this.hostMemory ? this.hostMemory.get(key) : undefined),
      list: async (prefix) => (this.hostMemory ? this.hostMemory.list(prefix) : []),
    };
  }
```

(Writes — `set`/`delete` — throw when unattached so internal bugs surface loudly; reads — `get`/`list` — are inert, per spec §7.7.)

- [ ] **Step 5: Run service test to verify it passes**

Run: `pnpm test src/lib/plugins/vibe/in-process-vibe-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing tests for the plugin wiring**

In `src/lib/plugins/vibe/vibe-plugin.test.ts`, add (reuse the file's existing harness; if it lacks a fake service, add one). These tests assert the `memory` capability and that init wires `host.memory` into the service:

```ts
import { describe, expect, it, vi } from "vitest";

import type { HostMemoryApi, PluginHostContext, VibeMemoryHandle } from "../contract/types";
import type { VibeService } from "./vibe-service";
import { VibePlugin } from "./vibe-plugin";

function makeFakeService(): VibeService & { attachHostMemory: ReturnType<typeof vi.fn> } {
  const handle: VibeMemoryHandle = {
    async set() {},
    async get() {
      return undefined;
    },
    async list() {
      return [];
    },
    async delete() {},
  };
  return {
    listLanes: async () => [],
    generateHandoff: async () => null,
    dispose: async () => {},
    memory: handle,
    attachHostMemory: vi.fn(),
  };
}

function makeHostContext(memory: HostMemoryApi): PluginHostContext {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: new Map(),
    memory,
    events: { emit: vi.fn() },
  };
}

describe("VibePlugin memory capability", () => {
  it("advertises the memory capability", () => {
    const plugin = new VibePlugin(makeFakeService());
    expect(plugin.capabilities).toContain("memory");
  });

  it("attaches host.memory to the service at init", async () => {
    const service = makeFakeService();
    const plugin = new VibePlugin(service);
    const hostMemory: HostMemoryApi = {
      async set() {},
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async delete() {},
    };
    await plugin.init(makeHostContext(hostMemory));
    expect(service.attachHostMemory).toHaveBeenCalledWith(hostMemory);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/vibe/vibe-plugin.test.ts`
Expected: FAIL — capability list lacks `"memory"`; `attachHostMemory` not called in `init`.

- [ ] **Step 8: Wire the plugin**

In `src/lib/plugins/vibe/vibe-plugin.ts`:

1. Add `"memory"` to the capabilities array:

```ts
  readonly capabilities: readonly PluginCapability[] = ["discovery", "handoff", "memory"];
```

2. In `init`, after storing the context, attach the host memory to the service:

```ts
  async init(host: PluginHostContext): Promise<void> {
    this.context = host;
    this.service.attachHostMemory(host.memory);
    host.log.info("vibe plugin initialized");
  }
```

Do **not** add a `memoryBridge` — VibePlugin keeps the default allow-delete behavior (spec §7.7: "most plugins won't override the defaults"). The host treats a missing `beforeDelete` as "allow" (Task 5).

- [ ] **Step 9: Run plugin test + the vibe suite to verify they pass**

Run: `pnpm test src/lib/plugins/vibe`
Expected: PASS (service + plugin tests).

- [ ] **Step 10: Commit**

```bash
git add src/lib/plugins/vibe/vibe-service.ts src/lib/plugins/vibe/in-process-vibe-service.ts src/lib/plugins/vibe/vibe-plugin.ts src/lib/plugins/vibe/in-process-vibe-service.test.ts src/lib/plugins/vibe/vibe-plugin.test.ts
git commit -m "feat(plugins): wire Vibe plugin-side memory bridge (capability + pass-through, spec §7.7)"
```

---

### [backend-engineer] Task 5: Host wiring — per-plugin namespace injection + delete veto

**Specialist:** backend-engineer
**Depends on:** Task 3 (`createHostMemoryApi`), Task 4 (`VibePlugin` advertises `memory`; `memoryBridge.beforeDelete` shape)
**Produces:** `PluginHost` injects a `<plugin.id>`-bound `HostMemoryApi` into each plugin's init context and exposes `confirmPluginMemoryDeletion(pluginId, key)`. `getPluginHost()` supplies the real `createHostMemoryApi` factory. Consumed by Task 6.

**Files:**
- Modify: `src/lib/plugins/host/plugin-host.ts`
- Modify: `src/lib/plugins/host/get-plugin-host.ts`
- Modify: `src/lib/plugins/host/plugin-host.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/plugins/host/plugin-host.test.ts` (the file already has `makeMockPlugin`/`makeHostContext`; `makeMockPlugin` spreads overrides so you can inject `init`, `memoryBridge`, `capabilities`):

```ts
import type { HostMemoryApi } from "../contract/types";

describe("PluginHost memory wiring", () => {
  it("injects a namespace-bound HostMemoryApi into each plugin's init context", async () => {
    const seen: Record<string, HostMemoryApi> = {};
    const memoryFactory = (namespace: string): HostMemoryApi => ({
      // tag the api by namespace so we can assert which plugin got which
      async set(key) {
        seen[namespace] = seen[namespace];
        (seen[namespace] as unknown as { lastKey?: string }).lastKey = key;
      },
      async get() {
        return namespace; // identity probe
      },
      async list() {
        return [];
      },
      async delete() {},
    });

    const captured: Record<string, HostMemoryApi> = {};
    const host = new PluginHost(makeHostContext(), memoryFactory);
    await host.load([
      {
        id: "vibe",
        factory: () =>
          makeMockPlugin({
            id: "vibe",
            capabilities: ["discovery", "handoff", "memory"],
            init: async (ctx) => {
              captured.vibe = ctx.memory;
            },
          }),
      },
    ]);
    expect(await captured.vibe.get("anything")).toBe("vibe");
  });

  it("confirmPluginMemoryDeletion allows when the plugin has no beforeDelete", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([{ id: "vibe", factory: () => makeMockPlugin({ id: "vibe" }) }]);
    expect(await host.confirmPluginMemoryDeletion("vibe", "run:1")).toBe(true);
  });

  it("confirmPluginMemoryDeletion honors a beforeDelete veto", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([
      {
        id: "vibe",
        factory: () =>
          makeMockPlugin({
            id: "vibe",
            capabilities: ["memory"],
            memoryBridge: { beforeDelete: async () => false },
          }),
      },
    ]);
    expect(await host.confirmPluginMemoryDeletion("vibe", "run:1")).toBe(false);
  });

  it("confirmPluginMemoryDeletion allows for an unknown plugin", async () => {
    const host = new PluginHost(makeHostContext());
    expect(await host.confirmPluginMemoryDeletion("ghost", "run:1")).toBe(true);
  });
});
```

(The existing `makeMockPlugin` does not set `init` to capture context — pass an `init` override as above. Ensure `makeMockPlugin`'s `init` signature accepts the context arg; if its current default is `async () => {}`, the override replaces it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/host/plugin-host.test.ts`
Expected: FAIL — `PluginHost` constructor ignores a 2nd arg; `confirmPluginMemoryDeletion` does not exist.

- [ ] **Step 3: Add the memory factory + per-plugin injection + veto to `PluginHost`**

In `src/lib/plugins/host/plugin-host.ts`:

1. Extend the type import to include `HostMemoryApi`:

```ts
import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  HostMemoryApi,
  LaneSummary,
  PluginHostContext,
} from "../contract/types";
```

2. Add an optional `memoryFactory` constructor parameter:

```ts
  constructor(
    private readonly context: PluginHostContext,
    private readonly memoryFactory?: (namespace: string) => HostMemoryApi,
  ) {}
```

3. In `load()`, build a per-plugin context whose `memory` is namespace-bound, and init against it. Replace the `await instance.init(this.context);` line with:

```ts
        const instance = entry.factory();
        const pluginContext: PluginHostContext = this.memoryFactory
          ? { ...this.context, memory: this.memoryFactory(entry.id) }
          : this.context;
        await instance.init(pluginContext);
```

4. Add the veto method (place after `generateHandoff`):

```ts
  /**
   * Ask the owning plugin whether a memory key may be deleted (spec §7.5/§7.7).
   * Returns true when: the plugin is not loaded (nothing to veto), it has no
   * `beforeDelete` hook (default allow), or the hook returns true. Returns
   * false when the hook returns false. On hook error, denies (safe default).
   */
  async confirmPluginMemoryDeletion(pluginId: string, key: string): Promise<boolean> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded || loaded.status !== "ready" || !loaded.instance) return true;
    const beforeDelete = loaded.instance.memoryBridge?.beforeDelete;
    if (!beforeDelete) return true;
    try {
      return await beforeDelete(key);
    } catch (err) {
      this.context.log.error(`plugin ${pluginId} beforeDelete failed`, {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
```

- [ ] **Step 4: Wire the real factory in `get-plugin-host.ts`**

In `src/lib/plugins/host/get-plugin-host.ts`, import the factory and pass it to the constructor:

```ts
import { createHostMemoryApi } from "./host-memory-api";
```

```ts
export function getPluginHost(): Promise<PluginHost> {
  if (cached) return cached;
  const host = new PluginHost(makeDefaultContext(), (namespace) =>
    createHostMemoryApi(namespace),
  );
  cached = host.load(buildPluginRegistry()).then(() => host);
  return cached;
}
```

Leave `makeDefaultContext()`'s no-op `memory` in place — it is the fallback the base context carries; the per-plugin `memoryFactory` is what plugins actually receive.

- [ ] **Step 5: Run host tests to verify they pass**

Run: `pnpm test src/lib/plugins/host`
Expected: PASS (existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/plugins/host/plugin-host.ts src/lib/plugins/host/get-plugin-host.ts src/lib/plugins/host/plugin-host.test.ts
git commit -m "feat(plugins): inject per-plugin namespaced memory + delete veto into host (spec §7.5/§7.7)"
```

---

### [backend-engineer] Task 6: `/api/cockpit/plugin-memory` route (list + delete)

**Specialist:** backend-engineer
**Depends on:** Task 3 (`listAllPluginMemoryForUser`, `PluginMemoryStore`), Task 5 (`confirmPluginMemoryDeletion`)
**Produces:** `src/app/api/cockpit/plugin-memory/route.ts` — `GET` (entries grouped by namespace; `{groups:[]}` when no user) and `DELETE` (veto → namespaced delete). Consumed by Tasks 7 (contract) and 8.

**Wire contract (pinned — Task 7 builds against this exact shape):**
- `GET /api/cockpit/plugin-memory` → `200 { groups: { namespace: string; entries: { key: string; value: unknown; createdAt: string; updatedAt: string }[] }[] }`. No user / no Supabase ⇒ `{ groups: [] }`.
- `DELETE /api/cockpit/plugin-memory` with JSON body `{ namespace: string; key: string }` → `200 { deleted: true }` on success; `400 { deleted: false, error }` on bad body; `409 { deleted: false, reason }` when the plugin vetoes; `200 { deleted: false, reason }` when no user.

**Files:**
- Create: `src/app/api/cockpit/plugin-memory/route.ts`
- Create: `src/app/api/cockpit/plugin-memory/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/cockpit/plugin-memory/route.test.ts`. It mocks the host singleton and the Supabase server module so handlers run in the node test env without a request scope:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const confirmPluginMemoryDeletion = vi.fn();
vi.mock("@/lib/plugins/host/get-plugin-host", () => ({
  getPluginHost: async () => ({ confirmPluginMemoryDeletion }),
}));

const isSupabaseConfigured = vi.fn(() => false);
const createSupabaseServerClient = vi.fn(async () => null);
vi.mock("@/lib/cockpit/supabase-server", () => ({
  isSupabaseConfigured: () => isSupabaseConfigured(),
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));

import { DELETE, GET, groupByNamespace } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  isSupabaseConfigured.mockReturnValue(false);
  confirmPluginMemoryDeletion.mockResolvedValue(true);
});

function deleteRequest(body: unknown): Request {
  return new Request("http://test/api/cockpit/plugin-memory", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("plugin-memory route", () => {
  it("GET returns empty groups when no user is signed in", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [] });
  });

  it("groupByNamespace groups rows by namespace preserving order", () => {
    const groups = groupByNamespace([
      { namespace: "vibe", key: "run:1", value: 1, createdAt: "a", updatedAt: "b" },
      { namespace: "vibe", key: "run:2", value: 2, createdAt: "c", updatedAt: "d" },
      { namespace: "aider", key: "x", value: 3, createdAt: "e", updatedAt: "f" },
    ]);
    expect(groups.map((g) => g.namespace)).toEqual(["vibe", "aider"]);
    expect(groups[0].entries).toHaveLength(2);
  });

  it("DELETE 400s on a missing namespace/key", async () => {
    const res = await DELETE(deleteRequest({ namespace: "vibe" }));
    expect(res.status).toBe(400);
    expect((await res.json()).deleted).toBe(false);
  });

  it("DELETE 409s when the plugin vetoes", async () => {
    confirmPluginMemoryDeletion.mockResolvedValue(false);
    const res = await DELETE(deleteRequest({ namespace: "vibe", key: "run:1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ deleted: false });
  });

  it("DELETE reports not-signed-in after the veto passes but no user is present", async () => {
    confirmPluginMemoryDeletion.mockResolvedValue(true);
    const res = await DELETE(deleteRequest({ namespace: "vibe", key: "run:1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: false, reason: "not signed in" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/cockpit/plugin-memory/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the route**

Create `src/app/api/cockpit/plugin-memory/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/cockpit/supabase-server";
import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";
import {
  PluginMemoryStore,
  listAllPluginMemoryForUser,
  type PluginMemoryRow,
} from "@/lib/plugins/host/plugin-memory-store";

export const runtime = "nodejs";

export interface PluginMemoryGroup {
  namespace: string;
  entries: { key: string; value: unknown; createdAt: string; updatedAt: string }[];
}

export async function GET(): Promise<NextResponse> {
  const ctx = await resolveUser();
  if (!ctx) return NextResponse.json({ groups: [] });
  const rows = await listAllPluginMemoryForUser(ctx.supabase, ctx.userId);
  return NextResponse.json({ groups: groupByNamespace(rows) });
}

const DeleteSchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1),
});

export async function DELETE(request: NextRequest | Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { deleted: false, error: "namespace and key are required" },
      { status: 400 },
    );
  }
  const { namespace, key } = parsed.data;

  const host = await getPluginHost();
  const allowed = await host.confirmPluginMemoryDeletion(namespace, key);
  if (!allowed) {
    return NextResponse.json(
      { deleted: false, reason: "plugin vetoed deletion" },
      { status: 409 },
    );
  }

  const ctx = await resolveUser();
  if (!ctx) return NextResponse.json({ deleted: false, reason: "not signed in" });
  await new PluginMemoryStore(ctx.supabase, ctx.userId, namespace).delete(key);
  return NextResponse.json({ deleted: true });
}

async function resolveUser() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id };
}

export function groupByNamespace(rows: PluginMemoryRow[]): PluginMemoryGroup[] {
  const map = new Map<string, PluginMemoryGroup>();
  for (const r of rows) {
    let group = map.get(r.namespace);
    if (!group) {
      group = { namespace: r.namespace, entries: [] };
      map.set(r.namespace, group);
    }
    group.entries.push({
      key: r.key,
      value: r.value,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }
  return [...map.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/cockpit/plugin-memory/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck the route**

Run: `pnpm lint`
Expected: no errors in the new files. (If `DELETE(request: NextRequest | Request)` triggers a lint rule, prefer `Request` — the handler only calls `.json()`.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cockpit/plugin-memory/route.ts src/app/api/cockpit/plugin-memory/route.test.ts
git commit -m "feat(api): plugin-memory list (grouped) + delete-with-veto route (spec §7.5)"
```

---

### [frontend-engineer] Task 7: `PluginMemoryPanel` + cockpit-app `"memory"` surface

**Specialist:** frontend-engineer
**Depends on:** Task 2 (`MemoryEntryMeta` — and the pinned GET/DELETE contract in Task 6's "Wire contract"). Tested with mocked `fetch`, so it does **not** block on Task 6's implementation.
**Produces:** `src/components/cockpit/plugin-memory-panel.tsx` (read + delete, grouped by plugin with a "Plugin: <id>" badge) and a `"memory"` lower surface + rail button in `cockpit-app.tsx`.

**Files:**
- Create: `src/components/cockpit/plugin-memory-panel.tsx`
- Create: `src/components/cockpit/plugin-memory-panel.test.tsx`
- Modify: `src/components/cockpit/cockpit-app.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/cockpit/plugin-memory-panel.test.tsx` (mirrors the `lane-inventory-panel.test.tsx` harness):

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PluginMemoryPanel } from "./plugin-memory-panel";

const sampleGroups = [
  {
    namespace: "vibe",
    entries: [
      { key: "run:1", value: { status: "done" }, createdAt: "t0", updatedAt: "t1" },
      { key: "run:2", value: "note", createdAt: "t2", updatedAt: "t3" },
    ],
  },
];

describe("PluginMemoryPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("shows the empty state when there are no groups", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ groups: [] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<PluginMemoryPanel />));
    await flush();
    expect(container.textContent).toMatch(/No plugin memory yet/i);
  });

  it("renders a plugin badge and entry keys per group", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ groups: sampleGroups }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => root.render(<PluginMemoryPanel />));
    await flush();
    expect(container.textContent).toContain("Plugin: vibe");
    expect(container.textContent).toContain("run:1");
    expect(container.textContent).toContain("run:2");
  });

  it("deletes an entry after confirmation and removes it from the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ groups: sampleGroups }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => root.render(<PluginMemoryPanel />));
    await flush();

    const deleteButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /delete run:1/i.test(b.getAttribute("aria-label") ?? ""),
    );
    expect(deleteButton).toBeTruthy();
    await act(async () => {
      deleteButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/cockpit/plugin-memory",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(container.textContent).not.toContain("run:1");
    expect(container.textContent).toContain("run:2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/cockpit/plugin-memory-panel.test.tsx`
Expected: FAIL — `Cannot find module './plugin-memory-panel'`.

- [ ] **Step 3: Write the panel**

Create `src/components/cockpit/plugin-memory-panel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

interface MemoryEntry {
  key: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

interface MemoryGroup {
  namespace: string;
  entries: MemoryEntry[];
}

interface PanelState {
  status: "loading" | "ready" | "error";
  groups: MemoryGroup[];
  error?: string;
  deleting: Record<string, boolean>;
}

const INITIAL_STATE: PanelState = {
  status: "loading",
  groups: [],
  deleting: {},
};

function entryId(namespace: string, key: string): string {
  return `${namespace} ${key}`;
}

export function PluginMemoryPanel() {
  const [state, setState] = useState<PanelState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cockpit/plugin-memory");
        if (!res.ok) {
          if (!cancelled) setState((s) => ({ ...s, status: "error", error: `HTTP ${res.status}` }));
          return;
        }
        const body = (await res.json()) as { groups: MemoryGroup[] };
        if (!cancelled) setState((s) => ({ ...s, status: "ready", groups: body.groups }));
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onDelete = useCallback(async (namespace: string, key: string): Promise<void> => {
    if (!window.confirm(`Delete "${key}" from ${namespace}? The plugin owns this entry.`)) return;
    const id = entryId(namespace, key);
    setState((s) => ({ ...s, deleting: { ...s.deleting, [id]: true } }));
    try {
      const res = await fetch("/api/cockpit/plugin-memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ namespace, key }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { reason?: string };
        setState((s) => ({
          ...s,
          deleting: { ...s.deleting, [id]: false },
          error: body.reason ?? `Delete failed (HTTP ${res.status})`,
        }));
        return;
      }
      setState((s) => ({
        ...s,
        deleting: { ...s.deleting, [id]: false },
        error: undefined,
        groups: s.groups
          .map((g) =>
            g.namespace === namespace
              ? { ...g, entries: g.entries.filter((e) => e.key !== key) }
              : g,
          )
          .filter((g) => g.entries.length > 0),
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        deleting: { ...s.deleting, [id]: false },
        error: err instanceof Error ? err.message : "Delete failed",
      }));
    }
  }, []);

  if (state.status === "loading") {
    return <div className="p-4 text-sm opacity-70">Loading plugin memory…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load plugin memory: {state.error ?? "unknown error"}
      </div>
    );
  }
  if (state.groups.length === 0) {
    return (
      <div className="p-4 text-sm opacity-70">
        No plugin memory yet. Plugins that advertise the <code>memory</code> capability
        write run-scoped entries here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold">Plugin memory</h2>
      {state.error && <p className="text-xs text-red-500">{state.error}</p>}
      {state.groups.map((group) => (
        <section key={group.namespace} className="rounded-md border border-zinc-700 p-3">
          <header className="mb-2 flex items-center justify-between gap-2">
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-semibold">
              Plugin: {group.namespace}
            </span>
            <span className="text-xs opacity-60">{group.entries.length} entries</span>
          </header>
          <ul className="grid gap-2">
            {group.entries.map((entry) => {
              const id = entryId(group.namespace, entry.key);
              return (
                <li key={id} className="rounded border border-zinc-800 p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold">{entry.key}</span>
                    <button
                      type="button"
                      aria-label={`Delete ${entry.key}`}
                      disabled={!!state.deleting[id]}
                      onClick={() => onDelete(group.namespace, entry.key)}
                      className="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {state.deleting[id] ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all opacity-80">
                    {typeof entry.value === "string"
                      ? entry.value
                      : JSON.stringify(entry.value, null, 2)}
                  </pre>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run panel test to verify it passes**

Run: `pnpm test src/components/cockpit/plugin-memory-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the `"memory"` lower surface into `cockpit-app.tsx`**

In `src/components/cockpit/cockpit-app.tsx`:

1. Import the panel (next to the `LaneInventoryPanel` import):

```ts
import { PluginMemoryPanel } from "@/components/cockpit/plugin-memory-panel";
```

2. Extend the `LowerSurface` type union:

```ts
type LowerSurface = "evidence" | "openui" | "handoff" | "review" | "lanes" | "memory";
```

3. Add a rail button after the `"Lanes"` `RailButton` (inside the `<nav aria-label="Cockpit workspace">` block):

```tsx
              <RailButton
                label="Memory"
                active={lowerSurface === "memory"}
                onClick={() => setLowerSurface("memory")}
              />
```

4. In the `LowerSurface` component, add a case before the final parking-lot `return` (mirror the `"lanes"` case):

```tsx
  if (surface === "memory") {
    return (
      <section
        className="cockpit-panel cockpit-panel-lanes border p-0"
        data-testid="memory"
      >
        <PluginMemoryPanel />
      </section>
    );
  }
```

- [ ] **Step 6: Verify the app builds + existing cockpit-app tests still pass**

Run: `pnpm test src/components/cockpit`
Expected: PASS.
Run: `pnpm build`
Expected: build succeeds (type-checks the new `LowerSurface` member and the panel import).

- [ ] **Step 7: Commit**

```bash
git add src/components/cockpit/plugin-memory-panel.tsx src/components/cockpit/plugin-memory-panel.test.tsx src/components/cockpit/cockpit-app.tsx
git commit -m "feat(cockpit): plugin memory panel + Memory lower surface (spec §7.5)"
```

---

### [frontend-engineer] Task 8: E2E smoke — memory surface mounts + empty state

**Specialist:** frontend-engineer
**Depends on:** Task 6 (GET returns `{groups:[]}` when no user), Task 7 (panel + rail button)
**Produces:** `tests/e2e/plugin-memory.spec.ts` — proves the route + panel + cockpit-app wiring connect end-to-end via the deterministic empty-state path (no auth needed).

**Files:**
- Create: `tests/e2e/plugin-memory.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/plugin-memory.spec.ts` (mirrors `tests/e2e/lane-inventory.spec.ts`):

```ts
import { expect, test } from "@playwright/test";

test("memory surface mounts and shows the empty state", async ({ page }, testInfo) => {
  // The Memory rail entry lives in cockpit-rail (`hidden ... lg:block`), so it
  // is not reachable on mobile viewports.
  test.skip(
    testInfo.project.name === "mobile-chrome",
    "Memory rail is hidden below the lg breakpoint",
  );

  await page.goto("/");

  await page.getByRole("button", { name: /^Memory$/i }).click();

  // With no signed-in user, GET /api/cockpit/plugin-memory returns {groups:[]}
  // and the panel renders its empty state. Scope to <main> to avoid sibling
  // matches in the shell.
  await expect(
    page.getByRole("main").getByText(/No plugin memory yet/i),
  ).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm test:e2e plugin-memory`
Expected: PASS on the desktop (chromium) project; SKIPPED on `mobile-chrome`. (Playwright reuses an existing dev server on 3000 per `reuseExistingServer: true` — don't start a second one.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/plugin-memory.spec.ts
git commit -m "test(e2e): smoke the plugin memory surface empty state"
```

---

## Self-Review (completed by plan author)

**Standard `superpowers:writing-plans` checks:**
- **Spec coverage (§7):** §7.6 schema → Task 1. §7.7 types (`HostMemoryApi`/`MemoryEntryMeta`/`PluginMemoryBridge`/`VibeMemoryHandle`) → Task 2; host-injected namespace + pass-through wiring → Tasks 3/4/5. §7.2 last-write-wins upsert on `(user_id, namespace, key)` → Task 1 (unique) + Task 3 (`onConflict`). §7.5 read+delete UI with veto → Tasks 5/6/7. §7.8 RLS audit (every path via `auth.uid()`, no service role, defensive `user_id` scoping) → Tasks 1 (static RLS test) + 3 (store always scopes `user_id`/`namespace`). §7.1 one-way (no plugin read of host state), §7.3 scope, §7.4 no TTL, §7.9 deferred items → intentionally not built (out of scope). No orphaned §7 requirement.
- **Placeholder scan:** every code step contains complete code or an exact command; no "TBD"/"similar to". ✓
- **Type consistency:** the pinned GET/DELETE contract (Task 6) matches the panel's parsing (Task 7); `MemoryEntryMeta`/`VibeMemoryHandle`/`HostMemoryApi` shapes are identical across Tasks 2/3/4. ✓

**Team-specific checks:**
1. **Wave grouping safety:** W1 (T1 `migrations/`+`supabase-rls.test.ts` ∥ T2 `contract/`) — disjoint, no import. W2 (T3 new `host/plugin-memory-store.ts`+`host-memory-api.ts` ∥ T4 `vibe/*`) — disjoint; neither imports the other (both import contract types only). W4 (T6 `api/.../plugin-memory/` ∥ T7 `components/.../plugin-memory-panel.tsx`+`cockpit-app.tsx`) — disjoint; T7 uses `fetch`, not an import of the route. ✓
2. **Task metadata completeness:** every task has Specialist, Depends on, Produces; Tasks 1 and 3 carry `Plan approval required: true`. ✓
3. **Specialist role consistency:** every `Specialist:` (backend-engineer / plugin-engineer / frontend-engineer) matches a Specialists-table row; 3 roles, no overlap, no orphans. ✓

**Acyclic dependency graph:** verified (no task's blocked-by chain includes itself). ✓
