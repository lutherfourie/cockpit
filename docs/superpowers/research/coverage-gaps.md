# Cockpit Coverage Gaps

## Scope

Reviewed `src/lib/cockpit` and `src/components/cockpit` for high-risk logic that was not already covered by focused unit tests. Existing coverage already exercised schema normalization, kernel reducers, repo-state parsing, assistant-event parsing, agent fallback behavior, codex exec parsing, generated-surface degradation, lane inventory loading, and the assistant command center.

## Critical Gaps Found

- `src/lib/cockpit/storage.ts`: Supabase persistence behavior was untested even though it is the boundary that must preserve user-scoped state, local no-op behavior, chronological chat loading, assistant-event fallback, and session title compaction.
- `src/components/cockpit/thought-chat-lane.tsx`: the bounded chat lane had no tests for collapsed-by-default behavior, blank input rejection, request payload shape, assistant response appending, promotion, or API error handling.
- `src/components/cockpit/cockpit-panels.tsx`: stable cockpit panels had no direct test proving they render the model-independent kernel output without relying on an assistant/provider runtime.

## Tests Added

- `src/lib/cockpit/storage.test.ts`
  - Covers `NullCockpitMemoryStore` as a complete no-op persistence implementation.
  - Verifies session loading is scoped by both `session_id` and `user_id`.
  - Verifies chat messages are loaded newest-first from storage and returned chronologically.
  - Verifies assistant activity falls back to legacy chat messages when event rows are absent.
  - Verifies new session persistence writes cockpit output fields and compact titles.
  - Verifies existing session updates remain scoped by both session and user filters.

- `src/components/cockpit/thought-chat-lane.test.tsx`
  - Covers collapsed-by-default bounded lane behavior.
  - Verifies blank submissions do not append messages or call the chat API.
  - Verifies trimmed request payloads, existing-history payload shape, assistant append behavior, and promotion.
  - Verifies API failures show an inline bounded error without exposing promotion actions.

- `src/components/cockpit/cockpit-panels.test.tsx`
  - Verifies stable Current Goal, Next Action, and Proof Needed panels render from structured cockpit output.
  - Verifies the assumptions block is omitted when no assumptions exist.

## Remaining Notable Gaps

- `src/components/cockpit/cockpit-app.tsx` still contains a large amount of integrated UI state logic that is only indirectly covered. The highest-value future tests would target slash command handling, capture-intent routing, localStorage persistence events, assistant activity fetch/subscription handling, and focus-mode behavior.
- `src/components/cockpit/auth-panel.tsx` is still untested. Focused tests should mock `createSupabaseBrowserClient` and cover unconfigured local mode, OTP sign-in status updates, sign-out, and auth subscription cleanup.
- `src/lib/cockpit/supabase-client.ts` and `src/lib/cockpit/supabase-server.ts` remain lightly covered by static review only. Future tests could mock `@supabase/ssr` and `next/headers` to verify publishable-key gating and cookie adapter behavior.
