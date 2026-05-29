# Agent-Friendly Development Patterns: Designing a Codebase Many AI Agents Can Build Together

- **Date:** 2026-05-29
- **Status:** Research / synthesis (no code changes)
- **Scope:** Cockpit + Vibe (the "Cockpit develops itself" system)
- **Audience:** anyone wiring the self-development loop, or designing lanes/contracts/gates

---

## TL;DR

The more good engineering practices a codebase adopts, the **smaller and safer each autonomous change becomes** — and small, safe, independent changes are exactly the precondition for many agents to develop the same codebase at once.

Every practice in this document improves at least one of **four levers** that bound an agent's competence:

| Lever | Question it answers | Why it matters for *many* agents |
|---|---|---|
| **Context size** | How much must an agent load to be correct here? | Smaller context = cheaper, less drift, more agents in parallel |
| **Blast radius** | How far can one change reach? | Bounded writes = no clobbering, conflicts pushed to merge time |
| **Verification trust** | Can the agent believe its own "it works"? | Deterministic gates = self-verification is real, not flaky |
| **Parallelism** | Can agents work without coordinating? | Contracts + ownership = work against an interface, not each other |

The recurring failure mode for parallel agents is not bad code — it is **text-level merge conflicts plus *semantic* contradictions from partial, isolated context.** UC Berkeley's MAST study (1,600+ traces across 7 frameworks) found ~42% of multi-agent failures originate in *specification and design*, and the most common production failure is *inter-agent misalignment* — agents duplicating effort, forgetting responsibilities, or holding inconsistent assumptions. **The highest-ROI fixes are organizational, not model-level:** better decomposition, ownership boundaries, and coordination protocols.

Vibe + Cockpit already embody many of these patterns (declarative lane ownership, a provider contract, a model-independent kernel, heavy worktree isolation, declared verify/approval gates). The three biggest gaps are that **ownership, verification, and approval are declared but not *enforced at execution*, and the lane runtime is not yet implemented.** Closing those is what turns "humans driving worktrees by hand" into "many agents developing Cockpit concurrently and safely."

---

## 1. Modularity & boundaries — shrink context, confine blast radius

**Principle:** co-locate what changes together; sever what doesn't. High cohesion / low coupling is the oldest rule in software design and it pays *double* for agents: a well-bounded module both fits in a smaller context window and confines the blast radius of a change.

| Practice | Mechanism | Agent benefit |
|---|---|---|
| **Vertical slices** (`Features/CreateOrder/` holds request→validation→handler→response) over horizontal layers | one feature = one folder | an agent edits one place instead of threading a change through five layers; it also curbs the AI tendency to "improve everything around" the change. Disjoint slices = disjoint agents. |
| **Screaming architecture** | directory tree announces *what the app does*, not the framework | the agent locates the right slice from structure alone — no exploration spend |
| **Ports & adapters / dependency inversion** | domain depends on interfaces, not concrete I/O | swap or stub an adapter without reading domain internals |
| **Small files/functions** | single responsibility per unit | the unit fits in context; the diff is reviewable |
| **Explicit file/area ownership ("lanes")** | each task declares the file globs it may write | *blast-radius containment* — the single most important multi-agent primitive |

> **Lanes are spec, not suggestion.** Before spawning agents, map which files each task touches. Tasks with overlapping write-sets must be **sequenced, not parallelized**. This up-front pessimistic assignment is what keeps the later optimistic merges trivial.

*Sources:* Baeldung (Vertical Slice Architecture); CodeOpinion (VSA vs Clean/Hexagonal); MindStudio (parallel agentic dev with worktrees).

---

## 2. Explicit contracts & typed interfaces — the biggest enabler of safe parallelism

**Principle:** declare the interface; don't make agents infer it. When the seam between two parts of the system is an explicit, machine-checked contract, **independent agents can each work against the contract without reading the other's implementation.** This is the single largest enabler of parallel work.

