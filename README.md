# Cockpit ADHD Development Assistant

Cockpit is a focused development assistant for compressing messy input into one current goal, one next action, and one proof target. The first screen is the working cockpit, not a landing page.

## Stack

- Next.js App Router and TypeScript.
- OpenUI constrained React rendering for the assistant output surface.
- OpenAI Agents SDK for the v1 coordinator agent.
- Supabase Auth and Postgres for owner-scoped persistent memory.

## Environment

Copy `.env.example` into your local environment and provide:

- `OPENAI_API_KEY`
- `COCKPIT_LLM_PROVIDER`
- `COCKPIT_CODEX_MODEL`
- `COCKPIT_CODEX_TIMEOUT_MS`
- `CEREBRAS_API_KEY`
- `CEREBRAS_MODEL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`COCKPIT_LLM_PROVIDER` supports:

- `local`: deterministic fallback, no external model call.
- `openai`: OpenAI Agents SDK with `OPENAI_API_KEY`.
- `codex`: local `codex exec` with the signed-in Codex CLI subscription surface.
- `cerebras`: Cerebras OpenAI-compatible Chat Completions endpoint with `CEREBRAS_API_KEY`.

The Codex provider runs server-side with `--ephemeral`, `--sandbox read-only`, and a JSON output schema. If no provider is set and `OPENAI_API_KEY` is absent, the route uses the deterministic local fallback so the UI and tests still work. If Supabase is not configured or no user is authenticated, memory tools become no-ops instead of using a service role.

## Operating Model

Cockpit has a model-independent kernel. The stable panels, Parking Lot, local cache, and proof tracking work without an LLM. Assistant providers can enrich the result when available.

OpenUI is reserved for approved generated-surface zones. It does not own durable cockpit state.

The thought-forming chat lane helps turn unclear mental state into cockpit-ready input. When no model is available, it uses local phrasing prompts rather than blocking the workflow.

For Cerebras:

```env
COCKPIT_LLM_PROVIDER=cerebras
CEREBRAS_API_KEY=your_key_here
CEREBRAS_MODEL=zai-glm-4.7
```

## Development

```bash
pnpm dev
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Supabase

Start the local Supabase stack:

```bash
pnpm exec supabase start
```

For local development, `.env.local` should use the local API URL and publishable key from `supabase status -o env`. Do not put the Supabase secret key or service role key in browser-facing environment variables.

The migration in `supabase/migrations` creates:

- `cockpit_sessions`
- `parking_lot_items`
- `handoffs`
- `cockpit_chat_messages`

Every public table has RLS enabled with policies scoped to `user_id = (select auth.uid())`. Browser code uses only the Supabase publishable key.
