<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

If `node_modules/next/dist/docs/` is missing (fresh worktree), run `pnpm install` first or read docs from the main checkout at the repo root.
<!-- END:nextjs-agent-rules -->

# Working in this repo

## Superpowers workflow (primary)

The user works through the **superpowers** skill framework. Before any task, check for a matching skill via the `Skill` tool — process skills (`brainstorming`, `systematic-debugging`, `test-driven-development`) come before implementation skills.

- Design docs live in `docs/superpowers/specs/YYYY-MM-DD-name.md`.
- Implementation plans live in `docs/superpowers/plans/YYYY-MM-DD-name-slice.md` with `- [ ]` checkboxes.
- Execute plans with `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans`.
- `.superpowers/` is gitignored — visual companion artifacts only, never durable state.

## Commands

```bash
pnpm dev                  # Next.js dev server
pnpm lint                 # eslint
pnpm test                 # vitest (unit, node env, src/**/*.test.{ts,tsx})
pnpm test:watch           # vitest watch
pnpm test:e2e             # Playwright (tests/e2e, chromium + mobile-chrome)
pnpm build                # next build
pnpm exec supabase start  # local Supabase stack
```

## Architecture invariants

The cockpit has a **model-independent kernel**. Stable panels (Current Goal, Next Action, Proof Needed, Parking Lot, Handoff) must work without an LLM. Assistant providers *enrich* state; they don't own it.

- `src/lib/cockpit/` — kernel: schema-first JSON state, reducers, providers, persistence.
- `src/components/cockpit/` — stable React panels + bounded OpenUI generated-surface slot + thought-chat lane + CopilotKit assistant command center sidebar.
- `src/lib/openui/` — OpenUI adapter for the generated-surface slot **only**. OpenUI never owns durable cockpit state and never rearranges the stable panels.
- `src/app/api/cockpit/` — turn route + chat route. Return shape includes `sessionId` and persistence status.
- `supabase/migrations/` — every public table has RLS scoped to `user_id = (select auth.uid())`.

## LLM provider model

`COCKPIT_LLM_PROVIDER` selects: `local` (deterministic, no model), `openai` (Agents SDK), `codex` (`codex exec --ephemeral --sandbox read-only`, JSON schema), `cerebras` (OpenAI-compatible). If unset and `OPENAI_API_KEY` is absent, fall back to `local` so UI and tests still work. Memory tools become no-ops when Supabase isn't configured or no user is signed in — **never** use a service role to fill that gap.

## Gotchas

- **Supabase keys**: browser code uses only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never put the secret/service-role key in `NEXT_PUBLIC_*` env vars or browser bundles.
- **CopilotKit Plan sidebar**: only populates when Claude Code is in Plan Mode (`Shift+Tab`). Unrelated to Cockpit state.
- **Bounded chat**: the thought-forming chat lane is intentionally bounded — don't expand it into an unbounded runtime takeover.
- **Test scope**: vitest config only globs `src/**/*.test.{ts,tsx}`. Tests outside `src/` won't run.
- **E2E web server**: Playwright spawns `pnpm dev --hostname 127.0.0.1 --port 3000` with `reuseExistingServer: true`. Don't start another dev server on 3000 first or trace/baseURL drifts.
