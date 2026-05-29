# Spike 07 — `vibe serve`: Local HTTP Daemon Design

**Date:** 2026-05-29
**Status:** SPIKE / DE-RISKING — no production code
**Author:** Claude (Sonnet 4.6)
**Scope:** HTTP surface, security, lifecycle, concurrency design for the `vibe serve` daemon in SP1.
**Sibling spikes assumed read:** 01 (Go SDK surface), 02 (transport), 03 (agent spawning), 05 (LaneEvent contract), 09 (approvals + fanout).

---

## 1. What exists today (grounded reading)

### 1.1 `vibe serve` stub — `go/cmd/vibe/main.go`

`runServe` (lines 190–253 of `C:\vibe\go\cmd\vibe\main.go`) is already wired and running. It:

1. Parses `--addr` (default `127.0.0.1:8787`, sourced from `serve.DefaultAddr`) and `--provider` flags.
2. Loads a self-plan JSON, renders a Mermaid graph and dashboard HTML.
3. Constructs a `serve.Daemon` (from `C:\vibe\go\internal\serve\serve.go`) and calls `daemon.Register(mux)`.
4. Adds static routes (`/`, `/self-plan.json`, `/vibe-lanes.mmd`, `/handoffs/…`, `/favicon.ico`).
5. Calls `http.ListenAndServe(*addr, mux)` — **no graceful shutdown yet**.

### 1.2 `go/internal/serve/serve.go` — what's real

The `Daemon` struct already implements:

| Route | Method | What it does |
|---|---|---|
| `GET /healthz` | GET | Returns `ok\n`, 200 |
| `GET /v1/providers` | GET | Returns list of registered providers + default |
| `POST /v1/turn` | POST | Streams `agent.Event` as SSE via `provider.RunTurn` |

The `/v1/turn` handler is the key precedent: it uses `http.Flusher` + `text/event-stream` and drains `<-chan agent.Event` until a `done` or `error` event. Session IDs are mapped in a `sync.RWMutex`-guarded `map[string]string`. Provider factories are registered at startup; each turn gets a fresh provider instance.

### 1.3 `go/agent` package — the streaming contract

- `agent.Event` (kinds: `text_delta`, `tool_call`, `tool_result`, `usage`, `error`, `done`) is the provider-neutral stream atom already used by `/v1/turn`.
- `agent.Provider` interface: `RunTurn(ctx, TurnRequest) (<-chan Event, error)`.
- `agent.RunLoop` wraps multi-turn tool-calling on top of a single provider.
- Spike 05 defines the higher-level `LaneEvent` — the lane-scoped envelope wrapping `agent.Event` with lane ID, agent ID, sequence number, and timestamp. This report designs for that contract without defining it.

### 1.4 `go/internal/lanes` — lane IR

`lanes.Plan` / `lanes.Lane` carry name, mode, branch, reads, writes, prompt, requires. The coordinator (`coordinator.go`) does parallel handoff emission with a bounded worker pool (min(len(lanes), 4)). SP1 execution reuses the plan/lane types and extends the coordinator to spawn agents instead of writing handoffs.

---

## 2. Target HTTP endpoint surface

The existing daemon is an agent-turn surface. SP1 extends it into a lane execution surface. The two surfaces coexist under the same mux.

### 2.1 Full endpoint table

| Method | Path | Auth | Body / Params | Response |
|---|---|---|---|---|
| GET | `/healthz` | None (loopback only) | — | `200 ok\n` |
| GET | `/v1/providers` | Token | — | `{"providers":[…],"default":"…"}` |
| POST | `/v1/turn` | Token | `TurnRequest` JSON | SSE stream of `agent.Event` |
| GET | `/v1/lanes` | Token | `?plan=<path>` | JSON array of `LaneSummary` |
| POST | `/v1/lanes/{id}/run` | Token | `RunLaneRequest` JSON | `{"runId":"…"}` |
| GET | `/v1/lanes/{id}/events` | Token | `?runId=<runId>` | SSE stream of `LaneEvent` |
| POST | `/v1/approvals/{id}` | Token | `{"verdict":"approve"|"reject","reason":"…"}` | `204` |
| DELETE | `/v1/lanes/{id}/runs/{runId}` | Token | — | `204` (cancel in-flight run) |

