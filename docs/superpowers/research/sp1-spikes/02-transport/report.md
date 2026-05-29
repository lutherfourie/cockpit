# Spike 02 — Transport selection for the Vibe LaneEvent stream

**Date:** 2026-05-29
**Status:** Draft — de-risking spike, not production code
**Author:** Claude Code (Sonnet 4.6) on behalf of Luther
**Scope:** SP1 of the Vibe×Cockpit roadmap
**Sibling doc (payload schema):** TBD — a parallel spike will define the `LaneEvent` JSON shape.

---

## 0. Context and what this spike decides

SP1 makes the Go daemon (`vibe serve`, currently at
`C:\vibe\go\cmd\vibe\main.go` + `C:\vibe\go\internal\serve\serve.go`)
the execution core that spawns `claude`/`codex` CLIs, runs lanes in
parallel, and emits a `LaneEvent` stream. Cockpit (Next.js 16, at
`C:\Users\4elut\Documents\Cockpit`) must:

1. **Server layer** — a Next.js route handler proxies the event stream from
   the Go daemon into the browser (pattern established in
   `src/app/api/agent/turn/route.ts` and `src/app/api/agent/selfdev/route.ts`).
2. **Browser client** — React components subscribe and render events live.

The existing `/v1/turn` endpoint in `serve.go` already emits SSE
(`text/event-stream`, `writeSSE` + `flusher.Flush()`) for single-agent turns.
SP1 introduces the `LaneEvent` multi-agent stream, which has more demanding
requirements: parallel lanes, long-lived executions (minutes to tens of
minutes), approval/interrupt signals flowing _back_ to the daemon, and the
possibility of many concurrent lane runs.

This spike compares four candidate transports and recommends one.

---

## 1. Candidate transports

### A — HTTP + SSE (Server-Sent Events)

**How it works.**
The daemon exposes a `GET /v1/lanes/{runId}/events` endpoint that writes
`text/event-stream` with `id:`, `event:`, and `data:` fields. The client
(Next.js route handler) opens a `fetch` call and pipes the body `ReadableStream`
straight to the browser. The browser uses the native `EventSource` API (or
a `fetch`-based polyfill for POST/auth flows).

**Streaming semantics.**
True server-push with line-buffered flushing. The daemon controls cadence;
each goroutine writing events calls `flusher.Flush()` after each `\n\n`.
Already proven in the repo — `serve.go` does exactly this via `writeSSE`.

**Backpressure.**
`net/http` on the Go side propagates TCP backpressure naturally: if the
browser stops reading, kernel buffers fill, `Write()` blocks, goroutines
pause. The Next.js proxy passes the `ReadableStream` unchanged; Node.js
streams honour backpressure end-to-end.

**Reconnection / resumability.**
The SSE protocol defines `Last-Event-ID`. The daemon can track `runId` state
in memory and replay missed events from a sequence number on reconnect. The
browser `EventSource` sends `Last-Event-ID` automatically. This is the
strongest resumability story of the four options.

**Event ordering.**
A single TCP connection delivers events in emission order. With multiple
concurrent lanes the daemon serialises writes per connection — events
interleave by time of emission, not by lane. Envelope fields on `LaneEvent`
(e.g. `laneId`, `seq`) let the client reconstruct per-lane order.

**Proxy/buffering pitfalls in Next.js route handlers.**
Next.js 16 App Router route handlers with `export const runtime = "nodejs"`
pass the daemon's `body: ReadableStream` directly to the `Response`
constructor, which streams through without buffering. This is confirmed
working in `src/app/api/agent/turn/route.ts` and
`src/app/api/agent/selfdev/route.ts` — both do exactly
`return new Response(daemonResponse.body, { headers: { "Content-Type":
"text/event-stream" } })`. The only gotcha is Vercel Edge runtime, which
does NOT support `runtime = "nodejs"` and will buffer at the CDN layer.
Since Cockpit runs locally (or in the portable Docker image), this is not
a concern for SP1.

**Browser API ergonomics.**
`EventSource` is native in all modern browsers, requires zero libraries,
and auto-reconnects. Its one limitation: it only works over GET and cannot
carry a request body. For SP1 the run is started via a separate POST
(`POST /v1/lanes/start`); the SSE stream is opened GET with `runId` in
the path.

