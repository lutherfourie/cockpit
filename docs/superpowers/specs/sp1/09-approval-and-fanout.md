# SP1 Design — Approval-Gate + Fan-Out Concurrency Model
# (Go SDK)

**Date:** 2026-05-29
**Status:** DRAFT
**Owner:** Luther
**Scope:** Design-only artifact — no production code written here.
**Sibling docs:** 03 (agent-spawn spike), 05 (LaneEvent schema)

---

## 1. Context & motivation

The north-star is "Cockpit develops itself": a Vibe Go daemon fans out many
`claude`/`codex` CLI agents across lanes in parallel and pauses at human
approval gates before consequential actions. SP1 delivers the **Go SDK first**;
goroutine-per-lane concurrency is the natural execution model.

Two interlocking mechanisms are needed:

1. **Approval gate** — a lane goroutine parks itself mid-execution until a
   human resolves it (approve/deny) or a timeout expires.
2. **Bounded fan-out** — the daemon launches many lanes/agents concurrently but
   never overwhelms the host; cancellation of one lane must not affect siblings.

This document designs both mechanisms precisely, grounded in existing Go code
and the lane spec `approval` field.

---

## 2. Existing foundations

### 2.1 Lane spec `approval` field
Source: `C:\Users\4elut\Documents\Cockpit\src\lib\plugins\vibe\in-process-vibe-service.ts`
(`LaneSpecSchema`, line 24).

```typescript
approval: z.string().optional(),
// observed values in deepagents lanes:
//   "human.before_commit"    — gate before any write is persisted
//   "human.before_runtime"   — gate before the agent subprocess is launched
```

The field is already surfaced in `LaneSummary.approval` and echoed into the
handoff text by `formatHandoff`. The Go SDK must honour the same field.

### 2.2 Go lane types
Source: `C:\vibe\go\internal\lanes\types.go`

`Lane` currently carries `Name`, `Mode`, `Branch`, `Reads`, `Writes`,
`Prompt`, `Requires`. SP1 adds:

```go
// Approval declares when human confirmation is required.
// Values: "human.before_commit" | "human.before_runtime" | "" (none)
Approval string `json:"approval,omitempty"`
```

### 2.3 Existing worker-pool pattern
Source: `C:\vibe\go\internal\lanes\coordinator.go` (`EmitHandoffs`, lines 47–99).

The coordinator already uses a **bounded worker pool** (cap = `min(len(lanes), 4)`)
with a `jobs` channel and a `sync.WaitGroup`. The fan-out design below extends
this pattern with a configurable semaphore and per-lane `context.CancelFunc`.

### 2.4 Agent event stream
Source: `C:\vibe\go\agent\event.go` and `C:\vibe\go\agent\loop.go`.

`agent.Event` is provider-neutral (`EventKind`: `text_delta`, `tool_call`,
`tool_result`, `usage`, `error`, `done`). SP1 adds **LaneEvent** (see §4) as
an envelope above agent events, carrying lane and approval metadata.

### 2.5 Concurrency demo
Source: `C:\vibe\go\experiments\gopher-lane-demo\main.go`.

Demonstrates channels + `sync.WaitGroup` for a multi-gopher message-passing
topology. The demo's `done <-chan struct{}` shutdown pattern is directly reused
in the fan-out runner below.

---

## 3. Approval gate design

### 3.1 Gate lifecycle

```
lane goroutine
     │
     ▼ reaches approval point (e.g. "human.before_commit")
  emit LaneEvent{kind: "approval.requested", approvalID: uuid}
     │
     ▼ park: block on approvalCh until resolved or timed out
  ┌──────────────────────────────────────┐
  │         PARKED (goroutine waits)     │
  │  Cockpit UI shows pending approval   │
  └──────────────────────────────────────┘
     │
     ├─ approve → resume execution
     ├─ deny    → abort lane (return error, cancel ctx)
     └─ timeout → auto-deny (same as deny)
```

### 3.2 Approval registry

A single `ApprovalRegistry` tracks all in-flight approvals across all lanes.
Concurrent approvals (multiple lanes each hitting a gate simultaneously) are
tracked by a unique `approvalID` (UUID v4).

