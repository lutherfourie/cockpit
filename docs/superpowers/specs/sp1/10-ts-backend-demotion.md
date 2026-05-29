# SP1 Design: TS/LangGraph Backend Demotion

**Date:** 2026-05-29
**Status:** DRAFT — SP1 design cycle
**Owner:** Luther
**Scope:** Formally demotes `@vibe/runtime` (the TS LangGraph package) and `sandbox/deepagents-poc`
from the execution core to optional-reference status; defines the optional-backend boundary the
Go SDK may call; performs a section-by-section disposition of the existing Phase-3 plan;
specifies a coexistence/migration path; ends with a concrete recommendation.

**Supersedes:** The execution architecture assumptions in
`docs/superpowers/plans/2026-05-18-cockpit-vibe-phase-3-execution-streaming.md` (2788 lines).

**Key references:**
- `C:\vibe\packages\runtime\src\index.ts` — currently `export {};` (empty barrel; no real exports)
- `C:\vibe\packages\runtime\package.json` — declares `@langchain/core`, `deepagents`, `langchain`
- `C:\vibe\sandbox\deepagents-poc\src\translator.ts` — the real LangGraph integration logic
- `C:\vibe\sandbox\deepagents-poc\lanes\{cli-delegation,feedback-triage,truths-extraction}.json` — discovery fixtures
- `docs/superpowers/specs/2026-05-28-cockpit-vibe-hermes-workflow-design.md` §5 — the authoritative demotion directive
- `docs/superpowers/specs/sp1/01-go-sdk-surface.md` — Go SDK package layout (read alongside this doc)

---

## 1. What Exists Today (Grounded)

### 1.1 `@vibe/runtime` (packages/runtime)

A scaffolded package created in PRs #12/#13. Its entire public API surface is:

```typescript
// packages/runtime/src/index.ts
export {};
```

The package has a full `package.json` dependency list (`@langchain/core`, `deepagents`, `langchain`,
`langchain/openai`, `zod`, `execa`) but zero implemented exports. Its description: "Vibe lane
runtime: translator + LangGraph chunk-mapper. Consumed by Cockpit's InProcessVibeService and the
Vibe daemon." That sentence describes an intended future that is now superseded.

### 1.2 `sandbox/deepagents-poc`

A genuine, working TS proof-of-concept that runs three lanes through LangChain/deepagents with a
Cerebras GLM backend. The key file is `src/translator.ts`, which defines:

- `VibeLaneSpec` — the lane shape (name, promptFile, reads, owns, tools, model, approval, target)
- `translateLane(spec, opts)` — converts a `VibeLaneSpec` into a configured `createDeepAgent` call
- `loadAndTranslateLane(jsonPath, opts)` — loads JSON → translates in one step

The three lanes it ships (`cli-delegation`, `feedback-triage`, `truths-extraction`) are real
`lanes/*.json` files that Cockpit's Phase-1 vibe plugin already discovers via
`COCKPIT_PLUGIN_VIBE_ROOTS=C:/vibe/sandbox/deepagents-poc`. These files are the **discovery fixture
Cockpit uses today** — they are not superseded.

### 1.3 The Phase-3 Plan's Architecture

The 2788-line Phase-3 plan (`2026-05-18-cockpit-vibe-phase-3-execution-streaming.md`) assumes this
execution chain (lines 5–13 of the plan):

```
Cockpit UI
  → POST /run (Next.js route)
  → PluginHost.runLane
  → InProcessVibeService.runLane
  → @vibe/runtime.runTranslatedLane   ← TS LangGraph runtime
  → deepagents / LangGraph
  ← LaneEvent stream (AsyncIterable)
  ← SSE frames back to browser
```

That chain requires `@vibe/runtime` to be a real, populated package (Task 9 wires a `file:` link
to it). The Go SDK directive breaks this chain at the `@vibe/runtime` node.

---

## 2. Ownership: Go SDK vs. TS Backend

### 2.1 What the Go SDK owns exclusively (from SP1)

| Concern | Go SDK location |
|---|---|
| Lane IR execution | `go/runtime/executor.go` — `Executor.Run(lane, provider)` |
| Multi-lane fan-out | `go/runtime/harness.go` — `Harness.RunPlan(plan)` |
| Agent spawning (claude/codex CLIs) | `go/agent/adapters/claude/`, `go/agent/adapters/codex/` |
| Lane event stream | `go/runtime/event.go` — `LaneEvent` (tagged, sequenced) |
| HTTP daemon + SSE endpoint | `go/serve/daemon.go` → `/v1/lanes/:id/run` |
| IR parsing | `go/lanes/parse.go` — `ParsePlan([]byte)` accepts `.vibe`-compiler JSON |
| Approval gates | `go/runtime/options.go` — `ApprovalGate` interface |