**Bidirectional needs (approvals).**
SSE is server-to-client only. Approval/interrupt signals flow back via a
separate POST (`POST /v1/lanes/{runId}/approve`, `/cancel`). REST callbacks
are well-understood, independently testable, and idempotent. The daemon
correlates by `runId`.

**Fan-out (many concurrent agents).**
Each lane run opens one SSE connection. Go goroutines are cheap; 50
concurrent SSE streams cost tens of MB. The Next.js side opens one `fetch`
per lane run; Node.js HTTP/1.1 keep-alive handles this fine.

**Summary:** proven in the codebase, resumable, zero new dependencies.

---

### B — WebSocket

**How it works.**
The daemon upgrades `GET /v1/lanes/{runId}/ws` to WebSocket; Cockpit's
route handler proxies the WebSocket frames to the browser.

**Streaming semantics.**
Full-duplex binary or text frames. Ideal for interactive two-way protocols
(e.g., approval dialogs that require a response within the channel).

**Backpressure.**
WebSocket does not define application-level backpressure. Flow control must
be implemented manually (credits, acks). Under load this is error-prone.

**Reconnection / resumability.**
No built-in `Last-Event-ID` equivalent. Reconnection and event replay must
be implemented from scratch — significant engineering cost.

**Proxy pitfalls in Next.js route handlers.**
WebSocket proxying from a Next.js App Router route handler is **not
supported**. The App Router handles HTTP request/response pairs; WebSocket
upgrade requires lower-level access (Node.js `http.Server` `upgrade` event).
Workarounds (custom server, separate WS port) break the clean route-handler
pattern and require either ejecting from `next start` or running a sidecar.
This is a major integration friction point.

**Bidirectional needs.**
WebSocket's strong suit — both directions share one channel. But for the
approval use-case, a REST POST is equally expressive and simpler to secure
and audit.

**Summary:** overkill bidirectionality at the cost of proxy complexity and
missing resumability. Ruled out for SP1.

---

### C — NDJSON over HTTP (chunked transfer encoding)

**How it works.**
The daemon sets `Transfer-Encoding: chunked` and writes newline-delimited
JSON objects with `flusher.Flush()` after each line. The client reads the
`ReadableStream` and splits on `\n`.

**Streaming semantics.**
Equivalent to SSE in practice: server push, line buffered. Slightly simpler
to produce on the Go side (no SSE framing overhead).

**Backpressure.**
Same TCP-level backpressure as SSE.

**Reconnection / resumability.**
No protocol-level `Last-Event-ID`. Must be implemented at the application
layer (pass `?since=<seq>` query param). Less ergonomic than SSE's native
support.

**Proxy pitfalls in Next.js.**
Same `ReadableStream` passthrough pattern as SSE. Browsers consume chunked
JSON via `fetch` + streaming body reader, which requires a `TextDecoder`
plus line-split loop in the client. More boilerplate than `EventSource`.

**Browser API ergonomics.**
`EventSource` is not applicable. The browser must use `fetch` with
`response.body.getReader()`, decode chunks, and accumulate a line buffer.
Doable but ~30 lines of careful stream-reading code per call site. No
auto-reconnect.

**Summary:** equivalent streaming power to SSE but trades away `EventSource`
ergonomics and native reconnect for marginal server-side simplicity. Not
worth the trade-off when SSE is already implemented in the repo.

---

### D — NDJSON over stdio (daemon as child process)

**How it works.**
Cockpit launches `vibe serve` as a child process via Node.js
`child_process.spawn`. Events arrive on `stdout`; control messages are
written to `stdin`.

**Streaming semantics.**
Synchronous, in-process pipe. Lowest latency. No network stack.

**Backpressure.**
Pipe buffers (64 KB on Linux) provide natural backpressure. If Cockpit
stops reading, the daemon blocks on `os.Stdout.Write()`.

**Reconnection / resumability.**
None. If Cockpit restarts, the daemon process is gone. All in-flight lane
state is lost unless the daemon writes a checkpoint file separately.

