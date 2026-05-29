# SP1 · LaneEvent Stream Contract

**Status:** DRAFT  
**Date:** 2026-05-29  
**Owner:** Luther  
**Sibling docs:** 02 (transport), 06 (cockpit adapter), 07 (vibe serve), 09 (approvals)

---

## 1. Purpose and scope

This document is the **authoritative definition** of the typed event stream that flows from the Vibe Go daemon to Cockpit during lane execution. Every other SP1 doc treats this spec as read-only ground truth.

The stream is the single seam between Go and TypeScript. Neither side may invent event shapes that are not defined here without a versioned update to this spec first.

**What is in scope:**
- The event envelope (shared fields on every event)
- The full event taxonomy with per-event payload fields
- Authoritative JSON Schema (draft-2020-12)
- Generated Go struct bindings (with `json:` tags)
- Generated TypeScript discriminated-union bindings
- Ordering, resumability, and seq semantics
- A versioning strategy

**What is out of scope:** transport framing (doc 02), Cockpit adapter implementation (doc 06), `vibe serve` HTTP layer (doc 07), approval gate UX (doc 09).

---

## 2. Grounding

The existing Cockpit `LaneEvent` type lives in  
`src/lib/plugins/contract/types.ts` and carries eight variants:  
`start`, `todo`, `tool_call`, `tool_result`, `log`, `file_write`, `final`, `error`.

That type is **used only inside Cockpit's in-process TS plugin today** — it has no seq, no agent scope, and no approval or verification events. SP1 replaces this shape as the Go-native event emitter and promotes the TS type to a generated consumer binding (the in-process plugin becomes a thin adapter; doc 06).

The existing Vibe `agent.Event` type (`go/agent/types.go`) carries `EventKindDone` / `EventKindError` only — it is the per-turn provider event, not the lane-level orchestration event. The new `LaneEvent` lives one layer above it and wraps it.

---

## 3. Stream characteristics

- **Encoding:** one JSON object per line (NDJSON), no trailing comma, terminated by `\n`.  
- **Transport:** HTTP SSE (`data: <json>\n\n`) for browser consumers; raw NDJSON over TCP or stdio for CLI consumers. Framing is defined in doc 02; this spec is framing-agnostic.  
- **Direction:** Go daemon → Cockpit (and optionally CLI). The stream is append-only and unidirectional; approval responses travel back via a separate HTTP POST (doc 09).  
- **Termination:** the stream closes naturally after a `lane.completed` or `lane.error` terminal event. Consumers MUST treat a dropped connection without a terminal event as an implicit `lane.error`.

---

## 4. Envelope

Every event, regardless of type, carries these top-level fields. Payload fields are merged into the same JSON object (flat envelope, not nested).

| Field | Type | Required | Description |
|---|---|---|---|
| `v` | `integer` | yes | Schema version. `1` for all events defined in this spec. |
| `id` | `string` (UUID v4) | yes | Globally unique event ID. Consumers may use this as an idempotency key. |
| `seq` | `integer` (uint64) | yes | Monotonically increasing, per-lane, starting at `1`. The first event in a lane run is always `seq=1`. Never reused within a run. |
| `laneId` | `string` | yes | Stable identifier matching `LaneSummary.laneId` from `src/lib/plugins/contract/types.ts`. |
| `runId` | `string` (UUID v4) | yes | Unique identifier for this specific execution run of the lane. A lane may run many times; `runId` distinguishes them. |
| `agentId` | `string` or `null` | yes | Identifies the spawned agent process that emitted this event. `null` for events emitted by the orchestrator itself (e.g. `lane.started`, `lane.completed`). |
| `ts` | `string` (RFC 3339, millisecond precision) | yes | Wall-clock timestamp when the event was emitted by the Go daemon. |
| `type` | `string` (enum) | yes | Discriminant. See taxonomy in §5. |
| *(payload fields)* | varies | — | Additional fields defined per event type. Merged at top level. |

**Ordering guarantee:** The Go daemon MUST emit events with strictly increasing `seq` within a single `(laneId, runId)` pair. Consumers that buffer events for replay MUST sort by `seq`, not by `ts`, as wall-clock skew can cause `ts` inversion across goroutines.

