# SP1 — Memory Bridge: Go SDK ↔ Cockpit Supabase Store

**Date:** 2026-05-29
**Status:** DRAFT — for review before SP1 implementation cycle
**Owner:** Luther
**Spec parent:** `docs/superpowers/specs/2026-05-28-cockpit-vibe-hermes-workflow-design.md` §5 (SP1 open questions) + §7 (architecture invariants)
**Sibling doc:** `05-lane-events.md` (LaneEvent stream shape)

---

## 1. Purpose

This document designs how the memory bridge — specced in §7 and backed up on `origin/claude/cockpit-vibe-memory-bridge-2026-05-27` — folds into the **Go-SDK-first** SP1 architecture. The backup branch was written against an in-process TypeScript `InProcessVibeService` world. SP1's execution core moves to a Go daemon (`vibe serve`). This spec reconciles the two, preserving everything that is reusable and redesigning what is not.

**North-star:** the Go daemon executes lanes, writes memory to the same `cockpit_plugin_memory` Supabase table, and streams `memory_write` / `memory_read` events back to Cockpit — all while honoring the `user_id = (select auth.uid())` RLS invariant and never touching a service-role key.

---

## 2. Prior work inspected (backup branch `origin/claude/cockpit-vibe-memory-bridge-2026-05-27`)

Four commits were read via `git show` (read-only; branch not checked out):

| Commit | Content |
|---|---|
| `dfecfc7` | `docs/superpowers/plans/2026-05-27-cockpit-vibe-memory-bridge.md` — 1826-line implementation plan for the TS-world memory bridge |
| `fd26034` | `supabase/migrations/20260527120000_create_cockpit_plugin_memory.sql` — table + RLS (see §4 below) |
| `e289f32` | `src/lib/plugins/contract/types.ts` — `HostMemoryApi`, `MemoryEntryMeta`, `VibeMemoryHandle`, `PluginMemoryBridge` contract types |
| `97e1892` | `src/lib/plugins/contract/memory-types.test.ts` — `expectTypeOf` tests pinning the contract |

All four commits are reachable. Key finding: the TS contract types and the SQL migration are architecture-neutral — they describe the store shape and Cockpit-side API, which is unaffected by whether the writer is TS or Go. The TS-side host-injection wiring (`plugin-host.ts`, `InProcessVibeService.memory`, `VibePlugin`) is the layer that must be redesigned for Go.

---

## 3. What the Go daemon reads and writes during lane execution

