# SP1 Design — 06: Cockpit VibeService → Go Daemon Adapter

**Status:** DRAFT  
**Date:** 2026-05-29  
**Owner:** Luther  
**Depends on:** 02-transport.md (HTTP+SSE transport), 05-lane-event-contract.md (LaneEvent wire types)

---

## 1. Purpose

The Phase-1 Cockpit VibeService (`InProcessVibeService`) discovers lane JSON files from local
filesystem roots and generates handoff markdown — all in-process, no network, no execution.  
SP1 needs to add **real lane execution** and **event streaming** without breaking the
working discovery+handoff path.

This document designs:

1. A `RemoteVibeService` that speaks to the `vibe serve` Go daemon over the transport
   defined in doc 02.
2. How the existing `VibeService` interface is extended to carry execution operations.
3. The offline-degradation contract: discovery and handoff MUST keep working when the
   daemon is down.
4. How incoming `LaneEvent`s (doc 05) map onto Cockpit kernel state and surface in the
   Lane Inventory panel and a new execution view.
5. How the adapter wires into the existing plugin registry (`buildPluginRegistry` in
   `src/lib/plugins/host/registry.ts`).

---

## 2. Current shape (grounding)

| File | Role |
|---|---|
| `src/lib/plugins/vibe/vibe-service.ts` | `VibeService` interface: `listLanes()`, `generateHandoff()`, `dispose()` |
| `src/lib/plugins/vibe/in-process-vibe-service.ts` | Phase-1 impl: scans `<root>/lanes/*.json` on every call; no network |
| `src/lib/plugins/vibe/vibe-plugin.ts` | `VibePlugin` (implements `CockpitPlugin`): thin delegation to `VibeService` |
| `src/lib/plugins/host/registry.ts` | `buildPluginRegistry()`: reads `COCKPIT_PLUGINS` + `COCKPIT_PLUGIN_VIBE_ROOTS`, instantiates `InProcessVibeService` |
| `src/lib/plugins/contract/types.ts` | `LaneSummary`, `LaneEvent`, `LaneRunInput`, `CockpitPlugin.runLane?()` |
| `src/app/api/cockpit/lanes/route.ts` | `GET /api/cockpit/lanes` → `PluginHost.listAllLanes()` |
| `src/app/api/cockpit/lanes/[laneId]/handoff/route.ts` | `GET /api/cockpit/lanes/:id/handoff?target=` → `PluginHost.generateHandoff()` |
| `src/components/cockpit/lane-inventory-panel.tsx` | Client component: fetches `/api/cockpit/lanes`, renders cards, drives handoff generation |

Key observations:

- `VibeService` is already the seam. `VibePlugin` delegates every capability call to it
  without caring which implementation runs underneath.
- `CockpitPlugin.runLane?()` is already declared in `contract/types.ts` (returns
  `AsyncIterable<LaneEvent>`) but is not yet wired in `VibePlugin` or `VibeService`.
- `LaneEvent` is already typed in `contract/types.ts`. Doc 05 must be consistent with
  this; if doc 05 adds fields, they extend the existing union rather than replacing it.
- The plugin registry constructs a single service instance; swapping to remote requires
  only a different concrete class passed to `new VibePlugin(...)`.

---

## 3. Extended VibeService interface

The `VibeService` interface gains two execution methods. Existing `listLanes()`,
`generateHandoff()`, and `dispose()` are unchanged.