The Go SDK is the **sole authority** for lane execution. Cockpit's `VibeService` talks to the Go
daemon over HTTP+SSE (see §3); it no longer imports or loads any TS runtime in-process.

### 2.2 What the TS backend retains (optional/reference)

| Concern | TS location | Status |
|---|---|---|
| Lane discovery fixture | `sandbox/deepagents-poc/lanes/*.json` | **Keep** — Cockpit SP0/SP1 still discovers these |
| VibeLaneSpec schema | `sandbox/deepagents-poc/src/translator.ts` | Keep as reference/canonical shape definition |
| deepagents execution path | `sandbox/deepagents-poc/src/*.ts` | Optional backend (see §3) |
| @vibe/runtime barrel | `packages/runtime/src/index.ts` | Demoted; may re-export optional-backend adapters |
| LangGraph/deepagents deps | `packages/runtime/package.json` | Retained but not a Cockpit dependency |

---

## 3. The Optional-Backend Interface

The Go SDK may delegate to a TS backend for cases where deepagents/LangGraph semantics are
specifically needed (e.g., a lane that explicitly requests `model: "cerebras"` with the existing
deepagents toolchain). This is an escape hatch, not the default path.

### 3.1 Boundary definition

The Go SDK calls the TS backend as a child process over **NDJSON-over-stdio** (consistent with the
approach already used by `go/agent/adapters/claude/` and `go/agent/adapters/codex/`). This avoids
opening a network port and keeps the transport symmetric with the existing CLI adapter pattern.

```
Go Harness
  ↓  (optional, only if lane.backend == "ts-deepagents")
  subprocess: node packages/runtime/bin/runner.js  [lane-json-path]
  ← NDJSON lines on stdout, one LaneEvent per line
  Go reads, tags with LaneID, re-emits on the event channel
```

### 3.2 TS-side runner contract (to be implemented only if optional-backend is pursued)

The runner process reads the lane spec path from `argv[1]`, executes via `translateLane`, and emits
NDJSON lines matching the Go `LaneEvent` shape:

```typescript
// packages/runtime/bin/runner.ts  (only created if optional-backend is built)
// Input:  argv[1] = path to lane JSON file
// Output: NDJSON lines to stdout, one LaneEvent per line
// Signals: SIGTERM/SIGINT → graceful drain then exit
type NdjsonLaneEvent =
  | { type: "start";    laneId: string }
  | { type: "token";    laneId: string; text: string }
  | { type: "tool";     laneId: string; name: string; input: unknown }
  | { type: "todo";     laneId: string; items: Array<{ id: string; content: string; status: string }> }
  | { type: "done";     laneId: string; exitCode: 0 | 1 }
  | { type: "error";    laneId: string; message: string };
```

### 3.3 Go-side adapter sketch (reference, not production code)

```go
// go/runtime/adapters/ts/adapter.go  (only created if optional-backend is built)
// TSBackendAdapter implements runtime.LaneBackend by shelling out to the TS runner.
type TSBackendAdapter struct {
    NodeBin    string   // "node" or absolute path
    RunnerPath string   // abs path to packages/runtime/bin/runner.js
}

func (a *TSBackendAdapter) Run(ctx context.Context, spec []byte, events chan<- LaneEvent) error {
    cmd := exec.CommandContext(ctx, a.NodeBin, a.RunnerPath)
    // pipe spec JSON via stdin; read NDJSON from stdout
    // on context cancel, SIGTERM the child
}
```

### 3.4 When to engage the optional backend

A lane opts in by setting `"backend": "ts-deepagents"` in its `lanes/*.json`. The Go harness checks
this field; absent (the default), it uses the native Go executor. The three existing deepagents-poc
lanes do **not** set this field — they remain as discovery fixtures only and would route through the
native Go executor once SP1 execution is wired.

---

## 4. Phase-3 Plan — Section-by-Section Disposition

The Phase-3 plan has 24 tasks. Below is a disposition of each.

### Legend

- **KEEP** — logic survives as-is; task is still valid
- **REWRITE** — task addresses a real problem but the implementation must change (Go daemon instead of TS runtime)
- **DROP** — task becomes irrelevant because its entire purpose was the TS runtime integration

---