- **Schema-first / strong typing / API contracts** — the interface is declared and verifiable. Two agents on either side of it never need to share context.
- **"Parse, don't validate"** — encode invariants in types so a constructed value is *provably* valid (e.g. an `OwnedCommentId` that already proves ownership). "As long as functions maintain the contract of what the return value means, you can change either function independently." Illegal states become unrepresentable, so the agent *can't* write a whole class of bug.
- **Model-independent core** — a deterministic kernel that works without the LLM. It separates *enrichment* from *truth*, giving agents a stable substrate to build against rather than a moving target.

*Sources:* Alexis King, "Parse, don't validate"; Type-Driven Design (Rust).

---

## 3. Determinism & reproducibility — make the verification signal trustworthy

**Principle:** an agent's "it builds / it passes" is only useful if it is *reproducible*. Flaky or environment-dependent signals make agent self-verification meaningless.

- **Hermetic builds + pinned deps** — frozen toolchain + lockfiles → same source yields same artifact across every worktree.
- **Pure functions / no hidden global state + idempotency** — behavior is a function of inputs the agent can see, so it can reason locally and re-run safely.
- **Seeded randomness + reproducible fixtures** — "given the same repo state, failures, config, and model version, the agent produces the same patch and the same evaluation." Determinism is what makes self-verification *believable*.

*Sources:* reproducible-builds.org; Datadog ("closing the verification loop"); debugg.ai (deterministic debugging).

---

## 4. Machine-readable conventions & context — kill guesswork and drift

**Principle:** encode the rules in the repo, not in a prompt. A context-compacting agent forgets verbal guidance; it does not forget a file it re-reads.

- **AGENTS.md / CLAUDE.md** — a predictable in-repo home for build commands, conventions, and hard "never/always" constraints (now a Linux-Foundation-governed standard across 20k+ repos). Use **hierarchical/nested** files so deep directories carry local rules — single root files don't scale past a modest codebase.
- **Codified lint/format rules + ADRs** — ADRs preserve the *why* so an agent doesn't relitigate settled decisions; lint config makes style a deterministic gate, not a plea in a prompt.
- **Self-documenting code + README-as-contract + `llms.txt`** — treat docs as load-bearing infrastructure agents depend on for correct output.

*Sources:* AGENTS.md standard (Harness, Augment); "AGENTS.md is the new ADR."

---

## 5. Fast automated feedback & verification — tighter loops matter more for agents

**Principle:** a passing test suite is "an external source of truth that remains accurate regardless of how long an agentic session runs." It counters the LLM tendency to satisfy the *letter* not the *intent* — a tendency that compounds as context is compacted.

- **TDD + comprehensive tests as the source of truth.**
- **Type-check + lint as deterministic gates; pre-commit/pre-push hooks.** Gates must be **deterministic, not AI-powered.** "Not done until the linter is green and tests pass" (verification before completion).
- **Fast, smallest-relevant test runs + terse output** — verbose tool output slows agents significantly; a tight loop keeps the agent on-task and cheap.
- **Gate twice, make it unbypassable** — the agent runs the verifier internally *before* opening a PR, and **CI re-runs the same verifier as a hard gate the agent cannot skip.** Standard CI alone is insufficient: agents produce code that passes tests while violating the agreed contract (spec drift, hallucinated deps).

*Sources:* Codex TDD workflow; Augment ("pre-merge verification"); reccehq ("build these gates").

---

## 6. Small, atomic, reversible changes & coordination — the multi-agent substrate

**Principle:** small reversible units suit autonomous agents because they are reviewable, bisectable, and cheap to roll back.

- **Single-responsibility commits + atomic PRs** — one concern per unit; small diffs limit blast radius.
- **Trunk-based dev + feature flags** — merge small, frequent changes; wrap incomplete work behind an inactive flag so "merged" ≠ "released" and rollback is a config toggle. Avoids divergent long-lived branches that collide.
- **Git worktrees (one per agent)** — isolated filesystem + index so agents don't overwrite one another. This is the *practical substrate* for concurrency: conflicts surface at merge time, handled by standard git tooling, instead of agents fighting over `.git/index.lock` mid-flight.