```ts
// src/lib/plugins/vibe/vibe-service.ts  (additions for SP1)

import type { LaneEvent, LaneRunInput, LaneSummary } from "../contract/types";

export interface VibeService {
  // --- Phase 1 (unchanged) ---
  listLanes(): Promise<LaneSummary[]>;
  generateHandoff(laneId: string, target: HandoffTarget): Promise<HandoffArtifact | null>;
  dispose(): Promise<void>;

  // --- SP1 additions ---

  /**
   * Start executing a lane on the Go daemon and return an async iterable of
   * LaneEvents. Resolves the iterable's first value only after the daemon
   * confirms the run has started (the "start" event). Caller must pass an
   * AbortSignal; on abort the SSE connection is closed and the daemon receives
   * a cancellation request (POST /runs/:runId/cancel).
   *
   * Throws `DaemonUnavailableError` if the daemon is not reachable — callers
   * must handle this and degrade to handoff-only.
   */
  runLane(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent>;

  /**
   * Send a human approval decision for a paused run. No-op / throws
   * `DaemonUnavailableError` when offline.
   */
  sendApproval(
    runId: string,
    decision: "approve" | "reject",
    comment?: string,
  ): Promise<void>;

  /**
   * Probe whether the daemon is currently reachable. Used by the registry
   * to decide which concrete implementation to activate and by the adapter
   * to update UI health indicators without blocking lane discovery.
   */
  daemonHealth(): Promise<DaemonHealth>;
}

export type DaemonHealth =
  | { status: "up"; version: string; runningLanes: number }
  | { status: "down"; reason: string };

export class DaemonUnavailableError extends Error {
  constructor(message = "vibe daemon not reachable") {
    super(message);
    this.name = "DaemonUnavailableError";
  }
}
```

`InProcessVibeService` will implement `runLane()` by throwing `DaemonUnavailableError`
(it has no execution capability) and `daemonHealth()` by returning `{ status: "down",
reason: "in-process mode" }`. This keeps the type contract satisfied for all
implementations.

---

## 4. RemoteVibeService

A new file `src/lib/plugins/vibe/remote-vibe-service.ts` implements `VibeService` by
talking to `vibe serve`.

### 4.1 Constructor and configuration

```ts
export interface RemoteVibeServiceOptions {
  /**
   * Base URL of the vibe daemon, e.g. "http://127.0.0.1:7474".
   * Injected via COCKPIT_VIBE_DAEMON_URL env var.
   */
  daemonUrl: string;

  /**
   * Fallback: if the daemon is unreachable, delegate discovery and handoff to
   * this in-process service so existing functionality is preserved.
   */
  fallback: VibeService;

  /**
   * Milliseconds before a daemon probe is considered failed.
   * Default: 2000.
   */
  probeTimeoutMs?: number;

  /**
   * How many times to retry a failing SSE connection before surfacing an error.
   * Default: 3. Backoff: 500 ms × attempt (capped at 5 s).
   */
  sseMaxRetries?: number;
}

export class RemoteVibeService implements VibeService {
  private readonly opts: Required<RemoteVibeServiceOptions>;
  private abortController: AbortController = new AbortController();

  constructor(options: RemoteVibeServiceOptions) { ... }
}
```

### 4.2 Discovery and handoff: daemon-first, fallback second

`listLanes()` and `generateHandoff()` try the daemon first (via `GET /v1/lanes` and
`GET /v1/lanes/:id/handoff?target=`). If the daemon returns a non-2xx response OR the
fetch throws (network error / timeout), the adapter transparently falls back to the
`InProcessVibeService` instance. The caller (API route) receives a valid result in both
cases — it never knows which path served it.

```ts
async listLanes(): Promise<LaneSummary[]> {
  try {
    const resp = await this.daemonFetch("/v1/lanes", { signal: this.probeSignal() });
    if (!resp.ok) throw new Error(`daemon ${resp.status}`);
    return (await resp.json()) as LaneSummary[];
  } catch {
    return this.opts.fallback.listLanes();
  }
}

async generateHandoff(laneId: string, target: HandoffTarget): Promise<HandoffArtifact | null> {
  try {
    const resp = await this.daemonFetch(
      `/v1/lanes/${encodeURIComponent(laneId)}/handoff?target=${encodeURIComponent(target)}`,
      { signal: this.probeSignal() },
    );
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`daemon ${resp.status}`);
    return (await resp.json()) as HandoffArtifact;
  } catch {
    return this.opts.fallback.generateHandoff(laneId, target);
  }
}
```

`probeSignal()` creates an `AbortSignal.timeout(probeTimeoutMs)`. This ensures
discovery/handoff never block the UI for more than 2 s when the daemon is down.

### 4.3 runLane: SSE streaming with retry

