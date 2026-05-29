# SP1 Design: Vibe Go SDK — Execution Surface

**Date:** 2026-05-29
**Status:** DRAFT — SP1 design cycle, iteration 1
**Owner:** Luther
**Scope:** Package layout, exported API, end-to-end usage example, CLI thin-wrapper strategy, and IR entry point for the Vibe Go SDK execution core.

---

## 1. Context and grounding

The current Go code lives at `C:\vibe\go\` (module path `github.com/lutherfourie/vibe/go`, Go 1.22).
What exists today:

| Path | What it does today |
|---|---|
| `go/agent/` | `Provider` interface, `Event`/`Message`/`ToolSpec` types, `RunLoop` agentic loop |
| `go/agent/adapters/claude/` | Shells out to `claude` CLI, streams NDJSON back as `Event` channel |
| `go/agent/adapters/codex/` | Same pattern for Codex CLI |
| `go/agent/adapters/openai/` | HTTP OpenAI-compatible chat provider |
| `go/internal/lanes/` | `Plan`/`Lane` types, JSON parse+validate, `EmitHandoffs` (writes markdown, no execution) |
| `go/internal/serve/` | `Daemon` HTTP server; `/v1/turn` streams a single provider turn as SSE |
| `go/cmd/vibe/main.go` | CLI entry — `doctor`, `continue`, `lanes`, `graph`, `serve`, `verify`, `make-plan`, `handoff` |
| `go/experiments/gopher-lane-demo/` | Goroutine concurrency proof (router/planner/reviewer goroutines) |

What is **missing** (the SP1 gap):
- No lane *execution* — `EmitHandoffs` writes markdown but never spawns anything.
- `vibe serve`'s `/v1/turn` is a single-turn endpoint, not a lane-runner.
- No fan-out across parallel lanes with dependency ordering.
- No lane-scoped event multiplexing (every event needs a `laneID` tag).
- No IR executor (the `.vibe` → JSON IR path is Langium-only; no Go consumer yet).

---

## 2. Design principles

1. **The `agent` package is the bedrock.** `Provider`, `Event`, and `RunLoop` are already well-shaped. The SDK builds *on top* of these — no rework.
2. **`internal` stays internal.** `go/internal/lanes` types (`Plan`, `Lane`) are promoted to a public `go/lanes` package; the internal one is re-wrapped or removed. The SDK surface must be importable by callers outside the repo.
3. **Channels, not callbacks.** Consistent with the existing `RunTurn` and `RunLoop` patterns. Fan-out returns a merge channel of tagged events.
4. **IR is just a lane plan.** The `.vibe` → JSON IR output (self-plan/lane-plan schema) maps directly to `lanes.Plan`. The SDK accepts `[]byte` or `io.Reader` — compilation is not the SDK's job.
5. **`vibe serve` becomes the HTTP skin over the SDK.** The daemon calls SDK methods; it does not own any execution logic.
6. **No TS runtime dependency.** The scaffolded `@vibe/runtime` (LangGraph) is demoted to a reference POC. The Go SDK is the authoritative runtime from SP1 onward.

---

## 3. Proposed package layout

```
go/
├── go.mod                          (module github.com/lutherfourie/vibe/go)
├── agent/                          (EXISTING — no change)
│   ├── types.go                    Message, ToolSpec, ToolCall, ToolResult, Usage
│   ├── event.go                    Event, EventKind constants
│   ├── provider.go                 Provider interface, TurnRequest
│   ├── loop.go                     RunLoop, LoopOptions, ToolExecutor
│   ├── fake.go                     FakeProvider (test helper)
│   └── adapters/
│       ├── claude/                 EXISTING — Claude CLI adapter
│       ├── codex/                  EXISTING — Codex CLI adapter
│       └── openai/                 EXISTING — OpenAI-compatible HTTP adapter
│
├── lanes/                          NEW (public; promotes internal/lanes)
│   ├── types.go                    Plan, Lane, LaneStatus, RunRequest, RunResult
│   ├── validate.go                 ValidatePlan (moved from internal)
│   ├── parse.go                    ParsePlan([]byte) — accepts JSON IR from .vibe compiler
│   └── runner.go                   Runner interface + LaneEvent type
│
├── runtime/                        NEW — execution core
│   ├── executor.go                 Executor: runs one Lane against a Provider
│   ├── harness.go                  Harness: fan-out across Plan lanes with dep-ordering
│   ├── event.go                    LaneEvent (wraps agent.Event + LaneID + Seq)
│   └── options.go                  HarnessOptions, ConcurrencyPolicy, ApprovalGate
│
├── memory/                         NEW (SP1 stub; fleshed out when memory-bridge lands)
│   └── store.go                    MemoryStore interface (Get/Put/Delete)
│
├── serve/                          PROMOTED from internal/serve
│   ├── daemon.go                   Daemon (HTTP wrapper over runtime.Harness)
│   ├── routes.go                   /v1/lanes, /v1/lanes/:id/run (SSE), /v1/turn, /healthz
│   └── sse.go                      SSE framing helpers
│
└── cmd/
    └── vibe/
        └── main.go                 EXISTING — becomes thin wrapper; calls lanes/runtime/serve