**Resumability:** A Cockpit SSE consumer MUST send `Last-Event-ID: <id>` on reconnect (using the SSE standard header). The `vibe serve` endpoint MUST buffer the last N events (default 200) and replay events with `seq` greater than the last acknowledged one. For NDJSON streams without SSE, consumers use the `seq` field directly: reconnect with `?after_seq=<n>` to skip already-processed events.

---

## 5. Event taxonomy

### 5.1 Lane lifecycle

#### `lane.started`

Emitted once, immediately, when the orchestrator begins executing a lane run. Always `seq=1`.

| Field | Type | Description |
|---|---|---|
| `laneSpec` | `object` | Snapshot of the lane definition at execution time. Fields: `name`, `description`, `reads`, `owns`, `tools`, `model`, `approval`, `verify`. |
| `triggerSource` | `string` | `"cockpit_ui"` \| `"cli"` \| `"api"` |

#### `lane.completed`

Terminal. Emitted once when the lane run exits successfully — all agents done, verification passed (or no `verify` step), no outstanding approvals.

| Field | Type | Description |
|---|---|---|
| `summary` | `string` | Human-readable summary of what the lane accomplished. |
| `outputs` | `array<{path: string, bytes: number}>` | Files written during the run. |
| `durationMs` | `integer` | Wall time from `lane.started` to this event in milliseconds. |

#### `lane.error`

Terminal. Emitted once when the lane run fails unrecoverably.

| Field | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable error message. |
| `code` | `string` | Machine-readable error code. Defined values: `agent_spawn_failed`, `approval_timeout`, `verify_failed`, `orchestrator_panic`, `context_cancelled`. |
| `agentId` | `string` or `null` | If the failure originated in a specific agent, its ID; otherwise `null`. |
| `recoverable` | `boolean` | `false` always for `lane.error`. Present for forward-compat symmetry with `agent.failed`. |

---

### 5.2 Agent lifecycle

#### `agent.spawned`

Emitted by the orchestrator when it forks a new agent process (a `claude` or `codex` CLI subprocess).

| Field | Type | Description |
|---|---|---|
| `agentId` | `string` | The ID assigned to this agent. Matches the `agentId` envelope field on subsequent events from this agent. |
| `target` | `string` | `"claude.code"` \| `"codex.cli"` \| `"codex.web"` — maps to `HandoffTarget` in `src/lib/plugins/contract/types.ts`. |
| `prompt` | `string` | The full prompt submitted to this agent. |
| `workdir` | `string` | Absolute working-directory path for the agent process. |

#### `agent.output_delta`

Streaming text chunk from an agent. Cockpit appends deltas to reconstruct the full agent turn in order. High-frequency; may arrive many times per agent.

| Field | Type | Description |
|---|---|---|
| `delta` | `string` | Incremental text content. May be empty string (heartbeat chunk to keep SSE alive); consumers MUST tolerate. |
| `turnIndex` | `integer` | Monotonically increasing per-agent turn counter, starting at `0`. All deltas for the same turn share the same `turnIndex`. |

#### `agent.tool_use`

An agent has invoked a tool. Corresponds to `claude --sdk` tool-call events.

| Field | Type | Description |
|---|---|---|
| `tool` | `string` | Tool name (e.g. `"bash"`, `"read_file"`, `"str_replace_editor"`). |
| `toolCallId` | `string` | Provider-assigned ID for correlating with `agent.tool_result`. |
| `args` | `object` or `null` | Tool arguments as a JSON object. `null` if the provider did not supply args. |

#### `agent.tool_result`

Result from a tool execution, immediately following `agent.tool_use` with the same `toolCallId`.

| Field | Type | Description |
|---|---|---|
| `toolCallId` | `string` | Correlates with the originating `agent.tool_use`. |
| `ok` | `boolean` | `true` if the tool succeeded. |
| `preview` | `string` or `null` | Short human-readable excerpt of the result (max 512 chars). Full output not included here. |
| `errorMessage` | `string` or `null` | Error message when `ok=false`. |

#### `agent.completed`

An individual agent process has exited successfully.

