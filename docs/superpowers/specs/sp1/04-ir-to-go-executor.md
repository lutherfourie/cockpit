# SP1 Design — `.vibe` IR → Go Executor

**Status:** DRAFT  
**Date:** 2026-05-29  
**Owner:** Luther  
**Scope:** How the JSON IR produced by the Langium parser feeds the Go SDK executor; Go struct schema, primitive-to-executor mapping, dispatch loop, validation boundaries, and where execution hooks into the existing `go/` package tree.

Sibling docs in this folder cover the full Go SDK surface (`01-go-sdk-surface`), transport (`02-transport`), and Cockpit integration (`03-cockpit-integration`). This doc focuses exclusively on the path **IR in → lanes/agents running → `agent.Event` stream out**.

---

## 1. IR JSON Schema (grounded in observed fields)

Two canonical IR shapes exist in `C:/vibe`. Their schemas live under `schemas/` and are enforced at load time by `go/internal/contract` using `github.com/santhosh-tekuri/jsonschema/v5`.

### 1.1 Self-Plan IR (`vibe-self-plan.schema.json`)

Observed fields from `docs/examples/vibe-self-plan.json` and the Go struct in `go/internal/selfplan/selfplan.go`:

```jsonc
{
  "name":     "vibe-self",           // required string — plan identity
  "source":   "examples/vibe-self.vibe",  // optional — originating .vibe file
  "repo":     "C:/vibe",             // optional — repo root for path resolution
  "providers": [ ... ],              // optional — named provider declarations
  "routes":   { "role": "provider-name" }, // optional — role→provider routing table
  "fallback": "openai.gpt_5_5",     // optional — fallback provider name
  "surfaces": [                      // optional — execution surfaces
    { "name": "codex.local", "kind": "codex", "mode": "local", "metadata": { ... } }
  ],
  "agents": [                        // optional — agent declarations
    {
      "name":    "vibe_bootstrap",
      "persona": "persona.vibe_bootstrap_voice",
      "memory":  "memory.vibe_project",
      "harness": "harness.self_making",
      "uses":    [ "plugin.research_lane", ... ]
    }
  ],
  "lanes": [                         // required — runnable lanes
    {
      "name":     "local_toolkit_lane",  // required
      "impl":     "./tools/local-toolkit-lane",
      "owns":     "docs/local-toolkit.md go/** packages/**",
      "emits":    "small vibe CLI plan for ...",
      "target":   "surface.codex.local", // resolved surface reference
      "reads":    ["README.md", ...],
      "verify":   ["pnpm run self:plan", ...],
      "approval": "human.before_commit",
      "metadata": { ... }            // raw pass-through from .vibe fields
    }
  ],
  "gates": [                         // optional — approval gates
    { "name": "human_merge_gate", "impl": "./tools/human-merge-gate",
      "owns": "review", "emits": "approved next slice" }
  ],
  "notes": [ ... ]                   // optional — freeform strings
}
```

### 1.2 Lane-Plan IR (`vibe-lane-plan.schema.json`)

Used by `go/internal/lanes`. Distinct from self-plan: it is the execution-focused IR with richer run semantics (branch, prompt, write scopes). Fields from `go/internal/lanes/types.go`:

```jsonc
{
  "name":  "my-plan",   // required
  "repo":  "C:/vibe",  // required
  "lanes": [
    {
      "name":     "language_lane",  // required
      "mode":     "local",          // required — enum: "local" | "codex.web"
      "branch":   "feat/lang",      // optional — git branch to work on
      "reads":    ["README.md"],    // optional — files to read before starting
      "writes":   ["packages/language/**"], // optional — exclusive write scopes
      "prompt":   "Implement the grammar changes described in ...", // required
      "requires": ["research_lane"] // optional — dependency ordering
    }
  ]
}
```