```go
// go/internal/approval/registry.go  (new package, SP1)

package approval

import (
    "context"
    "fmt"
    "sync"
    "time"

    "github.com/google/uuid"
)

// Resolution is the answer delivered by a human (or timeout).
type Resolution struct {
    Approved bool
    Reason   string // optional free-text from the UI
}

// Gate is a parked approval request.
type Gate struct {
    ID      string
    LaneID  string
    Kind    string // "human.before_commit" | "human.before_runtime"
    ch      chan Resolution
}

// Registry manages all in-flight approval gates.
type Registry struct {
    mu    sync.Mutex
    gates map[string]*Gate
}

func NewRegistry() *Registry {
    return &Registry{gates: make(map[string]*Gate)}
}

// Request parks the calling goroutine until the gate is resolved or ctx/timeout fires.
// Returns nil on approval, ErrDenied on denial, ctx.Err() on cancellation.
func (r *Registry) Request(ctx context.Context, laneID, kind string, timeout time.Duration) error {
    g := &Gate{
        ID:     uuid.NewString(),
        LaneID: laneID,
        Kind:   kind,
        ch:     make(chan Resolution, 1),
    }

    r.mu.Lock()
    r.gates[g.ID] = g
    r.mu.Unlock()

    defer func() {
        r.mu.Lock()
        delete(r.gates, g.ID)
        r.mu.Unlock()
    }()

    // Caller emits the approval.requested event before calling Request.
    timer := time.NewTimer(timeout)
    defer timer.Stop()

    select {
    case res := <-g.ch:
        if !res.Approved {
            return fmt.Errorf("%w: %s", ErrDenied, res.Reason)
        }
        return nil
    case <-timer.C:
        return fmt.Errorf("%w: approval timed out after %s", ErrDenied, timeout)
    case <-ctx.Done():
        return ctx.Err()
    }
}

// Resolve delivers a resolution to the waiting goroutine.
// Returns ErrNotFound if the approvalID is not registered.
func (r *Registry) Resolve(approvalID string, res Resolution) error {
    r.mu.Lock()
    g, ok := r.gates[approvalID]
    r.mu.Unlock()
    if !ok {
        return ErrNotFound
    }
    g.ch <- res
    return nil
}

// Pending returns a snapshot of all open gate IDs and their lane/kind.
func (r *Registry) Pending() []Gate {
    r.mu.Lock()
    defer r.mu.Unlock()
    out := make([]Gate, 0, len(r.gates))
    for _, g := range r.gates {
        out = append(out, *g)
    }
    return out
}

var ErrDenied   = fmt.Errorf("approval denied")
var ErrNotFound = fmt.Errorf("approval gate not found")
```

### 3.3 How a lane goroutine uses the gate

```go
// Inside the lane runner goroutine (simplified):

func runLane(ctx context.Context, lane Lane, events chan<- LaneEvent, reg *approval.Registry) error {
    // Gate fires before runtime if specified.
    if lane.Approval == "human.before_runtime" {
        id := uuid.NewString()
        events <- LaneEvent{
            Kind:       LaneEventApprovalRequested,
            LaneID:     lane.Name,
            ApprovalID: id,
            ApprovalKind: lane.Approval,
        }
        if err := reg.Request(ctx, lane.Name, lane.Approval, 10*time.Minute); err != nil {
            events <- LaneEvent{Kind: LaneEventFailed, LaneID: lane.Name, Err: err.Error()}
            return err
        }
        events <- LaneEvent{Kind: LaneEventApprovalResolved, LaneID: lane.Name, ApprovalID: id}
    }

    // ... spawn agent, stream events ...

    if lane.Approval == "human.before_commit" {
        // gate fires again before writes are persisted
        id := uuid.NewString()
        events <- LaneEvent{Kind: LaneEventApprovalRequested, LaneID: lane.Name, ApprovalID: id}
        if err := reg.Request(ctx, lane.Name, lane.Approval, 10*time.Minute); err != nil {
            return err
        }
    }

    return nil
}
```

Key properties:
- The goroutine is **parked** in a `select` — no spin, no polling, no leaked
  goroutine. It holds its stack until the channel fires.
- Cancelling the parent `context.Context` (lane cancelled) unblocks immediately
  via `<-ctx.Done()`.
