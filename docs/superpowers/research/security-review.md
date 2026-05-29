# Security Review: Supabase Browser Key Exposure

Date: 2026-05-29

## Scope

This review checked the Cockpit worktree for Supabase secret or service-role key exposure through `NEXT_PUBLIC_*` variables, browser-bundled modules, Docker build arguments, examples, documentation, and tests. It also checked that browser code uses only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Supabase client creation.

## Reference Points

- Next.js bundled docs (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`) state that `NEXT_PUBLIC_*` variables are inlined into JavaScript sent to the browser.
- Next.js bundled docs (`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`) state that `"use client"` marks a client bundle boundary and all imports under that boundary are included in the client bundle.
- Supabase documentation says publishable keys are safe to expose online when scoped by Row Level Security, while secret keys and legacy `service_role` keys bypass RLS and must never be used in a browser.

## Audit Evidence

### Public Supabase Environment Variables

Allowed browser-facing variables found:

- `.env.example:7` uses `NEXT_PUBLIC_SUPABASE_URL`.
- `.env.example:8` uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `Dockerfile:23-26` defines only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` build-time values.
- `docker-compose.yml:23-24` passes only those same two `NEXT_PUBLIC_SUPABASE_*` build arguments.
- `src/lib/cockpit/supabase-client.ts:6-14` creates the browser client from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `src/lib/cockpit/supabase-server.ts:6-20` creates the server SSR client from the same publishable key and cookie-bound auth state; it does not use a service-role key.

No `NEXT_PUBLIC_*` variable containing `SECRET`, `SERVICE`, or `ROLE` was found in tracked repo files.

### Browser Bundle Boundary

Client components that use Supabase import only `createSupabaseBrowserClient`:

- `src/components/cockpit/auth-panel.tsx:1-10`
- `src/components/cockpit/cockpit-app.tsx:1-48`

Server Supabase imports are limited to route-handler files:

- `src/app/auth/callback/route.ts:3`
- `src/app/api/cockpit/route.ts:8`
- `src/app/api/cockpit/chat/route.ts:8`
- `src/app/api/cockpit/assistant/route.ts:13`

No client component imports `src/lib/cockpit/supabase-server.ts`.

### Service-Role and Secret-Key Search

Searches for `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `sb_secret_`, `service_role`, `service role key`, and secret-looking `NEXT_PUBLIC_*` names found no active key material or browser-facing service-role configuration. The only matches were documentation warnings and an existing RLS regression assertion:

- `README.md:68` warns not to put Supabase secret or service-role keys in browser-facing env vars.
- `docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md:1164` documents that plugin memory must not use `SUPABASE_SERVICE_ROLE_KEY`.
- `src/lib/cockpit/supabase-rls.test.ts:50` asserts migrations do not mention `service_role`.

### RLS Posture

The existing migrations enable RLS and scope public-table policies to `user_id = (select auth.uid())`. The existing regression test checks every public table and append-only assistant event table for owner-scoped RLS and rejects `service_role` in migration SQL.

## Findings

No Supabase secret-key or service-role leak was found in tracked code, docs, examples, or browser-reachable imports.

The browser Supabase client uses only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, matching the project invariant and Supabase's documented publishable-key model. Server route handlers use the cookie-bound Supabase SSR client and fall back to no-op persistence when Supabase is not configured or no authenticated user is present, rather than using a service-role key.

## Fixes Applied

No leak fix was required. This research note is the task artifact.

## Verification Results

Static review commands used:

```powershell
rg -n --hidden -S --glob '!node_modules/**' --glob '!.next/**' --glob '!.git/**' --glob '!pnpm-lock.yaml' --glob '!CODEX_TASK.md' -e 'NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE|ROLE)|NEXT_PUBLIC_SUPABASE_(SECRET|SERVICE|SERVICE_ROLE)|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sb_secret_|service_role|service role key|secret key' .
rg -n --hidden -S --glob '!node_modules/**' --glob '!.next/**' --glob '!.git/**' --glob '!pnpm-lock.yaml' --glob '!CODEX_TASK.md' -e 'NEXT_PUBLIC_[A-Z0-9_]+' .
rg -n -S --hidden --glob '!node_modules/**' --glob '!.next/**' --glob '!.git/**' --glob '!pnpm-lock.yaml' --glob '!CODEX_TASK.md' -e 'from "@/lib/cockpit/supabase-server"|supabase-server' src
rg -n -S --hidden --glob '!node_modules/**' --glob '!.next/**' --glob '!CODEX_TASK.md' -e 'from "@/lib/cockpit/supabase-client"|supabase-client' src
```

Focused test attempted:

```powershell
pnpm exec vitest run src/lib/cockpit/supabase-rls.test.ts
```

Result: Vitest did not reach the test body. Vite failed while loading `vitest.config.ts` with `spawn EPERM` from dependency/config resolution in the shared `node_modules` junction. The static review above is the completed verification for this task.

## Residual Risk

This review did not inspect ignored local files such as `.env.local`, because those may contain developer secrets and are intentionally not committed. Deployment environments should still verify that no secret or service-role key is assigned to a `NEXT_PUBLIC_*` variable at build time.