The executor for SP1 consumes **both** shapes. The self-plan is the authoring artifact; the lane-plan is the execution artifact. When Cockpit submits a self-plan, the executor upconverts it to a lane-plan (see §4).

---

## 2. The Nine `.vibe` Primitives → Executor Operations

The Langium grammar (`packages/language/src/vibe.langium`) defines exactly nine declaration types in `Declaration`. Here is how each maps to an executor operation:

| Primitive | IR field | Executor operation |
|---|---|---|
| `provider` | `providers[]` | Resolve to `agent.Provider` via `serve.ProviderFactory`; register in the plan's provider registry keyed by `name`. |
| `route` | `routes{role→provider}` | Populate a `RouteTable` map; looked up at spawn time to select the `agent.Provider` for a given semantic role (e.g. `implementation`). |
| `fallback` | `fallback` | Stored as the default `agent.Provider` name; used when no `route` matches a lane's role. |
| `surface` | `surfaces[]` | Resolve `kind`+`mode` to a `SpawnStrategy` (e.g. `kind=codex, mode=cli` → exec `codex` binary; `kind=codex, mode=local` → in-process `agent.Loop`). |
| `agent` | `agents[]` | Expanded into a set of lane runs; `uses` list is flattened into the lane dispatch queue. `persona`, `memory`, and `harness` become system-prompt fragments injected into each lane's `TurnRequest.Messages`. |
| `memory` | referenced by agent | Resolved at lane spawn: `kind=vault, namespace=C:/vibe` → a read-only file-snapshot injected as a system message. No write-back in SP1. |
| `harness` | referenced by agent | Selects the `RunLoop` strategy: `planner_generator_evaluator` → multi-iteration loop with `MaxIterations=8`; default → single-turn. |
| `plugin` | `lanes[]` (plugins are treated as lanes) | Each plugin becomes one `LaneRun` task. Fields `impl`, `owns`, `reads`, `verify`, `approval`, `target`, `emits` are mapped directly to the `ExecLane` struct (see §3). |
| `trigger` | `triggers[]` (not yet in self-plan IR) | Scheduled dispatch; deferred to post-SP1. In SP1, triggers are parsed but not executed — a warning is emitted and the trigger is skipped. |

Note: `corrected` (the ninth primitive, for error-recovery annotations) has no direct execution operation in SP1; it is preserved in `metadata` for future use.

---

## 3. Go Executor Structs

These structs live in a new package `go/internal/executor` (to be created in SP1 implementation). They extend the existing `agent` and `selfplan` packages without modifying them.

```go
package executor

import (
    "context"
    "github.com/lutherfourie/vibe/go/agent"
    "github.com/lutherfourie/vibe/go/internal/selfplan"
)

// Plan is the normalized, execution-ready form of any Vibe IR.
// Built from either a self-plan or a lane-plan JSON document.
type Plan struct {
    Name      string
    Repo      string
    Providers map[string]agent.Provider   // name → resolved provider
    Routes    map[string]string           // role → provider name
    Fallback  string
    Surfaces  map[string]SpawnStrategy    // surface name → strategy
    Lanes     []ExecLane
    Gates     []Gate
}

// ExecLane is one runnable unit of work.
type ExecLane struct {
    Name     string
    Target   string          // resolved surface name (empty = default)
    Reads    []string        // file paths to load as context
    Writes   []string        // exclusive write scopes (overlap-checked)
    Prompt   string          // the task prompt injected as user message
    Verify   []string        // shell commands to run post-execution
    Approval ApprovalKind    // none | human.before_commit | human.before_runtime
    Requires []string        // names of lanes that must complete first
    Emits    string          // human description of output (for handoff)
    Impl     string          // path to tool/script, if mode=script
}

// ApprovalKind controls whether a human gate blocks lane completion.
type ApprovalKind int
const (
    ApprovalNone ApprovalKind = iota
    ApprovalBeforeCommit
    ApprovalBeforeRuntime
)

// SpawnStrategy describes how to materialize an agent for a surface.
type SpawnStrategy struct {
    Kind string   // codex | claude | ide | framework
    Mode string   // cli | local | cloud | github_pr | vscode | python
    Meta map[string]string
}

// Gate is a human or automated approval checkpoint.
type Gate struct {
    Name string
    Kind string   // human | automated
}

// LaneEvent is the stream item emitted by the executor to callers (Cockpit).
// It wraps agent.Event and adds lane-level metadata.
type LaneEvent struct {
    LaneName string       `json:"laneName"`
    SeqNum   int          `json:"seq"`
    agent.Event
}
```