### Coordination topologies (how the agents relate)

| Topology | Mechanism | When to use |
|---|---|---|
| **Supervisor / hierarchical** | a lead decomposes work, delegates to workers, merges in dependency order | de-facto 2026 production standard; traceable, debuggable; best for codebases |
| **Swarm / peer** | agents coordinate through **shared state** (blackboard / task queue + claim-lock registry), not direct chatter | high-throughput, decentralized; needs idempotent task definitions |
| **Isolation (subagents)** | each agent runs in its **own context window**, returns only a result | what makes parallelism *safe* — siblings can't pollute each other's context |

> **Isolation beats sharing for parallelism.** Give each agent its own context window *and* its own worktree/branch; **merge results, don't share live state.** Coordinate through a task queue + completion registry (claim → execute → report) so work is idempotent and never duplicated. Keep a **human on-the-loop at merge** for high-risk paths (auth, billing, core data, persistence).

*Sources:* Anthropic ("How we built our multi-agent research system" — orchestrator-worker, isolated contexts, ~90% faster / ~15x tokens); OpenAI ("Routines and Handoffs"); Augment ("Swarm vs Supervisor", "git worktrees for parallel agents"); Atlassian / trunkbaseddevelopment.com (trunk-based + feature flags).

---

## 7. How Vibe + Cockpit map today

The system already embodies more of this than most codebases. The pattern is consistent: **the right concepts are declared, but enforcement and runtime are partial.**

| Pattern | What exists (evidence) | Gap |
|---|---|---|
| **Modularity / ownership** | Vibe lanes declare `owns`/`reads` globs (`examples/vibe-self.vibe`); a real overlap-checker exists — `ValidatePlan` / `scopesOverlap` / `normalizeScope` in `go/internal/lanes/coordinator.go:144,188,177` rejects overlapping write-scopes and `../` escapes. Cockpit's 3-way kernel split (`src/lib/cockpit/` kernel · `src/components/cockpit/` panels · `src/lib/openui/` bounded slot) is documented in `AGENTS.md`. | `ValidatePlan` runs only on the **lane-plan IR**, not the self-plan's free-form `owns` strings (which already overlap: `go/**` vs `packages/language/**`). `TurnRequest` carries **no lane/scope identity**, so a spawned CLI agent can write outside its `owns` set. |
| **Contracts** | Clean provider seam: `agent.Provider` = one method `RunTurn(ctx, TurnRequest) (<-chan Event, error)` (`go/agent/provider.go`); daemon HTTP contract `/healthz` · `/v1/providers` · `/v1/turn` SSE (`go/internal/serve/serve.go:101`). Cockpit plugin contract is fully typed + versioned (`src/lib/plugins/contract/types.ts`); state is schema-first (Zod + `cockpit-output.schema.json`). | `TurnRequest` has no `owns`/`reads` field, so the provider boundary is blind to blast radius. `LaneEvent` has `file_write` but no contract field constraining *which* paths a lane may write. |
| **Determinism** | Cockpit's `local` provider is genuinely model-free/deterministic (`src/lib/cockpit/agent.ts` `saveFallback`); codex provider pins a JSON schema; persistence re-validates every field (`kernel-state.ts`). Vibe pins toolchain (`pnpm@10.33.4`, `go-version-file`). | Codex/OpenAI providers are non-deterministic with no recorded-fixture replay. Cockpit `runLane` is **contract-only** — `InProcessVibeService` implements only `listLanes`/`generateHandoff` (Phase 1). |
| **Conventions** | `AGENTS.md`/`CLAUDE.md` in both repos; cross-agent `plugins/vibe-workbench/shared/vibe-contract.md` codifies the six portable lane concepts; Vibe validates artifacts via `pnpm run schemas:check`. | Cockpit has **no lint/format CI**; Vibe root `lint` is a stub (`echo "no lint configured yet"`). `InProcessVibeService` scans `<root>/lanes/*.json` but **that dir doesn't exist**, so lane discovery returns nothing. |
| **Verification gates** | Per-lane `verify:` commands are first-class (`vibe-self.vibe`: `["pnpm run self:plan","pnpm test","pnpm run build"]`) and flow into handoffs. Vibe CI runs go build/vet/test + `schemas:check` + a **self-plan drift guard** (`.github/workflows/ci.yml`). Cockpit enforces RLS on every table (`user_id = (select auth.uid())`). | Cockpit has **no `.github/workflows/` at all** — its lint/test/build/e2e scripts never run automatically; an agent can merge unverified. Lane `verify:` strings are emitted into handoff text but **never executed** by the runtime. |
| **Atomic / reversible / coordination** | Heavy worktree isolation is live (Vibe 8, Cockpit 4 worktrees under `.claude/worktrees/`, gitignored). Human gates declared: `approval: human.before_commit` / `before_runtime`, a `human_merge_gate` lane, and the `vibe-handoff` skill (dirty-state warning, out-of-scope files, approval point). | `approval` is **documented data, not an enforced gate** — no code blocks a commit on `human.before_commit`; the handoff route returns artifacts without checking approval. Reversibility relies entirely on git + human review. |

