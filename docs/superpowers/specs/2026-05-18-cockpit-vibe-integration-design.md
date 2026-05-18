# Cockpit ↔ Vibe Integration Design (Draft)

| Field | Value |
|---|---|
| Date | 2026-05-18 (resumed and completed same day) |
| Status | **APPROVED** — All sections (1–10) at APPROVED status. Ready for the user end-to-end review pass, then for the `writing-plans` skill to translate Sections 5/7/9 into Phase 3/4/5 implementation plans. See per-section status headers for provenance. |
| Author | Luther (brainstorming session) |
| Brainstorming partner | Claude (Superpowers brainstorming + dispatching-parallel-agents skills) |
| Sibling artifact | `lutherfourie/vibe` PR #6 — deepagents POC sandbox |

> **Spec completion note.** The 2026-05-18 morning session approved Sections 1 and 2 only. The afternoon resume pass (same date, "do this with superpowers") walked Sections 3–10 to APPROVED using a Section 3 → parallel-agents (4/5/6/7) → Section 8/9/10 sequence. The `Status:` header on each section records its provenance.

---

## Context

Two projects have grown in parallel:

- **Cockpit** (this repo, `lutherfourie/cockpit`) — a Next.js 16 / React 19 ADHD development assistant. Compresses messy input into one current goal, one next action, one proof target. Multi-provider agent (local / OpenAI / Codex CLI / Cerebras), Supabase Auth + RLS-scoped memory, OpenUI for the assistant render surface, CopilotKit recently merged for the assistant command center. Designed to be the operator's primary surface across browser, browser extension, VS Code extension, and CLI.
- **Vibe** (`lutherfourie/vibe`) — a hybrid specification language and runtime substrate for declaring agentic infrastructure as code. Langium parser, lane/scope/verify/approval primitives, surface-aware handoff generator, `vibe serve` HTTP dashboard, and (per PR #6) a working deepagents-based lane runtime that drives Cerebras GLM-4.7 with the user's own Codex CLI and Claude CLI as delegation tools.

The integration question is **how the two reconcile architecturally** when both have multi-provider model stories, lane/handoff concepts, and persistent context.

## Decisions captured during brainstorming

These were the user's calls during the 2026-05-18 session. They constrain the rest of the design.

1. **Relationship**: Cockpit is the operator UI (multi-surface: browser, browser ext, VS Code ext, CLI). Vibe is the substrate Cockpit connects to. They ship independently. Cockpit-first when designing the integration ("make life easy through Cockpit").
2. **Plugin system**: Cockpit has a plugin system. Vibe is the first plugin. Other plugins (Aider, custom DSLs, GitHub Actions integrations) should be able to follow the same shape later.
3. **Capabilities required**: A plugin can provide any subset of four capabilities: **discovery**, **execution + streaming**, **handoff generation**, **memory bridge**.
4. **Single mega-spec**: All five sub-projects (plugin system + four capabilities) are designed in one document. (This document.)
5. **Plugin runtime**: Plugins are **in-process TypeScript modules**, dynamically imported by Cockpit's Next.js backend. No external-process plugins for v0.
6. **Vibe service shape**: A `VibeService` interface is exposed by the plugin. The interface has **two implementations**: `InProcessVibeService` (default — runs in Cockpit's process) and `RemoteVibeService` (talks to a Vibe daemon over HTTP/WS). Choice made at plugin init via config.
7. **Memory ownership**: Cockpit owns the Supabase memory and its RLS. Plugins receive a *mediated* memory API (`HostMemoryApi`) namespaced to `<plugin.id>:*`. No service-role bypass, no direct DB access from plugins.
8. **Multi-surface coordination**: One Cockpit Next.js backend per user/machine. Browser tabs, browser extension, VS Code extension, and Cockpit CLI are all clients of that backend. The plugin host lives in the backend.

## Provenance

- Sandbox prototype (proves deepagents is viable as Vibe's runtime substrate): `lutherfourie/vibe` PR #6 — translator, three working lanes (`feedback-triage`, `truths-extraction`, `cli-delegation`), Codex CLI + Claude CLI as tools via stdin.
- User memory: `C:\Users\4elut\.claude\projects\C--vibe\memory\` — durable context referenced throughout this session.

---

## Section 1 — Overall architecture

**Status: APPROVED 2026-05-18**

Three-layer model with the plugin abstraction in the middle providing a swappable runtime story.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Cockpit surfaces (clients)                                              │
│   • Next.js browser pages (existing)                                    │
│   • Browser extension (planned)                                         │
│   • VS Code extension (planned)                                         │
│   • Cockpit CLI (planned)                                               │
│                                                                         │
│   All speak Cockpit's existing HTTP/SSE API to → the Cockpit backend.   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Cockpit Next.js backend (this repo)                                     │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │ Plugin host (`src/lib/plugins/host/plugin-host.ts`)              │ │
│   │   - Loads plugins at startup based on settings                    │ │
│   │   - Each plugin implements the `CockpitPlugin` interface          │ │
│   │   - Exposes discovery/execution/handoff/memory across plugins     │ │
│   └────────────────────────────┬─────────────────────────────────────┘ │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │ Plugins (in-process TS modules)                                   │ │
│   │                                                                    │ │
│   │   • @vibe/cockpit-plugin   (first plugin — Vibe)                  │ │
│   │   • future: aider-plugin, custom-dsl-plugin, etc.                 │ │
│   │                                                                    │ │
│   │   Each plugin imports a `VibeService`-style runtime interface.    │ │
│   └────────────────────────────┬─────────────────────────────────────┘ │
└────────────────────────────────┼───────────────────────────────────────┘
                                 │
                ┌────────────────┴──────────────────┐
                │                                    │
                ▼                                    ▼
   ┌──────────────────────────┐         ┌────────────────────────────┐
   │ InProcessVibeService     │         │ RemoteVibeService          │
   │ (default — Node module)  │         │ (daemon mode — HTTP/WS)    │
   │                          │         │                            │
   │ Watches files, parses    │         │ Thin client to `vibe-daemon│
   │ .vibe, runs deepagents,  │         │ ` running on localhost,    │
   │ generates handoffs.      │         │ same logic externalized.   │
   │ Runs in Cockpit process. │         │                            │
   └──────────────────────────┘         └────────────────────────────┘
```

**Three layered abstractions**, each with one job:

1. **Plugin host** — Cockpit-internal. Knows nothing about Vibe specifically. Loads plugins, routes calls.
2. **`@vibe/cockpit-plugin`** — Vibe-specific. Translates the generic `CockpitPlugin` contract into `VibeService` calls. Marshals types. Handles error envelopes.
3. **`VibeService`** — Vibe-runtime-internal. The actual work: file watching, parsing, deepagents, handoff. Two implementations sharing one interface.

The user's "in-process TS modules" choice means the plugin (layer 2) is always in-process. The `VibeService` (layer 3) is what's swappable.

**Why three layers and not two:** if layer 2 (plugin) and layer 3 (service) were merged, the plugin would always have to run in the same process as the service — defeating the "daemon optional" choice. The interface boundary at layer 3 is what lets the daemon be optional.

**Runtime choice mechanism.** Cockpit reads a single config field (env var or settings entry):

```
COCKPIT_VIBE_RUNTIME=in-process    # default
COCKPIT_VIBE_RUNTIME=remote        # talks to localhost:8787 daemon
COCKPIT_VIBE_REMOTE_URL=http://127.0.0.1:8787
```

Plugin at startup constructs the right impl:

```typescript
const service: VibeService =
  config.runtime === "remote"
    ? new RemoteVibeService(config.remoteUrl)
    : new InProcessVibeService(config.repoRoots);
```

Both implement the same interface. Switching is one env var.

---

## Section 2 — `CockpitPlugin` contract

**Status: APPROVED 2026-05-18** (with the three open questions resolved — see "Resolutions" at the end of this section)

The interface every plugin (Vibe first, others later) implements. Lives in Cockpit at `src/lib/plugins/contract/types.ts`.

```typescript
// Cockpit's plugin contract — language-agnostic in spirit, TS-typed in practice.

export interface CockpitPlugin {
  /** Stable identifier — used as namespace for routes, memory, telemetry. */
  readonly id: string;             // e.g. "vibe"
  readonly displayName: string;    // e.g. "Vibe Lanes"
  readonly version: string;
  readonly description?: string;

  /** Which capabilities this plugin provides. Cockpit checks before calling. */
  readonly capabilities: readonly PluginCapability[];

  /** Called once at startup. Plugin connects to its runtime, validates config, returns ready. */
  init(host: PluginHostContext): Promise<void>;

  /** Called on Cockpit shutdown or plugin reload. Plugin tears down its runtime. */
  dispose(): Promise<void>;

  // ─── Capability hooks (each is optional; presence must match `capabilities`) ───

  /** Discovery: return all lanes this plugin knows about. Cheap; cached by host. */
  listLanes?(): Promise<LaneSummary[]>;

  /** Execution: run a lane; yield events until done. AbortSignal supports cancellation. */
  runLane?(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent>;

  /** Handoff: produce a ready-to-paste handoff for a target surface. */
  generateHandoff?(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact>;

  /** Memory bridge: optional accessor for namespaced memory operations. */
  memoryBridge?: PluginMemoryBridge;
}

export type PluginCapability =
  | "discovery"
  | "execution"
  | "handoff"
  | "memory";

export interface PluginHostContext {
  /** Logger scoped to plugin id; writes structured logs Cockpit can render. */
  log: PluginLogger;

  /** Read-only access to Cockpit settings the user has scoped to this plugin. */
  settings: ReadonlyMap<string, unknown>;

  /** Cockpit-mediated memory API. Plugin writes are namespaced to `<plugin.id>:*`. */
  memory: HostMemoryApi;

  /** Cockpit's structured event sink — plugin can emit telemetry / activity events. */
  events: HostEventSink;
}
```

### Shared types (sketched, not exhaustive)

```typescript
export interface LaneSummary {
  laneId: string;             // unique within plugin (plugin namespaces)
  pluginId: string;           // set by host on read; plugins don't include
  name: string;
  description?: string;
  repoPath: string;           // which repo this lane belongs to
  reads: string[];
  owns: string[];
  target?: string;            // surface hint, e.g. "codex.local"
  approval?: string;          // approval gate name, e.g. "human.before_commit"
  verify?: string[];
  status: "ready" | "running" | "error";
  lastRunAt?: string;         // ISO timestamp
}

export type LaneEvent =
  | { type: "start";          laneId: string; runId: string; }
  | { type: "todo";           items: TodoItem[]; }
  | { type: "tool_call";      tool: string; args?: unknown; }
  | { type: "tool_result";    tool: string; ok: boolean; preview?: string; }
  | { type: "log";            level: "info" | "warn" | "error"; message: string; }
  | { type: "file_write";     path: string; bytes: number; }
  | { type: "final";          summary: string; outputs: { path: string; bytes: number }[]; }
  | { type: "error";          message: string; recoverable: boolean; };

export interface HandoffArtifact {
  text: string;
  target: HandoffTarget;
  format: "markdown" | "json";
  recommendedCommand?: string;  // e.g. `claude -p < handoff.md`
}

export type HandoffTarget =
  | "codex.web"
  | "codex.cli"
  | "codex.github_pr"
  | "claude.code"
  | "claude.web"
  | "human.review";
```

### Plugin lifecycle in Cockpit

1. **Startup**: Cockpit reads its plugin registry (just a settings list: `cockpit.plugins = ["@vibe/cockpit-plugin"]`). For each entry, dynamic-imports the module, instantiates the default export, calls `init(host)`.
2. **Use**: Cockpit's API routes (e.g., `/api/cockpit/lanes`) consult the plugin host, which fans out to plugins whose `capabilities` include the relevant one.
3. **Failure isolation**: A plugin throwing in `init` or any capability hook is logged + reported via UI; doesn't crash Cockpit. The plugin's capabilities are marked `errored` and excluded from future calls until reload.
4. **Reload**: A `/api/cockpit/plugins/:id/reload` route disposes and re-inits a plugin (useful for dev / config changes).

### Why this shape

- **Discriminated-union events** (`LaneEvent`) keep the streaming protocol typed end-to-end — the UI can render each event variant differently without runtime type guards.
- **Optional capabilities** mean a plugin can ship in slices (Vibe v0 might do discovery + handoff only; execution and memory land later).
- **Host-mediated memory** keeps RLS intact: plugin doesn't get raw Supabase access, only the namespaced `HostMemoryApi` (more in Section 7).
- **AbortSignal on `runLane`** is the cancellation primitive — Cockpit's "Cancel run" button just aborts.

### Resolutions

These were the three open questions; resolved during the 2026-05-18 review pass.

**1. JSON manifest separate from the TS class?** No. The TS class's static metadata (`id`, `displayName`, `version`, `description`, `capabilities`) is enough for v0. A separate JSON manifest can be added later if/when a plugin browser UI demands it, but YAGNI for now.

**2. Is `PluginHostContext.settings` reactive or read-at-init?** Read-at-init. Settings are snapshotted into the plugin context when `init(host)` is called. Settings changes are handled via the explicit `/api/cockpit/plugins/:id/reload` endpoint already in the lifecycle (Section 2.3). Reactive-at-runtime settings would hide lifecycle issues.

**3. What's in `LaneRunInput`?** Concrete shape:

```typescript
export interface LaneRunInput {
  /** The human message / user instruction for this lane run. Required. */
  userMessage: string;

  /** Optional overrides applied for this single run only. */
  overrides?: {
    /** Override the lane's default model (e.g., switch from cerebras to anthropic). */
    model?: string;

    /** Additional env vars merged into the lane's environment for this run. */
    envVars?: Record<string, string>;

    /** Override the working directory the lane resolves paths against. */
    cwd?: string;
  };
}
```

This maps directly to what the sandbox prototype's `run-translated.ts` already consumes — `userMessage` from CLI arg, overrides not yet supported but the shape leaves room. Adding fields is additive; removing requires a contract version bump (Section 8).

---

## Section 3 — `VibeService` interface and implementations

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

`VibeService` is the layer-3 runtime interface the plugin consumes internally. Two implementations: `InProcessVibeService` (default, runs in Cockpit's Node process) and `RemoteVibeService` (HTTP/SSE client against a Vibe daemon on `127.0.0.1:8787`). Selection is via `COCKPIT_VIBE_RUNTIME` at plugin init (Section 1.runtime choice mechanism).

### 3.1 Full interface

```typescript
export interface VibeService {
  /** Discover all lanes under configured repo roots. Cheap; called frequently. */
  listLanes(): Promise<LaneSummary[]>;

  /**
   * Execute a lane and stream events until done. The returned iterable terminates
   * on a `final` or `error` event, or when `signal` aborts. Implementations MUST
   * close any underlying resources (subprocesses, SSE connections) on abort.
   */
  runLane(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent>;

  /** Produce a copy-paste handoff for the given lane targeted at a surface. */
  generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null>;

  /** Handle to the runtime's memory bridge — see Section 7. Always present;
   *  the value is a no-op implementation when the plugin's `memory` capability is
   *  not advertised. */
  readonly memory: VibeMemoryHandle;

  /** Release file watchers, open HTTP/SSE connections, and any subprocesses.
   *  Idempotent; safe to call multiple times. */
  dispose(): Promise<void>;
}
```

The plugin layer translates `<pluginId>:<laneId>` ↔ bare `laneId` at the host boundary; the service never sees plugin namespacing.

### 3.2 `InProcessVibeService` — file watching

- **Library**: chokidar v4 across `options.repoRoots`.
- **Globs**: `**/lanes/*.json` and sibling `**/lanes/*.prompt.md`.
- **Debounce**: 100 ms per file (collapses editor-save bursts).
- **Internal event**: emits a `lanesChanged` signal the plugin subscribes to for cache invalidation. (Phase 3+: same signal is forwarded over the lane-events SSE channel for live UI refresh.)
- **Poll fallback**: when chokidar reports `usePolling` was forced (WSL2, network mounts), drop to a 5 s poll. Logged once at init.
- **`listLanes()` semantics**: returns from an in-memory cache populated by the watcher. First call after init resolves only after the initial scan completes. Cache invalidation is automatic on watcher events; no manual refresh API.

### 3.3 `RemoteVibeService` — wire protocol

All endpoints rooted at `COCKPIT_VIBE_REMOTE_URL` (default `http://127.0.0.1:8787`). JSON request/response unless noted.

| Endpoint | Purpose |
|---|---|
| `GET /lanes` | List lanes. Returns `LaneSummary[]` minus the `pluginId` field (host fills it). |
| `GET /lanes/:laneId` | Fetch one lane's detail (currently unused by the interface, reserved for future). |
| `POST /runs` | Start a run. Body: `{ laneId, input }`. Returns `{ runId }`. |
| `GET /runs/:runId/events` | SSE stream of `LaneEvent` JSON frames. Each event uses the SSE event type matching `LaneEvent.type`. |
| `POST /runs/:runId/cancel` | Request cancellation. Fire-and-forget; the SSE stream closes on the daemon's side. |
| `GET /handoff?laneId=...&target=...` | Returns a `HandoffArtifact` JSON. 404 if lane unknown. |
| `GET /health` | Liveness probe. Returns `200 { "ok": true, "version": "<daemon semver>" }`. Used by Cockpit's auto-spawn lifecycle (§9.5). |

**SSE over WebSocket** for `runLane`: browser fetch supports SSE natively, single-direction matches our streaming model, reconnect semantics are built in, and we already need HTTP for state queries — no second wire type to design. The cost (no client→server frames) is exactly what the `POST /runs/:runId/cancel` side-channel handles.

### 3.4 Productionized lane runtime location

The deepagents-based translator graduates from `sandbox/deepagents-poc/src/translator.ts` into a new workspace package **`vibe/packages/runtime/`**. Public API:

```typescript
// @vibe/runtime
export interface LaneRunSpec {
  laneId: string;
  prompt: string;          // resolved prompt body
  reads: string[];
  owns: string[];
  tools?: string[];
  model?: string;
  approval?: string;
  verify?: string[];
  repoPath: string;
}

export interface LaneRunInputs {
  userMessage: string;
  overrides?: {
    model?: string;
    envVars?: Record<string, string>;
    cwd?: string;
  };
}

export function runTranslatedLane(
  spec: LaneRunSpec,
  input: LaneRunInputs,
  signal: AbortSignal,
): AsyncIterable<LaneEvent>;
```

Both `InProcessVibeService` (direct import) and the Vibe daemon (embed) consume this module. Single source of truth for the lane-execution contract.

### 3.5 AbortSignal propagation

- **InProcess**: `runLane`'s `signal` is passed directly into `runTranslatedLane`, which forwards it to LangGraph's stream controller.
- **Remote**: when `signal.aborted` fires, the iterator wrapper issues `POST /runs/:runId/cancel` (fire-and-forget) and closes the SSE EventSource on the client side. The daemon, on receiving the cancel, calls `controller.abort()` on its in-flight stream. The SSE stream's final frame is `{ type: "error", message: "canceled", recoverable: true }`. Consumers who only watch their own `AbortSignal` get a clean iterator return; consumers who read all events see the explicit `canceled` error.

### 3.6 Sequence — `runLane` in both modes

```text
InProcess:
  Plugin.runLane(<plugin>:<lane>, input, signal)
    └─► strip prefix → bare laneId
    └─► VibeService.runLane(laneId, input, signal)
          └─► runTranslatedLane (from @vibe/runtime)
                └─► LangGraph stream chunks
          ◄── yields LaneEvent
    ◄── yields LaneEvent to host → API route → SSE → surface

Remote:
  Plugin.runLane(<plugin>:<lane>, input, signal)
    └─► strip prefix → bare laneId
    └─► RemoteVibeService.runLane(laneId, input, signal)
          └─► POST /runs                     ← daemon spawns runTranslatedLane
          ◄── { runId }
          └─► GET  /runs/:runId/events (SSE)
                ◄── LaneEvent JSON frames
          (on signal.aborted)
          └─► POST /runs/:runId/cancel       ← daemon aborts its stream
    ◄── final `error: canceled` frame → iterator returns
```

### 3.7 Daemon lifecycle (forward reference)

`RemoteVibeService` is a passive HTTP client. **Who starts/stops the Vibe daemon** is resolved in Section 9 (Error handling) and the cross-cutting open questions — most likely Cockpit autospawns it with health-check + restart, mirroring how Docker Desktop manages dockerd. Not in scope for Section 3.

---

## Section 4 — Capability: Lane discovery

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

Discovery is the cheapest and most-called capability in the contract. Its job is to keep the plugin host's view of "what lanes exist" continuously aligned with what's on disk, so that surfaces (browser, VS Code, CLI) render a lane inventory without any explicit refresh. Section 3.2 already pinned the file-watching mechanics; this section pins the file shape, deletion semantics, UI representation, and the consequence chain for the rest of Cockpit.

### 4.1 Canonical lane-discovery file shape

**Decision: v0 ingests only `lanes/*.json` files with optional sibling `*.prompt.md` files.** `.vibe` DSL files are deferred.

Rationale:

- `InProcessVibeService` (Phase 1 code, `src/lib/plugins/vibe/in-process-vibe-service.ts`) already implements this exact shape; `LaneSpecSchema` is the live source of truth.
- The three working lanes the deepagents POC proved out (`sandbox/deepagents-poc/lanes/{feedback-triage,cli-delegation,truths-extraction}.json`) all use this shape.
- `.vibe` DSL files require the Langium parser at runtime in Cockpit's Next.js process. That's a multi-megabyte dependency tree and a forward compat hazard (the DSL is still moving). Translating `.vibe` → lane JSON is a job the Vibe daemon will own once `RemoteVibeService` lands; until then, JSON-only keeps Cockpit's dependency graph clean.
- The user can hand-author lane JSON today; `.vibe` ingestion can be added in a later phase as a strict extension (add a glob, add a parse path) without changing the contract.

**Canonical schema** (mirrors `LaneSpecSchema` in `in-process-vibe-service.ts`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Becomes the bare `laneId`. Unique within the configured roots; first occurrence wins on collision. |
| `description` | string | no | Surface-facing one-liner. |
| `promptFile` | string | no\* | Relative to the lane JSON's directory, or absolute. Resolved on demand. |
| `prompt` | string | no\* | Inline alternative to `promptFile`. |
| `defaultUserMessage` | string | no | Prefilled in the run dialog when the user picks the lane. |
| `reads` | string[] | no | Glob patterns the lane is allowed to read. |
| `owns` | string[] | no | Glob patterns the lane is allowed to write. |
| `tools` | string[] | no | Tool ids the lane may invoke (e.g. `codex_cli`, `claude_cli`). |
| `model` | string | no | Default model for the lane (e.g. `cerebras`). |
| `target` | string | no | Surface hint for handoff (e.g. `codex.local`, `vibe.cockpit`). |
| `approval` | string | no | Approval gate name (e.g. `human.before_commit`). |
| `verify` | string[] | no | Verification commands the lane should pass. |

\* Either `prompt` or `promptFile` SHOULD be set; absent both, discovery succeeds but execution will resolve to `"(no prompt defined)"`.

**Example** (`<repoRoot>/lanes/feedback-triage.json` from the deepagents POC, unmodified):

```json
{
  "name": "feedback-triage",
  "description": "Map Pawfall feedback bullets to a docs-only implementation action plan, aligned with the GDD.",
  "promptFile": "./feedback-triage.prompt.md",
  "defaultUserMessage": "Process the 2026-05-15 Pawfall feedback. Read /fixtures/pawfall/docs/feedback/2026-05-15.md and /fixtures/pawfall/docs/GDD.md, then write the action plan to /outputs/2026-05-15-action-plan.md.",
  "reads": ["/fixtures/pawfall/docs/feedback/**", "/fixtures/pawfall/docs/GDD.md"],
  "owns": ["/outputs/**"],
  "model": "cerebras",
  "target": "codex.web",
  "approval": "human.before_commit"
}
```

**Validation**: each candidate file is parsed with `LaneSpecSchema.safeParse`. Failures (bad JSON, missing `name`, wrong types) are silently skipped and logged through `PluginHostContext.log.warn` — discovery never throws because one file is malformed.

### 4.2 File-watching responsibilities for discovery

Restates Section 3.2 with the discovery-specific consequences nailed down.

| Concern | Decision |
|---|---|
| Watcher | chokidar v4, started once at `InProcessVibeService` construction. |
| Watched roots | `options.repoRoots` (passed in by Cockpit at plugin init from user settings). |
| Globs | `**/lanes/*.json` and `**/lanes/*.prompt.md`. |
| Debounce | 100 ms per file, collapsing editor-save bursts. |
| Poll fallback | 5 s when chokidar reports `usePolling` (WSL2, network mounts). Logged once. |
| Initial scan | First `listLanes()` call awaits the initial scan; subsequent calls return from cache synchronously after the promise settles. |
| Internal signal | The watcher updates the in-memory cache and emits a `lanesChanged` event the plugin subscribes to (forwarded over SSE in a later phase). |
| Manual refresh API | None. `listLanes()` is the only public surface; the cache is always live. |

**Deletion semantics** (the question Section 4 must answer beyond Section 3.2):

- A lane JSON file deleted from disk is removed from the in-memory cache on the next debounced watcher tick — i.e. up to ~100 ms after the OS delivers the `unlink` event (5 s in poll-fallback environments).
- Removing the sibling `*.prompt.md` does **not** drop the lane from discovery. The lane stays in the cache with a stub prompt resolver; `listLanes()` continues to return it. This matches the existing `resolvePrompt()` behavior, which falls back to `"(prompt file not found)"` rather than failing discovery. The rationale: a missing prompt file is recoverable (re-create the file); a missing lane JSON is the explicit "this lane no longer exists" signal.
- An in-flight `runLane(laneId, ...)` for a lane whose JSON was just deleted continues to completion against the spec snapshot the runtime already loaded. Subsequent calls for the same `laneId` return null / 404 once the cache eviction settles.
- Renaming a lane file (`unlink` + `add`) appears in the cache as a remove-then-add within the same debounce window. The host will see one `lanesChanged` event with the net state.

### 4.3 Caching semantics and UI consequence

Cache is the single source of truth for `listLanes()`. UI consequences:

- **No "refresh" button**: Cockpit's lane inventory panel does not need one, and intentionally does not show one. Avoids users wondering why a refresh button is there if the panel is supposed to be live.
- **No spinners after initial load**: the first render awaits initial scan completion (one-time spinner acceptable); from then on, the panel re-renders from the cache and from `lanesChanged`-driven SSE pushes (Phase 3+). Discovery latency for added/removed lanes is bounded by the watcher debounce (~100 ms typical; ~5 s poll fallback).
- **Stale-while-disconnected**: when the SSE connection drops (browser tab backgrounded, network blip), the surface keeps rendering the last cache snapshot. On reconnect the next push replaces it. No reconcile pass needed — the host's cache is authoritative.

### 4.4 Multi-repo representation in Cockpit

**Decision: grouped by `repoPath`, repo name as a section header, collapsible.** Flat-with-badge was the rejected alternative.

Rationale: the user runs this against Cockpit + Vibe + GameSpree-style repos concurrently. With 5–20 lanes per repo and 3+ repos, a flat list with a "repo" badge column becomes a scan problem (eyes have to filter the badge to find a coherent set). Grouped headers let the user collapse uninteresting repos and treat each repo as a workspace tab.

Repo group ordering: stable by `repoPath` string (deterministic). Within a group, lanes are ordered by `name` ascending. Lane status badge (`ready` / `running` / `error`) lives on each lane row.

### 4.5 Lane inventory panel — UI sketch

The panel lives in Cockpit's existing layout as an OpenUI render zone, addressable by the assistant ("show my lanes") and by direct route navigation. The CopilotKit chat panel runs alongside and can issue lane actions; the inventory panel is the readout surface.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Lanes                                                  [Run lane…]  ⓘ │
├────────────────────────────────────────────────────────────────────────────┤
│ ▼ C:\Users\4elut\Documents\Cockpit                                   3 lanes │
│   ● cockpit-feedback-triage         codex.local    human.before_commit │
│       Map feedback bullets to docs-only action plan items.                  │
│       reads: /docs/feedback/**, /docs/GDD.md  owns: /outputs/**             │
│       [Generate handoff ▾]  [Run lane]                                      │
│                                                                             │
│   ● cockpit-truths-extraction       codex.local    -                  │
│       Extract durable truths from session transcripts.                      │
│       reads: /memory/**             owns: /memory/truths/**                 │
│       [Generate handoff ▾]  [Run lane]                                      │
│                                                                             │
│   ◐ cockpit-cli-delegation          vibe.cockpit   human.before_commit │
│       running · 2 tool calls · started 14s ago                              │
│       [View stream]  [Cancel]                                               │
│                                                                             │
│ ▶ C:\vibe                                                            5 lanes │
│ ▶ C:\GameSpree                                                       2 lanes │
└────────────────────────────────────────────────────────────────────────────┘
```

Element key:

- Group header: `▼`/`▶` toggle, full repo path, count of lanes in that repo. Path is shown verbatim (no truncation) on hover; the rendered form may shorten to the trailing segment when space is tight.
- Lane row status glyph: `●` ready, `◐` running, `✖` error (status comes from `LaneSummary.status` for `ready`/`error`; `running` comes from the host's live run-tracking, not from disk).
- Per-row metadata: `target` and `approval` shown inline when present; `reads`/`owns` shown as a second line, truncated with a tooltip for the full list.
- Per-row actions: `Generate handoff` (dropdown over `HandoffTarget` values from Section 2) and `Run lane` (opens a small form prefilled with `defaultUserMessage`). When the lane is running, the action set swaps to `View stream` / `Cancel`.
- Header action `[Run lane…]`: shortcut to run any lane by id, primarily for power users / CopilotKit-issued commands.

The panel listens for `lanesChanged` events over the existing SSE channel and re-renders incrementally; no manual reload affordance is exposed.

### 4.6 What is explicitly NOT in v0

- `.vibe` DSL ingestion. Deferred until the Vibe daemon owns the parse step.
- A per-lane "history" inline in this panel. Run history lives on its own surface (Section 5).
- Plugin-contributed lane sources from non-Vibe plugins. The interface supports it (any plugin advertising `discovery` contributes to the merged list); the UI just shows the union grouped by `repoPath`, with the plugin id available as a column we can promote later if a second source appears.
- Editing lane JSON from the UI. Discovery is read-only; lane authoring stays in the user's editor.

---

## Section 5 — Capability: Lane execution + streaming

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

This is the section that makes Cockpit actually finish tasks. It wires the deepagents-based lane runtime in `vibe/packages/runtime/` (Section 3.4) into Cockpit's request/response surface via the `VibeService.runLane()` AsyncIterable defined in Section 3.1. Everything below assumes Sections 1–3 as backdrop.

### 5.1 End-to-end event flow

```text
surface (browser tab / VS Code ext / CLI)
   │   POST /api/cockpit/lanes/:laneId/run   { input }
   ▼
Cockpit Next.js routes (three new files):
   POST  src/app/api/cockpit/lanes/[laneId]/run/route.ts
   GET   src/app/api/cockpit/lanes/[laneId]/run-events/route.ts
   POST  src/app/api/cockpit/runs/[runId]/cancel/route.ts
   │   1. POST /run: authenticate; resolve user_id via Supabase Auth
   │   2. mint runId (uuid); add entry to in-memory activeRuns map (§5.7)
   │   3. call pluginHost.runLane(`<pluginId>:<laneId>`, input, signal)
   │       (mirrors the existing pluginHost.generateHandoff prefix routing;
   │        Phase 3 adds runLane() to the host — see Next Steps checklist)
   │   4. return { runId }; the consumer follows up with GET /run-events?runId=...
   │   5. GET /run-events drains the AsyncIterable into the SSE response
   │      (Phase 3b: also persist each event to cockpit_lane_events — §5.8)
   ▼
Vibe plugin .runLane()
   │   strips `<plugin>:` prefix → bare laneId
   ▼
VibeService.runLane()       (InProcess or Remote — Section 3)
   │
   ▼
@vibe/runtime.runTranslatedLane(spec, input, signal)
   │   loads spec, calls `agent.stream({ messages: [...] }, { streamMode: "updates", subgraphs: true })`
   ▼
LangGraph chunks: [namespace, { nodeName: stateUpdate }]   ◄── confirmed via sandbox/deepagents-poc/src/run-translated.ts:42 and ctx7 LangGraph docs (streamMode: "updates" with subgraphs: true yields tuples of [namespace, data]).
   │   translator (in @vibe/runtime) maps each chunk → 0..N LaneEvent variants (table in 5.2)
   ▼
AsyncIterable<LaneEvent>     ── flows back up the stack ──
```

The route handler is the only place that gets to touch Supabase. The plugin host, plugins, and runtime never see the database. This keeps Section 7's "host-mediated memory" invariant intact for execution as well.

### 5.2 LangGraph chunk → LaneEvent mapping

LangGraph's `streamMode: "updates"` with `subgraphs: true` emits `[namespace, { [nodeName]: stateUpdate }]` tuples (confirmed: `sandbox/deepagents-poc/src/run-translated.ts:42-45`). The `stateUpdate` object's keys are the deepagent state slots the node mutated — typically a subset of `{ messages, files, todos }`.

The translator in `@vibe/runtime` is the **only** place that knows about LangGraph internals. It emits the typed `LaneEvent` stream the rest of the system consumes.

| Upstream (LangGraph chunk shape) | Trigger | LaneEvent emitted | Field mapping | Notes |
|---|---|---|---|---|
| *(synthetic, before first chunk)* | Translator generates a uuid, opens stream | `start` | `laneId` = bare lane id; `runId` = caller-provided | Always first; not derived from any chunk. |
| `{ agent: { messages: [AIMessageChunk{ tool_calls: [...] }] } }` | Model decides to invoke a tool (built-in or CLI delegate) | `tool_call` (one per entry in `tool_calls`) | `tool` = `tool_calls[i].name`; `args` = `tool_calls[i].args` (JSON-cloned, depth-limited) | Filter out internal `__end__`/control entries. If `tool_calls.length === 0`, skip. |
| `{ tools: { messages: [ToolMessage{ name, content, status }] } }` | A tool returned | `tool_result` | `tool` = `name`; `ok` = `status !== "error"` (default true); `preview` = first 240 chars of `content` if string | Suppress for `write_file`/`edit_file` since the row below produces the richer `file_write` instead. |
| `{ tools: { messages: [ToolMessage{ name: "write_todos", ... }] } } ` AND/OR `{ agent: { todos: TodoItem[] } }` | The `write_todos` planning tool updates `state.todos` | `todo` | `items` = full normalized list from updated state | Coalesce: if both the tool message and the state-update arrive in the same chunk batch, emit a single `todo` event using the state slot (it's authoritative). |
| `{ tools: { files: { [path]: FileMeta } } }` or `{ agent: { files: ... } }` — diff vs previous `state.files` | `write_file` or `edit_file` mutated the in-state file map | `file_write` (one per changed path) | `path` = key; `bytes` = `Buffer.byteLength(content, "utf8")` — or `FileMeta.size` if present | Skip pure read access (state slot unchanged). Diff is computed by the translator holding a `prevFiles` reference. |
| `{ <subagent>: { messages: [AIMessage{ content: "..." }] } }` where `namespace.length > 0` | A subagent (spawned via deepagents' `task` tool) speaks | `log` (`level: "info"`) | `message` = `[subagent: ${namespace.join("|")}] ${content.slice(0, 500)}` | Use sparingly; this is the only place we leak subagent chatter. Main-agent `AIMessage`s without tool calls are NOT logged — the final synthesis lands in `final.summary` instead. |
| `{ agent: { messages: [AIMessageChunk{ content: "...", tool_calls: [] }] } }` AND it's the last chunk before iterator return | Model produced terminal message, no further tool calls | `final` | `summary` = `content`; `outputs` = `Object.entries(state.files).map(([path, f]) => ({ path, bytes: f.size ?? Buffer.byteLength(f.content, "utf8") }))` filtered to paths under the lane's `owns` globs | Detection: the translator buffers the latest assistant message; when the iterator resolves with no further chunks, that buffer becomes `final.summary`. |
| Any chunk where the stream throws / rejects | Runtime/tool/model error | `error` | `message` = `String(err?.message ?? err)`; `recoverable` = `false` for thrown exceptions, `true` for abort | See 5.5 for the cancel-specific overload. |
| **Dropped — not mapped**: `{ __start__: ... }`, `{ __end__: ... }`, internal LangGraph control updates | LangGraph plumbing | *(none)* | — | Pure graph-mechanics chunks have no operator value; surface noise. |
| **Dropped — not mapped**: token-level streaming from `streamMode: "messages"` | We don't use messages mode | *(none)* | — | We chose `"updates"` for atomic step granularity; token-level streaming is a future enhancement. |

**Chunk-shape verification anchor**: each upstream shape above is sourced from `sandbox/deepagents-poc/src/run-translated.ts:42` (`for await (const [namespace, chunk] of await agent.stream(...)` with `streamMode: "updates"`, `subgraphs: true`) and the deepagents state slots (`messages`, `files`, `todos`) confirmed via `createDeepAgent` documented at `langchain-ai/deepagentsjs`. The exact `tool_calls` array shape on `AIMessageChunk` follows LangChain core's `BaseMessageChunk` contract — translator code should normalize defensively (some providers serialize `tool_calls` as a JSON string in `additional_kwargs`).

**TodoItem shape** (introduced here, lifted into Section 8 on consolidation):

```typescript
export interface TodoItem {
  id: string;                                              // stable; the translator assigns if missing
  content: string;
  status: "pending" | "in_progress" | "completed";
}
```

> **Note on existing code.** `src/lib/plugins/contract/types.ts` currently ships `TodoItem` as `{ text: string; done: boolean }` (Phase 1 placeholder; no `runLane` exists yet so the type is unused at runtime). Phase 3 replaces it with the shape above. Type-level change only.

### 5.3 Transport: SSE

Per Section 3.3 the daemon-mode wire is SSE. For symmetry — and because the route handler is just a thinner wrapper around the same iterable — the **in-process** mode also exposes execution to Cockpit clients via SSE on `GET /api/cockpit/lanes/:laneId/run-events?runId=...` (paired with `POST .../run` which returns `{ runId }`). Same surface contract regardless of which `VibeService` is plugged in. Browser EventSource consumes natively; no second wire type to design; reconnect/resume semantics are built in.

The route handler streams `text/event-stream`; each `LaneEvent` is one SSE frame with `event: <LaneEvent.type>` and `data: <JSON>`. Final frame is always one of `final` or `error`; after that the response closes.

### 5.4 Concurrency model

**Backend**: concurrent runs are allowed. Every `POST /api/cockpit/lanes/:laneId/run` mints a fresh `runId` (uuid) and starts an independent iterable. Multi-surface (browser + VS Code + CLI) makes concurrency unavoidable — one operator on three surfaces will trigger three runs.

**Cockpit UI**: shows one active run at a time in the primary lane execution panel. A "Background runs (N)" chip in the header lists other in-flight runs; clicking promotes one to the foreground. Each surface picks its own foreground run independently; the backend doesn't care.

**Per-lane caps**: none in v0. If a user starts the same lane twice with overlapping `owns` scopes they get a race; deepagents' `FilesystemPermission` will not prevent it — the lane runtime is single-writer at the file level only within a single run. Documented limitation; future enhancement is a per-lane mutex keyed on `owns` globs.

### 5.5 Cancellation

Network side is fully specified in Section 3.5 (POST `/runs/:runId/cancel` for the remote path; `AbortSignal` direct for in-process). The in-memory side:

```text
client closes EventSource
or hits "Cancel"   ──┐
                     │
                     ▼
       AbortSignal.abort()  ──► route handler removes the runId from
                     │           its in-memory active-runs map
                     ▼
       runTranslatedLane sees signal
       LangGraph stream rejects
                     │
                     ▼
       translator catches, emits final
       { type: "error", message: "canceled", recoverable: true }
                     │
                     ▼
              SSE close
```

Idempotency: receiving cancel for an unknown or already-terminal `runId` is a 200 no-op (the entry is already gone from the active-runs map). When run persistence lands in Phase 3b (§5.8), the same flow additionally updates `cockpit_lane_runs.status = 'canceled'` and writes a final `error` row.

### 5.6 Backpressure

**v0 strategy**: per-run in-memory ring buffer in the route handler, cap **1000 events**. Producer (the runtime's AsyncIterable) is awaited synchronously; consumer (the SSE writer) drains as fast as it can flush.

- If the SSE writer falls behind, the buffer grows.
- When the buffer hits the 1000-event high-watermark, the handler:
  1. drops oldest **non-terminal** events (never `start`, `final`, or `error`),
  2. emits a synthetic `log` event: `{ level: "warn", message: "Dropped N events due to slow consumer." }`,
  3. continues.
- `final` and `error` are guaranteed to land on the SSE stream regardless of drops.
- **v0 consequence:** because run state is not persisted (§5.7), dropped events are gone forever. A browser tab refresh during a long run loses earlier intermediate events; only the most recent ones in the live SSE buffer survive. Acceptable for v0 since the operator can see `final.summary` on the lane card afterwards. Phase 3b (§5.8) adds durable replay via the persistence writer.

This buys us "the UI never blocks the runtime" without committing to a fancier flow-control protocol. The 1000-event cap is one variable; tune later.

### 5.7 Run state — in-memory only for v0

**Decision: Phase 3 ships with an in-memory active-runs map on a singleton module; no Supabase persistence.** Durable run history is deferred to a separate Phase 3b (§5.8).

**Singleton module location:** `src/lib/plugins/vibe/active-runs.ts`. Imported by all three route files (`run`, `run-events`, `cancel`). Module-level `const activeRuns = new Map<string, ActiveRun>()` is the singleton; in Next.js dev (which can re-import modules on hot reload) the runs map is therefore process-scoped, not request-scoped, which is what we want.

The in-memory shape:

```typescript
// src/lib/plugins/vibe/active-runs.ts
export interface ActiveRun {
  runId: string;
  pluginId: string;
  laneId: string;
  userId: string;          // for cross-surface SSE access checks
  startedAt: Date;
  abortController: AbortController;
  ringBuffer: LaneEvent[]; // capped per §5.6
  status: "running" | "completed" | "canceled" | "failed";
  lastEventAt: Date;       // drives LaneSummary.lastRunAt read-path
}

export const activeRuns = new Map<string, ActiveRun>();
```

- Entries are added on `POST /api/cockpit/lanes/:laneId/run` and removed when the iterator yields its terminal `final`/`error` frame (or after a 60s grace period post-cancel to allow a slow client to drain).
- A second surface connecting to `GET /api/cockpit/lanes/:laneId/run-events?runId=<id>` reads from the same in-memory map, validates `userId` against the caller's session, and joins the in-progress stream from the current ring-buffer position. **Cross-surface join works only while the run is live**; after termination + grace, the runId 404s.
- Process restarts wipe the map. Any in-flight runs are orphaned (the runtime keeps writing until it notices the disconnect, then aborts). Acceptable for v0 because Cockpit is single-operator and runs are typically short-lived (seconds to minutes).
- **`LaneSummary.lastRunAt` source**: the lane inventory's `listAllLanes()` response is enriched at the host layer by scanning `activeRuns` for the most-recent entry per `(pluginId, laneId)` and writing its `lastEventAt` into the corresponding `LaneSummary.lastRunAt`. Cheap; no extra round-trip. Resets on process restart (acceptable for v0).

**Trade-offs accepted by deferring persistence:**

- No "lane run history" panel in v0. The lane inventory shows `last run` from in-memory state only (resets on process restart).
- Browser refresh mid-run loses earlier events that have already scrolled past the SSE buffer (§5.6 consequence).
- Activity-feed observability of lane runs comes through the existing `cockpit_assistant_events` table via §9.4's logging path — every run start/cancel/error becomes a `tool_result` row with `metadata.plugin_id = "vibe"`. That gives the user a coarse audit trail without the new tables.

### 5.8 Persistence — deferred to Phase 3b

**Status: design preserved; not implemented in Phase 3.**

The full migration design lives below for when Phase 3b is planned. Two new tables, both RLS-scoped to `auth.uid()`, following the pattern from `cockpit_assistant_events` (`supabase/migrations/20260518061342_add_cockpit_assistant_events.sql`).

```sql
-- supabase/migrations/<timestamp>_add_cockpit_lane_runs.sql   [PHASE 3b — NOT YET]

create table public.cockpit_lane_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plugin_id text not null,
  lane_id text not null,                   -- bare lane id, no plugin prefix
  status text not null default 'running' check (
    status in ('running', 'completed', 'failed', 'canceled')
  ),
  user_message text not null,
  overrides jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  final_summary text,
  error_message text
);

create index cockpit_lane_runs_user_started_idx
  on public.cockpit_lane_runs (user_id, started_at desc);

create index cockpit_lane_runs_user_lane_idx
  on public.cockpit_lane_runs (user_id, plugin_id, lane_id, started_at desc);

alter table public.cockpit_lane_runs enable row level security;

grant select, insert, update on public.cockpit_lane_runs to authenticated;

create policy "cockpit_lane_runs_select_own"
  on public.cockpit_lane_runs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "cockpit_lane_runs_insert_own"
  on public.cockpit_lane_runs
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "cockpit_lane_runs_update_own"
  on public.cockpit_lane_runs
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.cockpit_lane_runs;


create table public.cockpit_lane_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.cockpit_lane_runs(id) on delete cascade,
  seq bigint not null,                     -- monotonic per run, assigned by route handler
  event_type text not null check (
    event_type in (
      'start', 'todo', 'tool_call', 'tool_result',
      'log', 'file_write', 'final', 'error'
    )
  ),
  payload jsonb not null,                  -- the LaneEvent minus its `type` discriminant
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index cockpit_lane_events_user_run_seq_idx
  on public.cockpit_lane_events (user_id, run_id, seq);

alter table public.cockpit_lane_events enable row level security;

grant select, insert on public.cockpit_lane_events to authenticated;

create policy "cockpit_lane_events_select_own"
  on public.cockpit_lane_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "cockpit_lane_events_insert_own"
  on public.cockpit_lane_events
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.cockpit_lane_events;
```

**Phase 3b acceptance criteria** (preserved from when this was §5.7):

- Migrations applied; route handler writes runs + events in addition to in-memory state.
- `GET /api/cockpit/lanes/runs/:runId/events?since=<seq>` endpoint added to replay missed events for a reconnecting client.
- Browser SSE consumer changes from "join in-progress live" to "request replay from last seen seq, then continue live" — handles refresh / network blips gracefully.
- Lane inventory's "last run" indicator reads from `cockpit_lane_runs` instead of the in-memory map; survives process restart.
- A "Run history" panel surfaces past runs with their final summary and error state.

**Trigger to revisit Phase 3b**: when the operator says "I lost a 10-minute run's events on refresh and that was annoying" — the engineered cost (~1-2 days) buys back exactly that pain. Premature otherwise.

---

## Section 6 — Capability: Handoff generation

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

Generates a copy-paste handoff text for a lane, scoped to one of six target surfaces. Wraps the markdown shape already shipping in Cockpit's `InProcessVibeService.formatHandoff` and `recommendedCommandFor` (see `src/lib/plugins/vibe/in-process-vibe-service.ts`) — Section 6 promotes that shape to canonical and resolves the four open questions left from the outline.

### 6.1 What this capability does (and doesn't)

`generateHandoff(laneId, target)` returns a `HandoffArtifact` (Section 2): the rendered text, the target, a `format` ("markdown" for all v0 targets), and an optional `recommendedCommand` string the UI can show alongside the text. The plugin layer translates `<pluginId>:<laneId>` → bare `laneId` at the host boundary (Section 3); the service receives only the bare id and returns `null` for unknowns (host maps `null` → 404).

**Not in v0**: one-click dispatch (spawning Codex/Claude CLIs or opening browser URLs from Cockpit). See 6.3.

### 6.2 Canonical handoff template

The shape produced by `formatHandoff` becomes the contract. All v0 targets render as markdown with this section order. The `**Approval gate:**` line is omitted when the lane has no approval field.

```markdown
# Handoff: <lane name>

**Target:** <handoff target>
**Repo:** <absolute repo path>
**Approval gate:** <approval, if present>

## Task

<resolved prompt body, trimmed>

## Read scope

- <reads[0]>
- <reads[1]>
...

## Write scope

- <owns[0]>
- <owns[1]>
...

## Verification

- <verify[0]>
- <verify[1]>
...

## Instructions

You are taking over this lane. Stay within the read and write scope. Run the verification commands before declaring complete.
```

Empty `reads`, `owns`, or `verify` arrays render as `- (none)` / `- (none specified)` — matches current implementation; do not silently drop the section. The `# Handoff:` H1 is the parse anchor: any future consumer (e.g., a `vibe-handoff` audit tool) can split a paste stream on `^# Handoff:` lines.

### 6.3 One-click dispatch — deferred

**Decision: v0 is text-only.** Cockpit generates the handoff, copies it to the clipboard, and shows the `recommendedCommand` next to it. The user pastes into Codex Web, runs the command in their CLI, or whatever the target demands.

**Why deferred:** dispatch requires Cockpit to either spawn the target CLI as a subprocess or open a surface URL. Both have surface-specific quirks already discovered in the CLI invocation work (`cli_invocation_findings.md` — argv-with-newlines truncates on Windows; prompts must be piped via stdin; CLI timeouts must be ≥10 min). The Codex/Claude CLIs already work from Vibe's lane runtime via stdin piping; replicating that plumbing on the Cockpit side, **for the handoff surface only**, doubles the integration cost without changing what the user can accomplish. Copy-paste is a one-keystroke gap.

**Path to enablement (later phase):** add an optional `dispatch?(artifact): Promise<{ dispatched: true; runId?: string } | { dispatched: false; reason: string }>` capability hook to `CockpitPlugin` (Section 2). The Vibe plugin's implementation reuses the same stdin-piping helpers the lane runtime uses for the `delegate_to_codex` / `delegate_to_claude` tools. Out of scope for v0.

### 6.4 HandoffTarget list — fixed for v0

**Decision: the six targets from Section 2 are a closed enum for v0.**

```typescript
"codex.web" | "codex.cli" | "codex.github_pr"
  | "claude.code" | "claude.web" | "human.review"
```

`recommendedCommand` is populated only for the two CLI targets (`codex.cli` → `codex exec --sandbox read-only -`; `claude.code` → `claude -p --input-format text --output-format text`). The web and PR and human-review targets return `undefined` — the markdown text is the whole artifact.

**Path to extensibility (later, when a second plugin arrives):** add a `getHandoffTargets?(): Promise<HandoffTargetDescriptor[]>` capability hook to `CockpitPlugin`. The host merges descriptors across plugins and dedups by id; the UI's dropdown reads from the merged list. Not worth building for one plugin — the type union stays closed until a real second consumer demands the seam.

### 6.5 Persistence model — opt-in save to `handoffs` table

**Decision: ephemeral by default, with a one-click "Save" that persists to the existing `public.handoffs` table.**

The existing schema (from `20260517152032_create_cockpit_memory.sql`):

```sql
create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.cockpit_sessions(id) on delete cascade,
  target text not null,
  prompt text not null,
  created_at timestamptz not null default now()
);
```

The table predates this integration design — it has `target` and `prompt` but no `lane_id`, `plugin_id`, or `format` columns. **For v0 we use it as-is**: write `target` = `HandoffArtifact.target`, `prompt` = `HandoffArtifact.text`. Lane provenance lives in the body of the markdown (the `# Handoff: <lane name>` line is the parse anchor from 6.2). Adding columns (`lane_id text`, `plugin_id text`, `recommended_command text`, `format text`) is a follow-up migration once a "Saved handoffs" UI demands sort/filter by lane.

**Audit trail (separate path).** Every generation — saved or not — also emits a `cockpit_assistant_events` row with `event_type = 'handoff'` and the artifact in `metadata` (this row already exists in `cockpit_assistant_events`'s check constraint — verified in `20260518061342_add_cockpit_assistant_events.sql`). This is the multi-surface activity feed; the `handoffs` table is the first-class "I want to come back to this" store.

**Why opt-in and not always-save:** most handoffs are intermediate scratch — the user generates one, pastes it, moves on. Saving everything inflates `handoffs` and adds noise to the saved-handoffs UI. The audit row in `cockpit_assistant_events` preserves observability without the cost.

### 6.6 UI affordance sketch

Per-lane "Handoff →" dropdown lives next to the existing "Run" / "Cancel" affordances in the lane inventory panel (`src/components/cockpit/lane-inventory-panel.tsx`). Selecting a target generates, copies to clipboard, and shows a toast.

```text
┌──────────────────────────────────────────────────────────────┐
│ feedback-triage                          [Run]  [Handoff ▼]  │
│ Triage user feedback into Vibe lanes      ├ codex.web        │
│                                            ├ codex.cli       │
│                                            ├ codex.github_pr │
│                                            ├ claude.code     │
│                                            ├ claude.web      │
│                                            └ human.review    │
└──────────────────────────────────────────────────────────────┘

(after selection)

┌────────────────────────────────────────────────────────────┐
│ Handoff copied to clipboard — claude.code                  │
│ Recommended: claude -p --input-format text --output-...    │
│                                            [Save]  [View]  │
└────────────────────────────────────────────────────────────┘
```

- **Copy** is automatic on generation. Failure to write to the clipboard (permissions, headless) demotes to a "Copy" button in the toast.
- **Save** persists to `public.handoffs` and rewrites the toast in-place to "Saved — /handoffs/<id>".
- **View** opens the rendered markdown in a side panel (read-only, monospace).
- The recommended-command line is omitted for targets where it's `undefined`.

### 6.7 Acceptance summary

| Decision | Resolution |
|---|---|
| One-click dispatch | Deferred; v0 is text-only with `recommendedCommand` shown alongside. |
| HandoffTarget list | Fixed enum (the six from Section 2); `getHandoffTargets` capability hook documented as the extensibility path. |
| Persistence | Opt-in `Save` writes to existing `public.handoffs`; every generation emits a `cockpit_assistant_events` audit row. |
| Markdown template | `formatHandoff` shape canonicalized (6.2); `# Handoff: <lane name>` is the parse anchor. |
| UI surface | Per-lane "Handoff →" dropdown in `lane-inventory-panel.tsx`, generate → copy → toast → optional save. |

---

## Section 7 — Capability: Memory bridge

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

The bridge is the narrowest of the four capabilities by design. It exists so that *lane-execution-scoped* outputs (summaries, follow-ups, artifact references the operator needs to see across Cockpit surfaces) land in Cockpit's Supabase-backed memory with RLS intact. It is **not** a sync of Vibe's `<repo>/.vibe/` Obsidian vault — the vault remains Vibe's source of truth for project understanding and is owned by the `vibe init`/`vibe sync` pipeline (SD3). The bridge handles a different surface: short-lived, run-scoped state the operator wants to see in Cockpit's memory panel without opening a vault file.

### 7.1 Direction of sync — one-way for v0

**Vibe writes; Cockpit reads.** The plugin pushes key/value pairs into Cockpit via the host-mediated API. Cockpit never pushes state back into the plugin in v0.

Rationale:

- There is exactly one writer per `<plugin.id>` namespace (the plugin itself), so multi-writer conflict resolution is premature.
- The plugin already has rich internal state (deepagents thread, file watcher, vault); pulling Cockpit memory into the plugin runtime adds coupling without a v0 consumer.
- The Vibe-side memory surface is the `<repo>/.vibe/` vault, which the plugin reads from disk directly — no round-trip through Cockpit is needed.

**Future path to bidirectional.** When a future plugin needs to *consume* Cockpit-owned state (e.g., the user's `activeGoal` from `cockpit_sessions`), the contract grows a read capability — most likely an additional `read?(key: string)` method on `HostMemoryApi` that is *only* allowed to return rows the plugin previously wrote in its own namespace, plus an explicit `hostState` accessor for whitelisted Cockpit-owned fields. That widening is contract-version-additive (Section 8) and out of scope here.

### 7.2 Conflict resolution — last-write-wins, single-writer

With one-way writes and a single writer per namespace, the rule is trivially **last-write-wins per `(user_id, namespace, key)`**. Implemented as an `upsert` on the table's unique key (Section 7.6). No vector clocks, no merge functions, no `If-Match` ETags. If a multi-writer scenario ever appears (e.g., the same plugin loaded into two Cockpit backends pointing at the same Supabase project), the user's responsibility is to not do that; the schema does not police it beyond honoring the last `updated_at`.

### 7.3 Scope — lane-execution memory, not vault content

| Surface | Where it lives | Owner | In v0 bridge? |
|---|---|---|---|
| Run events / lane summaries | Cockpit (`cockpit_plugin_memory`) | Plugin writes via bridge | **Yes** |
| Follow-up tasks emitted by a lane | Cockpit (`cockpit_plugin_memory`) | Plugin writes via bridge | **Yes** |
| Handoff artifact previews | Cockpit (`cockpit_plugin_memory`) or `handoffs` table | Plugin writes via bridge | **Yes** |
| Obsidian vault notes (`<repo>/.vibe/**/*.md`) | Vibe vault on disk | `vibe init`/`vibe sync` (SD3) | **No** |
| RepoFacts cache (`.vibe/.cache/`) | Vibe vault on disk | Vibe runtime | **No** |
| Cockpit's `activeGoal`/`nextAction`/`proofNeeded` | Cockpit (`cockpit_sessions`) | Cockpit | **No** (read-only Cockpit-owned) |

The bridge is the seam for **state the plugin produces that other Cockpit surfaces need to see**. Anything that's purely Vibe-internal stays in the vault; anything that's purely Cockpit-internal stays in Cockpit's existing tables (`cockpit_sessions`, `cockpit_chat_messages`, `cockpit_assistant_events`, `handoffs`).

### 7.4 Retention — no TTL in v0

Entries persist until the user prunes them from Cockpit's memory panel. No background reaper. The future direction is a per-plugin TTL hint declared in capability metadata (e.g., `memory: { ttlDays: 30 }`); the host would attach an `expires_at` column and a Supabase scheduled function would sweep. Out of scope for v0.

### 7.5 Surface UI

Plugin memory entries appear in Cockpit's existing memory panel, grouped by `<plugin.id>` with a "Plugin: vibe" badge on each row. The UI is **read + delete**, not edit — the plugin owns its writes and the only sanctioned mutation from the UI side is deletion (with confirmation). This matches the constraint that the host mediates writes: a UI edit would mean the user (not the plugin) authored a value into the plugin's namespace, which breaks the one-writer rule from Section 7.2.

### 7.6 Schema — `cockpit_plugin_memory` migration

Migration file: `supabase/migrations/<timestamp>_create_cockpit_plugin_memory.sql`. Follows the exact shape and policy idiom of the existing migrations (`20260517152032_create_cockpit_memory.sql`, `20260517194708_add_cockpit_chat_messages.sql`).

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

Notes on shape:

- `value jsonb` not `text` — plugins routinely store structured artifacts (lane summaries with arrays, follow-up records). JSONB keeps the door open for indexed lookups (`value->>'status'`) later without a migration.
- `unique (user_id, namespace, key)` is what `upsert` targets for last-write-wins (Section 7.2). It's also what makes namespace isolation per-user-and-plugin enforceable at the DB layer.
- `namespace` is the full `<plugin.id>` string (e.g., `"vibe"`). The host sets it; the plugin never writes it directly (Section 7.7).

### 7.7 TypeScript contracts

Three types, each owned by a different layer.

> **Note on existing code.** `src/lib/plugins/contract/types.ts` currently ships Phase 1 placeholders that do NOT match the shapes below:
> - `HostMemoryApi` uses `string`-typed values (`get: Promise<string | null>`, `set(key, value: string)`); the §7 schema requires `value jsonb`, so Phase 4 widens to `unknown` and changes `list()` to return `MemoryEntryMeta[]`.
> - `PluginMemoryBridge` is currently `{ read, write }` (the wrong direction — plugin exposing memory to host); Phase 4 replaces it with the `{ refresh?, beforeDelete? }` shape below (host-calls-plugin direction).
>
> Both placeholders are currently unused (no Phase 1 plugin advertises the `memory` capability), so the Phase 4 change is type-level only, not a data migration.

```typescript
// ─────────────────────────────────────────────────────────────
// Layer: Cockpit host. Lives in src/lib/plugins/contract/types.ts.
// Passed to the plugin at init via PluginHostContext.memory.
// ─────────────────────────────────────────────────────────────
export interface HostMemoryApi {
  /**
   * Write (upsert) a value under <plugin.id>:<key>. Host injects the namespace;
   * the plugin only supplies the bare key. Last-write-wins per (user, namespace, key).
   */
  set(key: string, value: unknown): Promise<void>;

  /**
   * Read back a value the plugin previously wrote. Returns undefined if not present.
   * Plugin can only read its own namespace — no cross-plugin or host-state reads.
   */
  get(key: string): Promise<unknown | undefined>;

  /**
   * List keys (not values) the plugin has written, newest-first.
   * `prefix` filters within the plugin's namespace (e.g., "run:" for run-scoped keys).
   */
  list(prefix?: string): Promise<MemoryEntryMeta[]>;

  /**
   * Delete one entry. Idempotent — deleting a missing key is not an error.
   */
  delete(key: string): Promise<void>;
}

export interface MemoryEntryMeta {
  key: string;            // bare key, namespace stripped
  createdAt: string;      // ISO timestamp
  updatedAt: string;      // ISO timestamp
}

// ─────────────────────────────────────────────────────────────
// Layer: Plugin contract. The optional `memoryBridge` member of CockpitPlugin
// (Section 2). The plugin uses this to advertise *which* HostMemoryApi calls
// it intends to use and to receive a back-handle the host can call for UI
// affordances (e.g., "force re-sync from vault"). Most plugins won't override
// the defaults.
// ─────────────────────────────────────────────────────────────
export interface PluginMemoryBridge {
  /**
   * Optional hook: host invokes this when the user clicks "refresh from plugin"
   * in the memory panel. Plugin re-emits anything that should be in Cockpit.
   * Default: no-op.
   */
  refresh?(): Promise<void>;

  /**
   * Optional hook: host invokes this when the user deletes a key from the UI,
   * BEFORE the row is removed from the DB. Plugin can refuse (return false)
   * if the entry is load-bearing internally. Default: allow.
   */
  beforeDelete?(key: string): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────
// Layer: Vibe service (Section 3). Always present on VibeService.memory,
// even when the plugin doesn't advertise the `memory` capability — in that
// case it's a no-op that throws on write attempts so internal bugs surface
// loudly instead of silently dropping data.
// ─────────────────────────────────────────────────────────────
export interface VibeMemoryHandle {
  /**
   * Write through to Cockpit's HostMemoryApi if the plugin has been wired up
   * with one; throw if not. The plugin's adapter wraps a HostMemoryApi the
   * host gave it at init.
   */
  set(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown | undefined>;
  list(prefix?: string): Promise<MemoryEntryMeta[]>;
  delete(key: string): Promise<void>;
}
```

**Wiring.** At plugin init, the Vibe plugin captures `host.memory` (a `HostMemoryApi`) into the `VibeService` constructor. `InProcessVibeService.memory` is a thin pass-through; `RemoteVibeService.memory` is the same pass-through (the daemon never sees Cockpit's DB — the plugin in Cockpit's process makes all calls). The namespace prefix `<plugin.id>:` is added by the host's `HostMemoryApi` implementation, not by the plugin, so a buggy plugin cannot escape its namespace by passing a hand-crafted key.

### 7.8 RLS audit

Every code path must reach a row only via `(select auth.uid())`. The host-side `HostMemoryApi` implementation uses Cockpit's existing `createSupabaseServerClient()` (`src/lib/cockpit/supabase-server.ts`), which is an SSR cookie-bound client — `auth.uid()` resolves from the user's session cookie, never from a service-role key. No code path in this design uses `SUPABASE_SERVICE_ROLE_KEY`.

| Operation | Code path | RLS gate exercised | Service-role bypass? |
|---|---|---|---|
| `set(key, value)` first write | `supabase.from("cockpit_plugin_memory").upsert({ user_id: uid, namespace, key, value })` | `cockpit_plugin_memory_insert_own` (with check) | No |
| `set(key, value)` subsequent write | same upsert hits unique `(user_id, namespace, key)` | `cockpit_plugin_memory_update_own` (using + with check) | No |
| `get(key)` | `supabase.from(...).select("value").eq("namespace", ns).eq("key", k).maybeSingle()` — host passes `eq("user_id", uid)` defensively even though RLS already filters | `cockpit_plugin_memory_select_own` (using) | No |
| `list(prefix)` | `supabase.from(...).select("key,created_at,updated_at").eq("namespace", ns).like("key", prefix ?? "%").order("updated_at", { ascending: false })` | `cockpit_plugin_memory_select_own` (using) | No |
| `delete(key)` (plugin) | `supabase.from(...).delete().eq("namespace", ns).eq("key", k)` | `cockpit_plugin_memory_delete_own` (using) | No |
| `delete(key)` (UI) | same path, triggered by memory-panel button after `beforeDelete?` returns true | `cockpit_plugin_memory_delete_own` (using) | No |
| Cross-namespace read attempt | host strips/overrides `namespace` server-side; even if it didn't, `select` is RLS-bounded to `user_id` rows | `cockpit_plugin_memory_select_own` | No |
| Cross-user read attempt | impossible: cookie session belongs to one user; `auth.uid()` returns that user; no `user_id` argument the plugin passes can change this | `cockpit_plugin_memory_select_own` | No |

The defensive `eq("user_id", uid)` on reads is not load-bearing for security (RLS already enforces it), but it's kept so the query plan uses the `(user_id, namespace, updated_at desc)` index efficiently. The `id` PK column is never exposed to the plugin — the (namespace, key) tuple is the plugin-facing identifier — so there is no way for a plugin to address a row by id and probe whether it exists outside its namespace.

### 7.9 Out of scope for v0 (deferred)

- Bidirectional sync / Cockpit-state reads from the plugin (Section 7.1 future path).
- TTL / auto-prune (Section 7.4 future path).
- Vault ↔ Supabase mirror of Obsidian notes — vault remains canonical for SD3-owned content; promoting selected vault notes into Cockpit memory is a future plugin behavior, not a bridge feature.
- Plugin-to-plugin shared memory. v0 is per-plugin namespace only; no `<plugin.id>:*` is readable across plugins.
- Encryption at rest beyond Supabase's defaults. `value jsonb` is stored as Postgres jsonb; if a plugin writes secrets, that's a plugin bug.

---

## Section 8 — Shared data model

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

Consolidates every type that crosses the host/plugin or plugin/service boundary into one home, picks a versioning convention so contract drift is visible at startup, and decides where Zod schemas earn their cost vs. pure TS types.

### 8.1 Module location

**Decision: single module `src/lib/plugins/contract/types.ts` inside the Cockpit repo. No separate `@cockpit/plugin-contract` package for v0. No path rename.**

Rationale:

- The first (and only v0) plugin — Vibe — lives in a different repo (`lutherfourie/vibe`) but is consumed by Cockpit via dynamic import at runtime, not via npm. Its type dependencies come over with the import path; a published package would only matter once a *second-repo* consumer needs typed contracts at build time.
- A workspace package adds publish / version-bump / changelog churn for one consumer. YAGNI.
- The existing Phase 1 code already lives in `src/lib/plugins/{contract,host,vibe}` — codify that as the canonical location.

**Promotion criterion:** when a second consumer ships from a different repo and needs the types at build time (not just runtime duck-typing), graduate the file to `@cockpit/plugin-contract` workspace package + publish. Until then, the types are sourced from the Cockpit repo only.

### 8.2 Type inventory (single source of truth)

All types below live in `src/lib/plugins/contract/types.ts`.

| Type | Source section | Purpose |
|---|---|---|
| `CockpitPlugin` | §2 | The plugin interface every plugin implements. |
| `PluginCapability` | §2 | Union: `"discovery" \| "execution" \| "handoff" \| "memory"`. |
| `PluginHostContext` | §2 | Passed to `init`; carries logger, settings, memory, events. |
| `PluginLogger` | §2 (implied) | Structured logger handed to the plugin, scoped to its id. |
| `HostEventSink` | §2 (implied) | Structured telemetry sink for plugin-emitted activity events. |
| `LaneSummary` | §2 | Discovery output row. |
| `LaneRunInput` | §2 | `runLane` input. |
| `LaneEvent` | §2 | Discriminated union of streamed events. |
| `TodoItem` | §5.2 | One entry in `LaneEvent { type: "todo" }`. |
| `HandoffArtifact` | §2 | `generateHandoff` output. |
| `HandoffTarget` | §2 | Closed enum for v0 (§6.4). |
| `VibeService` | §3.1 | Layer-3 runtime interface; lives in the plugin, not the host module. |
| `LaneRunSpec` / `LaneRunInputs` | §3.4 | `@vibe/runtime`'s public types — re-exported into the Vibe plugin, not into Cockpit's contract module. |
| `VibeMemoryHandle` | §7.7 | The handle on `VibeService.memory`. |
| `HostMemoryApi` | §7.7 | What the host hands the plugin at init. |
| `MemoryEntryMeta` | §7.7 | Row metadata returned by `list()`. |
| `PluginMemoryBridge` | §7.7 | Optional `memoryBridge?` on `CockpitPlugin`. |

**Convention:** types named after a *role in the contract* (`CockpitPlugin`, `HostMemoryApi`, `PluginMemoryBridge`) live in the host module. Types named after a *runtime concept inside a single plugin* (`VibeService`, `LaneRunSpec`) live with that plugin. The contract module exports nothing Vibe-specific.

### 8.3 Versioning rule

**Each plugin advertises `cockpitPluginContractVersion: string` as a static-equivalent field. Host warns (does not refuse) on minor mismatch and refuses on major mismatch.**

```typescript
export interface CockpitPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;                  // plugin's own version
  readonly cockpitPluginContractVersion: string;  // SemVer; e.g. "1.0.0"
  // …rest unchanged from Section 2
}
```

> **Note on existing code.** `src/lib/plugins/contract/types.ts` does NOT currently declare `cockpitPluginContractVersion` on `CockpitPlugin`, and `VibePlugin` does not set it. Phase 3 adds both the field (interface change) and the value (`"1.0.0"` on `VibePlugin`), plus the `PluginHost.load()` check that reads the field and applies the warn/refuse rule below. Until Phase 3 lands, the version field is `undefined`; the host treats `undefined` as `"1.0.0"` (legacy assumption) so existing Phase 1 code keeps working through the transition.

- Current contract version: `"1.0.0"` (set when Phase 3 lands the field and value).
- Host parses with SemVer. On major mismatch (`plugin.major !== host.major`), the host marks the plugin `errored` with reason `"contract version mismatch"`, does NOT call `init`, and surfaces the mismatch via `PluginHostContext.events`. Minor/patch mismatches log a warn but allow init.
- Additive changes (new optional capability hook, new optional field on existing types) bump minor.
- Breaking changes (removed field, narrowed enum, signature change) bump major.
- The Future-Path notes in Sections 6.3, 6.4, 7.1 are explicit additive-only widenings — they ship as minor bumps.

### 8.4 Runtime validation: Zod at boundaries, TS internally

**Decision: Zod for inputs crossing a process or network boundary. Pure TS types for in-process structural invariants.**

Cockpit already depends on Zod (`package.json: "zod": "^4.4.3"`) and uses it for `LaneSpecSchema` (§4.1). The boundary list:

| Boundary | Validate with Zod? | Why |
|---|---|---|
| Lane JSON file on disk → `LaneSummary` | **Yes** (`LaneSpecSchema`, already present) | File contents are arbitrary user/agent input. |
| HTTP POST body → `LaneRunInput` | **Yes** | Untrusted client input. |
| SSE frame on the wire (Remote mode) → `LaneEvent` | **Yes** (`LaneEventSchema`, new) | Daemon could be any version; protects against contract drift. |
| `HostMemoryApi` values → JSONB | **No** | In-process, plugin-trusted. Schema check on `key: string` is enough. |
| `VibeService.runLane()` arguments → runtime | **No** | In-process, type-checked at compile time. |
| Plugin → host return values (`LaneSummary[]`, `HandoffArtifact`) | **No** | In-process; TS types are the contract. |

**Schema co-location:** every Zod schema lives next to its TS type with a matching name (`LaneRunInput` ↔ `LaneRunInputSchema`). The Zod schema is the source of truth where present; the TS type is derived via `z.infer<typeof ...Schema>`. Where there's no schema (in-process types), the TS type stands alone.

### 8.5 Out of scope for v0

- Code generation of types into other languages (Python, Rust). The contract is TS-first.
- Runtime field-level migration (e.g. auto-fill defaults for old plugins). Major mismatch errors loudly; users update the plugin.
- A contract-conformance test harness. Section 10's mock plugin covers conformance via type-checked tests instead.

---

## Section 9 — Error handling and degradation

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

The plugin host already implements per-plugin failure isolation in code (`src/lib/plugins/host/plugin-host.ts` — a plugin throwing during `init` or any capability hook is caught, marked `errored`, and excluded from subsequent calls; the host itself never throws). This section nails down the user-visible behaviors that ride on top of that isolation, the retry policy for the daemon mode, and the daemon lifecycle question forward-referenced from §3.7.

### 9.1 Failure-mode → UI behavior matrix

Per Cockpit surface, the plugin's status drives a small set of visible affordances. The "Reload" action everywhere targets `POST /api/cockpit/plugins/:id/reload` (the lifecycle endpoint from §2.3).

| Failure mode | What broke | UI behavior | Operator recourse |
|---|---|---|---|
| Plugin not loaded (no entry in registry) | Settings-disabled or never installed | Lanes panel hidden entirely; assistant says "No lane provider configured." | Enable in settings. |
| Plugin `init` threw | Misconfig, missing env, bad version | Lanes panel renders empty state: "Vibe plugin failed to start: `<lastError>`. [Reload] [Open settings]" | Fix config; click Reload. |
| Plugin loaded, capability not advertised | e.g. `memory` capability off in v0 | The dependent UI surface is hidden; no error toast. | None — by design. |
| `listLanes()` threw | Plugin bug, watcher disk error | Lanes panel shows last cached list with a yellow banner: "Last refresh failed. [Reload]" | Click Reload; if persistent, file bug. |
| `runLane()` throws before first event | Lane spec broken, runtime can't start | Run dialog closes; toast: "Run failed: `<error>`. [Retry]" | Fix lane spec; retry. |
| `runLane()` errors mid-stream (recoverable: true) | Tool failure, transient model error | Run continues showing events up to the error frame; the lane card shows `error` state with the error message and a [Retry] button. | Retry same run, or edit prompt. |
| `runLane()` errors mid-stream (recoverable: false) | Crash, OOM, daemon died | Run terminates with a final `error` SSE frame; the in-memory run is marked `failed` and a `cockpit_assistant_events` row is written (§9.4) so the activity feed shows it. Card shows `failed`. (Phase 3b adds durable per-event history in `cockpit_lane_events`.) | Retry from scratch if appropriate. |
| `generateHandoff()` threw | Plugin bug | Dropdown stays open; toast: "Handoff generation failed: `<error>`." | Pick a different target, or Reload. |
| Memory bridge `set()` threw | DB error, missing auth | Plugin is asked again on next write; one error log per failure, but execution doesn't fail because of it (the bridge is observability-grade, not load-bearing in v0). | Operator typically does nothing; persistent failures surface in logs. |
| `RemoteVibeService` daemon unreachable | Daemon crashed / not started / network blocked | Lanes panel: persistent banner "Vibe daemon offline. Retrying in `<N>s`. [Start daemon] [Switch to in-process]." | Wait, or use the two buttons. |

"Cockpit must function meaningfully even when no plugins are loaded" is the **invariant**: every Cockpit-only feature (assistant, parking lot, memory panel, handoffs history, sessions) continues to work; only plugin-sourced surfaces degrade.

### 9.2 Retry policy for `RemoteVibeService`

Applies to all HTTP/SSE calls in §3.3.

| Failure | Retry? | Backoff | Cap | Surface? |
|---|---|---|---|---|
| Connection refused on `GET /lanes` (daemon down) | Yes | Exponential, base 1s, factor 2, jitter ±25% | 30s max interval | After 3 consecutive failures: banner in 9.1. |
| 5xx on state queries | Yes | Same as above | Same | Same. |
| `GET /runs/:runId/events` SSE drops mid-stream | Yes (Phase 3: reconnect joins from current ring-buffer head; Phase 3b adds `Last-Event-Id` header + `?since=<seq>` replay) | Immediate, then exponential as above | 30s | Inline "Reconnecting…" pill on the run card; auto-dismisses on resume. |
| 4xx on state queries | No | — | — | Surface the body's `error` field as a one-shot toast. Indicates a bug, not a transient. |
| `POST /runs/:runId/cancel` failed | No (fire-and-forget) | — | — | Silent; `AbortSignal` already short-circuited the iterator client-side. |

The retry loop runs in the `RemoteVibeService` client itself; the plugin and host are agnostic. While retries are in flight, `listLanes()` returns the last cached snapshot if one exists; otherwise it returns `[]` and the host logs the degraded state once per minute.

### 9.3 `init` failure recovery

Re-init on user action (the `/api/cockpit/plugins/:id/reload` endpoint already in §2.3). **No full Cockpit restart required.** The flow:

1. User clicks `[Reload]` in the lane panel banner.
2. Route handler calls `pluginHost.reload(id, entry)` — a new per-plugin method that disposes the single failed instance and re-runs `factory()` + `init(context)` for it, leaving other loaded plugins untouched.
3. Status flips from `errored` → `ready` (or back to `errored` with a new `lastError` if it still fails).
4. The lane panel subscribes to a plugin-status SSE event so the banner clears without a page refresh.

> **Note on existing code.** `PluginHost.dispose()` currently disposes ALL loaded plugins (no per-id overload). Phase 3 adds `PluginHost.reload(id, entry): Promise<void>` (and a private `disposeOne(id)` helper). This is a small additive change — existing `dispose()` semantics are preserved for shutdown.

Init failures that *cannot* be recovered without operator intervention (e.g., `CEREBRAS_API_KEY` missing) are surfaced with the `lastError` text intact — the operator's job is to fix the underlying condition before reload succeeds.

### 9.4 Logging schema

**Decision: plugin errors land in `cockpit_assistant_events` with `event_type = 'tool_result'` and `metadata.error = true`. No new table.**

Rationale: the existing `cockpit_assistant_events` table already has the right shape (`metadata jsonb`, RLS-scoped to user), it's already in the activity feed UI, and "plugin error" is conceptually the same kind of observable event as "tool failed." Re-using it keeps the activity stream coherent and avoids a fourth events table.

```typescript
// What PluginHostContext.log.error and PluginHostContext.events.emit() writes:
{
  event_type: "tool_result",
  role: "system",
  content: <plain-text summary>,   // e.g. "vibe.listLanes failed: ENOENT"
  metadata: {
    error: true,
    plugin_id: "vibe",
    operation: "listLanes" | "runLane" | "generateHandoff" | "memory.set" | "init" | "dispose",
    error_message: <Error.message>,
    error_stack?: <truncated stack>,  // dev-mode only
    lane_id?: string,
    run_id?: string,
    recoverable?: boolean,
  }
}
```

Console-side: `PluginHostContext.log` already exists in code as a structured logger; it writes to stdout via the standard Cockpit logger and *also* enqueues a `cockpit_assistant_events` row when level >= `error`. Warn/info stay in stdout only. This means the activity feed sees errors immediately without polluting it with every chokidar tick.

### 9.5 Daemon lifecycle — Cockpit auto-spawns

Forward-reference from §3.7 resolved: **when `COCKPIT_VIBE_RUNTIME=remote`, Cockpit auto-spawns the Vibe daemon as a subprocess.**

```text
Cockpit backend startup (plugin init)
  └─► spawn `vibe serve --port 8787 --json-logs` as child process
        ├─► capture stdout/stderr → structured logger (prefix [vibe-daemon])
        ├─► poll GET http://127.0.0.1:8787/health every 500ms for up to 10s
        └─► on health 200 → mark Vibe plugin `ready`
            on timeout    → mark `errored` ("daemon failed to become healthy")

Steady state
  └─► periodic GET /health every 30s; on 3 consecutive failures, restart subprocess
      (capped at 5 restarts in 5 minutes; further failures require user-initiated reload)

Cockpit backend shutdown
  └─► SIGTERM to daemon → 5s grace → SIGKILL if still alive
```

Operator override: `COCKPIT_VIBE_DAEMON_AUTOSPAWN=false` disables autospawn; the operator runs `vibe serve` manually (useful for debugging the daemon under a debugger). In that mode the connect/retry logic from §9.2 is what discovers and waits on the daemon.

**Why Cockpit owns the lifecycle:** mirrors the Docker Desktop ↔ dockerd model. The operator's mental model is "Cockpit is the app I run; everything it needs comes up with it." Forcing them to manage a second process is a footgun the spec explicitly avoids.

---

## Section 10 — Testing strategy

**Status: APPROVED 2026-05-18 (resumed brainstorming)**

Cockpit already runs Vitest (`pnpm test`) and Playwright (`pnpm test:e2e`). This section just decides which test category covers each layer, what the mock fixtures look like, and which tests run when.

### 10.1 Test taxonomy

| Layer | What it tests | Tooling | Example (file → assertion) |
|---|---|---|---|
| **Unit** | Pure functions, schema parsers, formatters, single-class behavior with deps stubbed inline | Vitest | `in-process-vibe-service.test.ts` → `formatHandoff` renders empty `reads` as `- (none)` |
| **Contract** | `CockpitPlugin` interface conformance — host wires every capability correctly without depending on Vibe | Vitest + an in-tree mock plugin (§10.2) | `plugin-host.test.ts` → loading the mock plugin, `listAllLanes()` returns the mock's lanes namespaced by host |
| **Integration** | `InProcessVibeService` + real plugin + real host, against a temp-directory fixture repo with seeded lane JSON files | Vitest + `node:fs` tmp setup | `in-process-vibe-service.integration.test.ts` → `runLane` against `truths-extraction` lane yields a `start` event then a `final` event with the mocked Cerebras response |
| **End-to-end** | Browser → Cockpit backend → plugin host → service → SSE stream → rendered UI | Playwright | `tests/lanes-panel.spec.ts` → user picks lane, clicks Run, sees stream of tool_call rows, sees final summary |

Each PR's CI runs unit + contract + integration in parallel; Playwright in a separate job. Live-Cerebras runs nightly only.

### 10.2 Mock plugin and mock VibeService

**Mock plugin** (`src/lib/plugins/test-doubles/mock-plugin.ts`): a minimal `CockpitPlugin` advertising all four capabilities. Each method returns a deterministic fixture (e.g., `listLanes()` returns two hard-coded `LaneSummary` rows; `runLane()` yields a canned sequence `[start, tool_call, tool_result, file_write, final]`). The mock has no I/O. Purpose: prove the host plumbing without depending on Vibe code.

**Mock `VibeService`** (`src/lib/plugins/test-doubles/mock-vibe-service.ts`): same shape but specifically the `VibeService` interface (Section 3.1). Used by the Vibe plugin's own tests to prove the plugin → service translation layer (prefix stripping, error envelope, AbortSignal forwarding) without spinning up `InProcessVibeService` or the daemon. Includes a `seed(lanes: LaneSpec[])` helper so a test can preload lanes and assert discovery aggregation.

**Fixture lanes**: the three deepagents POC lanes (`feedback-triage`, `truths-extraction`, `cli-delegation`) are copied verbatim into `tests/fixtures/lanes/` for integration tests. They double as the canonical examples — if their shape ever drifts, integration tests fail loudly.

**LangGraph stream fixtures**: integration tests for `runLane` use recorded JSON fixtures of LangGraph chunks (one per scenario: clean run, tool error, abort, slow consumer). The translator is the only place that consumes LangGraph types directly — fixtures live next to it under `@vibe/runtime/test/fixtures/`. Cockpit's tests stub `runTranslatedLane` to yield a hard-coded `LaneEvent[]` sequence; runtime tests prove the chunk → event mapping is correct against the recorded fixtures.

### 10.3 CI plan

**Every PR (GitHub Actions, on every push):**

- `pnpm lint`
- `pnpm test` — Vitest unit + contract + integration. Target: under 90 seconds wall clock, parallel.
- `pnpm test:e2e` — Playwright (Chromium only on CI). Target: under 5 minutes.
- `pnpm build` — Next.js build smoke.

**Nightly (cron):**

- Live-Cerebras smoke test gated by `VIBE_TEST_LIVE_CEREBRAS=1` + `CEREBRAS_API_KEY` secret. Runs one of the three fixture lanes against the real model; asserts the run finishes within 5 minutes and produces a non-empty `final.summary`. Failure files a Linear ticket (or whatever the team uses); doesn't block merges.
- Playwright across both Chromium and Firefox.

**Local dev:**

- `pnpm test:watch` for tight loop.
- `VIBE_TEST_LIVE_CEREBRAS=1 pnpm test -t live` to run the live test on demand.

### 10.4 Deepagents POC eval harness — do NOT lift into Cockpit

The `langchain-ai/deepagentsjs` `evals/` pattern is a runtime-quality measurement (LLM-judged correctness on a benchmark set). It belongs in `vibe/packages/runtime/` because that's where the LangGraph + deepagents internals live. Cockpit's tests should treat the runtime as a black box at the `LaneEvent` boundary — anything finer-grained creates a coupling we explicitly avoided in Section 3.4 (single source of truth for chunk → event translation).

When the runtime package gets eval harness wiring, Cockpit consumes the *result* (a pass/fail signal in CI nightly via package version pinning), not the harness itself.

### 10.5 What is explicitly NOT in v0 testing

- Mutation testing.
- Load tests for SSE under 1000+ concurrent connections (the user is single-operator; YAGNI).
- Cross-browser matrices beyond Chromium + Firefox.
- A contract-conformance test harness for third-party plugins (Section 8.5 deferred this).
- Visual regression on the lane inventory panel (consider once the UI stabilizes).

---

## Open questions (cross-cutting) — resolved or deferred

The 2026-05-18 brainstorming resume pass landed answers or explicit deferrals for the items below. Tracking them here so a future reader doesn't think these are still up in the air.

| # | Question | Status |
|---|---|---|
| 1 | Vibe daemon control plane | **Resolved in §9.5** — Cockpit auto-spawns with health-check + restart. Override via `COCKPIT_VIBE_DAEMON_AUTOSPAWN=false`. |
| 2 | Multi-machine scenarios | **Deferred** — out of scope for v0; the `VibeService` interface is the seam that makes it possible later without contract change. |
| 3 | Plugin distribution | **Deferred** — v0 is local (file: dep or workspace link). Promotion to npm/GitHub releases gates on a second plugin appearing. |
| 4 | Auth for non-browser clients (VS Code ext, CLI) | **Deferred** — out of scope for the integration spec; tracked as its own future spec under "multi-surface auth". Will reuse Cockpit's Supabase Auth via a local token cache. |
| 5 | Plugin sandboxing escalation path | **Deferred** — v0 trusts loaded plugins (Vibe is the only one). When third-party plugins ship, a permission model + worker-thread enforcement becomes its own spec. Out of scope here. |

## Next steps

1. **Spec self-review** — done as part of the brainstorming completion (placeholder scan, cross-section reference check, table-schema reconciliation).
2. **External code review pass** — done 2026-05-18 against the spec by a senior-reviewer subagent; findings applied (see the "Note on existing code" callouts throughout §5/§7/§8/§9 and the prerequisite checklist below).
3. **User end-to-end review** of the now-complete spec. Sections 1, 2 already approved; Sections 3–10 newly approved 2026-05-18. Read top-to-bottom and flag anything that doesn't match intent before invoking writing-plans.
4. **Invoke `writing-plans` skill** to translate the spec into phased implementation plans.

### Phase plan

- Phase 0: Plugin host + `CockpitPlugin` contract types (no Vibe yet). **Status: DONE** — covered by `src/lib/plugins/{contract,host}` and the Phase 1 plan in `docs/superpowers/plans/2026-05-18-cockpit-vibe-phase-1-plugin-system.md`.
- Phase 1: `VibeService` interface + `InProcessVibeService` skeleton + Vibe plugin doing discovery + handoff. **Status: DONE** — same phase plan.
- Phase 2: *(folded into Phase 1 — handoff already shipping.)*
- Phase 3: Execution + streaming **(in-memory only)**. **NEXT** — Section 5's design (excluding §5.8 persistence) + Section 3.4's runtime package extraction. Ships the `runLane` loop end-to-end so Cockpit and Vibe finish tasks together; run state lives in memory only.
- Phase 3b: Lane-run persistence. Section 5.8's deferred migrations + replay endpoint + "Run history" panel. Triggered when the loss-on-refresh UX bites.
- Phase 4: Memory bridge. Section 7 (includes the `HostMemoryApi` widening and `PluginMemoryBridge` direction-flip noted in §7.7).
- Phase 5: `RemoteVibeService` + Vibe daemon + autospawn (§9.5).

Each phase is independently shippable. Phase 3 is where Cockpit and Vibe first *finish tasks together*.

### Phase 3 prerequisite checklist

Code changes that must land **as part of Phase 3** (writing-plans should task each explicitly — each is a small additive change to `src/lib/plugins/contract/types.ts` or `src/lib/plugins/host/plugin-host.ts`):

- [ ] Add `runLane?(laneId, input, signal): AsyncIterable<LaneEvent>` to `VibeService` interface (`src/lib/plugins/vibe/vibe-service.ts`). The interface already exists; Phase 3 extends it. See §3.1.
- [ ] Add `runLane(fullLaneId, input, signal): AsyncIterable<LaneEvent>` to `PluginHost` (`src/lib/plugins/host/plugin-host.ts`). Mirrors the existing `generateHandoff()` pattern: split `<pluginId>:<laneId>`, route to the plugin's `runLane`, propagate errors. See §5.1.
- [ ] Add `reload(id, entry): Promise<void>` (and private `disposeOne(id)`) to `PluginHost`. Required by §9.3's reload flow; current `dispose()` only disposes all plugins.
- [ ] Replace placeholder `TodoItem = { text; done }` in `src/lib/plugins/contract/types.ts` with the §5.2 shape `{ id; content; status }`. Type-level only (no runtime use yet).
- [ ] Add `cockpitPluginContractVersion: "1.0.0"` field to `CockpitPlugin` interface and set it on `VibePlugin`. Add the SemVer check in `PluginHost.load()` per §8.3 (warn on minor mismatch, refuse on major).
- [ ] Add file-watching to `InProcessVibeService` per §3.2 / §4.2 (chokidar v4, 100ms debounce, 5s poll fallback, internal `lanesChanged` event). Required before SSE-driven UI refresh works.
- [ ] Implement `runLane` on `InProcessVibeService` by calling into the new `@vibe/runtime` package (§3.4) — which requires the package to exist first (next item).

Code changes in the **Vibe repo** (`C:\vibe`) that Phase 3 depends on:

- [ ] New workspace package `vibe/packages/runtime/` exporting `runTranslatedLane(spec, input, signal): AsyncIterable<LaneEvent>` — graduates the translator from `sandbox/deepagents-poc/src/translator.ts`. See §3.4. **This is the critical-path item Cockpit Phase 3 blocks on.**

The `HostMemoryApi` widening, `PluginMemoryBridge` direction-flip, and the §5.8 persistence migrations are **NOT** Phase 3 prerequisites — those belong to Phase 4 and Phase 3b respectively.

## Provenance, again, because of cross-repo entanglement

| Artifact | Location |
|---|---|
| This spec | `lutherfourie/cockpit:docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md` |
| Sandbox prototype | `lutherfourie/vibe` PR #6 (`sandbox/deepagents-poc/`) |
| User memory | `C:\Users\4elut\.claude\projects\C--vibe\memory\` |
| Decision: "keep deep agents peripheral" | Cockpit commit `be63ef3` |
| Decision: "langgraph for peripheral orchestration" | Cockpit commit `37935ac` |