```ts
async *runLane(
  laneId: string,
  input: LaneRunInput,
  signal: AbortSignal,
): AsyncIterable<LaneEvent> {
  let attempt = 0;
  while (true) {
    try {
      yield* this.openRunStream(laneId, input, signal);
      return; // clean finish
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof DaemonUnavailableError) throw err; // don't retry bootstrap failure
      if (++attempt > (this.opts.sseMaxRetries)) throw err;
      await delay(Math.min(500 * attempt, 5000));
    }
  }
}

private async *openRunStream(
  laneId: string,
  input: LaneRunInput,
  signal: AbortSignal,
): AsyncIterable<LaneEvent> {
  // 1. POST /v1/lanes/:id/runs  → { runId }
  let runId: string;
  try {
    const resp = await this.daemonFetch(`/v1/lanes/${encodeURIComponent(laneId)}/runs`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      signal,
    });
    if (!resp.ok) throw new DaemonUnavailableError(`start run: ${resp.status}`);
    runId = ((await resp.json()) as { runId: string }).runId;
  } catch (e) {
    if (e instanceof DaemonUnavailableError) throw e;
    throw new DaemonUnavailableError(String(e));
  }

  // 2. GET /v1/runs/:runId/events  (SSE / NDJSON per doc 02)
  const evtResp = await this.daemonFetch(`/v1/runs/${runId}/events`, { signal });
  if (!evtResp.ok || !evtResp.body)
    throw new Error(`event stream: ${evtResp.status}`);

  for await (const line of readLines(evtResp.body, signal)) {
    if (!line.startsWith("data:")) continue;
    const payload = JSON.parse(line.slice(5).trim()) as LaneEvent;
    yield payload;
    if (payload.type === "final" || payload.type === "error") return;
  }
}
```

`readLines` is a small utility that consumes a `ReadableStream<Uint8Array>` line by line
(NDJSON) using a `TextDecoderStream`. It is defined in
`src/lib/plugins/vibe/stream-utils.ts` (new file, ~40 lines).

### 4.4 sendApproval

```ts
async sendApproval(
  runId: string,
  decision: "approve" | "reject",
  comment?: string,
): Promise<void> {
  const resp = await this.daemonFetch(`/v1/runs/${runId}/approval`, {
    method: "POST",
    body: JSON.stringify({ decision, comment }),
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new DaemonUnavailableError(`approval: ${resp.status}`);
}
```

### 4.5 daemonHealth

```ts
async daemonHealth(): Promise<DaemonHealth> {
  try {
    const resp = await this.daemonFetch("/v1/health", { signal: this.probeSignal() });
    if (!resp.ok) return { status: "down", reason: `HTTP ${resp.status}` };
    const body = await resp.json() as { version: string; runningLanes: number };
    return { status: "up", ...body };
  } catch (e) {
    return { status: "down", reason: String(e) };
  }
}
```

### 4.6 dispose

```ts
async dispose(): Promise<void> {
  this.abortController.abort("dispose");
  await this.opts.fallback.dispose();
}
```

All in-flight SSE connections are terminated via the shared `AbortController`.
Subsequent calls to `runLane` after `dispose()` will throw immediately.

---

## 5. Connection lifecycle and retries

| Scenario | Behavior |
|---|---|
| Daemon never started | `probeSignal()` times out (2 s); `listLanes`/`generateHandoff` fall back to in-process; `runLane` throws `DaemonUnavailableError` |
| Daemon starts mid-session | Next `listLanes` call succeeds (no persistent socket — every request probes fresh); no explicit reconnect needed |
| SSE stream drops mid-run | `runLane` catches the network error and retries up to `sseMaxRetries` times with backoff; run resumes from the daemon's persisted state (doc 05 defines run resumption semantics) |
| Daemon crashes during a run | After `sseMaxRetries` exhausted, `runLane` surfaces an `Error`; the API route converts this to a 503; the UI marks the run as `error` |
| Cockpit server restart | `RemoteVibeService` is reconstructed; past in-progress runs become invisible until the execution view adds a "reload active runs" poll (SP1 stretch, not MVP) |