### The three biggest gaps for *many* concurrent agents

1. **Ownership is declared but not enforced at execution.** The only real overlap-checker runs on the lane-plan IR and ignores the self-plan's `owns` globs (already overlapping). `TurnRequest` has no scope field, so a spawned agent can write anywhere. *With many agents, write collisions are inevitable.*
2. **Approval/verify gates are advisory text, not machine-enforced** — nothing executes `verify:` or blocks a commit on `human.before_commit`, and Cockpit has no CI workflow at all, so even existing lint/test/build/RLS gates don't run on changes.
3. **Lane execution + discovery are unimplemented** — Cockpit's `runLane` is contract-only, `lanes/` doesn't exist, and the lane `impl` dirs (`./tools/*-lane`) don't exist. Coordination today is humans driving worktrees by hand; there is no runtime that *assigns → isolates → verifies → merges* parallel agent work end-to-end.

---

## 8. Prioritized recommendations

Ordered by ROI (impact per unit effort). Each closes a verified gap above and maps to one or more levers.

1. **Add a CI workflow to Cockpit** (`.github/workflows/ci.yml`) running `pnpm lint && pnpm test && pnpm build`, plus the RLS/schema checks. *Lever: verification trust. Effort: low.* Mirror Vibe's existing CI. This is the "gate twice, unbypassable" half that's currently missing.
2. **Make `verify` an executed contract, not text.** Have the lane runtime (and the self-dev route) actually run each lane's `verify:` commands and refuse to mark a turn complete unless they pass. *Lever: verification trust, parallelism.*
3. **Thread lane scope into `TurnRequest` and enforce it.** Add `owns`/`reads` (or a `laneId` resolving to them) to `TurnRequest`; before/after a turn, reject writes outside the `owns` globs (reuse `normalizeScope`/`scopesOverlap`). *Lever: blast radius. This is the key safety upgrade for concurrency.*
4. **Run `ValidatePlan` over the self-plan, and fix the overlapping lanes** (`go/**` vs `packages/language/**` vs `runtime_spike_lane`). Make overlap a build-time error. *Lever: parallelism. Effort: low — the checker already exists.*
5. **Enforce the approval gate.** Make `human.before_commit` block a commit (or merge) in code, not just describe one. Keep a human on-the-loop for high-risk paths (auth, **persistence** — see the standing parking-lot durability concern). *Lever: blast radius.*
6. **Implement lane discovery + execution** (`lanes/` dir + `runLane`) so the supervisor can assign → isolate (worktree) → verify → merge. Start with the supervisor/hierarchical topology (lead merges in dependency order); a task-queue + claim-lock registry can come later for swarm-style throughput. *Lever: parallelism. Effort: high — this is the runtime.*
7. **Adopt small-atomic-PR + trunk discipline for agent output**, with feature flags for incomplete work, so many lanes integrate continuously instead of accumulating colliding long-lived branches.

