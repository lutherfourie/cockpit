# Cockpit + Vibe + Hermes — Instant-Start, Integration & System-Automation Workflow

**Date:** 2026-05-28
**Status:** DRAFT — pending user review
**Owner:** Luther
**Scope:** A multi-cycle workflow that (1) gets Cockpit instantly runnable and fully verified, (2) makes Cockpit↔Vibe a *real* execution integration with Vibe as a **Go SDK first** (the `.vibe` language executes via that SDK), and (3) adds OS-level task automation, evaluating Nous Hermes-Agent as an optional capability backend.

This document is the north-star "workflow." It specifies **SP0 in full detail** and **SP1/SP2 at a roadmap level**. SP1 and SP2 each get their own spec → plan → implementation cycle before any code is written for them.

---

## 1. Goals & non-goals

**Goals**
- One command brings Cockpit fully up on Windows; every existing feature verified in a real browser.
- A portable production image so Cockpit can "run anywhere," while dev stays fast and native.
- Cockpit↔Vibe integration that actually *executes* lanes and streams results — not just discovery/handoff.
- Vibe delivered as a **Go SDK first** (the primary, programmatic execution surface) **and** a language; `.vibe` compiles to IR and executes *through* the Go SDK.
- A path to automate real tasks on the user's system, with Vibe as the orchestrator for parallelism ("spawn many agents").

**Non-goals**
- Merging Hermes-Agent's Python source into Vibe/Cockpit (language mismatch; Hermes is a complete runtime, not a library to absorb).
- Treating Hermes as a swarm controller (it hard-caps subagents at 3 concurrent / depth 3 — that orchestration belongs in Vibe).
- Unbounded runtime takeover of Cockpit's bounded chat lane, or OpenUI owning durable kernel state (preserves existing Cockpit invariants).

---

## 2. Current state (grounded)

**Cockpit** (`C:\Users\4elut\Documents\Cockpit`, Next.js 16 + Supabase): kernel, five stable panels, persistence, and all four LLM providers (`local`/`openai`/`codex`/`cerebras`; currently `cerebras` + `zai-glm-4.7`) are production-ready. **Phase-1 Vibe integration is built**: lane discovery + handoff generation via `src/lib/plugins/vibe/`, `/api/cockpit/lanes[/:id/handoff]`, and `lane-inventory-panel.tsx`. A **2788-line Phase-3 execution+streaming plan already exists on master** (`docs/superpowers/plans/2026-05-18-cockpit-vibe-phase-3-execution-streaming.md`).