- Timeout auto-denies and unblocks the `select` via `<-timer.C`.
- Multiple simultaneous gates are tracked by independent UUIDs; `Resolve` is
  O(1) under a single mutex.

### 3.4 Cockpit ↔ daemon approval flow

```
  Cockpit UI                  vibe daemon (Go)
     │                              │
     │   POST /lanes/:id/run        │
     │ ─────────────────────────►   │
     │                              │ goroutine parks at gate
     │   SSE: approval.requested    │
     │   {approvalID, kind, laneID} │
     │ ◄──────────────────────────  │
     │ (human sees modal)           │
     │                              │
     │   POST /approvals/:id/resolve│
     │   {approved: true}           │
     │ ─────────────────────────►   │
     │                              │ Registry.Resolve → ch <- Resolution
     │                              │ goroutine unparks
     │   SSE: approval.resolved     │
     │ ◄──────────────────────────  │
```

The HTTP handler for `POST /approvals/:id/resolve` calls
`registry.Resolve(id, res)`. The gate goroutine is already blocked in `select`;
the channel write is non-blocking (buffered capacity 1) so the handler returns
immediately.

---

## 4. LaneEvent type (SP1 additions)

SP1 extends the `agent.Event` stream with a **LaneEvent** envelope emitted on
the `vibe serve` SSE stream. This is the `approval.requested` event referenced
in sibling doc 05.

```go
// go/internal/lanes/event.go  (new file, SP1)

package lanes

type LaneEventKind string

const (
    LaneEventStarted           LaneEventKind = "lane.started"
    LaneEventAgentDelta        LaneEventKind = "lane.agent_delta"    // wraps agent.Event
    LaneEventApprovalRequested LaneEventKind = "approval.requested"
    LaneEventApprovalResolved  LaneEventKind = "approval.resolved"
    LaneEventCompleted         LaneEventKind = "lane.completed"
    LaneEventFailed            LaneEventKind = "lane.failed"
    LaneEventCancelled         LaneEventKind = "lane.cancelled"
)

// LaneEvent is the top-level SSE payload emitted by `vibe serve`.
type LaneEvent struct {
    Kind         LaneEventKind `json:"kind"`
    LaneID       string        `json:"laneId"`
    ApprovalID   string        `json:"approvalId,omitempty"`
    ApprovalKind string        `json:"approvalKind,omitempty"` // "human.before_commit" etc.
    AgentEvent   *agent.Event  `json:"agentEvent,omitempty"`
    Err          string        `json:"err,omitempty"`
    Seq          int64         `json:"seq"` // monotonic per-run sequence number
}
```

---

## 5. Fan-out concurrency design

### 5.1 Mental model

A **plan** contains N lanes. A **run** instantiates one goroutine per lane,
bounded by a semaphore so at most `maxConcurrency` lanes execute simultaneously.
Each lane goroutine independently manages its own agent subprocess(es) and its
own approval gates.

```
RunPlan(ctx, plan, maxConcurrency=8)
  │
  ├─ lane-1 goroutine ──► agent (claude CLI)
  ├─ lane-2 goroutine ──► agent (codex CLI)
  ├─ lane-3 goroutine ──► [waiting on semaphore]
  ├─ lane-4 goroutine ──► [waiting on semaphore]
  └─ ...
```

### 5.2 Worker-pool vs. lane-per-task

| Approach | Pros | Cons |
|---|---|---|
| **Worker pool** (fixed N workers pull from queue) | Simple; bounded by construction | Pool workers are stateless; lanes carry per-lane context (cancel, approval, branch) — awkward to pass through a generic worker |
| **Lane-per-goroutine + semaphore** (chosen) | Each goroutine owns its full lane lifecycle; cancel/approval scoping is natural | Slightly more goroutines, but Go handles 10k+ goroutines trivially |

**Decision: lane-per-goroutine bounded by `golang.org/x/sync/semaphore`.**

The existing `coordinator.go` worker-pool is appropriate for the *handoff-emit*
phase (CPU-light file writes). For *execution* (agent subprocesses, potentially
minutes long), per-goroutine scoping is cleaner.

### 5.3 Bounded fan-out runner