---

## 4. Loading IR and Building an Executor Plan

The load path lives in `go/internal/executor/load.go`. It calls the existing validated loaders, then upconverts to `Plan`:

```go
// LoadSelfPlan reads and validates a self-plan JSON, then builds an executor Plan.
// Uses contract.Validate (schema: vibe-self-plan.schema.json) before unmarshalling.
func LoadSelfPlan(path string) (Plan, error) {
    sp, err := selfplan.Load(path) // validates + parses
    if err != nil {
        return Plan{}, err
    }
    return upconvertSelfPlan(sp)
}

// upconvertSelfPlan maps selfplan.Plan → executor.Plan.
// Plugins-as-lanes: each selfplan.Lane becomes one ExecLane.
// Agents are expanded: each plugin in agent.Uses spawns an ExecLane
// with the agent's persona/memory injected into the prompt prefix.
func upconvertSelfPlan(sp selfplan.Plan) (Plan, error) {
    p := Plan{
        Name:      sp.Name,
        Repo:      sp.Repo,
        Providers: make(map[string]agent.Provider),
        Routes:    make(map[string]string),
        Surfaces:  make(map[string]SpawnStrategy),
    }

    for _, surf := range sp.Surfaces {
        p.Surfaces[surf.Name] = SpawnStrategy{Kind: surf.Kind, Mode: surf.Mode}
    }

    for _, lane := range sp.Lanes {
        p.Lanes = append(p.Lanes, ExecLane{
            Name:     lane.Name,
            Target:   lane.Target,
            Reads:    lane.Reads,
            Verify:   lane.Verify,
            Approval: parseApproval(lane.Approval),
            Emits:    lane.Emits,
            Impl:     lane.Impl,
            Writes:   []string{lane.Owns}, // owns → exclusive write scope
        })
    }

    for _, gate := range sp.Gates {
        p.Gates = append(p.Gates, Gate{Name: gate.Name, Kind: "human"})
    }

    if err := validateExecPlan(p); err != nil {
        return Plan{}, err
    }
    return p, nil
}
```

`LoadLanePlan` follows the same pattern using `lanes.ParsePlan` — already validated — and maps `lanes.Lane` fields directly to `ExecLane` (they align one-to-one).

---

## 5. Validation Boundaries

Three distinct checkpoints prevent malformed plans from reaching execution:

| Boundary | Location | What is checked |
|---|---|---|
| **Parse** (Langium, TS) | `packages/language` | Syntax validity; all 9 primitives tokenised correctly; cross-references resolvable within the file. |
| **IR-load** (Go) | `contract.Validate` in `selfplan.Load` / `lanes.ParsePlan` | JSON Schema conformance (`vibe-self-plan.schema.json` / `vibe-lane-plan.schema.json`); required fields present; `mode` enum membership. |
| **Executor-load** (Go) | `executor.validateExecPlan` | Cross-lane write-scope overlap (existing `lanes.ValidatePlan` logic, re-applied); unresolvable surface references; circular `requires` dependencies; `approval` enum values; `trigger` declarations flagged-and-skipped with a warning. |

Nothing is checked at execution time that can be caught earlier. Execution errors (provider failure, tool error, verify command non-zero exit) are surfaced as `agent.Event{Kind: EventKindError}` items in the stream, not panics.

