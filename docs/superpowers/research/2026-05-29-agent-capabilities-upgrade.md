# Upgrading Cockpit's Agent Capabilities: Ground-Truth Map of Vibe + Cockpit, and What to Harvest

- **Date:** 2026-05-29
- **Status:** Research / synthesis (no code changes)
- **Scope:** Cockpit (`C:\Users\4elut\Documents\Cockpit`) + Vibe (`C:\vibe`) — the "Cockpit develops itself" system; plus external patterns (Hermes, A2A, superpowers)
- **Audience:** anyone wiring the self-development / "agent teams" loop, or deciding what agent tech to adopt next
- **Related:** [`2026-05-29-agent-friendly-development-patterns.md`](2026-05-29-agent-friendly-development-patterns.md) (the *why* — design levers for many concurrent agents) · [`../specs/2026-05-28-cockpit-vibe-hermes-workflow-design.md`](../specs/2026-05-28-cockpit-vibe-hermes-workflow-design.md) (the SP0/SP1/SP2 roadmap)

**How to read the provenance tags:** `[verified]` = I read the file this session and confirmed it. `[agent-read]` = reported by a research subagent with a file:line citation (likely accurate, may have drifted — re-check before acting). `[web]` = external web research (treat vanity stats skeptically). `[opinion]` = my recommendation, not a fact.

---

## TL;DR

The self-development loop is **two halves of one system, mostly built but disconnected.** Vibe (Go daemon) is meant to spawn agent CLIs and stream their work back; Cockpit (Next.js) owns durable state and the UI. The only live wire today is chat (`/api/agent/turn`) plus one gated real-tool-use path (`/api/agent/selfdev` → claude `acceptEdits`).

**`[opinion]` The single most important finding: lighting up "agent teams" is mostly a wiring + contract-alignment job, not a greenfield build.** Vibe already contains an agentic tool-call loop (`RunLoop`), a complete MCP stdio client, and a codex adapter — all built, tested, and *not connected to the HTTP surface*. Cockpit already has the `runLane`/`LaneEvent` contract and the UI shells — *with zero implementations behind them*. The gap is the connective tissue, plus one event-vocabulary mismatch.

**`[opinion]` Order of work:** (1) fix the parking-lot persistence trap first — it's small, it's in the trust-critical area, and the cause is now verified; (2) reconcile the `LaneEvent` ↔ Vibe-`Event` vocabularies; (3) expose Vibe's existing `RunLoop` over a streaming endpoint and implement `runLane` + a `lane_runs` table. Harvest patterns from Hermes/A2A/superpowers along the way — but don't stand up any of them wholesale.

---

## 1. How the two systems relate

```
Cockpit (Next.js, owns durable state)                 Vibe (Go daemon :8787, owns agent execution)
  /api/agent/turn      ── chat only, cerebras ───────▶ POST /v1/turn  (SSE)
  /api/agent/selfdev   ── claude, acceptEdits ───────▶ POST /v1/turn  (the ONE real tool-use path; gated)
  /api/cockpit/lanes   ── discovery + handoff ───────▶ (reads lane JSON; emits markdown, no execution)
  runLane (CONTRACT ONLY) ─ ??? ─────────────────────▶ (no lane executor exists)
```

- **Designed (SP1 / Vibe Phase 3 "Izsha"):** Cockpit's `VibeService` becomes a `RemoteVibeService` that calls a *streaming Vibe lane endpoint* and renders `LaneEvent`s. **Neither end exists yet.**
- **Two roadmaps, different numbering** `[agent-read]`: Vibe has its own 7-phase plan (Phase 3 "Izsha" runtime, "Spineflow" memory) in `vibe: docs/superpowers/specs/2026-05-13-vibe-architecture.md`; Cockpit uses **SP0/SP1/SP2**. They meet at "Cockpit develops itself" → **Vibe Phase 3 ≈ Cockpit SP1.** Keep the labels straight.

---

## 2. Vibe — ground truth `[agent-read]`

Entry: `vibe.exe` (`vibe: cmd/vibe/main.go`); subcommands doctor/continue/lanes/graph/serve/verify/make-plan/handoff. `vibe serve` binds `127.0.0.1:8787`.

