# Spike 03 -- Spawning claude/codex CLI Subprocesses from Go with Goroutine Fan-out

**Date:** 2026-05-29
**Status:** SPIKE -- de-risking only; no production code
**Owner:** Luther
**SP:** SP1 -- Real lane execution (Vibe Go SDK first)
**North-star:** "Cockpit develops itself." The Vibe Go daemon spawns claude/codex CLIs as subprocesses, runs many in parallel via goroutines, and streams their events back to Cockpit.

---

## 1. Purpose and Scope

This spike answers one question: **how do we spawn N claude/codex CLI agents concurrently from Go, merge their event streams onto a single channel, and handle all the failure modes gracefully on Windows?**

This is a de-risking exercise. The code snippets below are illustrative sketches grounded in the *existing* Go SDK patterns already live in C:\vibe\go\agent\ and its adapters.

---

## 2. Existing Art to Build On

| File | What it already solves |
|---|---|
| go/agent/adapters/claude/claude.go | os/exec process construction, Windows .cmd shim awareness, stdin-as-prompt workaround, stderr buffering, wait() error capture |
| go/agent/adapters/claude/parse.go | Full NDJSON parser for --output-format stream-json events to agent.Event typed Go structs |
| go/agent/adapters/codex/codex.go | Same pattern for codex exec; normalizes non-streaming stdout into a single text_delta + done |
| go/agent/event.go + go/agent/types.go | Provider-neutral agent.Event sum type: text_delta, tool_call, tool_result, usage, error, done |
| go/agent/loop.go | Single-agent turn loop with context cancellation |
| go/internal/lanes/coordinator.go | Worker-pool pattern: jobs channel, bounded goroutine count, sync.WaitGroup, context-aware fan-out |
| go/experiments/gopher-lane-demo/main.go | Multi-goroutine message-passing demo; inboxes + peer routing + heartbeat |
| go/internal/serve/serve.go | HTTP daemon already streaming agent.Event as SSE; POST /v1/turn is the per-agent surface to extend |

The fan-out design is coordinator.go worker pool applied to claude.Provider.RunTurn calls.

---

## 3. Process Construction

### 3.1 Claude CLI

The claude binary on Windows ships as claude.cmd. exec.LookPath("claude") resolves this correctly because PATHEXT includes .CMD. The existing realRunner.Run in claude.go already handles this.

```go
path, _ := exec.LookPath("claude")
cmd := exec.CommandContext(ctx, path,
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
)
cmd.Dir = agentCwd // target repo or per-agent worktree

// Inherit the full parent env so PATHEXT, APPDATA, etc carry through.
// NEVER log, print, or embed CLAUDE_CODE_OAUTH_TOKEN.
// The token lives as a Windows user env var -- os.Environ() includes it silently.
cmd.Env = os.Environ()

// Prompt via stdin -- avoids cmd.exe mangling multi-line args on Windows.
// This is the documented workaround in claude.go buildArgs.
cmd.Stdin = strings.NewReader(prompt)

var stderr bytes.Buffer
cmd.Stderr = &stderr
stdout, _ := cmd.StdoutPipe()
cmd.Start()
```

os.Environ() is the only correct approach. No code should call os.Getenv("CLAUDE_CODE_OAUTH_TOKEN") and store or format the result -- the token must flow silently through os.Environ() only.

### 3.2 Codex CLI

codex exec (v0.130.0) does not emit NDJSON. It prints the final answer to stdout and exits. The existing codex.go handles this: read all stdout after cmd.Wait(), emit one text_delta + done.

```go
cmd := exec.CommandContext(ctx, "codex",
    "exec",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    prompt, // safe as a single arg for codex (unlike claude on Windows)
)
cmd.Dir = agentCwd
cmd.Env = os.Environ()
```

### 3.3 Context Cancellation and Kill on Windows

exec.CommandContext calls cmd.Process.Kill() on context cancellation on Windows -- abrupt SIGKILL equivalent, no graceful shutdown. This is acceptable for short-lived agent turns. The daemon context tree ensures kills propagate when a lane is cancelled from Cockpit.

Graceful CTRL_C_EVENT via golang.org/x/sys/windows.GenerateConsoleCtrlEvent is available but complex; defer to SP2 unless agents need explicit cleanup hooks.

---

## 4. Parsing claude --output-format stream-json Events

The parser in go/agent/adapters/claude/parse.go is complete and tested. The stream is newline-delimited JSON.

| type field | Produces |
|---|---|
| init / system | Captures session_id; no event emitted |
| stream_event with inner text_delta | agent.EventKindTextDelta |
| stream_event with inner tool_use | agent.EventKindToolCall |
| stream_event with inner tool_result | agent.EventKindToolResult |
| result | agent.EventKindUsage + agent.EventKindDone |

The scanner uses a 10 MB per-line buffer (maxStreamJSONLineBytes). bufio.Scanner is correct here; do not switch to json.Decoder line-by-line.

For codex, normalization to agent.Event types means the fan-out merger does not need to know which CLI produced which event.

---

## 5. Multiplexed Event Channel with Per-Agent Tagging

The merged channel must carry context for Cockpit to route events to the right lane/panel.