---

## 6. Dispatch Loop

The executor walks `Plan.Lanes`, respects `Requires` ordering, and runs eligible lanes concurrently using goroutines bounded by a configurable worker pool. This extends the existing `lanes.EmitHandoffs` pattern (which already uses a `sync.WaitGroup` + worker pool of up to 4) into a full execution loop:

```go
// Run executes all lanes in p, streaming LaneEvents to out.
// Lanes whose Requires are satisfied run in parallel up to concurrency workers.
// Gates block until human approval is signalled on approvalCh.
func Run(ctx context.Context, p Plan, concurrency int, out chan<- LaneEvent) error {
    completed := make(map[string]bool)
    var mu sync.Mutex
    sem := make(chan struct{}, concurrency)

    pending := append([]ExecLane(nil), p.Lanes...)
    var wg sync.WaitGroup

    for len(pending) > 0 {
        if err := ctx.Err(); err != nil {
            return err
        }
        // Collect lanes whose dependencies are all complete
        var ready, deferred []ExecLane
        mu.Lock()
        for _, lane := range pending {
            if depsComplete(lane.Requires, completed) {
                ready = append(ready, lane)
            } else {
                deferred = append(deferred, lane)
            }
        }
        mu.Unlock()

        if len(ready) == 0 && len(deferred) > 0 {
            // Dependency deadlock — fail fast
            return fmt.Errorf("executor: dependency cycle or unsatisfied requires")
        }
        pending = deferred

        for _, lane := range ready {
            wg.Add(1)
            sem <- struct{}{}
            go func(l ExecLane) {
                defer wg.Done()
                defer func() { <-sem }()
                runLane(ctx, p, l, out)
                mu.Lock()
                completed[l.Name] = true
                mu.Unlock()
            }(lane)
        }
        wg.Wait() // wait for this wave before scheduling the next
    }
    return nil
}

// runLane spawns one agent turn for a lane and streams events.
func runLane(ctx context.Context, p Plan, lane ExecLane, out chan<- LaneEvent) {
    provider := resolveProvider(p, lane)    // route table + fallback
    strategy := resolveStrategy(p, lane)   // surface → spawn strategy
    messages := buildMessages(p, lane)     // reads + prompt as conversation

    var events <-chan agent.Event
    var err error

    switch strategy.Mode {
    case "cli", "local":
        // Spawn agent.RunLoop with the resolved provider
        events, err = agent.RunLoop(ctx, agent.LoopOptions{
            Provider:      provider,
            MaxIterations: 8,
        }, messages)
    default:
        // Unknown mode: emit single error event
        out <- LaneEvent{LaneName: lane.Name, Event: agent.ErrorEvent("unsupported surface mode: " + strategy.Mode)}
        return
    }
    if err != nil {
        out <- LaneEvent{LaneName: lane.Name, Event: agent.ErrorEvent(err.Error())}
        return
    }

    seq := 0
    for ev := range events {
        out <- LaneEvent{LaneName: lane.Name, SeqNum: seq, Event: ev}
        seq++
    }

    // Post-execution: run verify commands
    if len(lane.Verify) > 0 {
        runVerify(ctx, p.Repo, lane.Verify, lane.Name, out)
    }

    // Approval gate: block until human acknowledges (SP1: log and continue)
    if lane.Approval != ApprovalNone {
        out <- LaneEvent{LaneName: lane.Name, Event: agent.TextDelta(
            "[approval required: " + lane.Approval.String() + " — auto-continuing in SP1]")}
    }
}
```

`buildMessages` reads each file in `lane.Reads` from disk (relative to `p.Repo`) and prepends them as a system message, then appends `lane.Emits` and `lane.Prompt` as the user message. This is the bridge from IR metadata to `agent.TurnRequest.Messages`.

---

## 7. Where This Lives in the Go Package Tree