```go
// go/internal/lanes/runner.go  (new file, SP1)

package lanes

import (
    "context"
    "fmt"
    "sync"

    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"

    "github.com/lutherfourie/vibe/go/internal/approval"
)

// RunConfig parameterises a plan execution run.
type RunConfig struct {
    MaxConcurrency int64         // semaphore weight; default 8
    ApprovalReg    *approval.Registry
    Events         chan<- LaneEvent // caller owns; closed by caller after RunPlan returns
}

// RunPlan executes all lanes in plan concurrently, bounded by cfg.MaxConcurrency.
// Cancelling ctx cancels ALL in-flight lanes (and their agent subprocesses).
// A single lane failure does NOT cancel siblings — use errgroup only for
// wait-and-collect; lane errors are delivered as LaneEventFailed events.
func RunPlan(ctx context.Context, plan Plan, cfg RunConfig) error {
    if cfg.MaxConcurrency <= 0 {
        cfg.MaxConcurrency = 8
    }
    sem := semaphore.NewWeighted(cfg.MaxConcurrency)

    var wg sync.WaitGroup
    for _, lane := range plan.Lanes {
        lane := lane // capture

        // Acquire semaphore slot (blocks if at concurrency limit).
        if err := sem.Acquire(ctx, 1); err != nil {
            // ctx cancelled — drain: remaining lanes never start.
            break
        }

        // Each lane gets its own cancel so we can abort it independently
        // without touching siblings.
        laneCtx, cancelLane := context.WithCancel(ctx)
        _ = cancelLane // stored in a LaneHandle for external cancellation (§5.4)

        wg.Add(1)
        go func() {
            defer wg.Done()
            defer sem.Release(1)
            defer cancelLane() // ensure no goroutine leak

            cfg.Events <- LaneEvent{Kind: LaneEventStarted, LaneID: lane.Name}
            if err := runLane(laneCtx, lane, cfg.Events, cfg.ApprovalReg); err != nil {
                cfg.Events <- LaneEvent{
                    Kind:   LaneEventFailed,
                    LaneID: lane.Name,
                    Err:    err.Error(),
                }
                return
            }
            cfg.Events <- LaneEvent{Kind: LaneEventCompleted, LaneID: lane.Name}
        }()
    }

    wg.Wait()
    return ctx.Err() // nil if all lanes finished naturally
}
```

Key properties:
- `semaphore.Acquire(ctx, 1)` blocks if the slot pool is exhausted AND unblocks
  immediately if `ctx` is cancelled — no spin.
- Each lane has a **child context** (`context.WithCancel(ctx)`). Cancelling the
  parent (`ctx`) cancels all children. Cancelling one child (external abort of
  a single lane) does not affect siblings.
- `wg.Wait()` ensures RunPlan blocks until every started goroutine has exited —
  no goroutine leaks even on partial cancellation.

### 5.4 Per-lane cancellation & LaneHandle

To support "cancel only lane X" from the Cockpit UI:

```go
// go/internal/lanes/handle.go  (new file, SP1)

package lanes

import "sync"

// LaneHandle gives the caller external control over a running lane.
type LaneHandle struct {
    LaneID string
    cancel context.CancelFunc
}

// RunRegistry tracks handles for all running lanes in a plan run.
type RunRegistry struct {
    mu      sync.Mutex
    handles map[string]*LaneHandle
}

func (r *RunRegistry) register(laneID string, cancel context.CancelFunc) {
    r.mu.Lock()
    r.handles[laneID] = &LaneHandle{LaneID: laneID, cancel: cancel}
    r.mu.Unlock()
}

func (r *RunRegistry) CancelLane(laneID string) bool {
    r.mu.Lock()
    h, ok := r.handles[laneID]
    r.mu.Unlock()
    if !ok {
        return false
    }
    h.cancel()
    return true
}
```

`RunPlan` registers each `cancelLane` in a `RunRegistry` before launching the
goroutine. `DELETE /runs/:runID/lanes/:laneID` calls `runReg.CancelLane(id)`.

### 5.5 Result aggregation

Each lane goroutine writes `LaneEvent`s to the shared `cfg.Events` channel.
The SSE handler on `vibe serve` reads that channel and fans events out to all
connected Cockpit clients over HTTP SSE.