No persistent WebSocket or keep-alive is maintained. HTTP+SSE is inherently
reconnectable and avoids the upgrade-handshake complexity of WebSockets in Next.js edge
middleware.

---

## 6. Offline-degradation contract (invariant)

**The existing Phase-1 functionality MUST work regardless of daemon state.**

Specifically:
- `GET /api/cockpit/lanes` returns discovered lanes (from local filesystem scan) even
  when `COCKPIT_VIBE_DAEMON_URL` is unset or the daemon is unreachable.
- `GET /api/cockpit/lanes/:id/handoff?target=` returns handoff markdown from the
  in-process path even when the daemon is down.
- The `LaneInventoryPanel` renders lanes and the "Generate handoff" button works
  identically to Phase 1.

This is guaranteed by the fallback chain in `RemoteVibeService.listLanes()` /
`generateHandoff()`. The fallback is always an `InProcessVibeService` constructed from
`COCKPIT_PLUGIN_VIBE_ROOTS`. If `COCKPIT_VIBE_DAEMON_URL` is unset, `registry.ts`
skips the `RemoteVibeService` entirely and uses `InProcessVibeService` directly (see §8).

A new `LaneSummary.daemonStatus?: "up" | "down" | "unknown"` field (optional extension
to the existing type) lets the UI indicate whether live execution is available for each
lane, without affecting discovery or handoff paths.

---

## 7. Mapping LaneEvents to Cockpit kernel state

### 7.1 The kernel authority invariant

Per the architecture invariants in the workflow design (§7):
> "OpenUI never owns durable state or rearranges stable panels."

All durable execution state lives in Cockpit's Supabase-backed kernel. The `LaneEvent`
stream is **transient telemetry** that the Cockpit server-side writes to the kernel as
structured records. The browser never writes kernel state directly from the event stream.

### 7.2 New API route: POST /api/cockpit/lanes/[laneId]/runs

```ts
// src/app/api/cockpit/lanes/[laneId]/runs/route.ts

export async function POST(req, { params }) {
  const { laneId } = await params;
  const body = LaneRunInputSchema.parse(await req.json());

  const host = await getPluginHost();
  const plugin = host.getPlugin("vibe"); // new: expose typed plugin getter
  if (!plugin) return NextResponse.json({ error: "vibe plugin not loaded" }, { status: 503 });

  // Create a kernel run record (durable, user_id scoped)
  const runRecord = await kernel.createLaneRun({ laneId, userId, input: body });

  // Return the runId immediately; client subscribes to /runs/:runId/events
  return NextResponse.json({ runId: runRecord.id });
}
```

### 7.3 New API route: GET /api/cockpit/runs/[runId]/events (SSE passthrough)

This route opens the SSE connection to the Go daemon via `RemoteVibeService.runLane()`,
writes each event to the kernel (`cockpit_lane_run_events` table, user_id scoped, RLS
enforced), and re-streams it to the browser as SSE.