| Field | Type | Description |
|---|---|---|
| `exitCode` | `integer` | OS process exit code. `0` for clean exit. |
| `summary` | `string` | One-sentence summary of what this agent did. May be extracted from the final agent message. |
| `outputs` | `array<{path: string, bytes: number}>` | Files written by this specific agent. |
| `usage` | `object` or `null` | Token/cost metadata if available. Fields: `inputTokens`, `outputTokens`, `costUsd`. |

#### `agent.failed`

An individual agent process exited abnormally. The lane may or may not recover.

| Field | Type | Description |
|---|---|---|
| `exitCode` | `integer` | OS exit code, or `-1` if the process was killed by signal. |
| `message` | `string` | Reason for failure. |
| `recoverable` | `boolean` | `true` if the orchestrator will retry or absorb this failure at the lane level. |

---

### 5.3 Approval gates

#### `approval.requested`

The orchestrator is paused, waiting for human approval before proceeding. Cockpit renders a blocking approval card (doc 09).

| Field | Type | Description |
|---|---|---|
| `approvalId` | `string` (UUID v4) | Unique ID for this approval request. Used in the response POST. |
| `kind` | `string` | `"commit"` \| `"destructive_tool"` \| `"lane_gate"` \| `"custom"`. |
| `title` | `string` | Short title shown in the approval card (≤80 chars). |
| `description` | `string` | Longer description of what is being approved. |
| `diff` | `string` or `null` | Unified diff string if `kind="commit"`, else `null`. |
| `timeoutSecs` | `integer` or `null` | Seconds before the orchestrator auto-cancels; `null` means indefinite. |

#### `approval.resolved`

Emitted after the orchestrator receives and processes an approval response.

| Field | Type | Description |
|---|---|---|
| `approvalId` | `string` | Matches the originating `approval.requested`. |
| `decision` | `string` | `"approved"` \| `"rejected"`. |
| `resolvedBy` | `string` | `"user"` \| `"timeout"` \| `"auto"`. |

---

### 5.4 Verification

#### `lane.verify_started`

The orchestrator has begun running the lane's `verify` commands.

| Field | Type | Description |
|---|---|---|
| `commands` | `array<string>` | Verify commands being run, in order. Sourced from `LaneSpec.verify`. |

#### `lane.verify_passed`

All `verify` commands exited with code `0`.

| Field | Type | Description |
|---|---|---|
| `commands` | `array<string>` | Commands that were run. |
| `durationMs` | `integer` | Wall time for the verify step. |

#### `lane.verify_failed`

One or more `verify` commands exited non-zero. Always followed by `lane.error`.

| Field | Type | Description |
|---|---|---|
| `failedCommand` | `string` | The first command that failed. |
| `exitCode` | `integer` | Its exit code. |
| `output` | `string` | Combined stdout+stderr, truncated to 4096 chars. |

---

### 5.5 Commit and file activity

#### `lane.commit_proposed`

The orchestrator has assembled a commit and is either auto-committing or requesting approval.

| Field | Type | Description |
|---|---|---|
| `branch` | `string` | Target branch. |
| `message` | `string` | Proposed commit message. |
| `diff` | `string` | Unified diff. |
| `approvalRequired` | `boolean` | If `true`, an `approval.requested` event with `kind="commit"` will follow before the commit lands. |

#### `lane.log`

Diagnostic log message from the orchestrator (not from an agent). Use sparingly; prefer structured events.

| Field | Type | Description |
|---|---|---|
| `level` | `string` | `"info"` \| `"warn"` \| `"error"`. |
| `message` | `string` | Human-readable message. |

---

## 6. Full event type enum

```
lane.started
lane.completed
lane.error
lane.verify_started
lane.verify_passed
lane.verify_failed
lane.commit_proposed
lane.log
agent.spawned
agent.output_delta
agent.tool_use
agent.tool_result
agent.completed
agent.failed
approval.requested
approval.resolved
```

---

## 7. JSON Schema (authoritative)