**Sequencing logic:** 1–2 give a trustworthy verification signal *now* (cheap, high value). 3–5 make ownership and approval *enforced* rather than advisory — the safety preconditions for unattended concurrency. 6 builds the runtime that exploits all of the above. The order deliberately front-loads the "make the signal real" work, because per MAST the organizational/coordination fixes — not the model — deliver the reliability.

---

## Sources

**Multi-agent orchestration & failure modes**
- Anthropic — [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- UC Berkeley MAST — [Why Do Multi-Agent LLM Systems Fail? (arXiv 2503.13657)](https://arxiv.org/abs/2503.13657)
- OpenAI — [Orchestrating Agents: Routines and Handoffs](https://developers.openai.com/cookbook/examples/orchestrating_agents)
- Composio — [Claude Agents SDK vs OpenAI Agents SDK vs Google ADK](https://composio.dev/content/claude-agents-sdk-vs-openai-agents-sdk-vs-google-adk)
- DataCamp — [CrewAI vs LangGraph vs AutoGen](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- Augment Code — [Git Worktrees for Parallel AI Agent Execution](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution) · [Swarm vs Supervisor](https://www.augmentcode.com/guides/swarm-vs-supervisor) · [CI/CD for AI Agents](https://www.augmentcode.com/guides/cicd-ai-agents-pipeline-integration) · [AI Agent Pre-Merge Verification](https://www.augmentcode.com/guides/ai-agent-pre-merge-verification) · [Why Multi-Agent LLM Systems Fail](https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them)
- MindStudio — [Parallel Agentic Development With Git Worktrees](https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees) · [Automated Code Review with Multiple AI Agents](https://www.mindstudio.ai/blog/automated-code-review-multiple-ai-agents)
- Codefinity — [The Architecture of AI Agent Swarms](https://codefinity.com/blog/The-Architecture-Of-AI-Agent-Swarms)
- Galileo — [Why Multi-Agent Systems Fail](https://galileo.ai/blog/why-multi-agent-systems-fail)

**Agent-friendly code design**
- Alexis King — [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
- [Type-Driven Design in Rust](https://www.harudagondi.space/blog/parse-dont-validate-and-type-driven-design-in-rust/)
- Baeldung — [Vertical Slice Architecture](https://www.baeldung.com/java-vertical-slice-architecture)
- CodeOpinion — [VSA vs Clean Architecture / Ports & Adapters](https://codeopinion.com/is-vertical-slice-architecture-better-than-clean-architecture-or-ports-and-adapters/)
- reproducible-builds.org · Datadog ([harness-first agents](https://www.datadoghq.com/blog/ai/harness-first-agents/)) · debugg.ai ([deterministic debugging](https://debugg.ai/resources/deterministic-debugging-reproducible-ai-seeds-snapshots-time-travel-builds))
- Harness — [The Agent-Native Repo: Why AGENTS.md is the New Standard](https://www.harness.io/blog/the-agent-native-repo-why-agents-md-is-the-new-standard) · Augment — [How to Build Your AGENTS.md](https://www.augmentcode.com/guides/how-to-build-agents-md)
- Atlassian — [Trunk-Based Development](https://www.atlassian.com/continuous-delivery/continuous-integration/trunk-based-development) · [Feature flags](https://trunkbaseddevelopment.com/feature-flags/)
- Codex — [TDD red-green-refactor workflow](https://codex.danielvaughan.com/2026/04/10/codex-cli-test-driven-development-workflow/) · reccehq — [Build these gates](https://blog.reccehq.com/before-you-let-agents-touch-your-codebase-build-these-gates)