**Proxy pitfalls in Next.js.**
The daemon process must be started at Cockpit server startup time (in a
custom server or via Next.js `instrumentation.ts` on Node runtime). The
process is shared across all route handlers via a module-level singleton.
This is an anti-pattern in the App Router and incompatible with horizontal
scaling. Passing events from the child process to the browser still requires
the same SSE/chunked stream in the route handler — stdio just replaces the
HTTP leg between Cockpit and the daemon.

**Fan-out.**
All lane events must be multiplexed through a single pipe. The daemon must
tag `runId` and the Cockpit side must demultiplex. Added complexity for no
benefit.

**Summary:** lowest latency but eliminates independent restartability.
Rules out horizontal scaling. A meaningful regression from the current
architecture where the daemon already speaks HTTP.

---

## 2. Evaluation matrix

| Criterion | A — SSE | B — WebSocket | C — NDJSON/HTTP | D — NDJSON/stdio |
|---|---|---|---|---|
| Streaming semantics | Server push, flushed | Full-duplex frames | Server push, flushed | Pipe, in-process |
| Backpressure | TCP (native) | Manual (no protocol) | TCP (native) | Pipe buffer |
| Reconnect / resume | Native `Last-Event-ID` | Manual from scratch | Manual (`?since=seq`) | None |
| Event ordering | Emission order + envelope | Emission order | Emission order + envelope | Emission order |
| Next.js proxy | Works today (proven) | Not supported in App Router | Works (same pattern) | Requires custom server |
| Browser API | `EventSource` (native) | `WebSocket` (native) | `fetch` + reader loop | N/A |
| Bidirectional | REST POST callbacks | Single channel | REST POST callbacks | stdin (fragile) |
| Fan-out | One conn per run | One conn per run | One conn per run | Multiplexed on one pipe |
| Implementation cost | Very low (pattern exists) | High (WS proxy) | Low | Medium-High |
| Resumability on restart | High | Low | Medium | None |

---

## 3. Recommendation

**Use SSE (option A).**

Rationale:

1. **It already works.** `serve.go` emits `text/event-stream` for `/v1/turn`.
   The Next.js proxy pattern is validated in `src/app/api/agent/turn/route.ts`
   and `src/app/api/agent/selfdev/route.ts`. SP1 extends the same pattern to a
   new `/v1/lanes/{runId}/events` endpoint — the risk surface is minimal.

2. **Native resumability.** `Last-Event-ID` plus a small event log in the daemon
   gives Cockpit free reconnect semantics. Lane runs last minutes; the browser
   tab may navigate away and return. No other option delivers this without
   significant custom code.

3. **Browser ergonomics.** `EventSource` is two lines in React. No third-party
   streaming library needed.

4. **Approvals via REST are sufficient.** Approval gates are infrequent (once
   per lane step at most). A POST to `/v1/lanes/{runId}/approve` is simpler to
   secure, log, and test than a bidirectional WebSocket channel.

5. **Go side is trivial.** The pattern is already in `writeSSE` in `serve.go`.
   Extending it for lane fan-out is a loop over a `chan LaneEvent` per run.

**Fallback: NDJSON/HTTP (option C).** If SSE's `EventSource` GET-only
constraint becomes a problem (e.g., needing JWT in the request body rather
than a header), switch the browser to a `fetch` streaming reader. The daemon
and Next.js proxy require zero changes (chunked JSON is SSE without framing
overhead); only the browser client changes.

---

## 4. Minimal code sketch (SSE — recommended option)

The snippets below are illustrative only. SP1 implementation is governed
by its own spec and plan.

### 4.1 Go daemon — lane-stream endpoint

