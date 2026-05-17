# OpenUI Usage Reset Design

## Purpose

Cockpit should remain useful even when no LLM is available, tokens are exhausted, or a provider is unavailable. OpenUI should be used where generated UI materially improves the task, not as the source of truth for the core cockpit.

The design direction is a hybrid cockpit kernel:

- A plain React and JSON kernel owns the stable cockpit loop.
- Optional assistant providers enrich the loop when available.
- OpenUI renders bounded generated surfaces only in approved zones.
- A future background work lane is reserved in the layout so assistant work can become integral without disrupting the cockpit.

## Goals

- Keep the five stable cockpit regions usable without a model: Current Goal, Next Action, Proof Needed, Parking Lot, and Handoff.
- Preserve a schema-first cockpit state that persists locally now and syncs to Supabase in the next persistence implementation slice.
- Use OpenUI only when it helps the intent of a block, such as experiment setup, prompt mentoring, review exploration, generated dashboards, or tool-result inspection.
- Design for future assistants and Pulse-like background work as part of the layout from the start.
- Make database persistence a near-term priority so the user can continue Cockpit sessions from a phone while desktop development agents keep working.
- Add a bounded thought-forming chat surface early, because the user often needs an LLM to help put an unclear mental state into words before Cockpit can compress it into action.

## Non-Goals

- Do not make OpenUI the durable source of cockpit truth.
- Do not let model-generated UI rearrange the core cockpit panels.
- Do not require an LLM for basic focus, parking, proof tracking, or handoff drafting.
- Do not implement a broad unbounded chat/runtime takeover in the first slice. The first chat feature should be a focused thought-forming surface that feeds the cockpit state.

## Architecture

Cockpit has three layers.

### Cockpit Kernel

The kernel is always available. It owns the typed cockpit state, deterministic fallback behavior, local persistence, session identity, keyboard-first parking, and the stable panel layout. The kernel receives messy input and mode selection, then produces or validates a `CockpitAgentOutput` object.

The kernel is plain React and TypeScript on the client, plus schema validation and deterministic fallback logic in the app layer. It should be understandable and testable without any provider credentials.

### Assistant Layer

The assistant layer is optional. When a provider is available, it can improve the kernel output, draft handoffs, summarize repo state, propose assumptions or blockers, and decide whether an OpenUI zone would help the current turn.

The assistant layer can fail without breaking the cockpit. Provider errors, token exhaustion, malformed model output, and timeouts fall back to kernel output with a visible but non-blocking status.

The first assistant-facing interaction should include a bounded chat lane for thought formation. Its job is to help the user say the thing clearly enough to act on, not to become an infinite conversation sink. The chat lane should make it easy to promote a message, summary, or assistant rewrite into the kernel as the next cockpit turn.

### OpenUI Zones

OpenUI zones are bounded render areas for generated UI. They are not the core panels and do not directly own durable state. An OpenUI artifact is a renderable assistant artifact attached to a turn or workspace.

OpenUI is appropriate for:

- experiment setup and scaffolding surfaces,
- prompt mentor panels,
- review or repo-state explorers,
- tool-result dashboards,
- thought-forming chat aids when a generated interaction helps the user express the next move,
- focused generated controls where layout composition matters.

OpenUI is not appropriate for:

- the durable session record,
- basic parking and proof tracking,
- authorization decisions,
- direct database mutation without kernel validation.

## Data Flow

Every turn follows this order:

1. The user submits a messy thought, mode, current session, optional repo context, and current parking state.
2. The kernel produces a local typed result first, using deterministic rules when needed.
3. If an assistant provider is available, the assistant may enrich the typed result.
4. If the turn benefits from generated UI, the assistant may emit an OpenUI artifact for an approved zone.
5. The durable state remains typed JSON and is validated before persistence.

This means the no-model path is not a degraded error path. It is a supported operating mode.

## Persistence

Local persistence is useful for immediate safety, but it is not enough for the intended usage. Supabase-backed persistence is the next required persistence slice because the user wants to continue using Cockpit on a phone while desktop agents are working.

The persistence model should be:

- local browser cache for fast reload safety,
- Supabase Auth and owner-scoped Postgres rows for cross-device continuity,
- no service-role key in browser code,
- conflict handling that treats the schema-first cockpit state as canonical and OpenUI artifacts as attached render history.

The first database sync slice should prioritize active session state and parking lot continuity before richer generated artifacts.

## Layout

The current layout direction is provisional until usage proves better alternatives.

- Left rail: sessions, mode, memory status, and background-work indicator.
- Center primary region: stable cockpit panels owned by the kernel.
- Center secondary region: OpenUI generated focus surface, shown only when useful.
- Right lane: future Pulse-like assistant work queue with completed summaries, proof links, pending check-ins, and async activity.
- Bottom input dock: keyboard-first capture, mode selector, park control, submit, and access to the bounded thought-forming chat lane.

The key layout rule is that model creativity cannot move or obscure the core cockpit panels.

## Error Handling

Cockpit should fail soft.

- If an LLM provider fails, the kernel result still renders.
- If tokens are exhausted, the UI labels local mode and keeps the focus loop usable.
- If OpenUI output is malformed, the OpenUI zone shows an unavailable state and the core panels remain untouched.
- If Supabase is unavailable, local cache keeps the current device usable and the UI indicates unsynced state.
- If browser local storage fails, the app remains usable for the current in-memory session.
- If chat is unavailable because no model is available, the input dock should still provide local prompts or templates that help the user form a cockpit-ready thought.

OpenUI actions should use explicit validated action envelopes. They may request kernel actions, but they should not directly mutate durable state.

## Testing

The implementation should add or preserve coverage for:

- deterministic no-LLM cockpit turns,
- provider failure and token exhaustion fallback,
- malformed OpenUI output,
- OpenUI zone isolation from stable cockpit panels,
- thought-forming chat promotion into a normal cockpit turn,
- local persistence across reload,
- Supabase owner isolation and no service-role browser usage,
- cross-device persistence once Supabase sync is added,
- e2e proof that the app remains useful with no model configured.

## Implementation Slices

1. Clarify boundaries in code names and docs: kernel, assistant layer, OpenUI zones, and persistence.
2. Refactor the current OpenUI wrapper so it is clearly a render artifact adapter, not the source of cockpit state.
3. Add a bounded thought-forming chat lane that can help the user phrase messy mental state and promote the result into a normal cockpit turn.
4. Add an explicit generated-surface slot that can render empty, unavailable, or OpenUI content without disturbing the core panels.
5. Add Supabase-authenticated persistence for active session, parking lot, and near-term chat continuity.
6. Add provider-failure, malformed-OpenUI, and chat-promotion tests.
7. After Supabase persistence and the first OpenUI zone are stable, add the right-side background work lane for Pulse-like async assistant activity.

## Open Questions

- Which generated surfaces should be first: experiments, prompt mentor, review explorer, or repo dashboard?
- Should phone use start with anonymous/local auth, magic-link auth, or a single-user dev login?
- How much OpenUI artifact history should be retained after Supabase sync exists?
- Should the first thought-forming chat appear as an expandable input-dock panel, a right-lane assistant thread, or a modal that converts directly into a cockpit turn?