```go
// AgentEvent is the tagged event type on the merged channel.
// All fields are value-safe to send across goroutine boundaries.
type AgentEvent struct {
    AgentID  string      // stable lane/task identifier
    Provider string      // "claude" or "codex"
    Cwd      string      // worktree or repo path this agent ran in
    Event    agent.Event // provider-neutral payload
    ExitCode int         // set on terminal event; 0 = success
}
```

---

## 6. Goroutine Fan-out with Bounded Worker Pool

This mirrors go/internal/lanes/coordinator.go exactly, extended to real CLI subprocess runs.

```go
type SpawnConfig struct {
    MaxConcurrent int           // semaphore width; 0 -> len(tasks)
    Timeout       time.Duration // per-agent deadline; 0 -> no extra timeout
}

type AgentTask struct {
    ID       string
    Provider string // "claude" | "codex"
    Cwd      string // repo root or per-agent worktree
    Prompt   string
}

// SpawnAll fans tasks onto a bounded worker pool and returns a merged event channel.
// Caller must drain the channel until it closes.
// Cancelling parent propagates immediately to all in-flight agent subprocesses.
func SpawnAll(
    parent         context.Context,
    tasks          []AgentTask,
    cfg            SpawnConfig,
    claudeProvider *claudeadapter.Provider,
    codexProvider  *codexadapter.Provider,
) <-chan AgentEvent {
    merged := make(chan AgentEvent, 64)

    maxWorkers := cfg.MaxConcurrent
    if maxWorkers <= 0 || maxWorkers > len(tasks) {
        maxWorkers = len(tasks)
    }

    jobs := make(chan AgentTask, len(tasks))
    for _, t := range tasks {
        jobs <- t
    }
    close(jobs)

    var wg sync.WaitGroup
    wg.Add(maxWorkers)
    for i := 0; i < maxWorkers; i++ {
        go func() {
            defer wg.Done()
            for task := range jobs {
                runAgentTask(parent, task, cfg.Timeout, claudeProvider, codexProvider, merged)
            }
        }()
    }

    // Close merged only after all workers finish -- safe; no concurrent send after close.
    go func() {
        wg.Wait()
        close(merged)
    }()

    return merged
}

func runAgentTask(
    parent  context.Context,
    task    AgentTask,
    timeout time.Duration,
    claude  *claudeadapter.Provider,
    codex   *codexadapter.Provider,
    merged  chan<- AgentEvent,
) {
    ctx := parent
    var cancel context.CancelFunc
    if timeout > 0 {
        ctx, cancel = context.WithTimeout(parent, timeout)
        defer cancel()
    }

    req := agent.TurnRequest{
        Cwd:            task.Cwd,
        PermissionMode: "bypassPermissions",
        Messages:       []agent.Message{{Role: agent.RoleUser, Content: task.Prompt}},
    }

    var events <-chan agent.Event
    var err error
    switch task.Provider {
    case "claude":
        events, err = claude.RunTurn(ctx, req)
    case "codex":
        events, err = codex.RunTurn(ctx, req)
    default:
        err = fmt.Errorf("unknown provider %q", task.Provider)
    }

    if err != nil {
        send(parent, merged, AgentEvent{
            AgentID: task.ID, Provider: task.Provider, Cwd: task.Cwd,
            Event: agent.ErrorEvent(err.Error()), ExitCode: 1,
        })
        return
    }

    exitCode := 0
    for ev := range events {
        if ev.Kind == agent.EventKindError {
            exitCode = 1
        }
        envelope := AgentEvent{
            AgentID: task.ID, Provider: task.Provider, Cwd: task.Cwd, Event: ev,
        }
        if ev.Kind == agent.EventKindDone || ev.Kind == agent.EventKindError {
            envelope.ExitCode = exitCode
        }
        if !send(parent, merged, envelope) {
            return // parent cancelled; subprocess killed via context
        }
    }
}

func send(ctx context.Context, ch chan<- AgentEvent, ev AgentEvent) bool {
    select {
    case <-ctx.Done():
        return false
    case ch <- ev:
        return true
    }
}
```

Key properties:

- **Bounded concurrency:** maxWorkers goroutines pull from a closed jobs channel; no goroutine leaks.
- **Partial failure isolation:** one agent error does not cancel others; per-task ExitCode lets Cockpit render per-lane status.
- **Back-pressure safe:** buffer-64 merged channel; send blocks on slow consumer but always unblocks on ctx.Done().
- **No secrets in events:** AgentEvent fields never include the OAuth token.

---

## 7. Per-Agent Worktree Isolation

Each agent should run in its own git worktree to prevent file conflicts when multiple claude agents write to the same repo simultaneously.

```
git worktree add --detach /tmp/vibe-agent-<id> <base-branch>
# set task.Cwd = /tmp/vibe-agent-<id>
# after agent completes: git worktree remove /tmp/vibe-agent-<id>
```

For SP1, the simplest mitigation is read-only mode (--permission-mode plan or --tools ""), making worktree isolation optional. Full write-isolation belongs to SP1.5.

---

## 8. Wiring Into vibe serve (Daemon Extension Point)

