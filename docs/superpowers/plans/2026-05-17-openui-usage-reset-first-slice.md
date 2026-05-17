# OpenUI Usage Reset First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cockpit's core loop model-independent, add a bounded thought-forming chat lane, reserve OpenUI for generated assistant surfaces, and add the first Supabase persistence path for cross-device continuity.

**Architecture:** The cockpit kernel owns durable schema-first JSON state and renders stable panels in plain React. Assistant providers can enrich kernel state and can emit OpenUI artifacts only into an explicit generated-surface slot. Supabase Auth and owner-scoped rows sync active session, parking lot, and near-term chat continuity while local storage remains the fast reload cache.

**Tech Stack:** Next.js App Router, React 19, TypeScript, OpenUI React packages, OpenAI Agents SDK providers, Supabase SSR/Auth/Postgres/RLS, Vitest, Playwright.

---

## Scope Check

The approved spec includes a future Pulse-like right lane and peripheral graph/deep-agent-style orchestration. This plan does not implement the background work lane or adopt LangGraph or Deep Agents as a runtime dependency. It reserves those directions through typed kernel boundaries, generated-surface isolation, and persistence shape, then stops after the first usable slice: kernel boundary reset, thought-forming chat, OpenUI generated slot, and Supabase session/parking/chat persistence.

## File Structure

- Modify `.gitignore`: ignore `.superpowers/` visual companion artifacts.
- Create `src/lib/cockpit/kernel-state.ts`: typed client kernel state, local storage key, parser, reducer helpers, and promotion helpers.
- Create `src/lib/cockpit/kernel-state.test.ts`: unit tests for parsing, local fallback state, parking, chat promotion, and generated-surface isolation.
- Modify `src/lib/cockpit/schema.ts`: add schemas for generated surfaces, thought chat messages, and turn results.
- Modify `src/lib/cockpit/schema.test.ts`: test new schema normalization and malformed surface fallback.
- Modify `src/lib/cockpit/agent.ts`: return a turn result that includes `output`, `sessionId`, and persistence status.
- Modify `src/lib/cockpit/agent.test.ts`: update expectations for the turn result and provider fallback.
- Modify `src/app/api/cockpit/route.ts`: return `sessionId` and persistence status from the turn result.
- Create `src/lib/cockpit/thought-chat.ts`: bounded thought-forming chat runner with deterministic fallback and provider-aware response shape.
- Create `src/lib/cockpit/thought-chat.test.ts`: unit tests for no-model fallback, promotion text, and provider failure.
- Create `src/app/api/cockpit/chat/route.ts`: route for thought-forming chat.
- Create `src/components/cockpit/cockpit-panels.tsx`: plain React stable cockpit panels.
- Create `src/components/cockpit/generated-surface-slot.tsx`: bounded OpenUI zone with empty, unavailable, and render states.
- Create `src/components/cockpit/thought-chat-lane.tsx`: expandable thought-forming chat UI with promote action.
- Modify `src/components/cockpit/cockpit-app.tsx`: use kernel state helpers, render plain panels, add generated slot, add chat lane, and keep keyboard-first input.
- Replace `src/lib/openui/cockpit-library.tsx` with `src/lib/openui/generated-surface-library.tsx`: OpenUI artifact adapter only.
- Create `src/lib/openui/generated-surface-library.test.ts`: unit tests for OpenUI response creation and malformed artifact fallback.
- Create `src/lib/cockpit/supabase-client.ts`: browser Supabase client.
- Create `src/components/cockpit/auth-panel.tsx`: bounded sign-in/sign-out status panel.
- Create `src/app/auth/callback/route.ts`: exchange Supabase auth code for a server session.
- Create `supabase/migrations/20260517193000_add_cockpit_chat_messages.sql`: chat messages table with RLS.
- Modify `src/lib/cockpit/storage.ts`: add chat persistence methods and parking/session load helpers.
- Modify `src/lib/cockpit/supabase-rls.test.ts`: cover the new chat table and no service-role browser usage.
- Modify `tests/e2e/cockpit.spec.ts`: cover no-model operation, chat promotion, local reload persistence, and stable panels.
- Leave `experiments/langgraph-runner` unimplemented in this first slice. Add it in a later plan as the first peripheral orchestration experiment. Evaluate Deep Agents only after the LangGraph boundary proves useful, because Deep Agents is a higher-level harness and the user may eventually build a custom Cockpit-shaped harness.

## Task 1: Repo Hygiene And Kernel State

**Files:**
- Modify: `.gitignore`
- Create: `src/lib/cockpit/kernel-state.ts`
- Create: `src/lib/cockpit/kernel-state.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Ignore visual companion artifacts**

Add this line under the testing ignores in `.gitignore`:

```gitignore
/.superpowers/
```

- [ ] **Step 2: Allow React component test filenames**

Keep the test environment as `node` for this task. Modify `vitest.config.ts` to include both `.test.ts` and `.test.tsx` filenames so later component-adjacent tests are discovered:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 3: Write the failing kernel state tests**

Create `src/lib/cockpit/kernel-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  createInitialKernelState,
  parseKernelState,
  promoteThoughtMessage,
  reduceKernelState,
} from "./kernel-state";