```ts
export async function GET(req, { params }) {
  const { runId } = await params;
  const signal = req.signal;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of vibeService.runLane(laneId, input, signal)) {
        // 1. Write to kernel (authoritative)
        await kernel.appendRunEvent(runId, event);
        // 2. Re-stream to browser
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (event.type === "final" || event.type === "error") {
          await kernel.finalizeRun(runId, event);
          controller.close();
          return;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

The kernel write happens **before** the event is forwarded to the browser. If Cockpit
crashes mid-run the kernel has the partial event log and the run is resumable (or at
minimum inspectable) without re-running.

### 7.4 LaneEvent → kernel record mapping

| LaneEvent type | Kernel table action |
|---|---|
| `start` | `UPDATE lane_runs SET status='running', started_at=now()` |
| `todo` | Upsert into `lane_run_todos` (id, content, status); replaces prior snapshot |
| `tool_call` / `tool_result` | Insert into `lane_run_events` (append-only log) |
| `log` | Insert into `lane_run_events`; level stored for filtering |
| `file_write` | Insert into `lane_run_events`; also update `lane_run_outputs` (path, bytes) |
| `final` | `UPDATE lane_runs SET status='done', completed_at=now()`; upsert `lane_run_outputs` |
| `error` | `UPDATE lane_runs SET status='error', error_message=...` |

All tables carry `user_id` + `run_id` FKs and row-level security identical to existing
`cockpit_assistant_events` policy.

### 7.5 LaneSummary.status update

When a run record exists for a lane, the `GET /api/cockpit/lanes` route joins
`lane_runs` to stamp `status: "running"` on the relevant `LaneSummary`. This keeps
the Lane Inventory panel live without the panel subscribing directly to the SSE stream.

---

## 8. New execution view (LaneRunPanel)

A new panel component `src/components/cockpit/lane-run-panel.tsx` renders the live
event stream for a selected run. It is NOT one of the five stable panels and does NOT
rearrange the existing layout. It renders as a collapsible drawer or a sixth panel slot
(visual design deferred to the SP1 plan phase).

The panel:
1. Fetches `GET /api/cockpit/runs/:runId/events` as an SSE stream via `EventSource`.
2. Maintains local React state: `events: LaneEvent[]`, `status`, `todos`.
3. Does NOT write to the kernel — kernel writes happen server-side in step §7.3.
4. On approval-gate events (`log` with `message: "approval_required"` or a dedicated
   `approval_pending` event from doc 05): shows an approve/reject UI. The button POSTs
   to `POST /api/cockpit/runs/:runId/approval`, which calls
   `RemoteVibeService.sendApproval()`.

```ts
// Sketch — src/components/cockpit/lane-run-panel.tsx

interface RunState {
  status: "connecting" | "running" | "done" | "error" | "awaiting_approval";
  events: LaneEvent[];
  todos: TodoItem[];
  runId: string | null;
}
```

The panel receives `runId` as a prop. The trigger is a new "Run lane" button added to
each `<article>` in `LaneInventoryPanel` — visible only when `daemonStatus === "up"`.

---

## 9. Plugin registry wiring

`buildPluginRegistry()` in `src/lib/plugins/host/registry.ts` gains a second condition:

```ts
if (enabled.includes("vibe")) {
  entries.push({
    id: "vibe",
    factory: () => {
      const roots = (process.env.COCKPIT_PLUGIN_VIBE_ROOTS ?? "")
        .split(",").map(s => s.trim()).filter(Boolean);

      const inProcess = new InProcessVibeService({ repoRoots: roots });

      const daemonUrl = process.env.COCKPIT_VIBE_DAEMON_URL?.trim();
      const service: VibeService = daemonUrl
        ? new RemoteVibeService({ daemonUrl, fallback: inProcess })
        : inProcess;

      return new VibePlugin(service);
    },
  });
}
```

New env vars:

| Variable | Default | Purpose |
|---|---|---|
| `COCKPIT_VIBE_DAEMON_URL` | (unset) | Base URL of `vibe serve`. Absence means in-process mode only |
| `COCKPIT_VIBE_PROBE_TIMEOUT_MS` | `2000` | Max ms to wait for daemon health probe |
| `COCKPIT_VIBE_SSE_MAX_RETRIES` | `3` | SSE reconnect attempts before surfacing error |

When `COCKPIT_VIBE_DAEMON_URL` is unset the code path is **byte-for-byte identical to
Phase 1** — `InProcessVibeService` is wired directly. No change in behavior.

`VibePlugin` must also expose the `runLane` capability:

```ts
// vibe-plugin.ts additions
readonly capabilities: readonly PluginCapability[] = ["discovery", "handoff", "execution"];