Schema version `1`. File to be checked in at  
`go/internal/events/schema/laneevent.v1.schema.json`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://vibe.lutherfourie.dev/schemas/laneevent.v1.json",
  "title": "LaneEvent",
  "description": "One event in the Vibe lane execution stream.",
  "type": "object",
  "required": ["v", "id", "seq", "laneId", "runId", "agentId", "ts", "type"],
  "properties": {
    "v":       { "type": "integer", "const": 1 },
    "id":      { "type": "string", "format": "uuid" },
    "seq":     { "type": "integer", "minimum": 1 },
    "laneId":  { "type": "string", "minLength": 1 },
    "runId":   { "type": "string", "format": "uuid" },
    "agentId": { "type": ["string", "null"] },
    "ts":      { "type": "string", "format": "date-time" },
    "type":    {
      "type": "string",
      "enum": [
        "lane.started", "lane.completed", "lane.error",
        "lane.verify_started", "lane.verify_passed", "lane.verify_failed",
        "lane.commit_proposed", "lane.log",
        "agent.spawned", "agent.output_delta",
        "agent.tool_use", "agent.tool_result",
        "agent.completed", "agent.failed",
        "approval.requested", "approval.resolved"
      ]
    }
  },
  "allOf": [
    {
      "if": { "properties": { "type": { "const": "lane.started" } } },
      "then": {
        "required": ["laneSpec", "triggerSource"],
        "properties": {
          "laneSpec": { "type": "object" },
          "triggerSource": { "type": "string", "enum": ["cockpit_ui", "cli", "api"] }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "lane.completed" } } },
      "then": {
        "required": ["summary", "outputs", "durationMs"],
        "properties": {
          "summary": { "type": "string" },
          "outputs": { "type": "array", "items": { "type": "object", "required": ["path", "bytes"], "properties": { "path": { "type": "string" }, "bytes": { "type": "integer" } } } },
          "durationMs": { "type": "integer" }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "lane.error" } } },
      "then": {
        "required": ["message", "code", "recoverable"],
        "properties": {
          "message": { "type": "string" },
          "code": { "type": "string", "enum": ["agent_spawn_failed", "approval_timeout", "verify_failed", "orchestrator_panic", "context_cancelled"] },
          "recoverable": { "type": "boolean" }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "agent.spawned" } } },
      "then": {
        "required": ["agentId", "target", "prompt", "workdir"],
        "properties": {
          "target": { "type": "string", "enum": ["claude.code", "codex.cli", "codex.web"] },
          "prompt": { "type": "string" },
          "workdir": { "type": "string" }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "agent.output_delta" } } },
      "then": {
        "required": ["delta", "turnIndex"],
        "properties": {
          "delta": { "type": "string" },
          "turnIndex": { "type": "integer", "minimum": 0 }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "agent.tool_use" } } },
      "then": {
        "required": ["tool", "toolCallId"],
        "properties": {
          "tool": { "type": "string" },
          "toolCallId": { "type": "string" },
          "args": { "type": ["object", "null"] }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "agent.tool_result" } } },
      "then": {
        "required": ["toolCallId", "ok"],
        "properties": {
          "toolCallId": { "type": "string" },
          "ok": { "type": "boolean" },
          "preview": { "type": ["string", "null"] },
          "errorMessage": { "type": ["string", "null"] }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "approval.requested" } } },
      "then": {
        "required": ["approvalId", "kind", "title", "description"],
        "properties": {
          "approvalId": { "type": "string", "format": "uuid" },
          "kind": { "type": "string", "enum": ["commit", "destructive_tool", "lane_gate", "custom"] },
          "title": { "type": "string", "maxLength": 80 },
          "description": { "type": "string" },
          "diff": { "type": ["string", "null"] },
          "timeoutSecs": { "type": ["integer", "null"] }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "approval.resolved" } } },
      "then": {
        "required": ["approvalId", "decision", "resolvedBy"],
        "properties": {
          "approvalId": { "type": "string", "format": "uuid" },
          "decision": { "type": "string", "enum": ["approved", "rejected"] },
          "resolvedBy": { "type": "string", "enum": ["user", "timeout", "auto"] }
        }
      }
    }
  ],
  "unevaluatedProperties": true
}
```

> The `unevaluatedProperties: true` setting allows forward-compat payload extensions in minor versions. Consumers MUST ignore unknown fields.

---

## 8. Go bindings

These types live in the new package `go/internal/events` (to be created in SP1). They are generated by hand for v1; a `go generate` step with `json-schema-to-go` may replace this in a later cycle.

```go
// Package events defines the LaneEvent stream contract.
// File: go/internal/events/types.go
package events