describe("cockpit kernel state", () => {
  it("falls back to a usable initial state when persisted data is invalid", () => {
    const state = parseKernelState("{not json");

    expect(state.output.currentGoal).toContain("Capture the next development move");
    expect(state.mode).toBe("focus");
    expect(state.theme).toBe("dim");
    expect(state.generatedSurface.status).toBe("empty");
  });

  it("adds parking items without growing beyond the cockpit limit", () => {
    let state = createInitialKernelState();

    for (const item of ["one", "two", "three", "four", "five", "six"]) {
      state = reduceKernelState(state, { type: "park", content: item });
    }

    expect(state.output.parkingLot).toEqual(["two", "three", "four", "five", "six"]);
  });

  it("promotes a thought chat message into cockpit-ready input text", () => {
    const text = promoteThoughtMessage({
      id: "message-1",
      role: "assistant",
      content: "You seem to be trying to decide whether OpenUI owns core state.",
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    expect(text).toBe(
      "You seem to be trying to decide whether OpenUI owns core state.",
    );
  });

  it("keeps generated surface separate from durable cockpit output", () => {
    const state = reduceKernelState(createInitialKernelState(), {
      type: "setGeneratedSurface",
      surface: {
        status: "ready",
        kind: "assistant_note",
        title: "Prompt Mentor",
        body: "Ask for proof before broad refactors.",
      },
    });

    expect(state.output.currentGoal).toContain("Capture the next development move");
    expect(state.generatedSurface.status).toBe("ready");
  });
});
```

- [ ] **Step 4: Run the failing test**

Run:

```bash
pnpm vitest run src/lib/cockpit/kernel-state.test.ts
```

Expected: fail because `src/lib/cockpit/kernel-state.ts` does not exist.

- [ ] **Step 5: Implement kernel state**

Create `src/lib/cockpit/kernel-state.ts`:

```ts
import {
  COCKPIT_MODES,
  type CockpitAgentOutput,
  type CockpitMode,
} from "./schema";

export type CockpitTheme = "dim" | "light";

export type ThoughtChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type GeneratedSurface =
  | { status: "empty" }
  | { status: "unavailable"; reason: string }
  | {
      status: "ready";
      kind: "assistant_note" | "prompt_mentor" | "experiment_setup";
      title: string;
      body: string;
      actions?: { label: string; value: string }[];
    };

export type CockpitKernelState = {
  output: CockpitAgentOutput;
  sessionId?: string;
  mode: CockpitMode;
  theme: CockpitTheme;
  generatedSurface: GeneratedSurface;
  thoughtChat: ThoughtChatMessage[];
};

export type KernelAction =
  | { type: "setOutput"; output: CockpitAgentOutput; sessionId?: string }
  | { type: "setMode"; mode: CockpitMode }
  | { type: "setTheme"; theme: CockpitTheme }
  | { type: "park"; content: string }
  | { type: "appendThoughtMessage"; message: ThoughtChatMessage }
  | { type: "setGeneratedSurface"; surface: GeneratedSurface };

export const COCKPIT_STATE_STORAGE_KEY = "cockpit:v1:state";

const MAX_PARKING_ITEMS = 5;
const THEMES = ["dim", "light"] as const;

const INITIAL_OUTPUT: CockpitAgentOutput = {
  currentGoal: "Capture the next development move without expanding the scope.",
  nextAction: "Paste the messy thought, choose a mode, and ask Cockpit to compress it.",
  proofNeeded:
    "The three primary panels update into one coherent, checkable slice.",
  parkingLot: [],
  assumptions: ["No assistant turn has run yet."],
  blockers: [],
};

export function createInitialKernelState(): CockpitKernelState {
  return {
    output: INITIAL_OUTPUT,
    mode: "focus",
    theme: "dim",
    generatedSurface: { status: "empty" },
    thoughtChat: [],
  };
}

export function parseKernelState(rawState: string | null): CockpitKernelState {
  if (!rawState) {
    return createInitialKernelState();
  }

  try {
    const parsed = JSON.parse(rawState) as unknown;
    if (!isRecord(parsed)) {
      return createInitialKernelState();
    }

    const initial = createInitialKernelState();

    return {
      output: isCockpitOutput(parsed.output) ? parsed.output : initial.output,
      sessionId:
        typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
          ? parsed.sessionId
          : undefined,
      mode: isCockpitMode(parsed.mode) ? parsed.mode : initial.mode,
      theme: isTheme(parsed.theme) ? parsed.theme : initial.theme,
      generatedSurface: isGeneratedSurface(parsed.generatedSurface)
        ? parsed.generatedSurface
        : initial.generatedSurface,
      thoughtChat: Array.isArray(parsed.thoughtChat)
        ? parsed.thoughtChat.filter(isThoughtChatMessage).slice(-20)
        : initial.thoughtChat,
    };
  } catch {
    return createInitialKernelState();
  }
}

export function serializeKernelState(state: CockpitKernelState): string {
  return JSON.stringify(state);
}

export function reduceKernelState(
  state: CockpitKernelState,
  action: KernelAction,
): CockpitKernelState {
  switch (action.type) {
    case "setOutput":
      return {
        ...state,
        output: action.output,
        sessionId: action.sessionId ?? state.sessionId,
      };
    case "setMode":
      return { ...state, mode: action.mode };
    case "setTheme":
      return { ...state, theme: action.theme };
    case "park": {
      const content = action.content.replace(/\s+/g, " ").trim();
      if (!content) {
        return state;
      }

      return {
        ...state,
        output: {
          ...state.output,
          parkingLot: [...state.output.parkingLot, content].slice(
            -MAX_PARKING_ITEMS,
          ),
        },
      };
    }
    case "appendThoughtMessage":
      return {
        ...state,
        thoughtChat: [...state.thoughtChat, action.message].slice(-20),
      };
    case "setGeneratedSurface":
      return { ...state, generatedSurface: action.surface };
  }
}

export function promoteThoughtMessage(message: ThoughtChatMessage): string {
  return message.content.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCockpitMode(value: unknown): value is CockpitMode {
  return (
    typeof value === "string" &&
    (COCKPIT_MODES as readonly string[]).includes(value)
  );
}

function isTheme(value: unknown): value is CockpitTheme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

function isCockpitOutput(value: unknown): value is CockpitAgentOutput {
  return (
    isRecord(value) &&
    typeof value.currentGoal === "string" &&
    typeof value.nextAction === "string" &&
    typeof value.proofNeeded === "string" &&
    isStringArray(value.parkingLot) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.blockers) &&
    (value.handoff === undefined || typeof value.handoff === "string")
  );
}

function isThoughtChatMessage(value: unknown): value is ThoughtChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
}

function isGeneratedSurface(value: unknown): value is GeneratedSurface {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === "empty") {
    return true;
  }

  if (value.status === "unavailable") {
    return typeof value.reason === "string";
  }

  return (
    value.status === "ready" &&
    (value.kind === "assistant_note" ||
      value.kind === "prompt_mentor" ||
      value.kind === "experiment_setup") &&
    typeof value.title === "string" &&
    typeof value.body === "string"
  );
}
```

- [ ] **Step 6: Run the kernel state test**

Run:

```bash
pnpm vitest run src/lib/cockpit/kernel-state.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add .gitignore vitest.config.ts src/lib/cockpit/kernel-state.ts src/lib/cockpit/kernel-state.test.ts
git commit -m "feat: add cockpit kernel state"
```

## Task 2: Turn Result And Persistence Status

**Files:**
- Modify: `src/lib/cockpit/schema.ts`
- Modify: `src/lib/cockpit/schema.test.ts`
- Modify: `src/lib/cockpit/agent.ts`
- Modify: `src/lib/cockpit/agent.test.ts`
- Modify: `src/app/api/cockpit/route.ts`

- [ ] **Step 1: Write the failing schema test**

Add this test to `src/lib/cockpit/schema.test.ts`:

```ts
it("parses a cockpit turn result with persistence status", () => {
  const parsed = CockpitTurnResultSchema.parse({
    output: {
      currentGoal: "Keep Cockpit useful without models",
      nextAction: "Return a typed turn result",
      proofNeeded: "Route response includes output and persistence",
      parkingLot: [],
      assumptions: [],
      blockers: [],
    },
    sessionId: "00000000-0000-4000-8000-000000000000",
    persistence: { saved: true, source: "supabase" },
  });

  expect(parsed.persistence.source).toBe("supabase");
});
```

- [ ] **Step 2: Run the failing schema test**

Run:

```bash
pnpm vitest run src/lib/cockpit/schema.test.ts
```

Expected: fail because `CockpitTurnResultSchema` is not exported.

- [ ] **Step 3: Add turn result schemas**

Modify `src/lib/cockpit/schema.ts` by adding these exports after `CockpitAgentOutputSchema`:

```ts
export const CockpitPersistenceSchema = z.object({
  saved: z.boolean(),
  source: z.enum(["supabase", "local", "none"]),
  reason: z.string().optional(),
});