`/healthz` is always token-free — it is only reachable from 127.0.0.1, and Cockpit needs it before it has stored the token.

### 2.2 Type sketches (fenced — not production code)

```go
// LaneSummary is what GET /v1/lanes returns per lane.
type LaneSummary struct {
    ID     string   `json:"id"`   // stable slug: sanitized lane name
    Name   string   `json:"name"`
    Mode   string   `json:"mode"`
    Branch string   `json:"branch,omitempty"`
    Writes []string `json:"writes,omitempty"`
}

// RunLaneRequest is the POST /v1/lanes/{id}/run body.
type RunLaneRequest struct {
    PlanPath string `json:"planPath"`           // absolute path to lane-plan JSON
    RunID    string `json:"runId,omitempty"`    // client-supplied idempotency key; generated if absent
    Provider string `json:"provider,omitempty"` // overrides daemon default
}

// LaneEvent is the SSE envelope (defined authoritatively in spike 05).
type LaneEvent struct {
    RunID  string      `json:"runId"`
    LaneID string      `json:"laneId"`
    Seq    int64       `json:"seq"`
    TS     time.Time   `json:"ts"`
    Inner  agent.Event `json:"event"`
}
```

---

## 3. Handler design

### 3.1 `GET /v1/lanes`

```go
func (d *Daemon) handleLanes(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet { /* 405 */ return }
    planPath := r.URL.Query().Get("plan")
    plan, err := lanes.ParsePlan(mustReadFile(planPath))
    if err != nil { writeJSONError(w, 400, err.Error()); return }
    summaries := make([]LaneSummary, len(plan.Lanes))
    for i, l := range plan.Lanes {
        summaries[i] = LaneSummary{ID: sanitizeID(l.Name), Name: l.Name, Mode: l.Mode,
            Branch: l.Branch, Writes: l.Writes}
    }
    writeJSON(w, 200, summaries)
}
```

### 3.2 `POST /v1/lanes/{id}/run`

The handler validates the request, allocates a `runID`, stores a cancel function, and launches the lane goroutine. It returns immediately with `{"runId":"…"}` so Cockpit can open the SSE stream.

```go
func (d *Daemon) handleRunLane(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost { /* 405 */ return }
    laneID := pathSegment(r.URL.Path, 3) // /v1/lanes/{id}/run

    var req RunLaneRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSONError(w, 400, "invalid body"); return
    }
    if req.RunID == "" { req.RunID = newRunID() }

    plan, lane, err := d.resolveLane(req.PlanPath, laneID)
    if err != nil { writeJSONError(w, 404, err.Error()); return }

    // Concurrency cap: reject if at limit.
    if !d.reserveSlot() { writeJSONError(w, 429, "too many concurrent lanes"); return }

    ctx, cancel := context.WithCancel(context.Background())
    fanout := newFanout(req.RunID) // ring-buffer + subscriber set
    d.registerRun(req.RunID, laneID, cancel, fanout)

    go func() {
        defer d.releaseSlot()
        defer d.unregisterRun(req.RunID)
        defer cancel()
        d.executeLane(ctx, req.RunID, plan, lane, req.Provider, fanout)
    }()

    writeJSON(w, 202, map[string]string{"runId": req.RunID})
}
```

### 3.3 `GET /v1/lanes/{id}/events?runId=…` — SSE stream