import (
    "encoding/json"
    "time"
)

// EventType is the discriminant for a LaneEvent.
type EventType string

const (
    EventTypeLaneStarted       EventType = "lane.started"
    EventTypeLaneCompleted     EventType = "lane.completed"
    EventTypeLaneError         EventType = "lane.error"
    EventTypeLaneVerifyStarted EventType = "lane.verify_started"
    EventTypeLaneVerifyPassed  EventType = "lane.verify_passed"
    EventTypeLaneVerifyFailed  EventType = "lane.verify_failed"
    EventTypeLaneCommitProposed EventType = "lane.commit_proposed"
    EventTypeLaneLog           EventType = "lane.log"
    EventTypeAgentSpawned      EventType = "agent.spawned"
    EventTypeAgentOutputDelta  EventType = "agent.output_delta"
    EventTypeAgentToolUse      EventType = "agent.tool_use"
    EventTypeAgentToolResult   EventType = "agent.tool_result"
    EventTypeAgentCompleted    EventType = "agent.completed"
    EventTypeAgentFailed       EventType = "agent.failed"
    EventTypeApprovalRequested EventType = "approval.requested"
    EventTypeApprovalResolved  EventType = "approval.resolved"
)

// Envelope carries fields present on every LaneEvent.
type Envelope struct {
    V       int       `json:"v"`
    ID      string    `json:"id"`
    Seq     uint64    `json:"seq"`
    LaneID  string    `json:"laneId"`
    RunID   string    `json:"runId"`
    AgentID *string   `json:"agentId"`
    Ts      time.Time `json:"ts"`
    Type    EventType `json:"type"`
}

// FileOutput represents a file written during a run.
type FileOutput struct {
    Path  string `json:"path"`
    Bytes int    `json:"bytes"`
}

// Usage captures provider token/cost telemetry.
type Usage struct {
    InputTokens  int     `json:"inputTokens"`
    OutputTokens int     `json:"outputTokens"`
    CostUSD      float64 `json:"costUsd"`
}