export const CockpitTurnResultSchema = z.object({
  output: CockpitAgentOutputSchema,
  sessionId: z.string().uuid().optional(),
  persistence: CockpitPersistenceSchema,
});

export type CockpitPersistence = z.infer<typeof CockpitPersistenceSchema>;
export type CockpitTurnResult = z.infer<typeof CockpitTurnResultSchema>;
```

Update the import list in `src/lib/cockpit/schema.test.ts`:

```ts
import {
  AgentInputSchema,
  CockpitProviderSchema,
  CockpitTurnResultSchema,
  createFallbackCockpitOutput,
  parseCockpitOutput,
} from "./schema";
```

- [ ] **Step 4: Update the agent test for turn results**

In `src/lib/cockpit/agent.test.ts`, update the first fallback test assertion shape:

```ts
const result = await runCockpitAgent(
  { message: "I need to fix tests but also rethink auth", mode: "focus" },
  { store },
);

expect(result.output.currentGoal).toContain("I need to fix tests");
expect(result.output.nextAction).toContain("smallest concrete step");
expect(result.persistence.saved).toBe(true);
expect(result.persistence.source).toBe("supabase");
expect(store.saveSessionState).toHaveBeenCalledOnce();
```

Update the mock store save result in `createMockStore()`:

```ts
saveSessionState: vi.fn(async () => ({
  sessionId: "00000000-0000-4000-8000-000000000000",
  saved: true,
})),
```

Apply the same `result.output` shape to the Codex and Cerebras tests.

- [ ] **Step 5: Run the failing agent test**

Run:

```bash
pnpm vitest run src/lib/cockpit/agent.test.ts
```

Expected: fail because `runCockpitAgent` still returns `CockpitAgentOutput`.

- [ ] **Step 6: Update `runCockpitAgent` to return a turn result**

In `src/lib/cockpit/agent.ts`, import the new type:

```ts
type CockpitTurnResult,
```

Change the function signature:

```ts
export async function runCockpitAgent(
  rawInput: unknown,
  options: RunCockpitAgentOptions = {},
): Promise<CockpitTurnResult> {
```

Add this helper near `saveFallback`:

```ts
function createPersistenceResult(
  saveResult: Awaited<ReturnType<CockpitMemoryStore["saveSessionState"]>>,
): CockpitTurnResult["persistence"] {
  return {
    saved: saveResult.saved,
    source: saveResult.saved ? "supabase" : "none",
    reason: saveResult.reason,
  };
}
```

Where provider branches currently return `output`, save and return the turn result:

```ts
const saveResult = await store.saveSessionState({
  sessionId: input.sessionId,
  message: input.message,
  output,
});

return {
  output,
  sessionId: saveResult.sessionId ?? input.sessionId,
  persistence: createPersistenceResult(saveResult),
};
```

Update `saveFallback` to return `Promise<CockpitTurnResult>`:

```ts
async function saveFallback({
  store,
  input,
  reason,
}: {
  store: CockpitMemoryStore;
  input: ReturnType<typeof AgentInputSchema.parse>;
  reason: string;
}): Promise<CockpitTurnResult> {
  const fallback = createFallbackCockpitOutput({
    message: input.message,
    mode: input.mode,
    reason,
  });
  const saveResult = await store.saveSessionState({
    sessionId: input.sessionId,
    message: input.message,
    output: fallback,
  });

  return {
    output: fallback,
    sessionId: saveResult.sessionId ?? input.sessionId,
    persistence: createPersistenceResult(saveResult),
  };
}
```

- [ ] **Step 7: Update the route response**

Modify `src/app/api/cockpit/route.ts`:

```ts
const result = await runCockpitAgent(parsed.data, { store });

return NextResponse.json(result);
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm vitest run src/lib/cockpit/schema.test.ts src/lib/cockpit/agent.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cockpit/schema.ts src/lib/cockpit/schema.test.ts src/lib/cockpit/agent.ts src/lib/cockpit/agent.test.ts src/app/api/cockpit/route.ts
git commit -m "feat: return cockpit turn persistence status"
```

## Task 3: Plain React Core Panels And OpenUI Generated Slot

**Files:**
- Create: `src/components/cockpit/cockpit-panels.tsx`
- Create: `src/components/cockpit/generated-surface-slot.tsx`
- Create: `src/lib/openui/generated-surface-library.tsx`
- Create: `src/lib/openui/generated-surface-library.test.ts`
- Modify: `src/components/cockpit/cockpit-app.tsx`
- Delete: `src/lib/openui/cockpit-library.tsx`

- [ ] **Step 1: Write the failing OpenUI artifact test**

Create `src/lib/openui/generated-surface-library.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toGeneratedSurfaceResponse } from "./generated-surface-library";