For **synchronous callers** (CLI, tests) that want final results only:

```go
// go/internal/lanes/collect.go  (new file, SP1)

package lanes

// CollectResults drains an events channel until it is closed and
// returns one LaneResult per lane.
func CollectResults(events <-chan LaneEvent) map[string]LaneResult {
    results := make(map[string]LaneResult)
    for ev := range events {
        switch ev.Kind {
        case LaneEventCompleted:
            results[ev.LaneID] = LaneResult{LaneID: ev.LaneID, Success: true}
        case LaneEventFailed:
            results[ev.LaneID] = LaneResult{LaneID: ev.LaneID, Success: false, Err: ev.Err}
        case LaneEventCancelled:
            results[ev.LaneID] = LaneResult{LaneID: ev.LaneID, Success: false, Err: "cancelled"}
        }
    }
    return results
}

type LaneResult struct {
    LaneID  string
    Success bool
    Err     string
}
```

---

## 6. Composition with agent-spawn spike (sibling doc 03)

Sibling doc 03 designs `SpawnAgent(ctx, AgentSpec)` which shells out to
`claude`/`codex` CLIs and returns an `agent.Event` channel. `runLane` (§3.3)
calls `SpawnAgent` as its innermost step:

```
RunPlan
  └─ lane goroutine
       │  [approval gate: human.before_runtime]
       │
       └─ SpawnAgent(laneCtx, AgentSpec{...})  ← doc 03
            │
            └─ agent.Event channel
                 │  wrapped into LaneEvent{Kind: LaneEventAgentDelta}
                 └─ forwarded to cfg.Events
```

Agent subprocess cancellation follows context: `laneCtx` cancellation sends
SIGTERM to the subprocess (via `exec.Cmd` with `CommandContext`). No separate
kill mechanism is needed.

```go
// Forwarding agent events into the lane event stream:
agentEvents, err := agent.SpawnAgent(laneCtx, spec)
if err != nil {
    return err
}
seq := int64(0)
for ae := range agentEvents {
    seq++
    cfg.Events <- LaneEvent{
        Kind:       LaneEventAgentDelta,
        LaneID:     lane.Name,
        AgentEvent: &ae,
        Seq:        seq,
    }
    if ae.Kind == agent.EventKindError {
        return fmt.Errorf("agent error: %s", ae.Err)
    }
}
```

---

## 7. Timeout and auto-deny behaviour

| Scenario | Behaviour |
|---|---|
| Human approves within timeout | Gate resolves; lane continues |
| Human denies within timeout | `ErrDenied` returned; lane emits `lane.failed`; lane goroutine exits cleanly |
| Timeout fires (no response) | `ErrDenied` with "timed out" reason; same as explicit deny |
| Parent ctx cancelled (e.g. run aborted) | `ctx.Err()` returned; lane emits `lane.cancelled` |
| `vibe serve` process exits mid-approval | Goroutine stack is freed; client reconnect (SSE) will re-fetch pending approvals via `GET /approvals` |

Default timeout: **10 minutes** (configurable via `RunConfig.ApprovalTimeout`).
UI should display a countdown. The `Registry.Pending()` snapshot is the source
of truth for reconnecting clients.

---

## 8. `errgroup` vs. plain `sync.WaitGroup`

`golang.org/x/sync/errgroup` is the idiomatic choice when you want to cancel
all siblings on the first error. For Vibe's fan-out, **sibling isolation is
preferred**: a failed `cli-delegation` lane must not kill `feedback-triage`.

Therefore:

- `errgroup` is used only in **sub-fan-outs within a single lane** (e.g. a
  lane that itself spawns multiple agents in parallel — a SP2 pattern).
- Top-level `RunPlan` uses `sync.WaitGroup` with per-lane error delivery via
  the events channel.

```go
// SP2 preview: sub-fan-out within one lane using errgroup + semaphore
func runSubAgents(ctx context.Context, specs []AgentSpec, sem *semaphore.Weighted) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, spec := range specs {
        spec := spec
        g.Go(func() error {
            if err := sem.Acquire(gctx, 1); err != nil {
                return err
            }
            defer sem.Release(1)
            return spawnAndDrain(gctx, spec)
        })
    }
    return g.Wait() // first error cancels siblings via gctx
}
```