```go
// Sketch: new handler in C:\vibe\go\internal\serve\ (SP1)
// NOT production code.

// LaneEvent is the typed event envelope.
// The `data` field schema is defined in the payload spike.
type LaneEvent struct {
    RunID  string          `json:"runId"`
    LaneID string          `json:"laneId"`
    Seq    int64           `json:"seq"`
    Kind   string          `json:"kind"` // "step"|"tool_call"|"approval_needed"|"done"|"error"
    Data   json.RawMessage `json:"data"`
}

// laneRun holds the live event channel and a replay log.
type laneRun struct {
    mu     sync.Mutex
    log    []LaneEvent   // append-only; used for Last-Event-ID replay
    events chan LaneEvent // closed by the executor when the run completes
}

// handleLaneEvents serves GET /v1/lanes/{runId}/events
func (d *Daemon) handleLaneEvents(w http.ResponseWriter, r *http.Request) {
    runID := extractRunID(r.URL.Path)
    run := d.registry.get(runID)
    if run == nil {
        http.NotFound(w, r)
        return
    }

    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming unsupported", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    w.Header().Set("X-Accel-Buffering", "no") // prevent nginx buffering

    // Replay missed events on reconnect.
    var since int64
    if raw := r.Header.Get("Last-Event-ID"); raw != "" {
        since, _ = strconv.ParseInt(raw, 10, 64)
    }
    run.mu.Lock()
    replay := append([]LaneEvent(nil), run.log[since:]...)
    run.mu.Unlock()
    for _, ev := range replay {
        writeSSELaneEvent(w, ev)
        flusher.Flush()
    }

    // Stream live events until run ends or client disconnects.
    for {
        select {
        case ev, ok := <-run.events:
            if !ok {
                return // channel closed — run complete
            }
            writeSSELaneEvent(w, ev)
            flusher.Flush()
        case <-r.Context().Done():
            return // client disconnected
        }
    }
}

func writeSSELaneEvent(w http.ResponseWriter, ev LaneEvent) {
    raw, _ := json.Marshal(ev)
    fmt.Fprintf(w, "id: %d\nevent: lane\ndata: %s\n\n", ev.Seq, raw)
}
```

### 4.2 Next.js route handler proxy

```typescript
// Sketch: src/app/api/cockpit/lanes/[runId]/events/route.ts  (SP1)
// Pattern identical to the proven src/app/api/agent/turn/route.ts

export const runtime = "nodejs"; // required — Edge runtime would buffer SSE

const DAEMON_URL = process.env.VIBE_DAEMON_URL ?? "http://127.0.0.1:8787";

export async function GET(
  request: Request,
  { params }: { params: { runId: string } },
): Promise<Response> {
  const { runId } = params;

  // Forward Last-Event-ID so the daemon can replay missed events.
  const upstreamHeaders: HeadersInit = {};
  const lastEventId = request.headers.get("Last-Event-ID");
  if (lastEventId) upstreamHeaders["Last-Event-ID"] = lastEventId;

  let daemonResponse: Response;
  try {
    daemonResponse = await fetch(
      `${DAEMON_URL}/v1/lanes/${encodeURIComponent(runId)}/events`,
      { headers: upstreamHeaders, signal: request.signal },
    );
  } catch {
    return sseError(`Vibe daemon unreachable at ${DAEMON_URL}`);
  }

  if (!daemonResponse.ok || !daemonResponse.body) {
    return sseError(`Daemon returned ${daemonResponse.status}`);
  }

  // Pass the ReadableStream through — no buffering, no transformation.
  // Same pattern as src/app/api/agent/turn/route.ts (proven).
  return new Response(daemonResponse.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function sseError(message: string): Response {
  const body =
    `event: error\ndata: ${JSON.stringify({ message })}\n\n` +
    `event: done\ndata: {}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
```

### 4.3 Browser React hook

```typescript
// Sketch: src/lib/cockpit/use-lane-events.ts  (SP1)

import { useEffect, useRef, useState } from "react";

export type LaneEvent = {
  runId: string;
  laneId: string;
  seq: number;
  kind: "step" | "tool_call" | "approval_needed" | "done" | "error";
  data: unknown;
};