| Task | Title (summary) | Disposition | Rationale |
|---|---|---|---|
| **Task 1** | Update `TodoItem` shape in contract types | **KEEP** | `TodoItem` shape (`id/content/status`) is transport-agnostic; still needed in Cockpit's contract layer regardless of which runtime produces events |
| **Task 2** | Add `cockpitPluginContractVersion` | **KEEP** | SemVer field on `CockpitPlugin` is a Cockpit-internal contract concern; unaffected by runtime choice |
| **Task 3** | SemVer check in `PluginHost.load()` | **KEEP** | Plugin loading guard is runtime-agnostic |
| **Task 4** | Add `runLane` to `VibeService` interface | **REWRITE** | The interface shape is correct; the implementation doc must reference `RemoteVibeService` (Go daemon HTTP client) not `InProcessVibeService` calling `@vibe/runtime`. The comment block already mentions `RemoteVibeService` as "Phase 5" — pull it to SP1. |
| **Task 5** | Add `runLane` to `PluginHost` | **KEEP** | Routing by `<pluginId>:<laneId>` prefix is runtime-agnostic |
| **Task 6** | `PluginHost.reload()` and `disposeOne()` | **KEEP** | Hot-reload of plugin instances is runtime-agnostic |
| **Task 7** | Add chokidar dependency | **DROP** | Chokidar was needed for `InProcessVibeService` to watch lane files in-process. The Go daemon polls/watches its own lane roots; Cockpit talks to the daemon over HTTP. |
| **Task 8** | File watching on `InProcessVibeService` | **DROP** | `InProcessVibeService` as a class that embeds execution is eliminated. Lane discovery in Cockpit comes from HTTP `GET /v1/lanes` against the Go daemon (or the existing static plugin scan). |
| **Task 9** | Add `@vibe/runtime` workspace dep (file: link) | **DROP** | Cockpit never imports `@vibe/runtime`. The Go daemon is the runtime; Cockpit's `package.json` does not gain this dep. |
| **Task 10** | Create `active-runs.ts` singleton | **REWRITE** | Run state must still live somewhere in Cockpit (for UI status tracking). However, the authoritative run state is in the Go daemon. Cockpit may keep a thin in-memory map keyed by `runId` that mirrors daemon state — but it holds no `LaneEvent` ring buffer (the SSE stream comes from the Go daemon directly). The ring-buffer logic is a Go concern. |
| **Task 11** | Implement `runLane` on `InProcessVibeService` | **DROP** | `InProcessVibeService.runLane` was the node that called `@vibe/runtime.runTranslatedLane`. With the Go SDK, there is no in-process execution; this class's `runLane` is replaced by `RemoteVibeService.runLane` which proxies to the Go daemon. |
| **Task 12** | Expose `runLane` on `VibePlugin` + `execution` capability | **KEEP** | Advertising `execution` capability on `VibePlugin` is correct regardless of backend; adjust implementation to delegate to `RemoteVibeService`. |
| **Task 13** | Create `POST /api/cockpit/lanes/[laneId]/run` route | **KEEP** | The route exists for the same reason; it now calls `RemoteVibeService.runLane` which issues `POST /v1/lanes/:id/run` to the Go daemon and returns the daemon's `runId`. |
| **Task 14** | Create `GET /run-events` SSE route | **REWRITE** | The SSE frames still reach the browser through a Cockpit route; but instead of reading from an in-memory ring buffer, this route **proxies** the Go daemon's SSE stream (or re-frames its NDJSON). The route becomes a thin streaming proxy rather than the event source. |
| **Task 15** | Create `POST /cancel` route | **KEEP** | Still needed; calls `DELETE /v1/lanes/:id/run/:runId` (or equivalent cancel endpoint) on the Go daemon. |
| **Task 16** | Enrich `listAllLanes` with `lastRunAt` | **KEEP** | Still useful; `lastRunAt` can come from the daemon's `GET /v1/lanes` response or from Cockpit's own run-id map. |
| **Task 17** | Audit-log run lifecycle to `cockpit_assistant_events` | **KEEP** | Supabase audit logging is a Cockpit concern; route receives daemon events and writes to Supabase regardless of which runtime produced them. |
| **Task 18** | Run dialog component | **KEEP** | UI modal is runtime-agnostic |
| **Task 19** | Run stream panel component | **KEEP** | SSE subscriber component; the SSE URL shape is identical — only the server-side source changes. |
| **Task 20** | Lane inventory panel — wire Run/Cancel/status | **KEEP** | UI wiring is runtime-agnostic |
| **Task 21** | Wire components into the Cockpit page | **KEEP** | Layout wiring is runtime-agnostic |
| **Task 22** | Playwright e2e — full lane-run flow | **KEEP** | E2e test is still valid; the Go daemon must be running locally for CI (or mocked via the HTTP interface) |
| **Task 23** | Full-suite verification | **KEEP** | CI verification is still valid |
| **Task 24** | Commit, push, PR | **KEEP** | Process step |