---

## 9. Packages and file locations

All new code lives in `C:\vibe\go\`:

| File | Purpose |
|---|---|
| `go/internal/approval/registry.go` | `ApprovalRegistry`, `Gate`, `Resolution`, `ErrDenied` |
| `go/internal/lanes/event.go` | `LaneEvent`, `LaneEventKind` constants |
| `go/internal/lanes/runner.go` | `RunPlan`, `RunConfig` |
| `go/internal/lanes/handle.go` | `LaneHandle`, `RunRegistry` |
| `go/internal/lanes/collect.go` | `CollectResults`, `LaneResult` |
| `go/internal/serve/serve.go` | Extended: SSE endpoint + approval resolve endpoint |

The `approval` package is intentionally **outside** `lanes` so it can be
imported by `serve` (HTTP handler) without an import cycle.

---

## 10. HTTP surface (vibe serve additions)

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/runs` | `{planID}` | Start a plan run; returns `{runID}` |
| `GET` | `/runs/:runID/events` | — | SSE stream of `LaneEvent` NDJSON |
| `GET` | `/runs/:runID/approvals` | — | Returns `Registry.Pending()` snapshot |
| `POST` | `/runs/:runID/approvals/:approvalID/resolve` | `{approved, reason}` | Calls `registry.Resolve(...)` |
| `DELETE` | `/runs/:runID/lanes/:laneID` | — | Calls `runReg.CancelLane(...)` |

Cockpit's `VibeService` (currently `InProcessVibeService`) gains a
`DaemonVibeService` implementation that talks to these endpoints over HTTP.

---

## 11. Open questions / risks

1. **Approval persistence across daemon restarts.** If `vibe serve` crashes
   while a gate is open, the pending `approvalID` is gone; the lane goroutine
   is dead. The simplest mitigation is to write gate state to a local file/DB
   on `Request` and clean up on `Resolve`. Design deferred to SP1
   implementation cycle. **Risk: HIGH** — lanes awaiting approval silently
   disappear on restart without this.

2. **`human.before_commit` semantics — what is a "commit"?** In the Cockpit
   deepagents lanes, `before_commit` appears to mean "before the agent writes
   files / opens a PR." The Go SDK must define this concretely: does the agent
   pause mid-execution (requiring the agent to be a cooperative coroutine), or
   does the SDK buffer agent outputs and gate on replay? Buffering is simpler
   for CLI agents. **Risk: MEDIUM** — wrong semantics here break the lane
   author mental model.

3. **Semaphore weight and machine limits.** `MaxConcurrency = 8` is a guess.
   `claude`/`codex` CLI processes each allocate significant RAM + API tokens.
   Too high → OOM; too low → slow fan-out. The right value is empirical.
   Consider making it configurable per-run and defaulting to `min(8, GOMAXPROCS*2)`.
   **Risk: LOW** — tunable without API changes.

4. **SSE reconnection and event replay.** If Cockpit disconnects mid-run (tab
   reload, network blip), it needs to re-fetch in-flight events. The events
   channel is consumed; a replay buffer or event log is needed. Consider an
   append-only `[]LaneEvent` ring buffer per run, served as the initial burst
   on reconnect. **Risk: MEDIUM** — without this, reconnect loses all progress
   rendering.

5. **Approval timeout UX.** 10 minutes may be too short for human reviewers who
   are away from their desk, or too long for automated CI. Should be
   per-lane-spec configurable (e.g. `approval_timeout_minutes: 60`). Add to
   `LaneSpec` schema in both the TS `LaneSpecSchema` and the Go `Lane` type.
   **Risk: LOW** — easy to add; footnote for the implementation cycle.

6. **errgroup vs. WaitGroup choice validity at scale.** The decision to isolate
   lane failures (§8) is correct for the "Cockpit develops itself" story, but
   it means a runaway lane (e.g. infinite loop in an agent) holds a semaphore
   slot forever. A per-lane `MaxRuntime` deadline (context deadline) is the
   safety valve. **Risk: MEDIUM** — add `RunConfig.LaneDeadline time.Duration`
   in the implementation cycle.
