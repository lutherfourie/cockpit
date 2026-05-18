# Cockpit ↔ Vibe Integration Design (Draft)

| Field | Value |
|---|---|
| Date | 2026-05-18 |
| Status | **DRAFT** — partial. See per-section status headers. |
| Author | Luther (brainstorming session) |
| Brainstorming partner | Claude (via Superpowers brainstorming skill) |
| Sibling artifact | `lutherfourie/vibe` PR #6 — deepagents POC sandbox |

> **READ THIS FIRST.** This spec was produced from a brainstorming session that did not run to completion. Section 1 was approved. Section 2 was presented but not yet approved. Sections 3-10 capture the **direction** the brainstorming converged on but are written as outlines only — they need to be expanded and reviewed before any implementation plan is drawn from them. The `Status:` header on each section is the source of truth for its readiness.
>
> The expected next move is: resume the brainstorming from Section 2, work through Sections 3-10, then re-review the whole document before invoking the `writing-plans` skill.

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
│   │ Plugin host (new — `src/lib/cockpit/plugin-host.ts`)             │ │
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

**Status: PRESENTED, AWAITING REVIEW 2026-05-18**

The interface every plugin (Vibe first, others later) implements. Lives in Cockpit at `src/lib/cockpit/plugin/types.ts`.

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

### Open questions for Section 2 (must be resolved before approval)

- Should plugins also carry a JSON manifest (separate from the TS class) for static discovery / display in a plugin browser UI? Or is the TS class's exported metadata enough for v0?
- Should `PluginHostContext.settings` be reactive (plugin re-inits on settings change) or read-once-at-init?
- What should `LaneRunInput` actually contain? At minimum: a human message + override env vars. Needs explicit typing.

---

## Section 3 — `VibeService` interface and implementations

**Status: OUTLINE ONLY — needs expansion before implementation**

### Direction agreed during brainstorming

- `VibeService` is the layer-3 interface (per Section 1) that the plugin internally consumes.
- Two implementations: `InProcessVibeService` (default) and `RemoteVibeService` (HTTP/WS client to an external Vibe daemon).
- Plugin chooses based on `COCKPIT_VIBE_RUNTIME` env var at init time.

### To resolve

- Exact method signatures of `VibeService` — must cover all four capabilities so the plugin can be a thin shim.
- File-watching strategy in `InProcessVibeService`. Likely chokidar across configured repo roots; debounced re-parse.
- Wire protocol for `RemoteVibeService`. Almost certainly HTTP for state queries + WebSocket (or SSE) for streaming events. Match Vibe's existing `vibe serve` shape on `127.0.0.1:8787`.
- Where the deepagents-poc translator code (`sandbox/deepagents-poc/src/translator.ts` in the Vibe repo) physically lives once productized. Most likely `vibe/packages/runtime/` as a workspace package.
- How `RemoteVibeService` propagates `AbortSignal` to the daemon (probably a `DELETE /runs/:id` or a WS cancel frame).

### Acceptance criteria for this section

- Method-by-method signature listing for `VibeService` with JSDoc.
- Sequence diagram for both modes covering a `runLane` invocation.
- Decision on which event-stream wire protocol (WS vs SSE).

---

## Section 4 — Capability: Lane discovery

**Status: OUTLINE ONLY**

### Direction agreed

- Vibe plugin scans configured repo roots for `.vibe` files and lane JSON specs.
- Discovery is internal to the Vibe service (the daemon shape "owns" file watching). Cockpit just calls `listLanes()`.
- User configures repo roots in Cockpit settings (not in Vibe directly), and Cockpit passes them to the plugin at init.

### To resolve

- Exactly which file patterns count as a lane definition. Options observed in the Vibe sandbox: lane JSON files in `lanes/*.json` next to `.prompt.md` siblings; `.vibe` DSL files; `vibe-self-plan.json` generated artifacts. Spec needs to pick a canonical shape.
- Refresh model: poll, watch, or both. (Recommend watch with poll fallback for environments where fsevents are unreliable.)
- How Cockpit UI represents lanes from multiple repos (grouped by repo? flat list with badge?).
- Caching semantics. Should `listLanes()` always be live, or returned from an in-plugin cache with a manual `refresh` action?

### Acceptance criteria

- Canonical lane-discovery file shape (JSON or .vibe).
- File-watching responsibilities and refresh contract documented.
- UI sketch (text-level) of the lane inventory panel.

---

## Section 5 — Capability: Lane execution + streaming