**Vibe** (`C:\vibe`, pnpm + Go monorepo): the `.vibe` language (Langium parser, 9 primitives, 240+ tests) compiles to JSON IR (self-plan / lane-plan). The Go CLI (`go/cmd/vibe`) validates IR and emits **handoff markdown** — it does **not yet execute agents**. A TS `@vibe/runtime` package was **scaffolded** (PRs #12/#13) to host a LangGraph/deepagents translator. The `sandbox/deepagents-poc/` (a TS LangGraph proof-of-concept) is on main and ships **real `lanes/*.json`** (`cli-delegation`, `feedback-triage`, `truths-extraction`) with `.prompt.md` siblings — exactly the shape Cockpit's plugin discovers.

**Hermes-Agent** (Python 3.11, MIT): a full autonomous personal-agent runtime — terminal/file/browser/cron/memory tools, six execution backends, OpenAI function-calling, and an **ACP (JSON-RPC/stdio) adapter** plus an **MCP server** surface. Strong at OS automation; Windows-native is "early beta" (recommend WSL2/Docker). Subagents hard-capped at 3×depth-3.

---

## 3. Decomposition & ordering

| Sub-project | Outcome | Size | Depends on |
|---|---|---|---|
| **SP0 — Boot + Verify** | Instant-start (native dev) + portable prod image; every existing feature browser-verified; existing Vibe lane discovery/handoff wired to `C:\vibe` and confirmed end-to-end. | Hours | — |
| **SP1 — Real lane execution (Go SDK first)** | Vibe Go SDK executes lanes (spawns/coordinates agents, streams events); `.vibe` runs *through* it; Cockpit launches a lane in-browser and watches it run & stream. | Days | SP0 |
| **SP2 — System task automation** | Hermes stood up in Docker/WSL2 as an ACP/MCP capability backend; Vibe orchestrates it (incl. high fan-out); Cockpit kernel stays source of truth. | Days+ | SP1 |

The full sequence is SP0 → SP1 → SP2, with a checkpoint at each milestone.

---

## 4. SP0 — Boot + Verify (detailed design)

### 4.1 Deliverables
1. **`scripts/cockpit_up.ps1`** — native dev launcher. Steps: verify Docker Desktop is running → `pnpm exec supabase start` (idempotent) → ensure `.env.local` has required keys (warn, don't overwrite) → `pnpm install` if lockfile newer than `node_modules` → `pnpm dev` on 3000 → poll `http://127.0.0.1:3000` until healthy → open browser → print the existing `cockpit_snapshot.ps1` summary. (Personal hook wiring stays in gitignored `.claude/`.)
2. **`Dockerfile` + `docker-compose.yml`** — production-style Cockpit image: multi-stage (`pnpm install --frozen-lockfile` → `pnpm build` → `next start`), `output: 'standalone'` if not already set, non-root user, `NODE_ENV=production`. Compose wires the app to the Supabase services **without** duplicating the containers the Supabase CLI already manages (reference its network/URLs; document the two run modes). This image is the portable artifact; **dev does not run in Docker**.
3. **Vibe wiring** — set `COCKPIT_PLUGINS=vibe` and `COCKPIT_PLUGIN_VIBE_ROOTS=C:/vibe/sandbox/deepagents-poc` in `.env.local`. Verify `/api/cockpit/lanes` returns the three deepagents lanes and the Lane Inventory panel renders them + generates handoff text. (No lane-file generation needed — real `lanes/*.json` already exist there.)
4. **Feature verification report** — I drive a real browser (Playwright/Preview MCP) and produce a works/partial/broken matrix with screenshots (see 4.2). Trivial quick-win fixes applied inline; anything larger flagged as a follow-up task (no scope creep).

### 4.2 Verification matrix (what "test each feature" means)
- Five stable panels: Current Goal, Next Action (+ Proof Needed box, Assumptions), Parking Lot, Handoff.
- Seven modes (auto/clarify/plan/focus/recover/review/handoff) via buttons **and** slash commands (`/focus`, `/plan`, `/park`, `/clear`, …).
- Parking Lot add/list/cap; theme toggle (dim/light); focus mode (F); capture-intent chip (URL/path/cmd/error detection).
- **Cerebras provider live**: confirm a turn returns model-enriched output, not the deterministic fallback (and that fallback still works if the key is unset).
- **Persistence**: sign in via local Supabase (create a test user through Studio/SQL), confirm a session + parked item + handoff persist with `user_id` RLS scoping; confirm the no-auth path degrades to the Null store cleanly.
- CopilotKit assistant sidebar (activity feed, message submit, event persistence).
- Thought-chat lane: confirm whether it's mounted in the default layout; if not, flag (it has a route but the explorer found no UI entry point).
- Lane Inventory + handoff end-to-end against the deepagents lanes.
- Regression gates: `pnpm lint`, `pnpm test` (vitest), `pnpm test:e2e` (Playwright) — run and reported.

### 4.3 Approach notes / decisions
- **Don't containerize dev** — Next.js file-watching inside Docker on Windows is slow/flaky. The prod image is build-and-serve only (hybrid choice, confirmed).
- **Supabase stays CLI-managed** — it already owns its containers; compose coexists rather than double-manages.
- Follow existing conventions: scripts in `scripts/`, personal automation in gitignored `.claude/`.

### 4.4 Risks & mitigations
- **Lane schema seam** — Cockpit Phase-1 discovers `lanes/*.json`; Vibe's authoritative artifacts are `.vibe`/self-plan JSON. SP0 sidesteps this by pointing at the deepagents `lanes/*.json` that already match. SP1 closes the seam properly (Go SDK emits the execution stream).
- **Cerebras key validity / rate limits** — fallback keeps the UI fully functional regardless; report if the live path fails.
- **Docker Desktop not running** — launcher detects and instructs.
- **Auth/persistence test friction** — script a local test user or use Studio; never use a service-role key to fake auth (kernel invariant).

### 4.5 Out of scope for SP0
Real lane execution/streaming (SP1), Hermes (SP2), any "N-agent" orchestration.

---

## 5. SP1 — Real lane execution, Vibe as a Go SDK first (roadmap-level)

**Direction (new, per user):** Vibe's **execution core becomes a Go SDK** — the primary programmatic surface. A developer can build and run agentic systems directly in Go by calling the SDK (providers, routes, agents, lanes, harness, memory, orchestration, agent spawning). The **`.vibe` language stays as the authoring front-end**: Langium parser → JSON IR → **the Go SDK executes the IR**. Go's goroutine concurrency is the natural fit for high fan-out ("spawn many agents"), and the repo's existing gopher-concurrency demos point this way.

**Reconciliation required (flagged, resolved in SP1's own cycle):** The existing Phase-3 plan and the scaffolded **`@vibe/runtime` (TS / LangGraph)** assume a *TypeScript* streaming runtime feeding Cockpit's `InProcessVibeService`. The Go-SDK-first directive supersedes that core. Likely shape:
- **Go SDK (`vibe` module)** owns lane execution + agent spawning (shelling out to `claude`/`codex` CLIs, parallel lanes, approval gates, event stream as NDJSON / a typed `LaneEvent` channel).
- **`vibe serve`** (already a CLI subcommand stub) exposes the runtime over a local HTTP + streaming endpoint.
- **Cockpit** consumes that stream (its `VibeService` talks to the Go daemon instead of an in-process TS runtime), rendering execution in the dashboard.
- The **TS LangGraph/deepagents POC is demoted** to a reference and/or an *optional backend* the Go SDK can delegate to — not the core. The existing Phase-3 plan is rewritten accordingly in the SP1 cycle.

**SP1 open questions (for its cycle):** exact Go SDK surface/package layout; transport between Cockpit and the Go runtime (HTTP+SSE vs. WebSocket vs. NDJSON-over-stdio); how `.vibe`→IR feeds the Go executor; what "agent spawning" maps to first (claude/codex CLIs); how the §7 **memory bridge** (now backed up at `origin/claude/cockpit-vibe-memory-bridge-2026-05-27`) folds in.

---

## 6. SP2 — System task automation (roadmap-level)

**Direction:** Stand up **Hermes-Agent in Docker (or WSL2)** as an **optional capability backend** reachable over its **ACP (JSON-RPC/stdio)** adapter and/or **MCP** server. Vibe (the Go SDK) treats Hermes as one kind of agent/surface and remains the **orchestrator**; Cockpit's kernel remains the **source of truth** (Hermes enriches, never owns). This gives OS-level automation (terminal, files, browser, cron) without absorbing Python.

**SP2 open questions (for its cycle):** Docker vs. WSL2 on this Windows box; which Hermes capabilities to expose first (terminal/file automation, scheduled jobs, web research); how the user authorizes/sandboxes OS actions (Hermes ships an approval/allowlist layer worth mirroring); the concrete "many agents" fan-out story in the Go SDK (worker pool vs. lane-per-task); what the user actually wants automated (to be elicited at the start of SP2).

---

## 7. Architecture invariants honored
- Cockpit's **model-independent kernel** stays authoritative; providers and Vibe/Hermes *enrich* state.
- Browser code uses only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no secret/service-role key in the browser or to fake auth.
- OpenUI never owns durable state or rearranges stable panels; the thought-chat lane stays bounded.
- Every public table keeps RLS scoped to `user_id = (select auth.uid())`.

---

## 8. Appendix — Work-recovery audit (2026-05-28)
Read-only forensics across both repos. **No stashes.** All worktrees clean.

- **At risk → BACKED UP:** Cockpit `memory-bridge` (97e1892, 4 commits: §7 memory-bridge plan, `cockpit_plugin_memory` migration+RLS, contract memory-types, tests) was local-only with no remote. **Pushed to `origin/claude/cockpit-vibe-memory-bridge-2026-05-27`.** Now safe.
- **Verified merged (tree-diffed, not just hashes):** Cockpit `phase-3-plan`, `priceless-fermat`; Vibe `funny-swirles` (#8 vibecade rename), `git-automation-contract` (#9), closed PR #10's gopher experiments (all present in main via #15). The deepagents POC + its `lanes/*.json` are on Vibe main.
- **Stale clutter (merged; left as-is per "back up only"):** Cockpit `elated-williams`, `phase-3-impl` + dead worktrees; ~12 merged Vibe `claude/*`/`codex/*` branches + dead worktrees.
- **Intentional archives (kept):** Vibe `legacy/local-main-seed`, `legacy/pre-vibe-main-integration`, `legacy/vibe-full-transfer-review`.

---

## 9. Next step
On approval of this design, proceed to a detailed **SP0 implementation plan** (writing-plans), execute SP0, verify in-browser, then open the SP1 cycle (where the Go-SDK-first reconciliation is fully designed).