// LaneEvent is a discriminated union. Unmarshal the Type field first,
// then assert the concrete payload via the typed helpers below.
type LaneEvent struct {
    Envelope

    // lane.started
    LaneSpec      *json.RawMessage `json:"laneSpec,omitempty"`
    TriggerSource string           `json:"triggerSource,omitempty"`

    // lane.completed / lane.error
    Summary     string       `json:"summary,omitempty"`
    Outputs     []FileOutput `json:"outputs,omitempty"`
    DurationMs  int          `json:"durationMs,omitempty"`
    Message     string       `json:"message,omitempty"`
    Code        string       `json:"code,omitempty"`
    Recoverable *bool        `json:"recoverable,omitempty"`

    // lane.verify_*
    Commands     []string `json:"commands,omitempty"`
    FailedCommand string  `json:"failedCommand,omitempty"`
    ExitCode     int      `json:"exitCode,omitempty"`
    Output       string   `json:"output,omitempty"`

    // lane.commit_proposed
    Branch           string `json:"branch,omitempty"`
    CommitMessage    string `json:"-"` // disambiguated field; see note below
    Diff             string `json:"diff,omitempty"`
    ApprovalRequired bool   `json:"approvalRequired,omitempty"`

    // agent.spawned
    Target  string `json:"target,omitempty"`
    Prompt  string `json:"prompt,omitempty"`
    Workdir string `json:"workdir,omitempty"`

    // agent.output_delta
    Delta     string `json:"delta,omitempty"`
    TurnIndex int    `json:"turnIndex,omitempty"`

    // agent.tool_use / agent.tool_result
    Tool         string           `json:"tool,omitempty"`
    ToolCallID   string           `json:"toolCallId,omitempty"`
    Args         *json.RawMessage `json:"args,omitempty"`
    OK           *bool            `json:"ok,omitempty"`
    Preview      *string          `json:"preview,omitempty"`
    ErrorMessage *string          `json:"errorMessage,omitempty"`

    // agent.completed
    AgentUsage *Usage `json:"usage,omitempty"`

    // approval.requested / approval.resolved
    ApprovalID  string `json:"approvalId,omitempty"`
    Kind        string `json:"kind,omitempty"`
    Title       string `json:"title,omitempty"`
    Description string `json:"description,omitempty"`
    TimeoutSecs *int   `json:"timeoutSecs,omitempty"`
    Decision    string `json:"decision,omitempty"`
    ResolvedBy  string `json:"resolvedBy,omitempty"`

    // lane.log
    Level string `json:"level,omitempty"`
}
```

> **Note on `CommitMessage`:** The commit message field is named `commitMessage` in JSON to avoid collision with the generic `message` error field. The Go struct uses `json:"-"` placeholder above; the actual serialized field is `commitMessage`. Adjust the struct tag accordingly in the implementation.

**Emitter helper** (to be placed in `go/internal/events/emit.go`):

```go
// NewEvent constructs an envelope with a new UUID, the next seq number,
// and the current timestamp. The caller fills payload fields.
func NewEvent(laneID, runID string, seq uint64, agentID *string, t EventType) LaneEvent {
    id := newUUID() // wrapper around crypto/rand
    now := time.Now().UTC()
    return LaneEvent{
        Envelope: Envelope{
            V:       1,
            ID:      id,
            Seq:     seq,
            LaneID:  laneID,
            RunID:   runID,
            AgentID: agentID,
            Ts:      now,
            Type:    t,
        },
    }
}
```

The orchestrator maintains one `atomic.Uint64` counter per `(laneID, runID)` pair and calls `Add(1)` before constructing each event.

---

## 9. TypeScript bindings

These types replace the existing `LaneEvent` union in  
`src/lib/plugins/contract/types.ts` for the Go-backed stream. The in-process TS plugin adapter (doc 06) maps these onto the kernel's `AssistantEvent` / activity feed as needed.

```typescript
// File: src/lib/plugins/contract/lane-event.ts
// AUTO-GENERATED from laneevent.v1.schema.json — do not hand-edit in SP2+

export const LANE_EVENT_VERSION = 1 as const;

export interface LaneEventEnvelope {
  v: 1;
  id: string;         // UUID v4
  seq: number;        // uint64 — safe up to 2^53
  laneId: string;
  runId: string;
  agentId: string | null;
  ts: string;         // RFC 3339
  type: LaneEventType;
}

export type LaneEventType =
  | "lane.started"       | "lane.completed"      | "lane.error"
  | "lane.verify_started"| "lane.verify_passed"  | "lane.verify_failed"
  | "lane.commit_proposed"| "lane.log"
  | "agent.spawned"      | "agent.output_delta"
  | "agent.tool_use"     | "agent.tool_result"
  | "agent.completed"    | "agent.failed"
  | "approval.requested" | "approval.resolved";

export interface FileOutput { path: string; bytes: number; }
export interface AgentUsage { inputTokens: number; outputTokens: number; costUsd: number; }

// ── Lane lifecycle ──────────────────────────────────────────────────────────

export interface LaneStartedEvent extends LaneEventEnvelope {
  type: "lane.started";
  laneSpec: Record<string, unknown>;
  triggerSource: "cockpit_ui" | "cli" | "api";
}
export interface LaneCompletedEvent extends LaneEventEnvelope {
  type: "lane.completed";
  summary: string;
  outputs: FileOutput[];
  durationMs: number;
}
export interface LaneErrorEvent extends LaneEventEnvelope {
  type: "lane.error";
  message: string;
  code: "agent_spawn_failed" | "approval_timeout" | "verify_failed" | "orchestrator_panic" | "context_cancelled";
  recoverable: boolean;
}
export interface LaneVerifyStartedEvent extends LaneEventEnvelope {
  type: "lane.verify_started"; commands: string[];
}
export interface LaneVerifyPassedEvent extends LaneEventEnvelope {
  type: "lane.verify_passed"; commands: string[]; durationMs: number;
}
export interface LaneVerifyFailedEvent extends LaneEventEnvelope {
  type: "lane.verify_failed";
  failedCommand: string; exitCode: number; output: string;
}
export interface LaneCommitProposedEvent extends LaneEventEnvelope {
  type: "lane.commit_proposed";
  branch: string; commitMessage: string; diff: string; approvalRequired: boolean;
}
export interface LaneLogEvent extends LaneEventEnvelope {
  type: "lane.log"; level: "info" | "warn" | "error"; message: string;
}