describe("generated surface OpenUI adapter", () => {
  it("serializes a ready assistant note artifact", () => {
    const response = toGeneratedSurfaceResponse({
      status: "ready",
      kind: "assistant_note",
      title: "Prompt Mentor",
      body: "Ask for proof before broad implementation.",
    });

    expect(response).toContain("root = AssistantNote");
    expect(response).toContain('"Prompt Mentor"');
    expect(response).toContain('"Ask for proof before broad implementation."');
  });

  it("does not serialize empty or unavailable surfaces", () => {
    expect(toGeneratedSurfaceResponse({ status: "empty" })).toBeNull();
    expect(
      toGeneratedSurfaceResponse({
        status: "unavailable",
        reason: "Malformed OpenUI artifact",
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing artifact test**

Run:

```bash
pnpm vitest run src/lib/openui/generated-surface-library.test.ts
```

Expected: fail because the new module does not exist.

- [ ] **Step 3: Create plain cockpit panels**

Create `src/components/cockpit/cockpit-panels.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import {
  ClipboardCheck,
  Forward,
  ListTodo,
  ParkingCircle,
  Target,
} from "lucide-react";

import type { CockpitAgentOutput } from "@/lib/cockpit/schema";

export function CockpitPanels({ output }: { output: CockpitAgentOutput }) {
  return (
    <div className="cockpit-panel-grid grid min-h-0 gap-3 lg:grid-cols-[1.1fr_1fr]">
      <CockpitPanel
        title="Current Goal"
        icon={<Target className="size-4" />}
        value={output.currentGoal}
        emphasis="strong"
        variant="goal"
      />
      <CockpitPanel
        title="Next Action"
        icon={<ListTodo className="size-4" />}
        value={output.nextAction}
        emphasis="strong"
        variant="action"
      />
      <CockpitPanel
        title="Proof Needed"
        icon={<ClipboardCheck className="size-4" />}
        value={output.proofNeeded}
        variant="proof"
      />
      <CockpitPanel
        title="Parking Lot"
        icon={<ParkingCircle className="size-4" />}
        items={output.parkingLot}
        emptyText="No parked items yet."
        variant="parking"
      />
      <CockpitPanel
        title="Handoff"
        icon={<Forward className="size-4" />}
        value={output.handoff || "No handoff drafted for this turn."}
        variant="handoff"
        wide
      />
      <div className="grid gap-3 md:grid-cols-2 lg:col-span-2">
        <CockpitPanel
          title="Assumptions"
          items={output.assumptions}
          emptyText="No assumptions recorded."
          quiet
          variant="quiet"
        />
        <CockpitPanel
          title="Blockers"
          items={output.blockers}
          emptyText="No blockers recorded."
          quiet
          variant="blocker"
        />
      </div>
    </div>
  );
}

function CockpitPanel({
  title,
  icon,
  value,
  items,
  emptyText,
  quiet,
  emphasis,
  variant = "default",
  wide,
}: {
  title: string;
  icon?: ReactNode;
  value?: string;
  items?: string[];
  emptyText?: string;
  quiet?: boolean;
  emphasis?: "strong";
  variant?:
    | "default"
    | "goal"
    | "action"
    | "proof"
    | "parking"
    | "handoff"
    | "quiet"
    | "blocker";
  wide?: boolean;
}) {
  const listItems = items ?? [];

  return (
    <section
      className={[
        "cockpit-panel min-h-[132px] border p-4 shadow-sm",
        `cockpit-panel-${variant}`,
        wide ? "lg:col-span-2" : "",
        quiet ? "cockpit-panel-quiet" : "",
      ].join(" ")}
      data-testid={title.toLowerCase().replace(/\s+/g, "-")}
    >
      <div className="cockpit-panel-heading cockpit-muted mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
        {icon ? <span className="cockpit-panel-icon">{icon}</span> : null}
        <h2>{title}</h2>
      </div>
      {items ? (
        listItems.length > 0 ? (
          <ul className="space-y-2 text-sm leading-6">
            {listItems.map((item) => (
              <li key={item} className="cockpit-list-item border-l-2 pl-3">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="cockpit-muted text-sm leading-6">{emptyText}</p>
        )
      ) : (
        <p
          className={[
            "text-sm leading-6",
            emphasis === "strong" ? "cockpit-strong text-base font-semibold" : "",
          ].join(" ")}
        >
          {value}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Create the generated surface OpenUI adapter**

Create `src/lib/openui/generated-surface-library.tsx`:

```tsx
"use client";

import {
  Renderer,
  createLibrary,
  defineComponent,
} from "@openuidev/react-lang";
import { Sparkles } from "lucide-react";
import { z } from "zod";

import type { GeneratedSurface } from "@/lib/cockpit/kernel-state";

const AssistantNote = defineComponent({
  name: "AssistantNote",
  description: "Renders a bounded assistant-generated note inside an approved cockpit zone.",
  props: z.object({
    title: z.string(),
    body: z.string(),
  }),
  component: ({ props }) => (
    <section className="cockpit-panel cockpit-panel-quiet border p-4">
      <div className="cockpit-panel-heading cockpit-muted mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
        <span className="cockpit-panel-icon">
          <Sparkles className="size-4" />
        </span>
        <h2>{props.title}</h2>
      </div>
      <p className="text-sm leading-6">{props.body}</p>
    </section>
  ),
});

export const generatedSurfaceLibrary = createLibrary({
  components: [AssistantNote],
  root: "AssistantNote",
});

export function GeneratedSurfaceRenderer({
  surface,
}: {
  surface: GeneratedSurface;
}) {
  const response = toGeneratedSurfaceResponse(surface);
  if (!response) {
    return null;
  }

  return <Renderer response={response} library={generatedSurfaceLibrary} />;
}

export function toGeneratedSurfaceResponse(
  surface: GeneratedSurface,
): string | null {
  if (surface.status !== "ready") {
    return null;
  }

  return `root = AssistantNote(${JSON.stringify(surface.title)}, ${JSON.stringify(
    surface.body,
  )})`;
}
```

- [ ] **Step 5: Create the generated surface slot**

Create `src/components/cockpit/generated-surface-slot.tsx`:

```tsx
"use client";

import type { GeneratedSurface } from "@/lib/cockpit/kernel-state";
import { GeneratedSurfaceRenderer } from "@/lib/openui/generated-surface-library";

export function GeneratedSurfaceSlot({
  surface,
}: {
  surface: GeneratedSurface;
}) {
  if (surface.status === "empty") {
    return (
      <section className="cockpit-panel cockpit-panel-quiet border p-4" data-testid="generated-surface">
        <div className="cockpit-panel-heading cockpit-muted mb-3 text-xs font-semibold uppercase tracking-normal">
          Generated Surface
        </div>
        <p className="cockpit-muted text-sm leading-6">
          No generated surface for this turn.
        </p>
      </section>
    );
  }

  if (surface.status === "unavailable") {
    return (
      <section className="cockpit-alert border p-4" data-testid="generated-surface">
        <div className="mb-2 text-xs font-semibold uppercase tracking-normal">
          Generated Surface Unavailable
        </div>
        <p className="text-sm leading-6">{surface.reason}</p>
      </section>
    );
  }

  return (
    <div data-testid="generated-surface">
      <GeneratedSurfaceRenderer surface={surface} />
    </div>
  );
}
```

- [ ] **Step 6: Wire plain panels and generated slot into the app**

In `src/components/cockpit/cockpit-app.tsx`, replace:

```ts
import { CockpitOpenUiRenderer } from "@/lib/openui/cockpit-library";
```

with:

```ts
import { CockpitPanels } from "@/components/cockpit/cockpit-panels";
import { GeneratedSurfaceSlot } from "@/components/cockpit/generated-surface-slot";
```

Replace:

```tsx
<CockpitOpenUiRenderer output={output} isStreaming={isSubmitting} />
```

with:

```tsx
<div className="grid gap-3">
  <CockpitPanels output={output} />
  <GeneratedSurfaceSlot surface={generatedSurface} />
</div>
```

After Task 1 state extraction, `generatedSurface` should come from the parsed kernel state:

```ts
const { mode, theme, output, sessionId, generatedSurface } = cockpitState;
```

- [ ] **Step 7: Remove the old core OpenUI library**

Delete `src/lib/openui/cockpit-library.tsx` after all imports are removed.

- [ ] **Step 8: Run tests and e2e**

Run:

```bash
pnpm vitest run src/lib/openui/generated-surface-library.test.ts
pnpm test:e2e
```

Expected: both pass; e2e still finds Current Goal, Next Action, Proof Needed, and Parking Lot.

- [ ] **Step 9: Commit**

```bash
git add src/components/cockpit/cockpit-panels.tsx src/components/cockpit/generated-surface-slot.tsx src/lib/openui/generated-surface-library.tsx src/lib/openui/generated-surface-library.test.ts src/components/cockpit/cockpit-app.tsx
git rm src/lib/openui/cockpit-library.tsx
git commit -m "feat: separate cockpit panels from openui surfaces"
```

## Task 4: Bounded Thought-Forming Chat

**Files:**
- Create: `src/lib/cockpit/thought-chat.ts`
- Create: `src/lib/cockpit/thought-chat.test.ts`
- Create: `src/app/api/cockpit/chat/route.ts`
- Create: `src/components/cockpit/thought-chat-lane.tsx`
- Modify: `src/components/cockpit/cockpit-app.tsx`
- Modify: `tests/e2e/cockpit.spec.ts`

- [ ] **Step 1: Write failing thought-chat tests**

Create `src/lib/cockpit/thought-chat.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { runThoughtChat } from "./thought-chat";

describe("thought-forming chat", () => {
  it("returns local phrasing help when no model is available", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "local");
    vi.stubEnv("OPENAI_API_KEY", "");

    const result = await runThoughtChat({
      message: "I know the UI is wrong but I cannot explain it",
      history: [],
    });

    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toContain("What feels wrong");
    expect(result.modelUsed).toBe("local");
  });

  it("keeps replies promotion-ready", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "local");
    vi.stubEnv("OPENAI_API_KEY", "");

    const result = await runThoughtChat({
      message: "too many things",
      history: [],
    });

    expect(result.promoteText).toContain("too many things");
  });
});
```

- [ ] **Step 2: Run failing thought-chat tests**

Run:

```bash
pnpm vitest run src/lib/cockpit/thought-chat.test.ts
```

Expected: fail because `thought-chat.ts` does not exist.

- [ ] **Step 3: Implement deterministic thought chat**

Create `src/lib/cockpit/thought-chat.ts`:

```ts
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { CockpitProviderSchema } from "./schema";

export const ThoughtChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1),
  createdAt: z.string(),
});