```go
func (d *Daemon) handleLaneEvents(w http.ResponseWriter, r *http.Request) {
    runID := r.URL.Query().Get("runId")
    fanout, ok := d.fanoutFor(runID)
    if !ok { writeJSONError(w, 404, "run not found"); return }

    flusher, ok := w.(http.Flusher)
    if !ok { http.Error(w, "streaming unsupported", 500); return }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering if ever proxied

    sub := fanout.Subscribe()
    defer fanout.Unsubscribe(sub)

    for {
        select {
        case <-r.Context().Done():
            return // client disconnected
        case ev, ok := <-sub:
            if !ok { return } // fanout closed (run finished)
            raw, _ := json.Marshal(ev)
            fmt.Fprintf(w, "data: %s\n\n", raw)
            flusher.Flush()
            if ev.Inner.Kind == agent.EventKindDone || ev.Inner.Kind == agent.EventKindError {
                return
            }
        }
    }
}
```

### 3.4 `POST /v1/approvals/{id}`

Approval gates are covered in spike 09. The daemon holds a `map[approvalID]chan verdict`. The handler writes to that channel, unblocking the lane goroutine.

```go
func (d *Daemon) handleApproval(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost { /* 405 */ return }
    approvalID := pathSegment(r.URL.Path, 2) // /v1/approvals/{id}
    var body struct {
        Verdict string `json:"verdict"` // "approve" | "reject"
        Reason  string `json:"reason,omitempty"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        writeJSONError(w, 400, "invalid body"); return
    }
    if err := d.resolveApproval(approvalID, body.Verdict, body.Reason); err != nil {
        writeJSONError(w, 404, err.Error()); return
    }
    w.WriteHeader(http.StatusNoContent)
}
```

---

## 4. Internal architecture

### 4.1 `executeLane` — Go SDK bridge

`executeLane` is the goroutine that owns one lane run. It:
1. Resolves the provider factory and constructs a fresh `agent.Provider`.
2. Builds system + user messages from `lane.Prompt` plus injected context (repo root, branch, read-file summaries).
3. Calls `agent.RunLoop` (multi-turn, tool-call-capable) with the provider.
4. Wraps each `agent.Event` from the loop channel into a `LaneEvent` (incrementing `Seq`, stamping `TS`) and publishes to the fanout.
5. On `agent.EventKindDone` or error, closes the fanout.

For multi-agent lanes (spike 03), `executeLane` will hand off to a coordinator that spawns one goroutine per sub-lane/sub-agent, each with its own `RunLoop`, pushing into the same fanout under a distinct `agentID` field.

### 4.2 Run registry

```go
type runRecord struct {
    laneID string
    cancel context.CancelFunc
    fanout *Fanout
}

// Daemon gains:
// runs   map[string]runRecord  // runID -> record
// runsMu sync.RWMutex
// slots  chan struct{}          // buffered semaphore, cap = MaxConcurrentLanes
```

### 4.3 Fanout (ring-buffer + subscribers)

The fanout bridges one producer goroutine to N subscriber connections. Constraints:
- A slow subscriber must not block the lane goroutine.
- Late-joining subscribers should see recent history (ring buffer of the last K=256 events).
- When the run ends the fanout is closed and all subscriber channels drained.

```go
type Fanout struct {
    mu     sync.Mutex
    ring   []LaneEvent     // circular buffer, capacity K
    head   int
    subs   map[int]chan LaneEvent
    nextID int
    closed bool
}