| Status | What |
|---|---|
| **Wired & working** | Routes `/healthz`, `/v1/providers`, `/v1/turn` (SSE) + dashboard routes (`/`, `/self-plan.json`, `/vibe-lanes.mmd`, `/handoffs/{file}`) — `vibe: internal/serve/serve.go`. Providers **fake** (default), **claude**, **openai**, **cerebras** (`providers.go`). Claude adapter spawns `claude -p --output-format stream-json --verbose [--permission-mode] [--resume] [--mcp-config]`, prompt via stdin, parses stream-json (`agent/adapters/claude/`). Lane-plan validation + per-lane handoff **markdown** via `EmitHandoffs` (`internal/lanes/coordinator.go`). `@vibe/language` (Langium parser, SD1+SD2, self-plan extraction). `vibe-vscode` extension. `vibe-workbench` Claude+Codex plugin (skills: vibe-orient/vibe-self-plan/vibe-handoff; a read-only `vibe-lane-reviewer` subagent; SessionStart hook). |
| **Built but NOT wired to the daemon** | **codex adapter** — complete, but **not in `DefaultProviders()`** (`agent/adapters/codex/codex.go`; runs `codex exec --sandbox read-only --skip-git-repo-check`, non-streaming). **`RunLoop`** — a real agentic tool-call loop (≤8 iters, `ToolExecutor` interface) in `agent/loop.go`, **not exposed over HTTP**. **MCP stdio JSON-RPC client** — complete + tested in `agent/mcp/client.go`, **not connected to serve**. Claude `WithMCPServers()` never called by the daemon. JSON config-file loading defined but never invoked. |
| **Missing** | Runtime **lane executor** (lanes only emit markdown — no agent is spawned per lane). No `/v1/lanes` endpoint. No runtime task queue / dependency gates. **No `file_write` event kind** — `/v1/turn` Events are `text_delta \| tool_call \| tool_result \| usage \| done \| error`. `@vibe/runtime` TS package is an empty `export {}` stub. |

**The `.vibe` format** `[agent-read]`: HCL/Pkl-like declarative; 9 primitives (`provider, surface, route, fallback, persona, memory, harness, plugin, agent`). A "lane" = a `plugin` whose name ends `_lane`; a "gate" = `plugin` ending `_gate` (explicit `lane`/`gate` syntax deferred). Canonical source `vibe: examples/vibe-self.vibe` → `pnpm run self:plan` → `vibe: docs/examples/vibe-self-plan.json` (generated, never hand-authored). Two schemas: rich `vibe-self-plan.schema.json` and thinner `vibe-lane-plan.schema.json` (`{name, repo, lanes[]}`, lane mode `codex.web|local`).

---

## 3. Cockpit — ground truth `[agent-read]` (persistence section personally `[verified]`)

| Status | What |
|---|---|
| **Wired & working** | 5 stable panels, all functional with **no LLM**. Zod kernel state (`CockpitAgentOutput`: currentGoal/nextAction/proofNeeded/parkingLot/handoff/assumptions/blockers) + reducers where **parking lot merges, never replaces** (`mergeParkingLot`, `kernel-state.ts`). 5 Supabase tables, RLS `user_id = (select auth.uid())`. Coordinator `runCockpitAgent` (max **4** turns; tools: load/save state, add-park, create-handoff, summarize-repo) over openai/cerebras/**codex**/local (`agent.ts`). `/api/cockpit` (real tool-use). `/api/agent/selfdev` → claude acceptEdits, gated on `COCKPIT_SELFDEV_ENABLED=1`. OpenUI slot = one bounded `AssistantNote` (`src/lib/openui/`). `AssistantCommandCenter` (custom overlay, not the CopilotKit widget). CopilotKit tool bridge gated on `OPENAI_API_KEY`. Supabase Realtime on `cockpit_assistant_events`. |
| **Dead / defined-but-unused** | **thought-chat is deterministic** — reads `COCKPIT_LLM_PROVIDER` then ignores it; `modelUsed` hard-coded `"local"` (`thought-chat.ts`). **`ThoughtChatLane` component is not mounted** in `cockpit-app.tsx`. **`runLane` + the `LaneEvent` union (`start\|todo\|tool_call\|tool_result\|log\|file_write\|final\|error`) are defined with ZERO implementations** — `VibePlugin` does only `discovery`+`handoff`; `PluginHost` has no `runLane`/stream method (`src/lib/plugins/`). |
| **Missing** | A `lane_runs`/`lane_events` persistence table (nowhere to durably store streamed `LaneEvent`s under RLS). `cockpit_plugin_memory` (exists only on an unmerged branch). |