**Summary count:** KEEP 17 / REWRITE 3 / DROP 4.

The four dropped tasks (`7, 8, 9, 11`) are precisely the TS-runtime integration surface. The three
rewrites (`4, 10, 14`) shift from in-process TS to HTTP proxy/mirror against the Go daemon. The
seventeen kept tasks are all Cockpit-internal contract, plugin host, UI, routing, and persistence
concerns that are backend-agnostic.

---

## 5. What to Preserve as Reference

### 5.1 `sandbox/deepagents-poc/lanes/*.json` — non-negotiable keep

These three files are the **live discovery fixture**:

```
sandbox/deepagents-poc/lanes/cli-delegation.json
sandbox/deepagents-poc/lanes/feedback-triage.json
sandbox/deepagents-poc/lanes/truths-extraction.json
```

Cockpit's Phase-1 plugin discovers them via `COCKPIT_PLUGIN_VIBE_ROOTS`. The `VibeLaneSpec` schema
they embody (`name`, `description`, `promptFile`, `reads`, `owns`, `tools`, `model`, `target`,
`approval`) is the canonical lane shape that both the deepagents-poc translator and the future Go
`lanes.ParsePlan` must understand. Do not move or modify these files.

The accompanying `.prompt.md` siblings are the system-prompt payloads. They also stay.

### 5.2 `sandbox/deepagents-poc/src/translator.ts` — reference implementation

`VibeLaneSpec` and `translateLane` are the clearest existing documentation of the lane-to-agent
mapping. The Go SDK's `lanes/types.go` `Lane` struct should align field-for-field with this
TypeScript interface. Keep it as an annotated reference; do not delete.

### 5.3 `packages/runtime/` — archive-in-place

The package is empty (barrel only). Keep the directory so that:
1. The `package.json` dependency list documents what a TS-side optional backend would need.
2. If the optional-backend is ever pursued (§3), the runner entry point lands here.

Add a `README.md` note: "Demoted to optional-backend stub in SP1. The execution core is the Go SDK
at `go/runtime/`. See `docs/superpowers/specs/sp1/10-ts-backend-demotion.md`."

---

## 6. Migration / Coexistence Path

The goal is: **nothing breaks during SP1 development**, and the existing lane discovery + handoff
flow (SP0-verified) keeps working throughout.

### Phase A — SP0 (already completed / in progress)

- Cockpit points at `sandbox/deepagents-poc` via `COCKPIT_PLUGIN_VIBE_ROOTS`.
- Phase-1 lane discovery (`GET /api/cockpit/lanes`) returns the three lanes.
- Handoff generation works. No execution is wired.
- `@vibe/runtime` is **not** referenced anywhere in Cockpit's `package.json`.
- Status: deepagents-poc is a data source, not a runtime. Nothing to migrate.

### Phase B — SP1 Go SDK development (parallel, non-breaking)

- Work proceeds inside `C:\vibe\go\` (new `go/runtime/`, `go/lanes/`, `go/serve/` packages).
- `vibe serve` starts the daemon on `localhost:4001` (port TBD in transport doc 02).
- Cockpit gains a `RemoteVibeService` (TS class) that wraps HTTP calls to the daemon.
  - `listLanes()` → `GET /v1/lanes`
  - `runLane(id, input, signal)` → `POST /v1/lanes/:id/run`, returns `runId`
  - SSE proxy: Cockpit `/run-events` route pipes daemon SSE to browser
- `InProcessVibeService` is **not deleted** — it still handles lane discovery (file-watching the
  JSON fixtures). Only its `runLane` stub is replaced by pointing `VibePlugin` at
  `RemoteVibeService.runLane`.
- The `active-runs.ts` singleton shrinks to a `Map<runId, { laneId; startedAt; signal }>` for
  Cockpit-side cancel bookkeeping; the event ring buffer is dropped.

### Phase C — Go daemon required in local dev (SP1 milestone)

- `scripts/cockpit_up.ps1` (from SP0) gains a step: `Start-Process vibe serve --port 4001`
  before `pnpm dev`.
- A `COCKPIT_VIBE_DAEMON_URL=http://127.0.0.1:4001` env var gates `RemoteVibeService`; if unset,
  `VibePlugin.runLane` is not advertised (capability `execution` absent), so lane cards show
  "Execution not available" rather than erroring.