export const ThoughtChatInputSchema = z.object({
  message: z.string().trim().min(1),
  history: z.array(ThoughtChatMessageSchema).default([]),
});

export const ThoughtChatResultSchema = z.object({
  message: ThoughtChatMessageSchema,
  promoteText: z.string().trim().min(1),
  modelUsed: z.string(),
});

export type ThoughtChatMessage = z.infer<typeof ThoughtChatMessageSchema>;
export type ThoughtChatInput = z.infer<typeof ThoughtChatInputSchema>;
export type ThoughtChatResult = z.infer<typeof ThoughtChatResultSchema>;

export async function runThoughtChat(rawInput: unknown): Promise<ThoughtChatResult> {
  const input = ThoughtChatInputSchema.parse(rawInput);
  const provider = readProvider();

  if (provider === "local" || !process.env.OPENAI_API_KEY) {
    return createLocalThoughtReply(input.message);
  }

  return createLocalThoughtReply(input.message);
}

function createLocalThoughtReply(message: string): ThoughtChatResult {
  const compact = message.replace(/\s+/g, " ").trim();
  const content = [
    "What feels wrong, blocked, or too vague?",
    `A usable cockpit phrasing could start with: ${compact}`,
    "Name the proof that would make the next step feel real.",
  ].join("\n");

  return {
    message: {
      id: randomUUID(),
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
    },
    promoteText: compact,
    modelUsed: "local",
  };
}