Lane execution in SP1 is a goroutine tree: one coordinator goroutine per lane run, N agent goroutines per lane (one per parallelizable sub-task, bounded by the lane's `Requires` DAG — see `go/internal/lanes/coordinator.go`). Memory access occurs at four moments:

### 3.1 Lane context bootstrap (read at run start)

Before spawning agent goroutines the coordinator reads any prior state for this `(user_id, lane_id)` pair. Useful keys:

| Key | Namespace | Purpose |
|---|---|---|
| `lane:{laneId}:last_summary` | `vibe` | Summary from the previous run — avoids repeating work already done |
| `lane:{laneId}:decisions` | `vibe` | Prior approval-gate outcomes (model, branch, overrides) |
| `lane:{laneId}:scratch` | `vibe` | Agent scratch notes that survived the last run |

These are passed into the system prompt of each spawned `claude`/`codex` subprocess via environment-injected context (not as tool access — the subprocess itself does not call Supabase).

### 3.2 Decision checkpoints (read + write mid-run)

When a lane hits an `approval` gate (lane plan field), the coordinator checks `lane:{laneId}:decisions/{gateId}` for a cached decision. If absent, it pauses, streams a `memory_prompt` LaneEvent (see §6), and waits for Cockpit to inject the decision back via the HTTP body of the next request. On receipt the coordinator writes the decision to memory and continues.

### 3.3 Agent scratch writes (write during run)

Each agent goroutine may emit a `memory_write` LaneEvent carrying a key+value. The coordinator's event loop receives these and calls the memory client (§5). This is fire-and-forget; a failed write logs a `log:warn` event and does not abort the lane.

### 3.4 Lane summary write (write at completion)

On a `final` LaneEvent the coordinator writes `lane:{laneId}:last_summary` with the run's `summary` string and a `completed_at` timestamp.

---

## 4. The Supabase store — reusable as-is

The migration from commit `fd26034` is **reusable verbatim**:

```sql
-- supabase/migrations/20260527120000_create_cockpit_plugin_memory.sql
create table public.cockpit_plugin_memory (
  id        uuid        primary key default gen_random_uuid(),
  user_id   uuid        not null references auth.users(id) on delete cascade,
  namespace text        not null,
  key       text        not null,
  value     jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, namespace, key)
);

create index cockpit_plugin_memory_user_namespace_idx
  on public.cockpit_plugin_memory (user_id, namespace, updated_at desc);

alter table public.cockpit_plugin_memory enable row level security;

grant select, insert, update, delete on public.cockpit_plugin_memory to authenticated;

create policy "cockpit_plugin_memory_select_own" on public.cockpit_plugin_memory
  for select to authenticated using (user_id = (select auth.uid()));

create policy "cockpit_plugin_memory_insert_own" on public.cockpit_plugin_memory
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "cockpit_plugin_memory_update_own" on public.cockpit_plugin_memory
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "cockpit_plugin_memory_delete_own" on public.cockpit_plugin_memory
  for delete to authenticated using (user_id = (select auth.uid()));
```

The `unique (user_id, namespace, key)` constraint gives last-write-wins upsert semantics for free. RLS is owner-scoped identically to `cockpit_sessions`, `parking_lot_items`, and `handoffs` (pattern from `20260517152032_create_cockpit_memory.sql`).

This migration ships to production as part of SP1 without modification. The `supabase-rls.test.ts` extension (adding `cockpit_plugin_memory` to `publicTables`) from commit `fd26034` also applies unchanged.

---

## 5. Go daemon authentication under RLS — the core design problem

### 5.1 Invariants (non-negotiable, from §7 of the workflow spec)

- Browser code uses **only** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — never a secret.
- No service-role key is injected into the browser, the Go daemon, or any agent subprocess.
- Every DB row is protected by `user_id = (select auth.uid())`.
- The Go daemon is a **local process** (127.0.0.1:8787) — it is not a trusted server on the public internet.

### 5.2 Approach: user JWT forwarded by Cockpit

The user is already authenticated in Cockpit's browser session. Supabase issues a short-lived JWT signed with the project secret. Cockpit's Next.js API routes already hold this JWT in the SSR cookie context (via `createSupabaseServerClient()`).

**Flow:**

```
Browser  ──POST /api/cockpit/lanes/:id/run──►  Next.js route handler
                                                   │  (has user JWT from cookie)
                                                   │
                                                   ├─ extracts JWT via auth.getSession()
                                                   │
                                                   └──POST http://127.0.0.1:8787/v1/lane/run
                                                        body: { laneId, input, supabaseUrl, userJwt }
                                                              ▲
                                                              bearer token = user JWT, NOT service role
                                                   Go daemon  │
                                                              ├─ constructs anon Supabase HTTP client
                                                              │   Authorization: Bearer <userJwt>
                                                              │   apikey: SUPABASE_PUBLISHABLE_KEY
                                                              │
                                                              ├─ reads/writes cockpit_plugin_memory
                                                              │   RLS sees auth.uid() = user's UUID ✓
                                                              │
                                                              └─ streams LaneEvents back via SSE
```

The Supabase REST API (`/rest/v1/`) accepts a user JWT as the Bearer token and evaluates `auth.uid()` from its claims — identical to the browser client. The Go daemon uses this path, not the service-role path.

**What the Go daemon receives at startup / per-request:**

| Value | Source | How delivered |
|---|---|---|
| `SUPABASE_URL` | Env var (from `.env.local`) | Process environment — not secret |
| `SUPABASE_PUBLISHABLE_KEY` | Env var (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | Process environment — not secret |
| `userJwt` | Per-request, from Cockpit route handler | HTTP request body field |
| `userId` | Decoded from `userJwt.sub` claim | Go parses JWT claims (no verification needed — Supabase REST verifies) |

The daemon **never** holds a service-role key. If it cannot reach Supabase (URL unset, JWT expired), memory writes are no-ops and a `log:warn` LaneEvent is emitted — the lane continues.

### 5.3 JWT expiry handling

Supabase JWTs expire in one hour by default. A long-running lane (unlikely in SP1 but possible) could hit expiry. Mitigation:

- Cockpit's route handler calls `auth.getSession()` which auto-refreshes the JWT if < 10 min remain before forwarding it.
- If the daemon gets a 401 on a memory write, it emits `log:warn` and continues — it does not retry (no re-auth path in the daemon).
- SP2 can revisit with a refresh-token flow if lanes routinely exceed 50 minutes.

---

## 6. Memory operations as LaneEvents

The sibling doc (`05-lane-events.md`) defines the `LaneEvent` discriminated union. Two new variants are added for the memory bridge:

```typescript
// Additions to the LaneEvent union in src/lib/plugins/contract/types.ts
| { type: "memory_write"; namespace: string; key: string; ok: boolean }
| { type: "memory_read";  namespace: string; key: string; hit: boolean }
```

These are **observability events only** — they carry no value payloads (values stay in Supabase, not in the event stream, to avoid leaking user data over the SSE channel). Cockpit renders them in the activity feed as "stored key X" / "loaded key X".

The Go daemon emits these synchronously around each Supabase call:

```go
// pseudo-Go — not production code
func (m *MemoryClient) Set(ctx context.Context, key string, value any) {
    err := m.supabaseUpsert(ctx, key, value)
    ok := err == nil
    m.eventCh <- LaneEvent{Type: "memory_write", Namespace: m.namespace, Key: key, Ok: ok}
    if !ok {
        m.eventCh <- LaneEvent{Type: "log", Level: "warn", Message: fmt.Sprintf("memory write %q failed: %v", key, err)}
    }
}
```

The `memory_prompt` event (used for approval-gate decisions) is a variant of `log` with `level: "info"` and a structured `metadata` field — it is handled by the existing `log` LaneEvent shape plus a future `metadata` extension, not a new variant.

---

## 7. Contract memory types — reconciliation

### 7.1 TS types (reusable as-is from commit `e289f32`)

The TypeScript side of the contract (`src/lib/plugins/contract/types.ts`) is fully reusable:

- `HostMemoryApi` — injected into Cockpit plugins; unchanged.
- `MemoryEntryMeta { key, createdAt, updatedAt }` — Cockpit UI list type; unchanged.
- `VibeMemoryHandle` — mirrors `HostMemoryApi` for the plugin service layer; unchanged.
- `PluginMemoryBridge { refresh?, beforeDelete? }` — optional plugin lifecycle hooks; unchanged.
- `memory-types.test.ts` — all `expectTypeOf` assertions; reusable without modification.

The `LaneEvent` union extension (`memory_write`, `memory_read`) is the only TS contract addition required for Go interop.

### 7.2 Go structs (new for SP1)

```go
// go/internal/memory/memory.go  (new package)

package memory

import (
    "context"
    "time"
)

// Entry mirrors the cockpit_plugin_memory DB row (value decoded from JSONB).
type Entry struct {
    ID        string          `json:"id"`
    UserID    string          `json:"user_id"`
    Namespace string          `json:"namespace"`
    Key       string          `json:"key"`
    Value     json.RawMessage `json:"value"`
    CreatedAt time.Time       `json:"created_at"`
    UpdatedAt time.Time       `json:"updated_at"`
}

// EntryMeta mirrors MemoryEntryMeta (TS) — list result without value.
type EntryMeta struct {
    Key       string    `json:"key"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}

// Client is the per-lane memory client bound to a (namespace, userJwt).
type Client struct {
    supabaseURL string
    publishableKey string
    userJwt     string
    namespace   string
    userID      string   // decoded from JWT sub claim
}

// Store defines the operations the coordinator calls.
type Store interface {
    Set(ctx context.Context, key string, value any) error
    Get(ctx context.Context, key string) (json.RawMessage, bool, error)
    List(ctx context.Context, prefix string) ([]EntryMeta, error)
    Delete(ctx context.Context, key string) error
}
```

### 7.3 DB ↔ Go ↔ TS type mapping

| DB column | Go field (`Entry`) | TS type (`MemoryEntryMeta`) | Notes |
|---|---|---|---|
| `namespace` | `Namespace string` | (host-injected, not in meta) | Always `"vibe"` for Go daemon writes |
| `key` | `Key string` | `key: string` | Bare key, namespace stripped in list responses |
| `value` | `Value json.RawMessage` | (not in meta) | JSONB; opaque to Cockpit list UI |
| `created_at` | `CreatedAt time.Time` | `createdAt: string` (ISO) | Go formats as RFC3339 |
| `updated_at` | `UpdatedAt time.Time` | `updatedAt: string` (ISO) | Same |

The only semantic difference: Go's `Client` always writes with `namespace = "vibe"`. The Cockpit `HostMemoryApi` injects `namespace = plugin.id` (i.e. `"vibe"` for the Vibe plugin). These align — both sides write to the same namespace.

---

## 8. What is reusable vs. what needs rework

### 8.1 Reusable from the backup branch (no modification)

| Artifact | Status | Reason |
|---|---|---|
| `20260527120000_create_cockpit_plugin_memory.sql` | Reuse verbatim | Architecture-neutral schema |
| `supabase-rls.test.ts` extension | Reuse verbatim | Static regex test, no runtime dependency |
| `src/lib/plugins/contract/types.ts` additions | Reuse verbatim | TS-only; Go interop is additive |
| `memory-types.test.ts` | Reuse verbatim | Type-level assertions only |
| `/api/cockpit/plugin-memory` route design | Reuse design | Cockpit-side route is still TS/Next.js |
| `PluginMemoryPanel` component design | Reuse design | Cockpit UI is unaffected by Go runtime |

### 8.2 Needs rework for Go

| Artifact | Change required |
|---|---|
| `HostMemoryApi` injection in `plugin-host.ts` | Still needed for the Cockpit-side plugin host; but the Vibe plugin no longer needs `InProcessVibeService.memory` (the Go daemon writes directly). The `VibePlugin` `memory` capability becomes a read-only view into Cockpit's panel, not a write path. |
| `InProcessVibeService.memory` / `attachHostMemory` | **Superseded.** The in-process TS Vibe service is demoted to discovery+handoff only in SP1. Memory writes come from the Go daemon. Remove or stub; do not implement. |
| The 1826-line TS implementation plan (`2026-05-27-cockpit-vibe-memory-bridge.md`) | **Partially superseded.** Tasks 1-2 (migration + types) and Task 7-8 (UI panel) remain valid. Tasks 3-5 (TS `PluginMemoryStore`, host injection wiring, `createHostMemoryApi`) apply only to the Cockpit-side HostMemoryApi — not to Vibe lane writes. Task 4 (`InProcessVibeService.memory`) is dropped. |
| `LaneEvent` union | **Extend** with `memory_write` and `memory_read` variants (see §6). |

---

## 9. End-to-end data flow (SP1)

```
User clicks "Run lane" in Cockpit browser
    │
    ▼
Next.js POST /api/cockpit/lanes/:id/run
    │  extracts user JWT via createSupabaseServerClient().auth.getSession()
    │
    ▼
POST http://127.0.0.1:8787/v1/lane/run
    body: { laneId, input, supabaseUrl, publishableKey, userJwt }
    │
    ▼
Go daemon: lanes.Coordinator.Run(ctx, plan, memClient, eventCh)
    │
    ├─ memory.Client.Get("lane:{id}:last_summary")
    │       ├── GET /rest/v1/cockpit_plugin_memory?namespace=eq.vibe&key=eq.lane:...
    │       │   Authorization: Bearer <userJwt>
    │       │   RLS: auth.uid() = user_id  ✓
    │       └── eventCh ← LaneEvent{type:"memory_read", hit:true/false}
    │
    ├─ spawn agent goroutines (claude/codex CLIs)
    │
    ├─ agent emits scratch → memory.Client.Set("lane:{id}:scratch", ...)
    │       ├── POST /rest/v1/cockpit_plugin_memory (upsert via prefer:resolution=merge-duplicates)
    │       └── eventCh ← LaneEvent{type:"memory_write", ok:true}
    │
    └─ final → memory.Client.Set("lane:{id}:last_summary", summary)
            └── eventCh ← LaneEvent{type:"memory_write", ok:true}

Go daemon streams NDJSON/SSE LaneEvents back to Next.js route handler
    │
    ▼
Next.js pipes SSE to browser  →  Cockpit activity feed renders events
                                  including memory_read / memory_write chips

Cockpit PluginMemoryPanel (future)
    reads GET /api/cockpit/plugin-memory?namespace=vibe
    renders key list (MemoryEntryMeta) with delete buttons
    beforeDelete veto: always allow (no veto hook in Go path)
```

---

## 10. Cockpit-side host memory injection (non-Vibe plugins)

The `HostMemoryApi` injected into Cockpit plugins at `init(host)` time (non-Go path, i.e. any future TS plugin) still follows the backup branch's design: `plugin-host.ts` constructs a `createHostMemoryApi(supabase, userId, namespace)` factory and injects it. This path is **orthogonal to Go** and can land in SP1 as specced in Tasks 3 and 5 of the backup branch plan — it only affects TS plugins, not the Vibe lane executor.

---

## 11. Open questions and risks

### 11.1 Go-daemon auth under RLS (highest risk)

**Question:** Supabase REST evaluates `auth.uid()` from a JWT. The Go daemon holds the JWT for the duration of a lane run. If the lane runs > 55 minutes the JWT expires mid-run. Does Supabase return a 401 or silently allow the stale token on subsequent reads?

**Current mitigation:** Cockpit's route handler refreshes the JWT before forwarding; daemon treats 401 as a no-op memory write and logs a warning. This is sufficient for SP1 where lanes are expected to run < 10 minutes. Longer lanes require a refresh-token flow (SP2 scope).

**Open:** Should the daemon accept a refresh token at startup so it can self-refresh? This requires storing the refresh token in process memory (acceptable for a local daemon, but requires a decision on the security model).

### 11.2 Namespace collisions

If a future TS plugin also writes to `namespace = "vibe"`, its entries will appear alongside Go daemon entries in the Cockpit panel. The migration's `unique (user_id, namespace, key)` constraint means last-write-wins across both writers. This is acceptable in SP1 (only one writer: the Go daemon) but must be documented as a coordination policy for SP2.

### 11.3 `LaneEvent` schema versioning

The `memory_write` / `memory_read` LaneEvent variants must be added to the TS union (`types.ts`) before the Go daemon ships. The Go daemon serialises these as JSON; the TS consumer deserialises them. If the union is not extended first, unknown event types will be silently dropped by the Cockpit activity feed. Risk: the two changes land in different PRs and one ships before the other. **Mitigation:** gate the Go memory-event emission behind a feature flag (`VIBE_MEMORY_EVENTS=1`) in SP1.

### 11.4 Value payload size

`value` is `jsonb`. A lane's scratch payload could be large (e.g., a full file diff). Supabase has no built-in row size limit beyond Postgres's 1 GB TOAST threshold. However, the SSE channel never carries `value` — only `key` + `ok` flags. No immediate risk, but an audit of what agents write to scratch is needed before SP2.

### 11.5 `InProcessVibeService` removal scope

The backup branch added `VibeService.memory` and `InProcessVibeService.attachHostMemory`. Removing these for SP1 requires confirming no test or route currently depends on them (they landed only on the backup branch, never on master). Safe to omit; confirmed by `git log master -- src/lib/plugins/vibe/` showing no memory-related commits on master.

### 11.6 Supabase REST upsert syntax

Supabase REST upsert via `POST` with `Prefer: resolution=merge-duplicates` is the correct idiom for `unique (user_id, namespace, key)`. The Go client must set this header; without it a duplicate insert returns a 409. This is a low-risk implementation detail but worth calling out since Go has no Supabase client library — the daemon calls the REST API directly with `net/http`.

---

## 12. Implementation sequence (within SP1)

1. **Apply migration** — `20260527120000_create_cockpit_plugin_memory.sql` (reuse from backup branch verbatim).
2. **Extend TS contract** — add `memory_write`/`memory_read` to `LaneEvent` union; update `memory-types.test.ts`.
3. **Go `memory` package** — `go/internal/memory/memory.go` implementing `Store` backed by Supabase REST (no external library, pure `net/http`).
4. **Wire into coordinator** — `go/internal/lanes/coordinator.go` accepts a `memory.Store`; reads bootstrap context, writes scratch + summary; emits `memory_write`/`memory_read` LaneEvents.
5. **Cockpit route** — `/api/cockpit/lanes/:id/run` extracts JWT, forwards to daemon; handles `memory_write`/`memory_read` events in the SSE pipe-through.
6. **Cockpit HostMemoryApi** — Tasks 3+5 from the backup branch plan for the TS plugin host path (parallel to Go work; no coupling).
7. **PluginMemoryPanel** — Task 7 from the backup branch plan (Cockpit UI; independent of Go runtime).
8. **RLS static test extension** — Task 1 extension to `supabase-rls.test.ts` (already written in backup branch).

Steps 1–2 are foundations; steps 3–5 are the Go core; steps 6–8 are the Cockpit-side additions that land in parallel with the Go work.