---

## 4. The seams — where the two are meant to meet but don't `[agent-read]`

This is the actionable core for an "agent teams" upgrade:

1. **The lane loop is a stub on both ends.** The SP1 `RemoteVibeService` needs a streaming Vibe producer *and* a Cockpit consumer (`PluginHost.runLane`). Both are absent; only the contract *type* is real.
2. **Event-vocabulary mismatch blocks naive wiring.** Cockpit's `LaneEvent` has `todo`, `log`, `file_write`; Vibe's `/v1/turn` emits none of those. **The two vocabularies must be reconciled before they can speak** (add `file_write`/`todo`/`log` to Vibe's `Event`, or translate at the boundary).
3. **codex is reachable in Cockpit but not through Vibe.** Cockpit can run `codex exec` locally; the daemon's codex adapter is unregistered, so via Vibe only `claude` does real tool-use today.
4. **`[opinion]` The brain already exists.** Vibe's `RunLoop` + MCP client + codex adapter are the hard parts of an agent runtime, and they're built. The work is exposing them over HTTP and connecting Cockpit — far cheaper than it looks.

> See [`2026-05-29-agent-friendly-development-patterns.md`](2026-05-29-agent-friendly-development-patterns.md) §7–8 for the *enforcement* gaps (ownership/verify/approval are declared but not executed; Cockpit has no CI). Those are the safety preconditions for running many lanes unattended.

---

## 5. External patterns to harvest `[web]`

The earlier braindump researched three references. `[opinion]` **None should be adopted wholesale; each has a cheap, high-value slice to steal.** (Vanity stats from these sources looked inflated — ignore them; the architecture/format substance is reliable.)

**Hermes (Nous Research) — harvest the agent-loop patterns, don't run the Python monolith.** SP2 deferral of the *runtime* still holds (Linux/WSL-first, heavyweight). Steal now:
- The **`<tool_call>{...}</tool_call>` / `<tool_response>{...}</tool_response>` XML format** — regex-parseable, ideal for text-only providers (cerebras, codex) that lack native tool-call objects.
- **Iteration budget + guaranteed summary-on-exhaustion** (Cockpit's coordinator already caps at 4 turns; make exhaustion produce a summary, not a silent stop).
- **Memory-flush-before-compression** — persist state *before* compressing/ending a turn. `[opinion]` This directly guards the parking-lot data-loss fear (see §6).
- Prompt-slot assembly (stable identity prefix → memory → state → tools) for prefix-cache hits.

**A2A (Agent2Agent, Linux Foundation) — borrow the vocabulary, skip the transport.** `[opinion]` JSON-RPC + `.well-known` discovery + webhooks is overkill for a few local processes. Steal the **data model**: the `Task` lifecycle (`submitted → working → input_required → completed/failed`) as the Handoff/lane state schema; an **Agent Card** as a per-agent self-description file; **Artifact** as typed output. `input_required` is exactly the "agent needs a human" state we'll hit immediately. Adopt transport later only if third-party/cross-host agents appear.

**superpowers (obra) — the orchestration blueprint for `runLane`.** `[opinion]` `subagent-driven-development` is almost exactly the agent-teams design: the **coordinator never implements**; it **curates a self-contained prompt per agent** (task + relevant files + verify command, *no shared history*); the **plan-file checkboxes are the shared state bus**; **two-stage review gates** (spec-compliance before code-quality); **parallel only when problems are provably independent**, else serialize. This is the model to implement `runLane`/`PluginHost` against.

---

## 6. Persistence — verified data-loss finding `[verified]`

The user has a standing fear that parked items silently vanish. I read `src/lib/cockpit/storage.ts` and `src/lib/cockpit/cockpit-output.schema.json` this session.

- **The DB side is durable.** `parking_lot_items` is **insert-only** — there is no `DELETE` or `UPDATE` on it anywhere in `storage.ts`, and `saveSessionState` writes only `title/active_goal/next_action/proof_needed` to `cockpit_sessions` (never the lot). `storage.ts:208–253, 308–325`.
- **The likely cause of lost items:** when **not signed in** (or Supabase unconfigured), `NullCockpitMemoryStore.addParkingLotItem` is a **silent no-op** returning `{saved:false}` — the item *never reaches the database*. `storage.ts:51–95, 88–90`. Those parks live **only in localStorage** (`cockpit:v1:state`). A localStorage clear, a different browser/profile, or a corrupted-state fallback to an empty lot then loses them permanently. This matches "they vanish and I don't know where the DB is."
- **No local→DB backfill on later sign-in** `[agent-read]` (only DB→local hydrate runs) — so items parked-while-logged-out stay vulnerable even after authenticating. *Verify the absence of a backfill path before fixing.*
- **Secondary, not a deleter:** `cockpit-output.schema.json:30` caps `parkingLot` at `maxItems:5` while TS allows `MAX_PARKING_LOT_ITEMS=200` — affects only the codex provider's structured output, and the union-merge reducer protects existing items. Still worth aligning to 200 to avoid under-reporting.

**`[opinion]` Fix order:** surface a visible warning (or block) when `addParkingLotItem` returns `saved:false`; add a local→DB backfill on sign-in; align `maxItems` 5→200; confirm the parse-failure path doesn't overwrite localStorage with the empty state. Keep a human on-the-loop for any change touching persistence.

---

## 7. My recommended sequence `[opinion]`

Ordered so trust comes before capability:

1. **Fix the persistence trap (§6).** Small, high-trust, in the sensitive area. Cause is verified. Do this first.
2. **Reconcile the event contracts.** Add `file_write`/`todo`/`log` to Vibe's `/v1/turn` `Event` enum (or translate at the Cockpit boundary) so `LaneEvent` and Vibe Events align.
3. **Expose Vibe's existing `RunLoop`** over a streaming lane endpoint, and **register the codex adapter** in `DefaultProviders()` so the daemon can dispatch codex too.
4. **Implement `runLane`** in `VibePlugin` + `PluginHost` as a `RemoteVibeService` client, following the superpowers coordinator pattern (curated context, no shared history). Add a **`lane_runs`/`lane_events` table** (RLS-scoped) so streamed events persist.
5. **Model lane/handoff state on the A2A `Task` lifecycle**; adopt the Hermes `<tool_call>` format for text providers and memory-flush-before-compress as the persistence ordering rule.
6. **Enforce ownership/verify/approval at execution** — see the patterns doc §8. This is the precondition for *many* concurrent agents, not just one.

**Why this order:** steps 1–2 are cheap and remove the two things that would otherwise corrupt trust or block wiring. Step 3 unlocks the already-built brain. Steps 4–6 build the actual agent-teams runtime on a foundation that's now durable and contract-aligned.

---

## 8. Open questions / to verify before acting

- Does any code write the *empty* kernel state back to localStorage on a parse failure (the destructive step)? `[verified]` the in-memory reset; the write-back is unconfirmed.
- Is there truly no local→DB parking-lot backfill on sign-in? `[agent-read]` — confirm.
- File:line citations in §2–§4 are from research-agent reads, not all personally re-verified — re-check before editing those exact lines.
- Should the codex adapter's hard-coded `--sandbox read-only` become configurable when used for *write*-capable lanes? (Today only claude can write.)

---

## Provenance

Produced 2026-05-29 by a four-agent research team (two per repo: `vibe-daemon-core`, `vibe-surfaces`, `cockpit-kernel`, `cockpit-ui`) plus a prior external-pattern team (`hermes-scout`, `a2a-scout`, `superpowers-scout`). The persistence finding (§6) and the two files it cites were personally verified by the orchestrating session. External-pattern stats are explicitly *not* trusted; their architectural substance is.