```

**Dropped:** `go/internal/lanes` and `go/internal/serve` are promoted. The `internal` qualifier is removed so external Go programs can import the SDK directly.

---

## 4. Key exported types and interfaces

### 4.1 `lanes` package

```go
package lanes

import (
    "context"
    "io"
)

// Plan is the JSON IR produced by the .vibe compiler (lane-plan schema).
// Identical shape to internal/lanes.Plan; now public.
type Plan struct {
    Name  string `json:"name"`
    Repo  string `json:"repo"`
    Lanes []Lane `json:"lanes"`
}

// Lane declares one isolated unit of agentic work.
type Lane struct {
    Name     string   `json:"name"`
    Mode     string   `json:"mode"`      // "claude.cli" | "codex.cli" | "local" | "codex.web"
    Branch   string   `json:"branch,omitempty"`
    Reads    []string `json:"reads,omitempty"`
    Writes   []string `json:"writes,omitempty"`
    Prompt   string   `json:"prompt"`
    Requires []string `json:"requires,omitempty"` // dependency gate: other lane Names
    Approval string   `json:"approval,omitempty"` // "" | "auto" | "human"
}

// LaneStatus is reported in LaneEvent.
type LaneStatus string

const (
    LaneStatusPending  LaneStatus = "pending"
    LaneStatusRunning  LaneStatus = "running"
    LaneStatusDone     LaneStatus = "done"
    LaneStatusFailed   LaneStatus = "failed"
    LaneStatusBlocked  LaneStatus = "blocked"  // waiting on an Approval gate
)

// ParsePlan is the IR entry point: accepts raw JSON from the .vibe compiler
// (or any tool that emits the lane-plan schema) and returns a validated Plan.
// This is the only function the .vibe toolchain needs to call into the SDK.
func ParsePlan(raw []byte) (Plan, error) { ... }

// ParsePlanReader is a convenience wrapper around ParsePlan.
func ParsePlanReader(r io.Reader) (Plan, error) { ... }

// ValidatePlan enforces structural constraints (non-overlapping write scopes, etc.).
func ValidatePlan(plan Plan) error { ... }
```

### 4.2 `runtime` package

```go
package runtime

import (
    "context"

    "github.com/lutherfourie/vibe/go/agent"
    "github.com/lutherfourie/vibe/go/lanes"
)

// LaneEvent wraps an agent.Event with lane identity and sequence info.
// This is the unit Cockpit consumes over SSE.
type LaneEvent struct {
    LaneID  string       `json:"laneId"`
    LaneSeq int64        `json:"laneSeq"`  // monotonic counter per lane
    PlanSeq int64        `json:"planSeq"`  // monotonic counter across the plan run
    Status  lanes.LaneStatus `json:"status,omitempty"`
    Event   agent.Event  `json:"event"`
}

// ProviderFactory constructs a fresh agent.Provider for one lane execution.
// The factory is called once per lane (not once per turn) so providers that
// carry CLI session state don't leak between lanes.
type ProviderFactory func(lane lanes.Lane) (agent.Provider, error)

// ApprovalGate is called before a lane's first turn when Lane.Approval == "human".
// It blocks until the gate returns (approved == true) or ctx is canceled.
// Return false to mark the lane as LaneStatusBlocked and skip it.
type ApprovalGate func(ctx context.Context, lane lanes.Lane) (approved bool, err error)

// HarnessOptions configures a Harness run.
type HarnessOptions struct {
    // ProviderFactory is required.
    ProviderFactory ProviderFactory

    // MaxConcurrent caps the number of lanes running in parallel.
    // 0 means unbounded (all ready lanes start immediately).
    MaxConcurrent int

    // ApprovalGate is called for lanes with Approval == "human".
    // If nil, human-approval lanes are skipped with LaneStatusBlocked.
    ApprovalGate ApprovalGate

    // MaxTurnsPerLane is forwarded to agent.LoopOptions.MaxIterations.
    // 0 uses the agent package default (8).
    MaxTurnsPerLane int
}