```
go/
  agent/                      # existing — Provider, RunLoop, Event, Message, ToolCall
  agent/adapters/claude/      # existing — Claude CLI adapter
  agent/adapters/codex/       # existing — Codex adapter
  internal/
    contract/                 # existing — JSON Schema validation
    selfplan/                 # existing — self-plan load + handoff emit
    lanes/                    # existing — lane-plan parse + handoff emit + ValidatePlan
    executor/                 # NEW in SP1 — this doc's deliverable
      load.go                 # LoadSelfPlan, LoadLanePlan, upconvertSelfPlan
      plan.go                 # Plan, ExecLane, SpawnStrategy, Gate, LaneEvent types
      dispatch.go             # Run() — the dispatch loop
      spawn.go                # resolveProvider, resolveStrategy, buildMessages
      verify.go               # runVerify — shell command runner post-lane
  serve/                      # existing — HTTP daemon + SSE streaming
    executor.go               # NEW shim — /v1/lanes/run POST endpoint, streams LaneEvents as SSE
cmd/
  vibe/
    main.go                   # existing — adds "exec" subcommand wiring executor.LoadSelfPlan + Run
```

`vibe serve` (already a stub in `main.go`) gains a `/v1/lanes/run` endpoint in `serve/executor.go`. It accepts a self-plan or lane-plan JSON body, calls `executor.LoadSelfPlan` or `executor.LoadLanePlan`, calls `executor.Run`, and streams `LaneEvent` items as SSE (`data: {...}\n\n`) — identical to the existing `/v1/turn` SSE pattern already implemented in `serve/serve.go`. Cockpit's `VibeService` subscribes to this stream.

---

## 8. Open Questions / Risks

1. **`buildMessages` context window pressure.** `lane.Reads` lists (e.g. `local_toolkit_lane` reads `README.md`, `docs/fresh-start.md`, `examples/vibe-self.vibe`) can be large. No truncation strategy is defined. Risk: provider token limits exceeded silently. Mitigation needed before SP1 ships: either a character budget cap or a summarise-first step.

2. **Provider resolution from self-plan `providers[]`.** The self-plan IR carries raw provider declarations (`mode=api, model=gpt-5.5`) but the Go SDK currently resolves providers by string name via `serve.ProviderFactory`. The mapping from `{ "mode": "cli", "model": "gpt-5.5" }` to an actual `agent.Provider` implementation (e.g. codex adapter) is not yet specified. This is the most structurally undefined seam in the pipeline — it requires either a provider registry keyed on `(kind, mode)` tuples or a convention that `mode=cli` always means the codex adapter.

3. **Write-scope enforcement at runtime.** `ValidatePlan` checks for overlapping `writes` declarations statically, but nothing prevents a lane's agent from actually writing outside its declared scope. True enforcement requires either a sandboxed working directory per lane or post-run diff inspection. Both are out of scope for SP1; the risk is silently violated isolation.

4. **Approval gates in SP1 are no-ops.** `human.before_commit` and `human.before_runtime` are logged and bypassed. If a lane does something destructive (e.g. commits code), the gate will not stop it. This is acceptable for SP1 but must be called out clearly in Cockpit's UI.

5. **Concurrent lane ordering vs. `requires`.** The dispatch loop uses a "wave" model — it waits for all ready lanes to complete before scheduling the next wave. This is correct but conservative: independent lanes in different branches of the requires graph could run earlier. For SP1's lane counts this is fine; for high-fan-out SP2 scenarios, a proper topological sort with a goroutine-per-ready-lane is needed.

6. **Schema evolution.** Two schemas (`vibe-self-plan.schema.json` and `vibe-lane-plan.schema.json`) are the shared source of truth between the TypeScript parser and the Go executor. Any new primitive or IR field added to the Langium grammar must be reflected in both schemas before the Go executor can consume it. A CI check that runs `contract.Validate` against all `docs/examples/*.json` files would catch drift early.