async *runLane(
  laneId: string,
  input: LaneRunInput,
  signal: AbortSignal,
): AsyncIterable<LaneEvent> {
  yield* this.service.runLane(laneId, input, signal);
}
```

`PluginHost` gains a `runLane(fullLaneId, input, signal)` method matching the pattern
of `generateHandoff` (strip `pluginId:` prefix, route to plugin, propagate
`DaemonUnavailableError` as 503).

---

## 10. File inventory

| New/Modified | Path | Notes |
|---|---|---|
| Modified | `src/lib/plugins/vibe/vibe-service.ts` | Add `runLane`, `sendApproval`, `daemonHealth`; export `DaemonUnavailableError`, `DaemonHealth` |
| New | `src/lib/plugins/vibe/remote-vibe-service.ts` | `RemoteVibeService` class (~180 lines) |
| New | `src/lib/plugins/vibe/stream-utils.ts` | `readLines(body, signal)` generator (~40 lines) |
| Modified | `src/lib/plugins/vibe/in-process-vibe-service.ts` | Stub `runLane` → throws `DaemonUnavailableError`; stub `daemonHealth` → `down` |
| Modified | `src/lib/plugins/vibe/vibe-plugin.ts` | Add `runLane` delegation; add `"execution"` to capabilities |
| Modified | `src/lib/plugins/host/registry.ts` | Conditional `RemoteVibeService` construction |
| Modified | `src/lib/plugins/host/plugin-host.ts` | Add `runLane` routing method |
| Modified | `src/lib/plugins/contract/types.ts` | Add `daemonStatus?` to `LaneSummary`; confirm `LaneEvent` union matches doc 05 |
| New | `src/app/api/cockpit/lanes/[laneId]/runs/route.ts` | POST: start run, create kernel record |
| New | `src/app/api/cockpit/runs/[runId]/events/route.ts` | GET: SSE passthrough + kernel write |
| New | `src/app/api/cockpit/runs/[runId]/approval/route.ts` | POST: forward approval decision |
| New | `src/components/cockpit/lane-run-panel.tsx` | SSE consumer + approval UI |
| Modified | `src/components/cockpit/lane-inventory-panel.tsx` | Add "Run lane" button (daemon-gated) |

---

## 11. Open questions / risks

1. **Kernel schema migration** — `lane_runs`, `lane_run_events`, `lane_run_todos`,
   `lane_run_outputs` tables do not yet exist. These must be Supabase migrations with
   RLS matching the existing `cockpit_assistant_events` policy. Forgetting RLS is the
   highest-probability security miss in this surface.

2. **Run resumption after Cockpit restart** — the design has no "reload in-flight
   runs" path. A run started before a dev-server HMR cycle or browser refresh is
   orphaned from the panel. The kernel preserves the event log but the UI needs a
   "reconnect to existing run" flow (query `lane_runs WHERE status='running'` on mount).
   MVP can omit this; it should be called out as a known gap in the SP1 plan.

3. **`vibe serve` run persistence** — the adapter assumes the Go daemon can serve
   `GET /v1/runs/:runId/events` to resume a stream after SSE retry (§5). If the daemon
   holds events only in-memory and discards them on client disconnect, retries will miss
   events. The Go daemon design (doc 03 / 04) must commit to either in-memory buffering
   with a replay window or external persistence before this retry contract is valid.

4. **LaneEvent union drift** — `contract/types.ts` already defines `LaneEvent`. If doc
   05 defines a different wire shape (e.g. `approval_pending` event type not yet in the
   union), there will be a silent misparse. A shared Zod schema with `safeParse` + warn
   on unknown event types at the SSE boundary should be added to `stream-utils.ts`.

5. **Next.js edge runtime** — `src/app/api/cockpit/runs/[runId]/events/route.ts` uses
   `ReadableStream` and long-lived responses. It must declare `export const runtime =
   "nodejs"` (matching existing routes). Forgetting this breaks SSE under the edge
   runtime.

6. **Auth on daemon URL** — if `vibe serve` is ever exposed beyond localhost (e.g.
   Docker bridge network), the `daemonFetch` helper must attach an auth token.
   For SP1 (localhost only) this is not blocking, but the extension point (a
   `daemonToken?: string` option) should be reserved in `RemoteVibeServiceOptions`
   to avoid a later breaking change.

7. **InProcessVibeService as fallback during execution** — when the daemon is down and
   the user clicks "Run lane," `runLane` throws `DaemonUnavailableError`. The API route
   converts this to HTTP 503. The `LaneRunPanel` must surface a human-readable
   "Daemon not running — start `vibe serve` to execute lanes" message rather than a raw
   503, preserving the UX invariant that handoff generation always remains accessible.