func (f *Fanout) Publish(ev LaneEvent) { /* append to ring, send to all subs non-blocking */ }
func (f *Fanout) Subscribe() <-chan LaneEvent { /* replay ring, register sub */ }
func (f *Fanout) Unsubscribe(ch <-chan LaneEvent) { /* remove from map */ }
func (f *Fanout) Close() { /* mark closed, close all sub channels */ }
```

---

## 5. Server lifecycle and graceful shutdown

The current `runServe` calls `http.ListenAndServe` bare — no shutdown signal handling. SP1 must add:

```go
func runServe(args []string) error {
    // ... flag parsing, daemon construction, mux registration ...

    srv := &http.Server{
        Addr:        *addr,
        Handler:     mux,
        ReadTimeout: 10 * time.Second,
        // No WriteTimeout: SSE streams are long-lived.
        IdleTimeout: 120 * time.Second,
    }

    idleConnsClosed := make(chan struct{})
    go func() {
        sigCh := make(chan os.Signal, 1)
        signal.Notify(sigCh, os.Interrupt) // SIGTERM unreliable on Windows
        <-sigCh
        daemon.CancelAll() // cancel all in-flight lane runs
        ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
        defer cancel()
        _ = srv.Shutdown(ctx)
        close(idleConnsClosed)
    }()

    log.Printf("vibe serve listening on http://%s", *addr)
    if err := srv.ListenAndServe(); err != http.ErrServerClosed {
        return err
    }
    <-idleConnsClosed
    return nil
}
```

`daemon.CancelAll()` iterates the run registry under the mutex and calls each `cancel()`. In-flight lane goroutines observe `ctx.Done()` through `agent.RunLoop`'s context propagation and exit cleanly. The graceful shutdown window is 15 seconds.

---

## 6. Concurrency model

- **One daemon process, many concurrent lanes.** A semaphore (`chan struct{}`, cap = `MaxConcurrentLanes`, default 4) prevents unbounded goroutine explosion — matching the existing coordinator cap in `lanes/coordinator.go`.
- **One goroutine per lane run.** Each goroutine blocks on the `RunLoop` channel. No shared mutable state between lane goroutines.
- **One goroutine per SSE subscriber.** Each `handleLaneEvents` call owns its own `select` loop.
- **Fanout mutex is the only cross-goroutine lock.** Held briefly (ring append + per-sub channel send with a `default` drop). The run registry mutex is separate and equally brief.

---

## 7. Local-only security

### 7.1 Bind address

The daemon binds exclusively to `127.0.0.1:8787` (already the default in `serve.DefaultAddr`). This prevents any remote host from reaching the API. No change needed here.

### 7.2 The DNS-rebinding / CSRF threat

A malicious web page can make requests to `http://127.0.0.1:8787` via JavaScript. The larger risk: any browser tab can drive the daemon if no token is required. DNS rebinding can escalate this by making an attacker-controlled domain resolve to 127.0.0.1.

### 7.3 Shared-secret token

At startup, `vibe serve` generates a 32-byte cryptographically random token, writes it to a `0600` file, and requires it on every non-`/healthz` request via `Authorization: Bearer <token>`.

```go
// Token generation at daemon startup:
func generateToken() (string, error) {
    b := make([]byte, 32)
    if _, err := io.ReadFull(rand.Reader, b); err != nil { return "", err }
    return base64.URLEncoding.EncodeToString(b), nil
}
// Token file: %LOCALAPPDATA%\vibe\daemon.token  (mode 0600)
// Fallback:   <repo-root>/.vibe/daemon.token    (gitignored)

// Token validation middleware:
func (d *Daemon) requireToken(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
        if !hmac.Equal([]byte(got), []byte(d.token)) {
            http.Error(w, "unauthorized", http.StatusUnauthorized); return
        }
        next(w, r)
    }
}
```

`hmac.Equal` provides constant-time comparison to prevent timing attacks.

### 7.4 CORS headers

```go
func corsMiddleware(allowed []string, next http.Handler) http.Handler {
    allowedSet := map[string]bool{}
    for _, o := range allowed { allowedSet[o] = true }
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        origin := r.Header.Get("Origin")
        if allowedSet[origin] {
            w.Header().Set("Access-Control-Allow-Origin", origin)
            w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
            w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        }
        if r.Method == http.MethodOptions { w.WriteHeader(204); return }
        next.ServeHTTP(w, r)
    })
}
```

`--allow-origin` flag defaults to `http://localhost:3000`.

### 7.5 `Host` header check (DNS-rebinding hardening)