**Status: OUTLINE ONLY — bulk of work lives here**

### Direction agreed

- Vibe service runs lanes via the deepagents-based translator that PR #6 in the Vibe repo proves works.
- Cockpit calls `runLane(laneId, input, signal)` which returns an `AsyncIterable<LaneEvent>`.
- Streaming events flow: deepagents stream → VibeService → plugin (translates event shapes) → host → Cockpit API route → surface (browser/extension/CLI) via SSE or WebSocket.

### To resolve

- Concrete mapping from deepagents LangGraph stream chunks → `LaneEvent` variants. (Sandbox already streams; mapping needs spec.)
- Server-to-client transport: SSE is simpler, WebSocket allows bidirectional cancellation. Recommend SSE for v0 + a separate `POST /runs/:id/cancel` endpoint.
- How concurrent lane runs are represented in the UI (a run-board? a single active lane at a time?).
- Where lane run history lives. Cockpit's Supabase already has a sessions concept; lane runs could be a new table or piggyback on existing assistant events.
- Backpressure: if the surface can't keep up with event rate, drop intermediate events or buffer?

### Acceptance criteria

- LangGraph event → LaneEvent mapping table.
- Transport decision (SSE vs WS) with rationale.
- Schema for the lane-run persistence (table or namespace).
- Cancellation flow diagram.

---

## Section 6 — Capability: Handoff generation

**Status: OUTLINE ONLY**

### Direction agreed