// Harness executes a Plan: resolves dependencies, fans out across lanes in
// parallel (respecting MaxConcurrent and Requires ordering), and merges all
// per-lane event streams into a single channel.
type Harness struct{ /* unexported */ }

// NewHarness returns a Harness ready to run.
func NewHarness(opts HarnessOptions) (*Harness, error) { ... }

// Run executes plan and returns a merged event stream.
// The channel is closed when all lanes are terminal (done/failed/blocked) or
// ctx is canceled. Run is safe to call once per Harness instance.
func (h *Harness) Run(ctx context.Context, plan lanes.Plan) (<-chan LaneEvent, error) { ... }

// Executor runs a single Lane to completion and streams LaneEvents.
// Used directly by Harness; also useful in tests and single-lane tooling.
type Executor struct{ /* unexported */ }

// NewExecutor returns an Executor for one lane.
func NewExecutor(factory ProviderFactory, opts ExecutorOptions) *Executor { ... }

// ExecutorOptions configures one lane's execution.
type ExecutorOptions struct {
    MaxTurns    int
    // ToolExecutor is forwarded to agent.RunLoop.
    ToolExecutor agent.ToolExecutor
}

// Run executes the lane and closes the returned channel when done.
func (e *Executor) Run(ctx context.Context, lane lanes.Lane) (<-chan LaneEvent, error) { ... }
```

### 4.3 `memory` package (SP1 stub)

```go
package memory

import "context"

// MemoryStore is the interface the Harness can query between lane turns.
// SP1 ships a NoopStore. The cockpit-vibe-memory-bridge branch fleshed out
// the Supabase-backed implementation; it integrates here in the SP1 impl cycle.
type MemoryStore interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Put(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
}

// NoopStore always returns empty results. Safe for use when no persistence is needed.
type NoopStore struct{}

func (NoopStore) Get(_ context.Context, _ string) ([]byte, error)       { return nil, nil }
func (NoopStore) Put(_ context.Context, _ string, _ []byte) error        { return nil }
func (NoopStore) Delete(_ context.Context, _ string) error               { return nil }
```

### 4.4 `serve` package (promoted from `internal/serve`)

```go
package serve

import (
    "net/http"

    "github.com/lutherfourie/vibe/go/lanes"
    "github.com/lutherfourie/vibe/go/runtime"
)

// DaemonOptions extends the existing Options with execution config.
type DaemonOptions struct {
    Addr            string
    DefaultProvider string
    Providers       map[string]ProviderFactory  // same as today
    HarnessOpts     runtime.HarnessOptions      // NEW: execution config
}

// Daemon serves both the existing turn API and the new lane execution API.
type Daemon struct{ /* unexported */ }

// New routes registered by the promoted Daemon:
//
//   GET  /healthz              — existing
//   GET  /v1/providers         — existing
//   POST /v1/turn              — existing (single-turn SSE)
//   GET  /v1/lanes             — list lanes from the loaded Plan
//   POST /v1/lanes/:id/run     — start a single lane; SSE stream of LaneEvent
//   POST /v1/plan/run          — start the full plan; SSE stream of LaneEvent
//
// All execution endpoints stream application/x-ndjson or text/event-stream
// (caller's Accept header chooses; defaults to SSE for browser compatibility).
```

---

## 5. Canonical end-to-end usage example

This is how a Go program (or a future integration test) uses the SDK from scratch:

```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "os"

    "github.com/lutherfourie/vibe/go/agent"
    "github.com/lutherfourie/vibe/go/agent/adapters/claude"
    "github.com/lutherfourie/vibe/go/lanes"
    "github.com/lutherfourie/vibe/go/runtime"
)