function readProvider() {
  const parsed = CockpitProviderSchema.safeParse(process.env.COCKPIT_LLM_PROVIDER);
  if (parsed.success) {
    return parsed.data;
  }

  return process.env.OPENAI_API_KEY ? "openai" : "local";
}
```

This first implementation intentionally uses local phrasing help for every provider. Add live provider calls in a separate task after the chat lane behavior is proven.

- [ ] **Step 4: Create the chat route**

Create `src/app/api/cockpit/chat/route.ts`:

```ts
import { NextResponse } from "next/server";

import { runThoughtChat } from "@/lib/cockpit/thought-chat";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  try {
    const result = await runThoughtChat(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Thought chat request failed.",
      },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 5: Create the chat UI**

Create `src/components/cockpit/thought-chat-lane.tsx`:

```tsx
"use client";

import { FormEvent, useState } from "react";
import { MessageSquareText, Wand2 } from "lucide-react";

import type { ThoughtChatMessage } from "@/lib/cockpit/kernel-state";

export function ThoughtChatLane({
  messages,
  onUserMessage,
  onAssistantMessage,
  onPromote,
}: {
  messages: ThoughtChatMessage[];
  onUserMessage: (message: ThoughtChatMessage) => void;
  onAssistantMessage: (message: ThoughtChatMessage) => void;
  onPromote: (text: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [promoteText, setPromoteText] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) {
      return;
    }

    const userMessage: ThoughtChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    onUserMessage(userMessage);
    setDraft("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/cockpit/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, history: messages }),
      });
      const payload = (await response.json()) as {
        message?: ThoughtChatMessage;
        promoteText?: string;
        error?: string;
      };

      if (!response.ok || !payload.message || !payload.promoteText) {
        throw new Error(payload.error ?? "Thought chat failed.");
      }

      onAssistantMessage(payload.message);
      setPromoteText(payload.promoteText);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="cockpit-surface border px-3 py-3" data-testid="thought-chat">
      <button
        type="button"
        className="cockpit-button inline-flex min-h-9 items-center gap-2 border px-3 text-sm font-medium"
        onClick={() => setIsOpen((current) => !current)}
      >
        <MessageSquareText className="size-4" />
        Thought Chat
      </button>

      {isOpen ? (
        <div className="mt-3 grid gap-3">
          <div className="max-h-40 overflow-auto text-sm leading-6">
            {messages.length > 0 ? (
              messages.map((message) => (
                <p key={message.id}>
                  <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>{" "}
                  {message.content}
                </p>
              ))
            ) : (
              <p className="cockpit-muted">
                Use this when you need help saying the thought before turning it into a cockpit action.
              </p>
            )}
          </div>

          <form onSubmit={submit} className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Help me put this into words"
              className="cockpit-input min-h-10 border px-3 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="cockpit-button inline-flex min-h-10 items-center justify-center gap-2 border px-3 text-sm font-medium"
            >
              <Wand2 className="size-4" />
              Phrase
            </button>
          </form>

          {promoteText ? (
            <button
              type="button"
              className="cockpit-primary min-h-10 px-3 text-sm font-semibold"
              onClick={() => onPromote(promoteText)}
            >
              Use As Cockpit Input
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Wire chat into the app**

In `src/components/cockpit/cockpit-app.tsx`, import:

```ts
import { ThoughtChatLane } from "@/components/cockpit/thought-chat-lane";
```

Read `thoughtChat` from kernel state:

```ts
const { mode, theme, output, sessionId, generatedSurface, thoughtChat } =
  cockpitState;
```

Render `ThoughtChatLane` above the parking input:

```tsx
<div className="mb-3">
  <ThoughtChatLane
    messages={thoughtChat}
    onUserMessage={(message) =>
      updateCockpitState((current) =>
        reduceKernelState(current, { type: "appendThoughtMessage", message }),
      )
    }
    onAssistantMessage={(message) =>
      updateCockpitState((current) =>
        reduceKernelState(current, { type: "appendThoughtMessage", message }),
      )
    }
    onPromote={(text) => setMessage(text)}
  />
</div>
```

Ensure `reduceKernelState` is imported from `kernel-state.ts`.

- [ ] **Step 7: Add the e2e chat-promotion assertion**

Append to `tests/e2e/cockpit.spec.ts` before the final reload:

```ts
await page.getByRole("button", { name: "Thought Chat" }).click();
await page
  .getByPlaceholder("Help me put this into words")
  .fill("I know the UI is wrong but I cannot explain it");
await page.getByRole("button", { name: "Phrase" }).click();
await expect(page.getByTestId("thought-chat")).toContainText("What feels wrong");
await page.getByRole("button", { name: "Use As Cockpit Input" }).click();
await expect(page.getByLabel("Scattered thought")).toHaveValue(
  "I know the UI is wrong but I cannot explain it",
);
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm vitest run src/lib/cockpit/thought-chat.test.ts
pnpm test:e2e
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cockpit/thought-chat.ts src/lib/cockpit/thought-chat.test.ts src/app/api/cockpit/chat/route.ts src/components/cockpit/thought-chat-lane.tsx src/components/cockpit/cockpit-app.tsx tests/e2e/cockpit.spec.ts
git commit -m "feat: add bounded thought-forming chat"
```

## Task 5: Supabase Auth And Chat Persistence

**Files:**
- Create: `supabase/migrations/20260517193000_add_cockpit_chat_messages.sql`
- Modify: `src/lib/cockpit/supabase-rls.test.ts`
- Create: `src/lib/cockpit/supabase-client.ts`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/components/cockpit/auth-panel.tsx`
- Modify: `src/lib/cockpit/storage.ts`
- Modify: `src/app/api/cockpit/chat/route.ts`
- Modify: `src/components/cockpit/cockpit-app.tsx`

- [ ] **Step 1: Write the failing RLS test update**

Modify the table loop in `src/lib/cockpit/supabase-rls.test.ts`:

```ts
for (const table of [
  "cockpit_sessions",
  "parking_lot_items",
  "handoffs",
  "cockpit_chat_messages",
]) {
  expect(sql).toContain(`alter table public.${table} enable row level security`);
  expect(sql).toContain(`on public.${table}`);
}
```

Update the expected owner-scope count:

```ts
expect(sql.match(/user_id = \(select auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(16);
```

- [ ] **Step 2: Run the failing RLS test**

Run:

```bash
pnpm vitest run src/lib/cockpit/supabase-rls.test.ts
```

Expected: fail because the migration does not include `cockpit_chat_messages`.

- [ ] **Step 3: Add the chat messages migration**

Create `supabase/migrations/20260517193000_add_cockpit_chat_messages.sql`:

```sql
create table public.cockpit_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.cockpit_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index cockpit_chat_messages_user_session_idx
  on public.cockpit_chat_messages (user_id, session_id, created_at desc);

alter table public.cockpit_chat_messages enable row level security;

grant select, insert, update, delete on public.cockpit_chat_messages to authenticated;

create policy "cockpit_chat_messages_select_own"
  on public.cockpit_chat_messages
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "cockpit_chat_messages_insert_own"
  on public.cockpit_chat_messages
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "cockpit_chat_messages_update_own"
  on public.cockpit_chat_messages
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "cockpit_chat_messages_delete_own"
  on public.cockpit_chat_messages
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
```

- [ ] **Step 4: Add browser Supabase client**

Create `src/lib/cockpit/supabase-client.ts`:

```ts
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 5: Add auth callback route**

Create `src/app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/cockpit/supabase-server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase?.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
```

- [ ] **Step 6: Add auth panel**

Create `src/components/cockpit/auth-panel.tsx`:

```tsx
"use client";

import { FormEvent, useState } from "react";
import { LogIn, LogOut } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/cockpit/supabase-client";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("Not signed in");
  const supabase = createSupabaseBrowserClient();

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setStatus(error ? error.message : "Check your email for the sign-in link.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStatus("Signed out");
  }

  return (
    <section className="mt-5 space-y-2 text-xs">
      <p className="cockpit-muted font-semibold uppercase tracking-normal">
        Sync
      </p>
      <form onSubmit={signIn} className="grid gap-2">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email for phone sync"
          className="cockpit-input min-h-9 border px-2 text-xs outline-none"
        />
        <button
          type="submit"
          className="cockpit-button inline-flex min-h-9 items-center justify-center gap-2 border px-2 font-medium"
        >
          <LogIn className="size-4" />
          Sign In
        </button>
      </form>
      <button
        type="button"
        className="cockpit-button inline-flex min-h-9 w-full items-center justify-center gap-2 border px-2 font-medium"
        onClick={signOut}
      >
        <LogOut className="size-4" />
        Sign Out
      </button>
      <p className="cockpit-muted">{status}</p>
    </section>
  );
}
```

- [ ] **Step 7: Extend storage for chat**

Modify `CockpitMemoryStore` in `src/lib/cockpit/storage.ts`:

```ts
  loadChatMessages(sessionId?: string): Promise<
    { id: string; role: "user" | "assistant"; content: string; createdAt: string }[]
  >;
  saveChatMessage(args: {
    sessionId?: string;
    role: "user" | "assistant";
    content: string;
  }): Promise<{ saved: boolean; reason?: string }>;