/** Subscribes to a lane execution stream via EventSource. Auto-reconnects. */
export function useLaneEvents(runId: string | null) {
  const [events, setEvents] = useState<LaneEvent[]>([]);
  const [isDone, setIsDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setIsDone(false);

    const url = `/api/cockpit/lanes/${encodeURIComponent(runId)}/events`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("lane", (e: MessageEvent) => {
      const ev: LaneEvent = JSON.parse(e.data as string);
      setEvents((prev) => [...prev, ev]);
      if (ev.kind === "done" || ev.kind === "error") {
        setIsDone(true);
        es.close();
      }
    });

    // EventSource auto-reconnects on error using Last-Event-ID.
    // Close explicitly only when the run is already complete.
    es.addEventListener("error", () => {
      if (isDone) es.close();
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { events, isDone };
}
```

### 4.4 Approval callback (bidirectional signal via REST)

```typescript
// Sketch: src/app/api/cockpit/lanes/[runId]/approve/route.ts  (SP1)
// Browser POSTs { stepId, decision: "approve" | "reject" }.
// Route handler forwards to daemon; daemon unblocks the lane goroutine.

export const runtime = "nodejs";
const DAEMON_URL = process.env.VIBE_DAEMON_URL ?? "http://127.0.0.1:8787";

export async function POST(
  request: Request,
  { params }: { params: { runId: string } },
): Promise<Response> {
  const body = await request.json();
  const res = await fetch(
    `${DAEMON_URL}/v1/lanes/${encodeURIComponent(params.runId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
```

---

## 5. Open questions and risks

### 5.1 Nginx / reverse-proxy buffering (HIGH)
If Cockpit is ever placed behind nginx (even locally for HTTPS), nginx
buffers `text/event-stream` by default unless `X-Accel-Buffering: no` is
set on the response. The daemon sketch above includes this header. The
Next.js proxy must re-emit it explicitly — the `new Response(body, { headers })`
constructor only sets the headers listed; upstream headers are not forwarded
automatically. **Action before SP1 ships:** verify header propagation
end-to-end; add an integration test confirming events arrive before the
connection closes when nginx is in the path.

### 5.2 Node.js fetch streaming under long-duration runs (MEDIUM)
Node.js 18+ ships undici as the native `fetch`. In practice, undici streams
response bodies correctly, but there are known edge cases with backpressure
and early connection close when the downstream reader disconnects abruptly.
The existing `turn/route.ts` has not been stress-tested for long-running
executions (minutes, thousands of events). **Action before SP1 ships:**
load-test the proxy with a synthetic high-frequency event emitter; confirm
no silent drops or hangs under a 10-minute, 5000-event run.

### 5.3 EventSource and authentication (MEDIUM)
The native `EventSource` API does not support custom request headers (e.g.,
`Authorization: Bearer <token>`). If lane-event routes are protected by JWT
(rather than session cookies), `EventSource` cannot carry the token.
Workarounds: (a) pass a short-lived one-time token in the query string; (b)
switch the browser to a `fetch`-based streaming reader (the NDJSON/HTTP
fallback — no daemon change needed). **Action in SP1 design:** decide whether
lane-event endpoints require auth, and if JWT is mandatory, pre-commit to
the `fetch` reader path.

### 5.4 Replay log growth (LOW-MEDIUM)
The in-memory replay log grows unbounded for long runs. For SP1 short spike
executions this is acceptable. Before production: cap the log (e.g., last
1000 events) and document the eviction cursor; warn clients whose
`Last-Event-ID` has been evicted. The correct long-term answer is a durable
`lane_events` Supabase table, which aligns with the memory-bridge work at
`origin/claude/cockpit-vibe-memory-bridge-2026-05-27`.

### 5.5 Goroutine lifecycle on client disconnect (LOW for SP1)
When the browser tab closes mid-run, the SSE handler's `r.Context().Done()`
fires — but lane goroutines continue unless they also watch a cancellation
context derived from the run lifecycle. **Action in SP1:** every lane-
spawning goroutine must select on a per-run `context.CancelFunc` that fires
on client disconnect OR explicit `/cancel` POST. Include a goroutine-leak
test before marking SP1 complete.

### 5.6 Windows loopback performance (LOW)
The Go daemon and Next.js process are co-located on the same Windows 11
machine. TCP loopback performs well (sub-millisecond). WSL2 network bridging
can introduce latency spikes, but SP1 is pure native/Docker; WSL2 is SP2
territory.

---

## 6. Decision summary

| | |
|---|---|
| **Recommended transport** | SSE (`text/event-stream`) with `Last-Event-ID` |
| **Why** | Already proven in the codebase; native browser reconnect; zero new dependencies; backpressure via TCP; approvals via REST POST |
| **Fallback** | NDJSON/HTTP — swap only the browser client; daemon and proxy unchanged |
| **Ruled out** | WebSocket (App Router proxy not supported); stdio (breaks independent restartability) |
| **Biggest open risk** | Proxy buffering — nginx and Node.js `fetch` streaming behaviour under long-duration, high-frequency event streams must be integration-tested before SP1 is declared production-ready |