go/internal/serve/serve.go already has POST /v1/turn with SSE streaming. SP1 adds:

```
POST /v1/lane/run
Body:     { "tasks": [...AgentTask], "maxConcurrent": 4 }
Response: text/event-stream  (each SSE data line = AgentEvent JSON)
```

The handler calls SpawnAll, drains the merged channel, writes each AgentEvent as a data: SSE line. Cockpit VibeService consumes via EventSource or fetch + ReadableStream. No new binary needed -- the daemon starts from go/cmd/vibe/main.go.

---

## 9. Codex Streaming Gap

codex exec (v0.130.0) has no --output-format stream-json equivalent. Only the final answer arrives after the process exits.

Mitigations:

1. **SP1:** accept the buffered model. Cockpit shows a per-agent spinner until done arrives.
2. **Later:** codex exec-server ([EXPERIMENTAL]) and codex mcp-server expose richer surfaces; spike separately if mid-turn streaming is required.

---

## 10. Secret Handling Rules

| Rule | Implementation |
|---|---|
| CLAUDE_CODE_OAUTH_TOKEN must never be logged | Pass via os.Environ() only; never call os.Getenv and store or format the result |
| Token must never appear in AgentEvent fields | AgentEvent carries: AgentID, Provider, Cwd, Event, ExitCode only |
| Token must never appear in any source file | Design uses os.Environ() exclusively; no hardcoded value |
| Cockpit SSE stream must not leak token | SSE payload is AgentEvent JSON; token is never a field |

---

## 11. Open Questions and Risks

### 11.1 Windows-specific risks

**exec.CommandContext kill is abrupt.** On Windows, context cancellation calls cmd.Process.Kill() with no graceful shutdown. If claude has an in-progress file write, the file may be truncated. Mitigation for SP1: read-only permission mode. Evaluate graceful CTRL_C_EVENT via golang.org/x/sys/windows if cleanup hooks become required.

**claude.cmd cold-start latency.** claude.cmd invokes node through an extra shell hop. Cold Node.js JIT adds 3-5 seconds before the first NDJSON line. The merged channel buffer absorbs this; Cockpit must show a per-agent "starting..." state distinct from "streaming" to avoid appearing frozen.

**PATHEXT in stripped environments.** In Docker or CI containers without PATHEXT, exec.LookPath(".cmd") resolution may fail. Resolve claude and codex absolute paths at daemon startup via exec.LookPath once and cache them; pass absolute paths to exec.CommandContext.

### 11.2 Concurrency risks

**Memory at high fan-out.** Each claude worker spawns a Node.js process. Default maxWorkers=4 for SP1; expose the knob via daemon config and document the RAM implications.

**Claude session file collisions.** Multiple concurrent agents writing to APPDATA\Claude\ can collide on session files. Use --no-session-persistence (confirmed in claude --help) for fire-and-forget agents, or unique --session-id per task.

### 11.3 Codex UX risk

A codex agent running a 60-second task appears hung with no feedback. The per-agent spinner is a required SP1 deliverable before any user-facing lane execution.

### 11.4 Logging middleware leaking the OAuth token (highest priority)

If any structured-logging middleware captures cmd.Env (e.g., slog.Any("cmd", cmd)), CLAUDE_CODE_OAUTH_TOKEN appears in logs. The daemon must explicitly exclude subprocess Env slices from all log output. This is the single highest-priority risk: add a code review checklist item and consider a linter rule to enforce it.

---

## 12. Recommended Fan-out Model

Build directly on go/agent/adapters/claude.Provider.RunTurn and go/agent/adapters/codex.Provider.RunTurn -- do not re-implement process spawning. The fan-out layer is a thin SpawnAll function (sketched in section 6) that:

1. Wraps each RunTurn result channel in a goroutine that forwards tagged AgentEvent envelopes to a single merged channel.
2. Uses a closed jobs channel + fixed worker-pool goroutines -- directly mirrors go/internal/lanes/coordinator.go.
3. Closes merged only after sync.WaitGroup.Wait() -- no concurrent-send-after-close.
4. Injects context.WithTimeout per agent for per-task deadline control independent of the parent context.

Wire the merged channel into go/internal/serve/serve.go as a new POST /v1/lane/run SSE handler. No new binary. No new concurrency primitives beyond what already exists in the repo.

---

## 13. Files Referenced

- C:\vibe\go\agent\adapters\claude\claude.go -- process spawning, stdin workaround, stderr capture
- C:\vibe\go\agent\adapters\claude\parse.go -- NDJSON parser for stream-json
- C:\vibe\go\agent\adapters\codex\codex.go -- codex exec runner
- C:\vibe\go\agent\event.go -- agent.Event type definitions
- C:\vibe\go\agent\provider.go -- agent.Provider interface and TurnRequest
- C:\vibe\go\agent\loop.go -- single-agent turn loop
- C:\vibe\go\internal\lanes\coordinator.go -- worker-pool pattern to clone for fan-out
- C:\vibe\go\experiments\gopher-lane-demo\main.go -- goroutine message-passing reference
- C:\vibe\go\internal\serve\serve.go -- SSE daemon and extension point for /v1/lane/run