Reject requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`:

```go
func hostGuard(port string, next http.Handler) http.Handler {
    allowed := []string{"127.0.0.1:" + port, "localhost:" + port}
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        h := r.Host
        for _, a := range allowed {
            if h == a { next.ServeHTTP(w, r); return }
        }
        http.Error(w, "forbidden", http.StatusForbidden)
    })
}
```

The three controls stack: loopback bind → Host guard (DNS-rebind) → Bearer token (cross-tab isolation).

---

## 8. Configuration

| Flag | Default | Meaning |
|---|---|---|
| `--addr` | `127.0.0.1:8787` | Bind address (host part must stay 127.0.0.1) |
| `--provider` | `fake` | Default agent provider |
| `--max-lanes` | `4` | Concurrent lane semaphore capacity |
| `--allow-origin` | `http://localhost:3000` | Cockpit origin for CORS |
| `--token-file` | `%LOCALAPPDATA%\vibe\daemon.token` | Where to write/read the shared secret |
| `--plan` | `docs/examples/vibe-self-plan.json` | Default self-plan for the dashboard |

---

## 9. Cockpit discovery and startup

1. Cockpit's `VibeService` reads the token file path from `VIBE_TOKEN_FILE` env var (same default as the daemon flag).
2. On initialization it polls `GET http://127.0.0.1:8787/healthz` with a 1-second timeout.
3. If not up, Cockpit shows a "Start Vibe daemon" affordance. Clicking it shells out to `vibe serve` (path from `VIBE_BINARY` or `PATH`) as a detached child process, then polls `/healthz` until healthy (max 10 retries, 500 ms apart).
4. The token is read from the token file after the daemon is healthy. All subsequent API calls include `Authorization: Bearer <token>`.

On Windows, the child process must use `syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}` so it is not killed when the Next.js dev server restarts.

---

## 10. Open questions and risks

| # | Question / Risk | Severity |
|---|---|---|
| OQ-1 | `LaneEvent` contract (spike 05) not yet finalized — the `Inner agent.Event` wrapper shape may change to a flat schema. | Medium |
| OQ-2 | Approval gate timeout: if the user never approves, the lane goroutine blocks forever. Recommendation: `context.WithTimeout` wrapping the approval wait, default 1 hour, configurable. | High |
| OQ-3 | Late-joiner ring-buffer memory: 256 `LaneEvent`s ≈ 100 KB+ for token-heavy runs. Acceptable for SP1; SP2 should consider SQLite persistence. | Low (SP1) |
| OQ-4 | Windows signal handling: `syscall.SIGTERM` is unreliable on Windows. Graceful shutdown should listen only to `os.Interrupt` on Windows (build-tag guard). | Medium |
| OQ-5 | Token file race on first start: Cockpit may poll before the daemon writes the token file. Cockpit must retry both the healthz poll and the token file read together. | Low |
| OQ-6 | Port collision on 8787: add auto-retry on the next port and write the chosen port alongside the token file. | Low |
| OQ-7 | Detached process on Windows: Cockpit must use `CREATE_NEW_PROCESS_GROUP` when spawning the daemon; otherwise a Next.js restart kills it. | Medium |
| **OQ-8** | **Biggest risk: `agent.Provider` is turn-scoped, not lane-scoped.** `executeLane` bridges `RunLoop` to a lane, but "spawn N agents for N sub-lanes" is not in the SDK. Until spike 03 resolves agent spawning, `POST /v1/lanes/{id}/run` executes single-agent lanes only. Multi-agent fanout is blocked on spike 03. | **High** |

---

## 11. Summary

The existing stub (`go/cmd/vibe/main.go:190–253`, `go/internal/serve/serve.go`) is a functional SSE streaming daemon bound to `127.0.0.1:8787` with `GET /healthz`, `GET /v1/providers`, and `POST /v1/turn` already working. SP1 adds five new routes on top of the same `Daemon` struct — backed by a run registry, a fanout ring-buffer, and an `executeLane` goroutine that bridges `agent.RunLoop` to the `LaneEvent` stream.

Security is three-layered: loopback-only bind (existing), `Host` header guard for DNS-rebinding protection (new), and a startup-generated 32-byte bearer token written to a `0600` file that Cockpit reads before making any API call (new). No browser tab without the token can drive the daemon.

The biggest open risk is OQ-8: the Go SDK's `agent.Provider` is turn-scoped. Single-agent lane execution is unblocked today; multi-agent fanout depends on spike 03. SP1 should ship single-agent lanes first and treat fanout as an additive increment.