```

Add no-op methods to `NullCockpitMemoryStore`:

```ts
async loadChatMessages() {
  return [];
}

async saveChatMessage(): Promise<{ saved: boolean; reason: string }> {
  return { saved: false, reason: this.reason };
}
```

Add Supabase methods:

```ts
async loadChatMessages(sessionId?: string) {
  if (!sessionId) {
    return [];
  }

  const { data, error } = await this.supabase
    .from("cockpit_chat_messages")
    .select("id,role,content,created_at")
    .eq("session_id", sessionId)
    .eq("user_id", this.userId)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.created_at,
  }));
}

async saveChatMessage({
  sessionId,
  role,
  content,
}: {
  sessionId?: string;
  role: "user" | "assistant";
  content: string;
}): Promise<{ saved: boolean; reason?: string }> {
  const { error } = await this.supabase.from("cockpit_chat_messages").insert({
    user_id: this.userId,
    session_id: sessionId ?? null,
    role,
    content,
  });

  return error ? { saved: false, reason: error.message } : { saved: true };
}
```

- [ ] **Step 8: Persist chat route messages when authenticated**

Modify `src/app/api/cockpit/chat/route.ts` to create a store with the same helper pattern as `/api/cockpit`. Save the user message before the run and assistant message after:

```ts
await store.saveChatMessage({
  sessionId: body?.sessionId,
  role: "user",
  content: body.message,
});