- E2e tests: either spin the Go daemon in CI, or mock the daemon URL with a thin HTTP stub that
  returns canned NDJSON (preferred for isolation).

### Phase D — Optional backend (if pursued, post-SP1)

- If a lane sets `"backend": "ts-deepagents"`, the Go harness spawns the TS runner as a subprocess
  (§3.3). This is additive and does not affect any other lane.
- No Cockpit changes needed; the backend selection is a Go-daemon concern.

---

## 7. Open Questions and Risks

1. **Go daemon startup sequencing** — If the daemon is not running when Cockpit starts, the
   `RemoteVibeService` must fail gracefully (degrade capability, not crash). What retry / health-
   check policy does Cockpit use? Polling `/healthz` on startup? This needs to be resolved in the
   SP1 implementation plan.

2. **SSE proxy overhead** — Cockpit's `/run-events` route proxies Go daemon SSE to the browser.
   This adds a hop. On Windows, Node.js Server-Sent Events piping through Next.js App Router's
   `Response` streaming has known edge cases (buffering, `Content-Type` negotiation). The
   alternative is having the browser connect directly to `vibe serve` — but that crosses origins
   and requires CORS on the daemon. The proxy approach is safer but must be verified against
   Next.js 16's streaming response behavior.

3. **`VibeLaneSpec` schema drift** — The `lanes/*.json` shape was defined in the deepagents-poc
   and is currently the only authoritative schema. As Go `lanes.ParsePlan` is built, the two
   schemas may diverge (Go might use `snakeCase` for JSON tags, TS uses camelCase). A canonical
   JSON schema file (e.g., `schemas/lane.schema.json`) should arbitrate before drift accumulates.

4. **Cerebras model in Go** — The deepagents-poc uses a Cerebras GLM model via a custom
   `cerebras-model.ts` adapter (OpenAI-compat API, custom base URL). The Go SDK's `openai` adapter
   (`go/agent/adapters/openai/`) should support the same via env-var `CEREBRAS_API_KEY` +
   `CEREBRAS_BASE_URL`. Verify this before SP1 end-to-end testing.

5. **Optional-backend is a feature, not a fallback** — If the Go executor is not production-ready
   by the SP1 milestone, the temptation will be to fall back to the TS runtime temporarily. This
   should be resisted: a TS fallback path adds maintenance burden and erodes the "Go SDK first"
   directive. Better to ship a reduced lane feature set in Go than to activate the TS optional
   backend as a crutch.

6. **`@vibe/runtime` npm package expectations** — Any existing CI job or pnpm workspace script
   that builds or tests `packages/runtime` may fail if `@langchain/core` / `deepagents` have
   breaking releases. Since the package is now just a stub, its tests should be reduced to a
   single smoke test (or removed). This is a minor but real maintenance risk.

---

## 8. Recommendation

**Verdict: Pure Go, archive TS — do not build the optional-backend path in SP1.**

Rationale:

- `@vibe/runtime` has **zero shipped code** today. There is no working TS runtime to demote — it
  was always scaffolding. Building an optional-backend interface to wrap scaffolding buys nothing.
- The deepagents-poc `translator.ts` is a single-file proof-of-concept tied to Cerebras + a
  specific deepagents API version. Wrapping it in a subprocess protocol adds complexity for no user
  benefit in SP1.
- The Go SDK's `openai` adapter already handles the same Cerebras endpoint (OpenAI-compat); the
  three existing lane specs can run natively in Go without any TS delegation.
- The optional-backend interface (§3) should be **designed but not implemented** in SP1. Its spec
  stays in this document. If a future lane genuinely requires LangGraph-specific graph semantics
  that Go cannot match, the subprocess adapter can be built then — it is not on the SP1 critical
  path.

**Concrete actions for SP1:**

1. Mark `packages/runtime/` as demoted in a `README.md` note (one-line, no architecture doc).
2. Do not add `@vibe/runtime` to Cockpit's `package.json` (Task 9 of Phase-3 plan is dropped).
3. Do not implement chokidar watching on `InProcessVibeService` (Task 7–8 dropped).
4. Build `RemoteVibeService` (TypeScript HTTP client) that calls the Go daemon — this replaces the
   `InProcessVibeService.runLane` stub.
5. Leave `sandbox/deepagents-poc/lanes/*.json` exactly where they are; they are data, not code.
6. Revisit optional-backend in SP2 if Hermes-agent integration exposes a pattern where TS
   subprocess delegation is the natural fit.