// ── Agent lifecycle ─────────────────────────────────────────────────────────

export interface AgentSpawnedEvent extends LaneEventEnvelope {
  type: "agent.spawned";
  agentId: string;
  target: "claude.code" | "codex.cli" | "codex.web";
  prompt: string; workdir: string;
}
export interface AgentOutputDeltaEvent extends LaneEventEnvelope {
  type: "agent.output_delta"; delta: string; turnIndex: number;
}
export interface AgentToolUseEvent extends LaneEventEnvelope {
  type: "agent.tool_use";
  tool: string; toolCallId: string; args: Record<string, unknown> | null;
}
export interface AgentToolResultEvent extends LaneEventEnvelope {
  type: "agent.tool_result";
  toolCallId: string; ok: boolean;
  preview: string | null; errorMessage: string | null;
}
export interface AgentCompletedEvent extends LaneEventEnvelope {
  type: "agent.completed";
  exitCode: number; summary: string;
  outputs: FileOutput[]; usage: AgentUsage | null;
}
export interface AgentFailedEvent extends LaneEventEnvelope {
  type: "agent.failed"; exitCode: number; message: string; recoverable: boolean;
}

// ── Approvals ───────────────────────────────────────────────────────────────

export interface ApprovalRequestedEvent extends LaneEventEnvelope {
  type: "approval.requested";
  approvalId: string;
  kind: "commit" | "destructive_tool" | "lane_gate" | "custom";
  title: string; description: string;
  diff: string | null; timeoutSecs: number | null;
}
export interface ApprovalResolvedEvent extends LaneEventEnvelope {
  type: "approval.resolved";
  approvalId: string;
  decision: "approved" | "rejected";
  resolvedBy: "user" | "timeout" | "auto";
}

// ── Discriminated union ─────────────────────────────────────────────────────

export type LaneEvent =
  | LaneStartedEvent      | LaneCompletedEvent    | LaneErrorEvent
  | LaneVerifyStartedEvent| LaneVerifyPassedEvent | LaneVerifyFailedEvent
  | LaneCommitProposedEvent| LaneLogEvent
  | AgentSpawnedEvent     | AgentOutputDeltaEvent
  | AgentToolUseEvent     | AgentToolResultEvent
  | AgentCompletedEvent   | AgentFailedEvent
  | ApprovalRequestedEvent| ApprovalResolvedEvent;

export type TerminalLaneEvent = LaneCompletedEvent | LaneErrorEvent;

export function isTerminal(e: LaneEvent): e is TerminalLaneEvent {
  return e.type === "lane.completed" || e.type === "lane.error";
}

/** Parse one NDJSON line into a LaneEvent. Throws on invalid JSON.
 *  Unknown `type` values are returned as-is (forward-compat). */