- Wraps the handoff text generation Vibe already does. Cockpit shows a "Generate handoff" button per lane, with target-surface selection. Output is copy-paste ready (or auto-dispatched to Cockpit's CLI delegation path in execution mode).
- Supports the surface-aware handoff targets Vibe already emits: `codex.web`, `codex.cli`, `codex.github_pr`, `claude.code`, plus a generic `human.review`.

### To resolve

- Should handoff in Cockpit be **only** the text-generation flavor, or also include a one-click "open this in Codex Web / Codex CLI" affordance? (Latter requires Cockpit to spawn the CLI or open a URL.)
- Whether handoff target list is fixed or plugin-extensible. Recommended: plugin-extensible via `getHandoffTargets()` capability addition.
- Where the handoff text is stored after generation. Recommended: ephemeral in UI + optional persistence to Cockpit's handoffs table (already exists in current schema).

### Acceptance criteria

- Whether one-click-dispatch is in v0 or a future enhancement.
- Final HandoffTarget list (closed enum or plugin-contributed).
- Persistence model (ephemeral / always-save / opt-in save).

---

## Section 7 — Capability: Memory bridge

**Status: OUTLINE ONLY**

### Direction agreed

- Cockpit owns Supabase memory with per-user RLS. Plugins do not get raw DB access.
- `HostMemoryApi` exposes namespaced read/write/list operations. Plugin writes land under `<plugin.id>:<key>`.
- Vibe plugin uses this to bridge Vibe's own memory primitive (currently file/vault based) into Cockpit's Supabase store.

### To resolve

- Whether the bridge is bidirectional (Vibe and Cockpit both read/write) or one-way (Vibe writes only).
- Conflict resolution semantics if both sides write.
- Should there be a "shadow read" mode where Vibe's filesystem memory is the source of truth and Cockpit's Supabase mirrors it? Or vice versa?
- TTL / retention policy per key namespace.
- Surface-level UI: do users see plugin memory entries in Cockpit's memory panel, or is it backend-only?

### Acceptance criteria

- Direction(s) of sync (one-way or bidirectional).
- Conflict resolution rule.
- Concrete `HostMemoryApi` TypeScript signature.
- RLS audit: every code path that reads/writes confirmed to honor `user_id`.

---

## Section 8 — Shared data model

**Status: OUTLINE ONLY (some types already drafted in Section 2)**

### To resolve

- Consolidate all shared types (`LaneSummary`, `LaneEvent`, `HandoffArtifact`, `HandoffTarget`, `LaneRunInput`, `PluginCapability`, plus types introduced in Sections 3-7) into a single `@cockpit/plugin-contract` package or `src/lib/cockpit/plugin/types.ts` module.
- Define versioning approach: each plugin advertises `cockpitPluginContractVersion` it was built against; host warns on mismatch.
- Choose Zod or pure TS for runtime validation. Cockpit already uses Zod heavily.

### Acceptance criteria

- Complete type listing.
- Versioning rule.
- Validation approach (Zod schema set or none).

---

## Section 9 — Error handling and degradation

**Status: OUTLINE ONLY**

### Direction agreed

- Per-plugin failure isolation: a plugin throwing during init or capability hooks is contained, surfaced to the user, doesn't crash Cockpit.
- Cockpit must function meaningfully even when no plugins are loaded / all plugins errored.

### To resolve

- Specific UI affordances when a capability is unavailable ("Vibe plugin offline — lanes panel disabled. Reload?").
- Retry policy for `RemoteVibeService` (daemon down, daemon restarting).
- Whether `init` failures should be retryable on user action or require full Cockpit restart.
- Logging structure (where do plugin errors land in the existing telemetry / Supabase tables?).

### Acceptance criteria

- Per-failure-mode UI behavior matrix.
- Retry/backoff policy for remote modes.
- Logging schema for plugin-related errors.

---

## Section 10 — Testing strategy

**Status: OUTLINE ONLY**

### Direction agreed

- Cockpit-side: contract tests against the `CockpitPlugin` interface using a mock plugin. The mock plugin proves the host wires correctly without depending on Vibe.
- Plugin-side: `@vibe/cockpit-plugin` tested against a mock `VibeService`. Then integration tests against `InProcessVibeService` with fixture lanes (the sandbox's three lanes are good seed fixtures).
- End-to-end: at least one Playwright test that exercises the lane inventory panel and `runLane` flow.

### To resolve

- Whether to lift the deepagents-poc eval harness pattern from `langchain-ai/deepagentsjs` `evals/` directory.
- Which existing Cockpit test infrastructure to reuse (vitest + playwright are present).
- Mock VibeService scope — minimal behavior to satisfy contract, or richer fake with seed data?

### Acceptance criteria

- Test taxonomy (unit / contract / integration / e2e) with examples per category.
- Mock VibeService capability list.
- CI plan: which tests run on every PR, which run nightly.

---

## Open questions (cross-cutting)

These didn't fit cleanly into a single section and need answers before implementation planning.

1. **Vibe daemon control plane**: if a user enables remote mode, who starts/stops the Vibe daemon? Does Cockpit spawn it automatically, or does the user run it separately? (Recommend: auto-spawn with health check + restart, like Docker Desktop manages dockerd.)
2. **Multi-machine scenarios**: out of scope for v0 per current "personal cockpit" thesis, but the abstracted `VibeService` interface is what would later allow remote-machine Vibe daemons.
3. **Plugin distribution**: in v0, the Vibe plugin is local (file: dependency or workspace link). Long-term, do plugins ship via npm registry, GitHub releases, or a Cockpit-specific plugin registry?
4. **Authentication surface for non-browser clients**: VS Code extension and CLI need to know which user/session they belong to. Probably reuse Cockpit's existing Supabase Auth via local token cache, but the exact mechanism isn't designed yet.
5. **Plugin sandboxing escalation path**: in-process means a malicious or buggy plugin can read whatever the Cockpit backend can read. For trusted plugins (Vibe is one) this is fine; future third-party plugins would need at minimum a documented permission model, possibly enforced via worker threads.

## Next steps

1. **Resume brainstorming from Section 2** — get explicit approval on the contract, then walk Sections 3-10 the same way. Each section moves from `OUTLINE ONLY` to `APPROVED` only after presented and reviewed.
2. **User reviews the full spec** end-to-end once all sections are at `APPROVED` status.
3. **Invoke `writing-plans` skill** to translate the spec into a phased implementation plan. The natural phasing per Section 1's three layers:
   - Phase 0: Plugin host + `CockpitPlugin` contract types (no Vibe yet).
   - Phase 1: `VibeService` interface + `InProcessVibeService` skeleton + Vibe plugin doing discovery only.
   - Phase 2: Handoff capability added.
   - Phase 3: Execution + streaming.
   - Phase 4: Memory bridge.
   - Phase 5: `RemoteVibeService` and Vibe daemon (when needed).

Each phase is independently shippable. Each yields visible user value (or, for Phase 0, removes a blocker for everything that follows).

## Provenance, again, because of cross-repo entanglement

| Artifact | Location |
|---|---|
| This spec | `lutherfourie/cockpit:docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md` |
| Sandbox prototype | `lutherfourie/vibe` PR #6 (`sandbox/deepagents-poc/`) |
| User memory | `C:\Users\4elut\.claude\projects\C--vibe\memory\` |
| Decision: "keep deep agents peripheral" | Cockpit commit `be63ef3` |
| Decision: "langgraph for peripheral orchestration" | Cockpit commit `37935ac` |