const result = await runThoughtChat(body);

await store.saveChatMessage({
  sessionId: body?.sessionId,
  role: "assistant",
  content: result.message.content,
});
```

Keep local behavior working if the store is `NullCockpitMemoryStore`.

- [ ] **Step 9: Render auth panel**

In `src/components/cockpit/cockpit-app.tsx`, import and render `AuthPanel` under the memory readout stack:

```tsx
<AuthPanel />
```

- [ ] **Step 10: Run Supabase reset and tests**

Run:

```bash
pnpm exec supabase db reset
pnpm vitest run src/lib/cockpit/supabase-rls.test.ts
pnpm test
```

Expected: migration applies and tests pass.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/20260517193000_add_cockpit_chat_messages.sql src/lib/cockpit/supabase-rls.test.ts src/lib/cockpit/supabase-client.ts src/app/auth/callback/route.ts src/components/cockpit/auth-panel.tsx src/lib/cockpit/storage.ts src/app/api/cockpit/chat/route.ts src/components/cockpit/cockpit-app.tsx
git commit -m "feat: add supabase auth and thought chat persistence"
```

## Task 6: Final Verification

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/cockpit.spec.ts`

- [ ] **Step 1: Update README with the new operating model**

Add this section to `README.md` after the provider list:

```md
## Operating Model

Cockpit has a model-independent kernel. The stable panels, Parking Lot, local cache, and proof tracking work without an LLM. Assistant providers can enrich the result when available.

OpenUI is reserved for approved generated-surface zones. It does not own durable cockpit state.

The thought-forming chat lane helps turn unclear mental state into cockpit-ready input. When no model is available, it uses local phrasing prompts rather than blocking the workflow.
```

- [ ] **Step 2: Add final e2e coverage**

Ensure `tests/e2e/cockpit.spec.ts` verifies all of these:

```ts
await expect(page.getByTestId("generated-surface")).toContainText(
  "No generated surface for this turn.",
);
await expect(page.getByRole("heading", { name: "Current Goal" })).toBeVisible();
await expect(page.getByRole("heading", { name: "Next Action" })).toBeVisible();
await expect(page.getByRole("heading", { name: "Proof Needed" })).toBeVisible();
await expect(page.getByTestId("thought-chat")).toBeVisible();
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm exec supabase db reset
```

Expected: all commands pass.

- [ ] **Step 4: Inspect repo status**

Run:

```bash
git status --short
```

Expected: only intentional untracked files remain from the pre-existing untracked app if this repo has not had a full initial commit. No `.superpowers/` files should appear after `.gitignore` is updated.

- [ ] **Step 5: Commit docs and verification updates**

```bash
git add README.md tests/e2e/cockpit.spec.ts
git commit -m "docs: document cockpit kernel operating model"
```

## Self-Review Notes

- Spec coverage: This plan covers the kernel boundary, OpenUI zone isolation, thought-forming chat, Supabase Auth and chat persistence, and verification. It intentionally excludes the future Pulse-like background work lane and peripheral LangGraph experiment.
- Red-flag scan: The plan gives concrete file paths, commands, and code snippets for each implementation task.
- Type consistency: `CockpitKernelState`, `GeneratedSurface`, `ThoughtChatMessage`, and `CockpitTurnResult` are introduced before later tasks reference them.