export function parseLaneEvent(line: string): LaneEvent {
  return JSON.parse(line) as LaneEvent;
}
```

---

## 10. Versioning strategy

### 10.1 Contract version field

The `v` envelope field is an integer, currently `1`. It increments only on **breaking changes** (removed fields, renamed fields, changed enum values, changed required-ness).

### 10.2 Backward-compatible changes (no version bump)

- Adding new optional payload fields to an existing event type.
- Adding new event types to the taxonomy.
- Adding new `code` values to `lane.error`.
- Adding new `kind` values to `approval.requested`.

Consumers MUST ignore unknown fields and unknown `type` values (treat as `lane.log` level `info` for display purposes if needed).

### 10.3 Breaking changes (bump `v` to 2)

- Removing or renaming any required field.
- Changing the type of any field.
- Removing any enum value from `type`.
- Changing seq semantics.

### 10.4 Negotiation

On connect, `vibe serve` will advertise supported versions via the `X-Vibe-Event-Schema-Versions: 1` response header. Cockpit sends `Accept-Vibe-Event-Schema: 1` on the SSE request. If the server cannot satisfy the requested version, it responds `406 Not Acceptable`. This avoids silent contract mismatch on upgrades.

### 10.5 Schema file location

The authoritative JSON Schema file lives at:

```
C:\vibe\go\internal\events\schema\laneevent.v1.schema.json
```

TypeScript consumers reference it via a local copy checked into Cockpit at:

```
C:\Users\4elut\Documents\Cockpit\src\lib\plugins\vibe\schema\laneevent.v1.schema.json
```

Both copies are generated from a single source; a future CI step can enforce they match.

---

## 11. Ordering and resumability (detailed)

### 11.1 Seq counter

The Go orchestrator maintains one `atomic.Uint64` per `runId`. Each goroutine — orchestrator and every spawned agent process — calls `seq.Add(1)` atomically before constructing its event. This guarantees global ordering within a run even under concurrent agent output.

Consequence: `seq` values within a run are gapless integers starting at `1`, but the order of emission from different goroutines means `ts` values may not be strictly increasing (fine; consumers sort by `seq`).

### 11.2 Replay buffer

`vibe serve` keeps an in-memory ring buffer of the last 200 events per active run. On SSE reconnect with `Last-Event-ID: <uuid>`, the server:
1. Looks up the event by `id` in the buffer.
2. Replays all events with `seq > matched_seq` in order.
3. Then resumes live streaming.

If the `id` is not in the buffer (client was disconnected too long), the server replays the entire buffer and marks the oldest replayed event in the response body as `"bufferTruncated": true` on a synthetic `lane.log` event prepended to the replay set.

### 11.3 Persistence for durable resumability

For runs that outlive the daemon process, `vibe serve` (or a future Vibe SDK extension) may flush the event stream to a local SQLite file at  
`.vibe-out/<runId>/events.ndjson`. Cockpit's adapter (doc 06) may read this file for post-run replay. This is out of scope for the SP1 initial implementation but the file path convention is established here so doc 06 can reference it.

---

## 12. Open questions / risks

1. **`seq` overflow across concurrent agents.** With one global atomic counter per run, very high agent fan-out (100+ agents) is fine — uint64 will never overflow in practice. But if we later move to per-agent seq counters for independent ordering, Cockpit needs a merge strategy. Decision deferred to SP2 when fan-out is real.

2. **`agent.output_delta` volume.** A verbose agent turn can emit thousands of deltas. SSE backpressure is not built into browsers; if Cockpit's React render loop falls behind, the delta buffer will grow unboundedly. The adapter (doc 06) MUST debounce UI updates (e.g. 50 ms coalesce window) and drop intermediate deltas from the activity feed, keeping only the assembled full text.

3. **`laneSpec` snapshot fidelity.** The `laneSpec` field on `lane.started` is `object` (untyped in schema). If the Go SDK's lane IR diverges from Cockpit's `LaneSpecSchema` (Zod), the Cockpit adapter will silently lose fields. Risk: medium. Mitigation: generate a typed `LaneSpecSnapshot` struct in Go and a matching Zod schema in TS in the SP1 implementation cycle.

4. **`commitMessage` field name collision.** The flat envelope has both a generic `message` field (used by `lane.error`, `agent.failed`, `lane.log`) and a `commitMessage` field. The naming is deliberate but reviewers should confirm no JSON serialization library merges them unexpectedly in the flat struct. Consider a nested `payload` object in v2 to eliminate all such collisions.

5. **Approval timeout race.** If the user approves at the exact moment `timeoutSecs` expires, both an `approval.resolved` with `decision=approved` and one with `decision=rejected,resolvedBy=timeout` could be emitted. The orchestrator MUST use a mutex to guarantee exactly one resolution. Doc 09 must enforce this invariant.

6. **`v` negotiation before SSE.** The negotiation headers (§10.4) require the client to inspect response headers before consuming the stream body. EventSource API in browsers does not expose response headers. The Cockpit adapter will need to use `fetch()` + `ReadableStream` instead of the native `EventSource` to read `X-Vibe-Event-Schema-Versions`. This is a known constraint; doc 06 must call it out.