func main() {
    ctx := context.Background()

    // 1. Load a Plan from IR (produced by: vibe compile myplan.vibe → lanes.json)
    //    In SP1 the JSON IR is the canonical wire format; the .vibe source is an
    //    authoring convenience that compiles to this same shape.
    raw, err := os.ReadFile("lanes.json")
    if err != nil {
        log.Fatal(err)
    }
    plan, err := lanes.ParsePlan(raw)
    if err != nil {
        log.Fatalf("invalid plan IR: %v", err)
    }

    // 2. Define a ProviderFactory.
    //    The factory is called once per lane so each lane gets its own
    //    stateful claude.Provider (session IDs don't bleed across lanes).
    factory := func(lane lanes.Lane) (agent.Provider, error) {
        switch lane.Mode {
        case "claude.cli":
            return claude.New(), nil
        case "codex.cli":
            // codex adapter follows the same pattern as claude
            return nil, fmt.Errorf("codex adapter: TODO in SP1 impl")
        default:
            return nil, fmt.Errorf("unsupported mode %q for lane %q", lane.Mode, lane.Name)
        }
    }

    // 3. Build the Harness with concurrency and approval policy.
    harness, err := runtime.NewHarness(runtime.HarnessOptions{
        ProviderFactory: factory,
        MaxConcurrent:   4,  // up to 4 lanes running in parallel
        MaxTurnsPerLane: 12,
        ApprovalGate: func(ctx context.Context, lane lanes.Lane) (bool, error) {
            // In production Cockpit sends approval through the dashboard;
            // this stub auto-approves in dev.
            fmt.Printf("[approval] lane %q requires human approval — auto-approving in dev\n", lane.Name)
            return true, nil
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    // 4. Run the Plan; consume the merged event stream.
    events, err := harness.Run(ctx, plan)
    if err != nil {
        log.Fatal(err)
    }

    enc := json.NewEncoder(os.Stdout)
    for ev := range events {
        // Each LaneEvent carries laneId, laneSeq, planSeq, status, and the
        // wrapped agent.Event. Pipe to Cockpit's /api/vibe/run SSE endpoint
        // or print as NDJSON for CLI inspection.
        _ = enc.Encode(ev)
    }

    fmt.Println("plan complete")
}
```

**What this demonstrates:**
- `lanes.ParsePlan` as the single IR entry point.
- `ProviderFactory` decouples lane mode selection from the harness.
- `Harness.Run` returns a single `<-chan LaneEvent` regardless of how many lanes run in parallel.
- Callers can pipe the channel to SSE, NDJSON, a file, or a test assertion — the harness doesn't care.

---

## 6. How the existing CLI becomes a thin wrapper

The `go/cmd/vibe/main.go` currently contains `runServe`, `runLanes`, `runHandoff`, etc. inline.
After the SDK lands, these collapse to delegation:

```go
// Before (today): runServe is ~60 lines that builds its own mux + handlers.
// After: 10 lines.
func runServe(args []string) error {
    opts := parseServeFlags(args)
    plan, err := lanes.ParsePlan(readFile(opts.planPath))
    if err != nil { return err }
    return serve.ListenAndServe(opts.addr, serve.DaemonOptions{
        DefaultProvider: opts.provider,
        HarnessOpts: runtime.HarnessOptions{MaxConcurrent: opts.concurrency},
    }, plan)
}

// The `handoff` subcommand stays for backward compat but calls lanes.EmitHandoffs
// which moves from internal/lanes to the public lanes package unchanged.
```

`vibe serve` is no longer a stub: it hosts `/v1/lanes`, `/v1/lanes/:id/run`, and `/v1/plan/run` in addition to the existing `/v1/turn` endpoint.

---

## 7. How `.vibe` → IR plugs in

The `.vibe` language (Langium, lives in `packages/vibe-lang/`) compiles to JSON IR.
The SDK's IR entry point is **`lanes.ParsePlan([]byte)`** — one function, stable contract.

```
┌──────────────┐   compile    ┌───────────────────┐   ParsePlan   ┌─────────────────┐
│  myplan.vibe │ ───────────► │  lanes.json (IR)  │ ────────────► │  lanes.Plan{}   │
│  (Langium)   │              │  (lane-plan schema)│               │  (Go struct)    │
└──────────────┘              └───────────────────┘               └─────────────────┘
                                                                          │
                                                                   runtime.Harness
                                                                          │
                                                                   <-chan LaneEvent
```

The compiler is *not* part of the Go SDK. The boundary is the JSON file.
A future `vibe run myplan.vibe` subcommand would shell out to `vibe compile` first, then call `ParsePlan` on the result — but that is an implementation detail of `cmd/vibe`, not a SDK concern.

The existing `go/internal/lanes/ParsePlan` already validates against the JSON schema via `go/internal/contract`. That validation logic moves to the public `lanes` package unchanged.

---

## 8. How Cockpit consumes the SDK

Cockpit's `InProcessVibeService` (`src/lib/plugins/vibe/in-process-vibe-service.ts`) currently does lane *discovery* only.
In SP1, Cockpit's VibeService gains an `executeLane` method that talks to the Go daemon:

```
Cockpit browser
  └─► POST /api/cockpit/lanes/:id/run  (Next.js route)
        └─► GET http://127.0.0.1:8787/v1/lanes/:id/run  (Go daemon, SSE)
              └─► runtime.Executor.Run(ctx, lane)
                    └─► agent.Provider.RunTurn → claude CLI or codex CLI
```

The Next.js API route acts as an SSE proxy: it forwards `LaneEvent` NDJSON from the daemon to the browser. Cockpit renders events in the Lane Inventory panel without owning any execution state — the Go daemon is the source of truth for a running lane's event stream.

This preserves the architecture invariant: **Cockpit enriches, never owns execution**.

---

## 9. Open questions and risks

### Q1 — Transport: SSE vs. NDJSON vs. WebSocket
`vibe serve` already uses SSE for `/v1/turn`. SSE is the natural fit for Cockpit's Next.js route proxy. The risk is long-running plans (many hours) and SSE reconnection — if the browser disconnects mid-run, Cockpit must re-attach to an in-flight plan. This requires the daemon to buffer or replay recent `LaneEvent`s per run ID.
**Decision needed:** buffer last N events per run in memory? Persist to Supabase? (Memory-bridge branch is the obvious answer but adds SP1 scope.)

### Q2 — `ProviderFactory` vs. `Mode` dispatch
Today `Lane.Mode` is a string (`"codex.web"`, `"local"`). The SDK needs to map modes to providers. Three options: (a) the factory does it (most flexible, shown in §5), (b) the SDK ships a `DefaultFactory` that reads env vars, (c) mode becomes a typed enum. Option (a) is proposed; it keeps the SDK provider-agnostic.
**Risk:** callers must know about every mode string. A `DefaultFactory` helper in the `serve` package would reduce boilerplate for the 90% case.

### Q3 — Dependency ordering and `Requires`
`Lane.Requires` lists other lane names that must complete before this lane starts. The Harness must topologically sort lanes and block on their completion. This is straightforward but needs a cycle-detection check at `ValidatePlan` time.
**Risk:** if a required lane fails, do dependent lanes skip (blocked) or also fail? Policy is needed; `HarnessOptions` should expose a `FailFast bool`.

### Q4 — Write-scope enforcement at execution time
`ValidatePlan` already checks for overlapping write scopes at parse time. At *execution* time, the SDK cannot actually enforce file-system isolation without a sandbox. The plan is to rely on the `claude`/`codex` CLI's own permission modes (`bypassPermissions`, `readOnly`, etc.) and document that overlapping writes are a lint error, not a runtime guard.
**Risk:** two lanes writing the same file concurrently will corrupt it. The mitigation is `ValidatePlan` catching overlaps before execution begins.

### Q5 — Windows path handling
The existing `go/internal/lanes/validate.go` uses `filepath.ToSlash(filepath.Clean(...))` for scope normalization. The SDK runs on Windows (the dev machine is Windows 11). The `claude` CLI adapter already handles Windows by delivering prompts via stdin (documented in `go/agent/adapters/claude/claude.go` line 163). The risk is that `Cwd` paths in `TurnRequest` need to be Windows-native (backslashes) while the JSON IR will likely carry forward-slash paths.
**Decision needed:** normalize paths to native form in `NewExecutor`? Or require callers to pass native paths?

### Q6 — Memory bridge integration timing
The `origin/claude/cockpit-vibe-memory-bridge-2026-05-27` branch has a Supabase-backed memory implementation. The `memory.MemoryStore` interface proposed here is intentionally thin so it can be satisfied by that implementation when it merges — but the branch hasn't been reviewed or merged. If SP1 needs cross-lane memory sharing (e.g., a summarizer lane reading a researcher lane's output), the `NoopStore` won't be sufficient.
**Risk:** SP1 ships a `NoopStore`; cross-lane memory is deferred to SP1.5 or SP2. This is acceptable if lanes communicate via the repo (writes) rather than in-memory state.

### Q7 — `vibe serve` run lifecycle (start/stop/status)
The `/v1/plan/run` endpoint starts a plan run asynchronously. The daemon needs a run registry (run ID → Harness + event buffer) so Cockpit can query run status and the browser can re-attach after a disconnect. This is a non-trivial piece of state; the current daemon is stateless (except session IDs). The run registry should be in-memory for SP1 (lost on daemon restart) with a note to persist it via Supabase in SP2.
**This is the biggest implementation risk in SP1.** A lost run registry means Cockpit can't re-render an in-flight plan after a page refresh.

---

## 10. Summary: recommended API shape

The top recommendation is:

> **`lanes.ParsePlan([]byte) → lanes.Plan` as the single IR entry point; `runtime.NewHarness(HarnessOptions).Run(ctx, plan) → <-chan LaneEvent` as the single execution surface.**

This is a two-call SDK for the 80% case. Everything else (provider factory, approval gate, concurrency) is injected via `HarnessOptions`, keeping the harness itself dependency-free and testable with `agent.FakeProvider`.

The `serve` package wraps these two calls in HTTP + SSE — the CLI wraps `serve` — and Cockpit wraps the HTTP endpoint. Each layer adds exactly one concern.
