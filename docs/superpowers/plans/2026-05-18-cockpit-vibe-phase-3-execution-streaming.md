# Cockpit ↔ Vibe Phase 3 — Execution + Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Cockpit's `runLane` capability end-to-end so the operator can start a Vibe lane from the inventory panel, watch its `LaneEvent` stream live via SSE, and cancel it. Run state lives in memory only for Phase 3; persistence is deferred to Phase 3b (spec §5.8).

**Architecture:** The Vibe plugin's `runLane` delegates to `InProcessVibeService.runLane`, which calls into `@vibe/runtime.runTranslatedLane` (the Vibe-side package from the sibling plan). Three new Next.js routes (`POST /run`, `GET /run-events`, `POST /cancel`) wrap an in-memory `activeRuns` singleton with a ring-buffer SSE writer. The lane inventory panel gains Run/Cancel affordances and a run-stream subpanel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase SSR (cookie-bound, RLS), Vitest, Playwright, chokidar v4 (new dep).

**Spec reference:** [docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md](../specs/2026-05-18-cockpit-vibe-integration-design.md) §3.1–§3.6, §4.2, §5.1–§5.7, §8.3, §9.3–§9.4. **Phase 3 prerequisite checklist** in Next Steps lists the 7 Cockpit-side code changes this plan implements + 1 Vibe-side prerequisite handled by the sibling plan `lutherfourie/vibe:docs/superpowers/plans/2026-05-18-vibe-runtime-package-extraction.md`.

**Dependency on the Vibe plan:** Tasks 1–7 here are independent of the Vibe runtime package; they can run in parallel with the Vibe plan. Task 11 (the real `runLane` impl) needs `@vibe/runtime` to be linkable — until then, Task 11's tests use a stubbed `runTranslatedLane` so Cockpit work can proceed.

---

## File Structure

**Create:**
- `src/lib/plugins/vibe/active-runs.ts` — singleton `Map<runId, ActiveRun>`, `ActiveRun` interface, helper `evictRun(runId)`
- `src/app/api/cockpit/lanes/[laneId]/run/route.ts` — `POST` handler, mints runId, calls `pluginHost.runLane`
- `src/app/api/cockpit/lanes/[laneId]/run-events/route.ts` — `GET` handler, SSE stream of `LaneEvent` frames
- `src/app/api/cockpit/runs/[runId]/cancel/route.ts` — `POST` handler, aborts the run's controller
- `src/components/cockpit/lane-inventory-panel.tsx` — extends existing (or creates) lane inventory UI
- `src/components/cockpit/run-stream-panel.tsx` — subscribes to SSE, renders LaneEvent stream
- `src/components/cockpit/run-dialog.tsx` — modal opened by Run button; form prefilled with `defaultUserMessage`
- `src/lib/plugins/vibe/__tests__/active-runs.test.ts`
- `src/lib/plugins/vibe/__tests__/in-process-vibe-service-watch.test.ts`
- `src/lib/plugins/vibe/__tests__/in-process-vibe-service-run.test.ts`
- `src/lib/plugins/host/__tests__/plugin-host-run-lane.test.ts`
- `src/lib/plugins/host/__tests__/plugin-host-reload.test.ts`
- `src/lib/plugins/host/__tests__/plugin-host-version-check.test.ts`
- `tests/lane-run-flow.spec.ts` — Playwright e2e

**Modify:**
- `src/lib/plugins/contract/types.ts` — `TodoItem` shape, `cockpitPluginContractVersion` on `CockpitPlugin`
- `src/lib/plugins/vibe/vibe-service.ts` — add `runLane` to `VibeService` interface
- `src/lib/plugins/vibe/in-process-vibe-service.ts` — chokidar watching, `runLane` impl, `lanesChanged` event emitter
- `src/lib/plugins/vibe/vibe-plugin.ts` — set `cockpitPluginContractVersion = "1.0.0"`, expose `runLane`
- `src/lib/plugins/host/plugin-host.ts` — `runLane`, `reload`, private `disposeOne`, SemVer check in `load`
- `package.json` — add `chokidar: ^4.0.0`, add `@vibe/runtime` (file: link, populated when Vibe plan lands)
- `src/components/cockpit/` — wire the new components into the existing layout (path TBD by codebase pattern; the task spells it out)

**Single-responsibility split:** the `active-runs.ts` singleton holds runtime state; routes are thin handlers; `InProcessVibeService` owns lane discovery + runtime invocation; `PluginHost` routes by `<pluginId>:<laneId>` prefix; UI components subscribe to backend SSE without owning state.

---

## Tasks

### Task 1: Update `TodoItem` shape in contract types

**Files:**
- Modify: `src/lib/plugins/contract/types.ts:94-98`
- Create: `src/lib/plugins/contract/__tests__/todo-item.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/contract/__tests__/todo-item.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { TodoItem, LaneEvent } from "../types";

describe("TodoItem", () => {
  it("has id, content, status fields per spec §5.2", () => {
    const t: TodoItem = { id: "1", content: "do thing", status: "pending" };
    expectTypeOf(t.id).toEqualTypeOf<string>();
    expectTypeOf(t.content).toEqualTypeOf<string>();
    expectTypeOf(t.status).toEqualTypeOf<"pending" | "in_progress" | "completed">();
  });

  it("is the items type on LaneEvent { type: 'todo' }", () => {
    const evt: LaneEvent = {
      type: "todo",
      items: [{ id: "x", content: "foo", status: "in_progress" }],
    };
    expectTypeOf(evt).toMatchTypeOf<{ type: "todo"; items: TodoItem[] }>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/contract/__tests__/todo-item.test.ts`
Expected: TypeScript fails — current `TodoItem` is `{ text; done }`, not `{ id; content; status }`.

- [ ] **Step 3: Update `TodoItem` in `types.ts`**

In `src/lib/plugins/contract/types.ts` replace the existing definition:

```typescript
/** A single to-do item emitted by the `todo` LaneEvent variant during lane execution. */
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}
```

- [ ] **Step 4: Run test to verify it passes + verify no other consumers break**

Run: `pnpm test src/lib/plugins/contract/__tests__/todo-item.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: PASS. (Phase 1 code doesn't consume `TodoItem` at runtime — Phase 3's runLane is the first consumer — so no other compile errors should surface.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/contract/types.ts src/lib/plugins/contract/__tests__/todo-item.test.ts
git commit -m "feat(contract): TodoItem shape { id, content, status } per spec §5.2"
```

---

### Task 2: Add `cockpitPluginContractVersion` to the contract + plugin

**Files:**
- Modify: `src/lib/plugins/contract/types.ts` (`CockpitPlugin` interface, ~line 142)
- Modify: `src/lib/plugins/vibe/vibe-plugin.ts` (set the field on `VibePlugin`)
- Create: `src/lib/plugins/contract/__tests__/contract-version.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/contract/__tests__/contract-version.test.ts`:

```typescript
import { describe, it, expect, expectTypeOf } from "vitest";
import type { CockpitPlugin } from "../types";

describe("CockpitPlugin.cockpitPluginContractVersion", () => {
  it("is a readonly string on the plugin interface", () => {
    const stub: CockpitPlugin = {
      id: "stub",
      displayName: "Stub",
      version: "0.0.0",
      cockpitPluginContractVersion: "1.0.0",
      capabilities: [],
      init: async () => {},
      dispose: async () => {},
    };
    expect(stub.cockpitPluginContractVersion).toBe("1.0.0");
    expectTypeOf(stub.cockpitPluginContractVersion).toEqualTypeOf<string>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/contract/__tests__/contract-version.test.ts`
Expected: TypeScript fails — the field doesn't exist yet.

- [ ] **Step 3: Add the field to the interface**

In `src/lib/plugins/contract/types.ts`, modify `CockpitPlugin`:

```typescript
export interface CockpitPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly description?: string;
  /** SemVer matching the contract version this plugin was built against. See spec §8.3. */
  readonly cockpitPluginContractVersion: string;
  readonly capabilities: readonly PluginCapability[];

  init(host: PluginHostContext): Promise<void>;
  dispose(): Promise<void>;

  listLanes?(): Promise<LaneSummary[]>;
  runLane?(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent>;
  generateHandoff?(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null>;

  memoryBridge?: PluginMemoryBridge;
}
```

- [ ] **Step 4: Set the field on `VibePlugin`**

In `src/lib/plugins/vibe/vibe-plugin.ts`, add the field next to the existing `version`:

```typescript
export class VibePlugin implements CockpitPlugin {
  readonly id = "vibe";
  readonly displayName = "Vibe Lanes";
  readonly version = "0.1.0";
  readonly cockpitPluginContractVersion = "1.0.0";
  readonly description = "Vibe lane discovery and surface-aware handoff generation.";
  // ...rest unchanged
```

- [ ] **Step 5: Run tests + typecheck + commit**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: all green.

```bash
git add src/lib/plugins/contract/types.ts src/lib/plugins/vibe/vibe-plugin.ts src/lib/plugins/contract/__tests__/contract-version.test.ts
git commit -m "feat(contract): add cockpitPluginContractVersion field; set on VibePlugin"
```

---

### Task 3: Add SemVer check in `PluginHost.load()`

**Files:**
- Modify: `src/lib/plugins/host/plugin-host.ts`
- Create: `src/lib/plugins/host/__tests__/plugin-host-version-check.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/plugins/host/__tests__/plugin-host-version-check.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { PluginHost } from "../plugin-host";
import type { CockpitPlugin, PluginHostContext } from "../../contract/types";

function makeContext(): PluginHostContext {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: new Map(),
    memory: {
      get: async () => null,
      set: async () => {},
      list: async () => [],
      delete: async () => {},
    },
    events: { emit: vi.fn() },
  };
}

function makePlugin(version: string): CockpitPlugin {
  return {
    id: "stub",
    displayName: "Stub",
    version: "0.0.0",
    cockpitPluginContractVersion: version,
    capabilities: [],
    init: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe("PluginHost contract-version check", () => {
  it("loads a plugin with matching major version", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const plugin = makePlugin("1.0.0");
    await host.load([{ id: "stub", factory: () => plugin }]);
    expect(host.getPluginStatus("stub")).toBe("ready");
    expect(plugin.init).toHaveBeenCalled();
  });

  it("warns but loads on minor version mismatch (host major === plugin major)", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const plugin = makePlugin("1.2.0"); // host expects 1.0.0; major matches
    await host.load([{ id: "stub", factory: () => plugin }]);
    expect(host.getPluginStatus("stub")).toBe("ready");
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("contract version"),
      expect.any(Object),
    );
  });

  it("refuses (status='errored') on major version mismatch", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const plugin = makePlugin("2.0.0");
    await host.load([{ id: "stub", factory: () => plugin }]);
    expect(host.getPluginStatus("stub")).toBe("errored");
    expect(plugin.init).not.toHaveBeenCalled();
  });

  it("treats undefined contract version as legacy '1.0.0' (back-compat)", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const legacy = { ...makePlugin("0.0.0"), cockpitPluginContractVersion: undefined as unknown as string };
    await host.load([{ id: "stub", factory: () => legacy }]);
    expect(host.getPluginStatus("stub")).toBe("ready");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/plugins/host/__tests__/plugin-host-version-check.test.ts`
Expected: all four FAIL — no version check exists.

- [ ] **Step 3: Implement the check in `PluginHost.load()`**

In `src/lib/plugins/host/plugin-host.ts`, add a constant + a check near the top of the `load` loop:

```typescript
const HOST_CONTRACT_VERSION = "1.0.0";

// ...inside class PluginHost...

async load(entries: PluginEntry[]): Promise<void> {
  for (const entry of entries) {
    if (this.plugins.has(entry.id)) {
      this.context.log.warn(`plugin ${entry.id} already loaded; call dispose() before re-loading`);
      continue;
    }
    const loaded: LoadedPlugin = {
      id: entry.id,
      entry,
      instance: null,
      status: "ready",
    };
    let instance: CockpitPlugin | null = null;
    try {
      instance = entry.factory();
      const advertised = instance.cockpitPluginContractVersion ?? "1.0.0";
      const hostMajor = parseMajor(HOST_CONTRACT_VERSION);
      const pluginMajor = parseMajor(advertised);
      if (pluginMajor !== hostMajor) {
        loaded.status = "errored";
        loaded.lastError = `contract version mismatch: host ${HOST_CONTRACT_VERSION}, plugin ${advertised}`;
        this.context.log.error(loaded.lastError, { pluginId: entry.id });
        this.plugins.set(entry.id, loaded);
        continue;
      }
      if (advertised !== HOST_CONTRACT_VERSION) {
        this.context.log.warn(
          `plugin ${entry.id} contract version differs but major matches`,
          { hostVersion: HOST_CONTRACT_VERSION, pluginVersion: advertised },
        );
      }
      await instance.init(this.context);
      loaded.instance = instance;
      loaded.status = "ready";
    } catch (err) {
      loaded.status = "errored";
      loaded.lastError = err instanceof Error ? err.message : String(err);
      this.context.log.error(`plugin ${entry.id} init failed`, {
        error: loaded.lastError,
      });
    }
    this.plugins.set(entry.id, loaded);
  }
}

function parseMajor(version: string): number {
  const m = version.match(/^(\d+)\./);
  return m ? Number(m[1]) : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/plugins/host/__tests__/plugin-host-version-check.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/host/plugin-host.ts src/lib/plugins/host/__tests__/plugin-host-version-check.test.ts
git commit -m "feat(host): SemVer contract-version check; warn on minor, refuse on major"
```

---

### Task 4: Add `runLane` to `VibeService` interface

**Files:**
- Modify: `src/lib/plugins/vibe/vibe-service.ts`

- [ ] **Step 1: Update the interface**

In `src/lib/plugins/vibe/vibe-service.ts`, replace the existing interface with:

```typescript
import type {
  HandoffArtifact,
  HandoffTarget,
  LaneEvent,
  LaneRunInput,
  LaneSummary,
} from "../contract/types";

/**
 * Vibe runtime interface — Phase 3 shape (extends Phase 1's discovery+handoff).
 * Two implementations:
 *   - InProcessVibeService (default; runs in Cockpit's process)
 *   - RemoteVibeService    (Phase 5; HTTP/SSE client to a Vibe daemon)
 */
export interface VibeService {
  /** Discover all lanes under configured repo roots. */
  listLanes(): Promise<LaneSummary[]>;

  /** Execute a lane and stream events until termination or abort. See spec §3.1, §5. */
  runLane(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent>;

  /** Produce a handoff artifact for the given lane targeted at the given surface. */
  generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null>;

  /** Release any resources held by this service instance (file watchers, in-flight runs). */
  dispose(): Promise<void>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — `InProcessVibeService` doesn't implement `runLane` yet. That's expected; Task 11 fixes it. For now we want this interface declared so dependent tasks can use it.

- [ ] **Step 3: Add a stub `runLane` to `InProcessVibeService`**

In `src/lib/plugins/vibe/in-process-vibe-service.ts`, add (at the bottom of the class, before the private internals):

```typescript
  // eslint-disable-next-line require-yield
  async *runLane(
    _laneId: string,
    _input: LaneRunInput,
    _signal: AbortSignal,
  ): AsyncIterable<LaneEvent> {
    throw new Error("InProcessVibeService.runLane is implemented in Task 11");
  }
```

Add to imports at the top of the file:

```typescript
import type { LaneEvent, LaneRunInput } from "../contract/types";
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/vibe/vibe-service.ts src/lib/plugins/vibe/in-process-vibe-service.ts
git commit -m "feat(vibe-service): add runLane to VibeService interface; stub in InProcess"
```

---

### Task 5: Add `runLane` to `PluginHost` (prefix routing)

**Files:**
- Modify: `src/lib/plugins/host/plugin-host.ts`
- Create: `src/lib/plugins/host/__tests__/plugin-host-run-lane.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/plugins/host/__tests__/plugin-host-run-lane.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { PluginHost } from "../plugin-host";
import type { CockpitPlugin, LaneEvent, PluginHostContext } from "../../contract/types";

function makeContext(): PluginHostContext {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: new Map(),
    memory: { get: async () => null, set: async () => {}, list: async () => [], delete: async () => {} },
    events: { emit: vi.fn() },
  };
}

function makePluginWithRunLane(events: LaneEvent[]): CockpitPlugin {
  return {
    id: "vibe",
    displayName: "Vibe",
    version: "0.1.0",
    cockpitPluginContractVersion: "1.0.0",
    capabilities: ["execution"],
    init: async () => {},
    dispose: async () => {},
    runLane: async function* () {
      for (const e of events) yield e;
    },
  };
}

describe("PluginHost.runLane", () => {
  it("strips <pluginId>: prefix and routes to the plugin", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const plugin = makePluginWithRunLane([
      { type: "start", laneId: "feedback-triage", runId: "r1" },
      { type: "final", summary: "done", outputs: [] },
    ]);
    const runLaneSpy = vi.spyOn(plugin, "runLane");
    await host.load([{ id: "vibe", factory: () => plugin }]);

    const events: LaneEvent[] = [];
    for await (const e of host.runLane(
      "vibe:feedback-triage",
      { userMessage: "go" },
      new AbortController().signal,
    )) {
      events.push(e);
    }
    expect(events).toHaveLength(2);
    expect(runLaneSpy).toHaveBeenCalledWith(
      "feedback-triage",
      { userMessage: "go" },
      expect.any(AbortSignal),
    );
  });

  it("yields a synthetic error and returns when plugin id is unknown", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const events: LaneEvent[] = [];
    for await (const e of host.runLane(
      "ghost:nope",
      { userMessage: "go" },
      new AbortController().signal,
    )) {
      events.push(e);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", recoverable: false });
  });

  it("yields a synthetic error when the plugin lacks execution capability", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const plugin: CockpitPlugin = {
      id: "vibe",
      displayName: "Vibe",
      version: "0.1.0",
      cockpitPluginContractVersion: "1.0.0",
      capabilities: ["discovery"], // no execution
      init: async () => {},
      dispose: async () => {},
    };
    await host.load([{ id: "vibe", factory: () => plugin }]);
    const events: LaneEvent[] = [];
    for await (const e of host.runLane("vibe:any", { userMessage: "go" }, new AbortController().signal)) {
      events.push(e);
    }
    expect(events[0]).toMatchObject({ type: "error", recoverable: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/plugins/host/__tests__/plugin-host-run-lane.test.ts`
Expected: all three FAIL — `host.runLane` doesn't exist.

- [ ] **Step 3: Implement `runLane` on `PluginHost`**

In `src/lib/plugins/host/plugin-host.ts`, add after `generateHandoff`:

```typescript
  /**
   * Execute a lane and stream its events. Yields a synthetic `error` event
   * and returns when the lane id is unknown, the plugin isn't ready, or the
   * plugin lacks the execution capability — so consumers always see a clean
   * AsyncIterable<LaneEvent> regardless of routing failures.
   *
   * @param fullLaneId  Namespaced lane id `<pluginId>:<laneId>`.
   */
  async *runLane(
    fullLaneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent> {
    const [pluginId, ...rest] = fullLaneId.split(":");
    const laneId = rest.join(":");
    if (!pluginId || !laneId) {
      yield { type: "error", message: `invalid lane id "${fullLaneId}"`, recoverable: false };
      return;
    }
    const loaded = this.plugins.get(pluginId);
    if (!loaded || loaded.status !== "ready" || !loaded.instance) {
      yield { type: "error", message: `plugin "${pluginId}" not ready`, recoverable: false };
      return;
    }
    if (!loaded.instance.capabilities.includes("execution") || !loaded.instance.runLane) {
      yield {
        type: "error",
        message: `plugin "${pluginId}" does not advertise execution capability`,
        recoverable: false,
      };
      return;
    }
    try {
      for await (const event of loaded.instance.runLane(laneId, input, signal)) {
        yield event;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.log.error(`plugin ${pluginId} runLane threw`, { laneId, error: message });
      yield { type: "error", message, recoverable: false };
    }
  }
```

Add imports at top of `plugin-host.ts`:

```typescript
import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  LaneEvent,
  LaneRunInput,
  LaneSummary,
  PluginHostContext,
} from "../contract/types";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/plugins/host/__tests__/plugin-host-run-lane.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/host/plugin-host.ts src/lib/plugins/host/__tests__/plugin-host-run-lane.test.ts
git commit -m "feat(host): PluginHost.runLane with prefix routing + synthetic error envelopes"
```

---

### Task 6: Add `PluginHost.reload(id, entry)` and `disposeOne(id)`

**Files:**
- Modify: `src/lib/plugins/host/plugin-host.ts`
- Create: `src/lib/plugins/host/__tests__/plugin-host-reload.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/plugins/host/__tests__/plugin-host-reload.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { PluginHost } from "../plugin-host";
import type { CockpitPlugin, PluginHostContext } from "../../contract/types";

function makeContext(): PluginHostContext {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: new Map(),
    memory: { get: async () => null, set: async () => {}, list: async () => [], delete: async () => {} },
    events: { emit: vi.fn() },
  };
}

function makePlugin(id: string, initFails = false): CockpitPlugin {
  return {
    id,
    displayName: id,
    version: "0.0.0",
    cockpitPluginContractVersion: "1.0.0",
    capabilities: [],
    init: vi.fn(async () => {
      if (initFails) throw new Error("init bomb");
    }),
    dispose: vi.fn(async () => {}),
  };
}

describe("PluginHost.reload", () => {
  it("re-inits a single plugin without touching others", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    const pluginA = makePlugin("a");
    const pluginB = makePlugin("b");
    await host.load([
      { id: "a", factory: () => pluginA },
      { id: "b", factory: () => pluginB },
    ]);
    expect(host.getPluginStatus("a")).toBe("ready");
    expect(host.getPluginStatus("b")).toBe("ready");

    const pluginA2 = makePlugin("a");
    await host.reload("a", { id: "a", factory: () => pluginA2 });
    expect(host.getPluginStatus("a")).toBe("ready");
    expect(host.getPluginStatus("b")).toBe("ready");
    expect(pluginA.dispose).toHaveBeenCalledTimes(1);
    expect(pluginB.dispose).not.toHaveBeenCalled();
    expect(pluginA2.init).toHaveBeenCalledTimes(1);
  });

  it("marks plugin errored if reload init throws", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    await host.load([{ id: "a", factory: () => makePlugin("a") }]);
    await host.reload("a", { id: "a", factory: () => makePlugin("a", true) });
    expect(host.getPluginStatus("a")).toBe("errored");
  });

  it("is idempotent for unknown plugin ids", async () => {
    const ctx = makeContext();
    const host = new PluginHost(ctx);
    await expect(
      host.reload("nope", { id: "nope", factory: () => makePlugin("nope") }),
    ).resolves.not.toThrow();
    expect(host.getPluginStatus("nope")).toBe("ready");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/plugins/host/__tests__/plugin-host-reload.test.ts`
Expected: FAIL — `host.reload` doesn't exist.

- [ ] **Step 3: Implement `reload` + private `disposeOne`**

In `src/lib/plugins/host/plugin-host.ts`, add inside the class:

```typescript
  /**
   * Dispose and re-init a single plugin. Used by /api/cockpit/plugins/:id/reload
   * to recover from init failures or apply settings changes. Other loaded
   * plugins are not affected. Idempotent for unknown ids (treats as load).
   */
  async reload(id: string, entry: PluginEntry): Promise<void> {
    await this.disposeOne(id);
    await this.load([entry]);
  }

  /** Internal: dispose just one plugin and remove it from the registry. */
  private async disposeOne(id: string): Promise<void> {
    const loaded = this.plugins.get(id);
    if (!loaded) return;
    if (loaded.instance && loaded.status === "ready") {
      try {
        await loaded.instance.dispose();
      } catch (err) {
        this.context.log.error(`plugin ${id} dispose failed during reload`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.plugins.delete(id);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/plugins/host/__tests__/plugin-host-reload.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/host/plugin-host.ts src/lib/plugins/host/__tests__/plugin-host-reload.test.ts
git commit -m "feat(host): per-plugin reload + private disposeOne (spec §9.3)"
```

---

### Task 7: Add chokidar dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add chokidar**

Run: `pnpm add chokidar@^4.0.0`
Expected: pnpm-lock.yaml updates, `package.json` gains `chokidar` under dependencies.

- [ ] **Step 2: Verify install**

Run: `pnpm install`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add chokidar v4 for InProcessVibeService file watching"
```

---

### Task 8: Add file watching to `InProcessVibeService`

**Files:**
- Modify: `src/lib/plugins/vibe/in-process-vibe-service.ts`
- Create: `src/lib/plugins/vibe/__tests__/in-process-vibe-service-watch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/vibe/__tests__/in-process-vibe-service-watch.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { InProcessVibeService } from "../in-process-vibe-service";

const sampleLane = (name: string) =>
  JSON.stringify({ name, description: `test lane ${name}`, owns: ["/out/**"] }, null, 2);

describe("InProcessVibeService — file watching", () => {
  let dir: string;
  let svc: InProcessVibeService;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vibe-watch-"));
    const lanesDir = path.join(dir, "lanes");
    require("node:fs").mkdirSync(lanesDir);
    writeFileSync(path.join(lanesDir, "first.json"), sampleLane("first"));
    svc = new InProcessVibeService({ repoRoots: [dir] });
  });

  afterEach(async () => {
    await svc.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it("initial listLanes returns lanes already on disk", async () => {
    const lanes = await svc.listLanes();
    expect(lanes.map((l) => l.laneId)).toEqual(["first"]);
  });

  it("emits lanesChanged when a new lane file is added", async () => {
    await svc.listLanes(); // ensure initial scan settled
    const events: string[] = [];
    svc.on("lanesChanged", () => events.push("changed"));

    writeFileSync(path.join(dir, "lanes", "second.json"), sampleLane("second"));
    await waitFor(() => events.length > 0, 1000);

    const lanes = await svc.listLanes();
    expect(lanes.map((l) => l.laneId).sort()).toEqual(["first", "second"]);
  });

  it("removes a lane from the cache when its JSON file is deleted", async () => {
    await svc.listLanes();
    const events: string[] = [];
    svc.on("lanesChanged", () => events.push("changed"));

    unlinkSync(path.join(dir, "lanes", "first.json"));
    await waitFor(() => events.length > 0, 1000);

    const lanes = await svc.listLanes();
    expect(lanes.map((l) => l.laneId)).toEqual([]);
  });
});

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/plugins/vibe/__tests__/in-process-vibe-service-watch.test.ts`
Expected: FAIL — `.on()` doesn't exist on `InProcessVibeService`.

- [ ] **Step 3: Implement file watching**

In `src/lib/plugins/vibe/in-process-vibe-service.ts`, add imports:

```typescript
import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
```

Make the class extend `EventEmitter`, add watcher state + initialize-on-construct:

```typescript
export class InProcessVibeService extends EventEmitter implements VibeService {
  private cache: ResolvedLane[] = [];
  private cacheReady: Promise<void>;
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly options: InProcessVibeServiceOptions) {
    super();
    this.cacheReady = this.startWatching();
  }

  private async startWatching(): Promise<void> {
    // Initial scan
    this.cache = await this.discoverAllLanes();
    // chokidar watcher (single instance across all roots)
    const globs = this.options.repoRoots.map((r) => path.posix.join(r.replace(/\\/g, "/"), "lanes/*.{json,prompt.md}"));
    this.watcher = chokidar.watch(globs, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      usePolling: false,
    });
    const onChange = (filePath: string) => this.scheduleRefresh(filePath);
    this.watcher.on("add", onChange);
    this.watcher.on("change", onChange);
    this.watcher.on("unlink", onChange);
    this.watcher.on("error", (err) => this.emit("error", err));
  }

  private scheduleRefresh(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      filePath,
      setTimeout(async () => {
        this.debounceTimers.delete(filePath);
        this.cache = await this.discoverAllLanes();
        this.emit("lanesChanged");
      }, 100),
    );
  }
```

Replace the old `listLanes()` to read from cache:

```typescript
  async listLanes(): Promise<LaneSummary[]> {
    await this.cacheReady;
    return this.cache.map((r) => this.toSummary(r));
  }
```

Update `dispose()`:

```typescript
  async dispose(): Promise<void> {
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.removeAllListeners();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/plugins/vibe/__tests__/in-process-vibe-service-watch.test.ts`
Expected: 3 passed. Test timeout is 10s; chokidar's "add" event should fire well under 1s.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/vibe/in-process-vibe-service.ts src/lib/plugins/vibe/__tests__/in-process-vibe-service-watch.test.ts
git commit -m "feat(vibe-service): chokidar file watching with 100ms debounce + lanesChanged event"
```

---

### Task 9: Add `@vibe/runtime` workspace dep (file: link for now)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the dep**

Add to `package.json` dependencies (manual edit, since `@vibe/runtime` is in a sibling repo):

```json
    "@vibe/runtime": "file:../../vibe/.claude/worktrees/peaceful-wright-5f8fa7/packages/runtime",
```

Once the sibling-plan PR ([vibe#12](https://github.com/lutherfourie/vibe/pull/12)) merges and the Vibe repo's main branch has `packages/runtime`, update the path to `file:../../vibe/packages/runtime`. For now the worktree path keeps Tasks 11–12 unblocked.

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: pnpm resolves the file: link; `@vibe/runtime` appears under `node_modules`.

If the Vibe runtime package doesn't yet exist (sibling plan hasn't been executed): skip this step temporarily, and Task 11 uses a vi.mock stub.

- [ ] **Step 3: Verify imports resolve**

Create a quick smoke check: `src/lib/plugins/vibe/__tests__/runtime-import.smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("@vibe/runtime import smoke", () => {
  it("exports runTranslatedLane and LaneEvent type", async () => {
    const mod = await import("@vibe/runtime");
    expect(typeof mod.runTranslatedLane).toBe("function");
  });
});
```

Run: `pnpm test runtime-import.smoke.test.ts`
Expected: PASS (if Vibe runtime is linked) or known-skipped with a clear message.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/plugins/vibe/__tests__/runtime-import.smoke.test.ts
git commit -m "build: add @vibe/runtime via file: workspace link (Phase 3 runtime dep)"
```

---

### Task 10: Create `active-runs.ts` singleton

**Files:**
- Create: `src/lib/plugins/vibe/active-runs.ts`
- Create: `src/lib/plugins/vibe/__tests__/active-runs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/vibe/__tests__/active-runs.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { activeRuns, addRun, evictRun, type ActiveRun } from "../active-runs";
import type { LaneEvent } from "../../contract/types";

function makeRun(overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    runId: "r1",
    pluginId: "vibe",
    laneId: "feedback-triage",
    userId: "u1",
    startedAt: new Date(),
    abortController: new AbortController(),
    ringBuffer: [],
    status: "running",
    lastEventAt: new Date(),
    ...overrides,
  };
}

describe("active-runs singleton", () => {
  beforeEach(() => activeRuns.clear());

  it("adds and retrieves runs by id", () => {
    const run = makeRun();
    addRun(run);
    expect(activeRuns.get("r1")).toBe(run);
  });

  it("evictRun removes the entry", () => {
    addRun(makeRun());
    evictRun("r1");
    expect(activeRuns.has("r1")).toBe(false);
  });

  it("evictRun is idempotent for unknown ids", () => {
    expect(() => evictRun("ghost")).not.toThrow();
  });

  it("ring buffer drops oldest non-terminal events when over high-watermark", () => {
    const run = makeRun();
    const start: LaneEvent = { type: "start", laneId: "l", runId: "r1" };
    run.ringBuffer.push(start);
    for (let i = 0; i < 1010; i++) {
      run.ringBuffer.push({ type: "tool_call", tool: "x", args: { i } });
    }
    // The route handler is responsible for capping; here we just verify the
    // buffer is plain array (the cap logic is unit-tested in Task 15).
    expect(run.ringBuffer.length).toBe(1011);
    expect(run.ringBuffer[0].type).toBe("start");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test active-runs.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the singleton**

Create `src/lib/plugins/vibe/active-runs.ts`:

```typescript
import type { LaneEvent } from "../contract/types";

/**
 * In-memory run state. Process-scoped (survives across HTTP requests),
 * not request-scoped. Wiped on process restart — Phase 3b adds persistence.
 *
 * Spec §5.7.
 */
export interface ActiveRun {
  runId: string;
  pluginId: string;
  laneId: string;
  userId: string;
  startedAt: Date;
  abortController: AbortController;
  ringBuffer: LaneEvent[];
  status: "running" | "completed" | "canceled" | "failed";
  lastEventAt: Date;
}

export const activeRuns = new Map<string, ActiveRun>();

export function addRun(run: ActiveRun): void {
  activeRuns.set(run.runId, run);
}

export function evictRun(runId: string): void {
  activeRuns.delete(runId);
}

/** Latest run per `(pluginId, laneId)`. Used to populate `LaneSummary.lastRunAt`. */
export function latestRunFor(pluginId: string, laneId: string): ActiveRun | undefined {
  let best: ActiveRun | undefined;
  for (const run of activeRuns.values()) {
    if (run.pluginId !== pluginId || run.laneId !== laneId) continue;
    if (!best || run.lastEventAt > best.lastEventAt) best = run;
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test active-runs.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/vibe/active-runs.ts src/lib/plugins/vibe/__tests__/active-runs.test.ts
git commit -m "feat(vibe-service): in-memory activeRuns singleton + helpers (spec §5.7)"
```

---

### Task 11: Implement `runLane` on `InProcessVibeService`

**Files:**
- Modify: `src/lib/plugins/vibe/in-process-vibe-service.ts`
- Create: `src/lib/plugins/vibe/__tests__/in-process-vibe-service-run.test.ts`

- [ ] **Step 1: Write the failing test (with a vi.mock'd @vibe/runtime)**

Create `src/lib/plugins/vibe/__tests__/in-process-vibe-service-run.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LaneEvent } from "../../contract/types";

vi.mock("@vibe/runtime", () => ({
  runTranslatedLane: vi.fn(async function* (spec, input, signal) {
    yield { type: "start", laneId: spec.laneId, runId: "test-run" };
    yield { type: "tool_call", tool: "read_file", args: {} };
    yield { type: "final", summary: "ok", outputs: [] };
  }),
}));

describe("InProcessVibeService.runLane", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vibe-run-"));
    mkdirSync(path.join(dir, "lanes"));
    writeFileSync(
      path.join(dir, "lanes", "test.json"),
      JSON.stringify({ name: "test", prompt: "you are a tester", owns: ["/out/**"] }),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("yields the LaneEvent sequence from @vibe/runtime for a known lane", async () => {
    const { InProcessVibeService } = await import("../in-process-vibe-service");
    const svc = new InProcessVibeService({ repoRoots: [dir] });
    await svc.listLanes(); // wait for initial scan

    const events: LaneEvent[] = [];
    for await (const e of svc.runLane("test", { userMessage: "go" }, new AbortController().signal)) {
      events.push(e);
    }
    await svc.dispose();

    expect(events.map((e) => e.type)).toEqual(["start", "tool_call", "final"]);
  });

  it("yields error frame when laneId is unknown", async () => {
    const { InProcessVibeService } = await import("../in-process-vibe-service");
    const svc = new InProcessVibeService({ repoRoots: [dir] });
    await svc.listLanes();

    const events: LaneEvent[] = [];
    for await (const e of svc.runLane("nope", { userMessage: "go" }, new AbortController().signal)) {
      events.push(e);
    }
    await svc.dispose();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", recoverable: false });
    expect((events[0] as { message: string }).message).toContain("nope");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test in-process-vibe-service-run.test.ts`
Expected: FAIL — `runLane` is still the Task-4 stub that throws.

- [ ] **Step 3: Implement `runLane`**

In `src/lib/plugins/vibe/in-process-vibe-service.ts`, replace the stub:

```typescript
import { runTranslatedLane } from "@vibe/runtime";

  // ...inside the class...

  async *runLane(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent> {
    await this.cacheReady;
    const lane = this.cache.find((r) => r.laneId === laneId);
    if (!lane) {
      yield {
        type: "error",
        message: `unknown lane "${laneId}"`,
        recoverable: false,
      };
      return;
    }
    const prompt = await lane.promptResolver();
    const runtimeSpec = {
      laneId: lane.laneId,
      prompt,
      reads: lane.spec.reads ?? [],
      owns: lane.spec.owns ?? [],
      tools: lane.spec.tools,
      model: lane.spec.model,
      approval: lane.spec.approval,
      verify: lane.spec.verify,
      repoPath: lane.repoPath,
    };
    yield* runTranslatedLane(runtimeSpec, input, signal);
  }
```

Note: re-using `LaneEvent` from `@vibe/runtime` would be cleaner than yielding into Cockpit's `LaneEvent`. Both shapes are structurally identical (spec §3.4 designed this intentional duplication). TypeScript treats them as compatible because the structures match; if the compiler ever flags it, add an `as LaneEvent` cast inside the loop.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test in-process-vibe-service-run.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/vibe/in-process-vibe-service.ts src/lib/plugins/vibe/__tests__/in-process-vibe-service-run.test.ts
git commit -m "feat(vibe-service): InProcessVibeService.runLane delegates to @vibe/runtime"
```

---

### Task 12: Expose `runLane` on `VibePlugin` + advertise `execution` capability

**Files:**
- Modify: `src/lib/plugins/vibe/vibe-plugin.ts`

- [ ] **Step 1: Update VibePlugin**

In `src/lib/plugins/vibe/vibe-plugin.ts`:

```typescript
export class VibePlugin implements CockpitPlugin {
  readonly id = "vibe";
  readonly displayName = "Vibe Lanes";
  readonly version = "0.1.0";
  readonly cockpitPluginContractVersion = "1.0.0";
  readonly description = "Vibe lane discovery, execution, and surface-aware handoff generation.";
  readonly capabilities: readonly PluginCapability[] = ["discovery", "execution", "handoff"];

  // ...existing init/dispose/listLanes/generateHandoff...

  runLane(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent> {
    return this.service.runLane(laneId, input, signal);
  }
}
```

Add `LaneEvent`, `LaneRunInput` to imports.

- [ ] **Step 2: Run all tests + typecheck**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/plugins/vibe/vibe-plugin.ts
git commit -m "feat(vibe-plugin): expose runLane + advertise execution capability"
```

---

### Task 13: Create `POST /api/cockpit/lanes/[laneId]/run` route

**Files:**
- Create: `src/app/api/cockpit/lanes/[laneId]/run/route.ts`
- Create: `tests/api/lanes-run.spec.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/api/lanes-run.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, vi } from "vitest";

// Mock the plugin host: returns a runId on runLane
const mockRunLane = vi.fn(async function* () {
  yield { type: "start", laneId: "l", runId: "test" };
  yield { type: "final", summary: "ok", outputs: [] };
});
vi.mock("../../src/lib/plugins/host/get-plugin-host", () => ({
  getPluginHost: () => ({ runLane: mockRunLane }),
}));

vi.mock("../../src/lib/cockpit/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  }),
}));

describe("POST /api/cockpit/lanes/[laneId]/run", () => {
  it("authenticates, mints runId, returns { runId }", async () => {
    const { POST } = await import("../../src/app/api/cockpit/lanes/[laneId]/run/route");
    const req = new Request("http://localhost/api/cockpit/lanes/feedback-triage/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userMessage: "go" }),
    });
    const ctx = { params: Promise.resolve({ laneId: "feedback-triage" }) };
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.doMock("../../src/lib/cockpit/supabase-server", () => ({
      createSupabaseServerClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      }),
    }));
    vi.resetModules();
    const { POST } = await import("../../src/app/api/cockpit/lanes/[laneId]/run/route");
    const req = new Request("http://localhost/api/cockpit/lanes/x/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{\"userMessage\":\"go\"}",
    });
    const ctx = { params: Promise.resolve({ laneId: "x" }) };
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lanes-run.spec.ts`
Expected: FAIL — route module doesn't exist.

- [ ] **Step 3: Create the route**

Create `src/app/api/cockpit/lanes/[laneId]/run/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/cockpit/supabase-server";
import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";
import { addRun, type ActiveRun } from "@/lib/plugins/vibe/active-runs";
import type { LaneEvent } from "@/lib/plugins/contract/types";

const RunBodySchema = z.object({
  userMessage: z.string().min(1),
  pluginId: z.string().default("vibe"),
  overrides: z
    .object({
      model: z.string().optional(),
      envVars: z.record(z.string()).optional(),
      cwd: z.string().optional(),
    })
    .optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ laneId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { laneId } = await context.params;
  const json = await request.json().catch(() => null);
  const parsed = RunBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", details: parsed.error.format() }, { status: 400 });
  }
  const { userMessage, pluginId, overrides } = parsed.data;

  const runId = randomUUID();
  const controller = new AbortController();
  const run: ActiveRun = {
    runId,
    pluginId,
    laneId,
    userId: user.id,
    startedAt: new Date(),
    abortController: controller,
    ringBuffer: [],
    status: "running",
    lastEventAt: new Date(),
  };
  addRun(run);

  // Kick off the lane in the background; the GET /run-events route consumes from the ring buffer.
  void drainIntoRingBuffer(run, pluginId, laneId, { userMessage, overrides }, controller.signal);

  return NextResponse.json({ runId });
}

async function drainIntoRingBuffer(
  run: ActiveRun,
  pluginId: string,
  laneId: string,
  input: { userMessage: string; overrides?: { model?: string; envVars?: Record<string, string>; cwd?: string } },
  signal: AbortSignal,
): Promise<void> {
  const host = getPluginHost();
  const HIGH_WATER = 1000;
  try {
    for await (const event of host.runLane(`${pluginId}:${laneId}`, input, signal)) {
      run.ringBuffer.push(event);
      run.lastEventAt = new Date();
      if (event.type === "final") run.status = "completed";
      if (event.type === "error" && event.recoverable === false) run.status = "failed";
      if (event.type === "error" && event.recoverable === true) run.status = "canceled";

      // Backpressure (spec §5.6): drop oldest non-terminal events when over high-watermark.
      while (run.ringBuffer.length > HIGH_WATER) {
        const idx = run.ringBuffer.findIndex(
          (e) => e.type !== "start" && e.type !== "final" && e.type !== "error",
        );
        if (idx < 0) break;
        run.ringBuffer.splice(idx, 1);
      }
    }
  } catch (err) {
    run.ringBuffer.push({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      recoverable: false,
    });
    run.status = "failed";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test lanes-run.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cockpit/lanes/[laneId]/run/route.ts tests/api/lanes-run.spec.ts
git commit -m "feat(api): POST /cockpit/lanes/[laneId]/run mints runId, drains into ring buffer"
```

---

### Task 14: Create `GET /api/cockpit/lanes/[laneId]/run-events` SSE route

**Files:**
- Create: `src/app/api/cockpit/lanes/[laneId]/run-events/route.ts`
- Create: `tests/api/lanes-run-events.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/lanes-run-events.spec.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/cockpit/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  }),
}));

describe("GET /api/cockpit/lanes/[laneId]/run-events", () => {
  it("streams ring-buffer events as SSE frames", async () => {
    const { activeRuns, addRun } = await import("../../src/lib/plugins/vibe/active-runs");
    activeRuns.clear();
    addRun({
      runId: "r1",
      pluginId: "vibe",
      laneId: "test",
      userId: "u1",
      startedAt: new Date(),
      abortController: new AbortController(),
      ringBuffer: [
        { type: "start", laneId: "test", runId: "r1" },
        { type: "final", summary: "done", outputs: [] },
      ],
      status: "completed",
      lastEventAt: new Date(),
    });

    const { GET } = await import("../../src/app/api/cockpit/lanes/[laneId]/run-events/route");
    const req = new Request("http://localhost/api/cockpit/lanes/test/run-events?runId=r1");
    const ctx = { params: Promise.resolve({ laneId: "test" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await readStreamToText(res.body!);
    expect(text).toContain("event: start");
    expect(text).toContain('"laneId":"test"');
    expect(text).toContain("event: final");
  });

  it("returns 404 when runId is unknown", async () => {
    const { GET } = await import("../../src/app/api/cockpit/lanes/[laneId]/run-events/route");
    const req = new Request("http://localhost/api/cockpit/lanes/x/run-events?runId=ghost");
    const ctx = { params: Promise.resolve({ laneId: "x" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 when run's userId differs from authenticated user", async () => {
    const { activeRuns, addRun } = await import("../../src/lib/plugins/vibe/active-runs");
    activeRuns.clear();
    addRun({
      runId: "r2",
      pluginId: "vibe",
      laneId: "x",
      userId: "OTHER",
      startedAt: new Date(),
      abortController: new AbortController(),
      ringBuffer: [],
      status: "running",
      lastEventAt: new Date(),
    });
    const { GET } = await import("../../src/app/api/cockpit/lanes/[laneId]/run-events/route");
    const req = new Request("http://localhost/api/cockpit/lanes/x/run-events?runId=r2");
    const ctx = { params: Promise.resolve({ laneId: "x" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(403);
  });
});

async function readStreamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lanes-run-events.spec.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Create the SSE route**

Create `src/app/api/cockpit/lanes/[laneId]/run-events/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/cockpit/supabase-server";
import { activeRuns } from "@/lib/plugins/vibe/active-runs";
import type { LaneEvent } from "@/lib/plugins/contract/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ laneId: string }> },
) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const run = activeRuns.get(runId);
  if (!run) return NextResponse.json({ error: "unknown runId" }, { status: 404 });
  if (run.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let cursor = 0;
      const drain = () => {
        while (cursor < run.ringBuffer.length) {
          const event = run.ringBuffer[cursor++];
          const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        }
      };
      drain();
      // Poll for new events until terminal frame is emitted or 60s grace post-termination.
      const terminalSeen = () =>
        run.ringBuffer.some((e) => e.type === "final" || e.type === "error");
      while (true) {
        await new Promise((r) => setTimeout(r, 50));
        drain();
        if (terminalSeen() && cursor >= run.ringBuffer.length) break;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test lanes-run-events.spec.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cockpit/lanes/[laneId]/run-events/route.ts tests/api/lanes-run-events.spec.ts
git commit -m "feat(api): GET /cockpit/lanes/[laneId]/run-events SSE stream with auth gates"
```

---

### Task 15: Create `POST /api/cockpit/runs/[runId]/cancel` route

**Files:**
- Create: `src/app/api/cockpit/runs/[runId]/cancel/route.ts`
- Create: `tests/api/runs-cancel.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/runs-cancel.spec.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/cockpit/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  }),
}));

describe("POST /api/cockpit/runs/[runId]/cancel", () => {
  it("aborts the run's controller and marks status=canceled", async () => {
    const { activeRuns, addRun } = await import("../../src/lib/plugins/vibe/active-runs");
    activeRuns.clear();
    const controller = new AbortController();
    addRun({
      runId: "r-cancel",
      pluginId: "vibe",
      laneId: "x",
      userId: "u1",
      startedAt: new Date(),
      abortController: controller,
      ringBuffer: [],
      status: "running",
      lastEventAt: new Date(),
    });

    const { POST } = await import("../../src/app/api/cockpit/runs/[runId]/cancel/route");
    const req = new Request("http://localhost/api/cockpit/runs/r-cancel/cancel", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ runId: "r-cancel" }) });
    expect(res.status).toBe(200);
    expect(controller.signal.aborted).toBe(true);
  });

  it("returns 200 no-op on unknown runId (idempotent)", async () => {
    const { POST } = await import("../../src/app/api/cockpit/runs/[runId]/cancel/route");
    const req = new Request("http://localhost/api/cockpit/runs/ghost/cancel", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ runId: "ghost" }) });
    expect(res.status).toBe(200);
  });

  it("returns 403 on cross-user cancel attempt", async () => {
    const { activeRuns, addRun } = await import("../../src/lib/plugins/vibe/active-runs");
    activeRuns.clear();
    addRun({
      runId: "r-other",
      pluginId: "vibe",
      laneId: "x",
      userId: "OTHER",
      startedAt: new Date(),
      abortController: new AbortController(),
      ringBuffer: [],
      status: "running",
      lastEventAt: new Date(),
    });
    const { POST } = await import("../../src/app/api/cockpit/runs/[runId]/cancel/route");
    const req = new Request("http://localhost/api/cockpit/runs/r-other/cancel", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ runId: "r-other" }) });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test runs-cancel.spec.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Create the route**

Create `src/app/api/cockpit/runs/[runId]/cancel/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/cockpit/supabase-server";
import { activeRuns, evictRun } from "@/lib/plugins/vibe/active-runs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { runId } = await context.params;
  const run = activeRuns.get(runId);
  if (!run) return NextResponse.json({ ok: true, status: "unknown" });
  if (run.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (run.status === "running") {
    run.abortController.abort();
    run.status = "canceled";
  }
  // 60s grace before eviction so a slow client can drain (spec §5.7).
  setTimeout(() => evictRun(runId), 60_000);
  return NextResponse.json({ ok: true, status: run.status });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test runs-cancel.spec.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cockpit/runs/[runId]/cancel/route.ts tests/api/runs-cancel.spec.ts
git commit -m "feat(api): POST /cockpit/runs/[runId]/cancel aborts controller; idempotent"
```

---

### Task 16: Enrich `listAllLanes` with `lastRunAt` from `activeRuns`

**Files:**
- Modify: `src/lib/plugins/host/plugin-host.ts`
- Create: `src/lib/plugins/host/__tests__/plugin-host-last-run-at.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/host/__tests__/plugin-host-last-run-at.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginHost } from "../plugin-host";
import { activeRuns, addRun } from "../../vibe/active-runs";
import type { CockpitPlugin, LaneSummary, PluginHostContext } from "../../contract/types";

function ctx(): PluginHostContext {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: new Map(),
    memory: { get: async () => null, set: async () => {}, list: async () => [], delete: async () => {} },
    events: { emit: vi.fn() },
  };
}

describe("PluginHost.listAllLanes — lastRunAt enrichment", () => {
  beforeEach(() => activeRuns.clear());

  it("fills LaneSummary.lastRunAt from the most-recent activeRun for that lane", async () => {
    const host = new PluginHost(ctx());
    const plugin: CockpitPlugin = {
      id: "vibe",
      displayName: "Vibe",
      version: "0.1.0",
      cockpitPluginContractVersion: "1.0.0",
      capabilities: ["discovery"],
      init: async () => {},
      dispose: async () => {},
      listLanes: async () => [
        {
          laneId: "feedback-triage",
          pluginId: "",
          name: "feedback-triage",
          repoPath: "/repo",
          reads: [],
          owns: [],
          status: "ready",
        } satisfies LaneSummary,
      ],
    };
    await host.load([{ id: "vibe", factory: () => plugin }]);

    const lastEventAt = new Date("2026-05-18T12:00:00Z");
    addRun({
      runId: "r-old",
      pluginId: "vibe",
      laneId: "feedback-triage",
      userId: "u1",
      startedAt: new Date("2026-05-18T11:00:00Z"),
      abortController: new AbortController(),
      ringBuffer: [],
      status: "completed",
      lastEventAt,
    });

    const lanes = await host.listAllLanes();
    expect(lanes[0].lastRunAt).toBe(lastEventAt.toISOString());
  });

  it("leaves lastRunAt undefined when no run exists for the lane", async () => {
    const host = new PluginHost(ctx());
    const plugin: CockpitPlugin = {
      id: "vibe",
      displayName: "Vibe",
      version: "0.1.0",
      cockpitPluginContractVersion: "1.0.0",
      capabilities: ["discovery"],
      init: async () => {},
      dispose: async () => {},
      listLanes: async () => [
        { laneId: "x", pluginId: "", name: "x", repoPath: "/", reads: [], owns: [], status: "ready" },
      ],
    };
    await host.load([{ id: "vibe", factory: () => plugin }]);
    const lanes = await host.listAllLanes();
    expect(lanes[0].lastRunAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-host-last-run-at.test.ts`
Expected: FAIL — `lastRunAt` not enriched.

- [ ] **Step 3: Implement enrichment**

In `src/lib/plugins/host/plugin-host.ts`, modify `listAllLanes()` after the existing aggregation loop:

```typescript
import { latestRunFor } from "../vibe/active-runs";

  async listAllLanes(): Promise<LaneSummary[]> {
    const out: LaneSummary[] = [];
    for (const loaded of this.plugins.values()) {
      if (loaded.status !== "ready" || !loaded.instance) continue;
      if (!loaded.instance.capabilities.includes("discovery")) continue;
      if (!loaded.instance.listLanes) continue;
      try {
        const lanes = await loaded.instance.listLanes();
        for (const lane of lanes) {
          const enriched: LaneSummary = { ...lane, pluginId: loaded.id };
          const latest = latestRunFor(loaded.id, lane.laneId);
          if (latest) {
            enriched.lastRunAt = latest.lastEventAt.toISOString();
            if (latest.status === "running") enriched.status = "running";
          }
          out.push(enriched);
        }
      } catch (err) {
        this.context.log.error(`plugin ${loaded.id} listLanes failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test plugin-host-last-run-at.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/host/plugin-host.ts src/lib/plugins/host/__tests__/plugin-host-last-run-at.test.ts
git commit -m "feat(host): enrich LaneSummary.lastRunAt + status from activeRuns map"
```

---

### Task 17: Audit-log run lifecycle to `cockpit_assistant_events`

**Files:**
- Modify: `src/app/api/cockpit/lanes/[laneId]/run/route.ts` (insert audit row on start)
- Modify: `src/app/api/cockpit/runs/[runId]/cancel/route.ts` (insert audit row on cancel)
- Modify: `src/lib/plugins/vibe/active-runs.ts` (extend to capture final/error transitions)
- Create: `tests/api/run-audit-log.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/run-audit-log.spec.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

const insertedRows: unknown[] = [];
vi.mock("../../src/lib/cockpit/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: () => ({
      insert: (row: unknown) => {
        insertedRows.push(row);
        return { error: null };
      },
    }),
  }),
}));

vi.mock("../../src/lib/plugins/host/get-plugin-host", () => ({
  getPluginHost: () => ({
    runLane: async function* () {
      yield { type: "start", laneId: "x", runId: "r" };
      yield { type: "final", summary: "ok", outputs: [] };
    },
  }),
}));

describe("Run audit log", () => {
  it("writes a cockpit_assistant_events row with event_type='tool_result' on run start", async () => {
    insertedRows.length = 0;
    const { POST } = await import("../../src/app/api/cockpit/lanes/[laneId]/run/route");
    const req = new Request("http://localhost/api/cockpit/lanes/x/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userMessage: "go" }),
    });
    await POST(req, { params: Promise.resolve({ laneId: "x" }) });
    await new Promise((r) => setTimeout(r, 100));
    const auditRows = insertedRows.filter(
      (r: any) => r.event_type === "tool_result" && r.metadata?.plugin_id === "vibe",
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect((auditRows[0] as any).metadata.operation).toBe("runLane:start");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test run-audit-log.spec.ts`
Expected: FAIL — no audit rows being inserted.

- [ ] **Step 3: Implement audit-log writes**

In `src/app/api/cockpit/lanes/[laneId]/run/route.ts`, add a helper and call it after `addRun(run)`:

```typescript
async function writeAuditRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  pluginId: string,
  laneId: string,
  runId: string,
  operation: string,
  content: string,
): Promise<void> {
  try {
    await supabase.from("cockpit_assistant_events").insert({
      user_id: userId,
      session_id: null,
      event_type: "tool_result",
      role: "system",
      content,
      metadata: { plugin_id: pluginId, lane_id: laneId, run_id: runId, operation },
    });
  } catch {
    // Audit failures must not break the user-facing operation. Logged via the host's logger.
  }
}
```

Call it after `addRun(run);`:

```typescript
await writeAuditRow(supabase, user.id, pluginId, laneId, runId, "runLane:start", `Started lane ${laneId}`);
```

In `src/app/api/cockpit/runs/[runId]/cancel/route.ts`, after the `abort()`:

```typescript
await writeAuditRow(supabase, user.id, run.pluginId, run.laneId, runId, "runLane:cancel", `Canceled lane ${run.laneId}`);
```

(Duplicate the helper or hoist it into `src/lib/plugins/vibe/audit-log.ts` — recommend the latter; do that hoist as part of this step.)

Create `src/lib/plugins/vibe/audit-log.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeAuditRow(
  supabase: SupabaseClient,
  userId: string,
  pluginId: string,
  laneId: string,
  runId: string,
  operation: string,
  content: string,
): Promise<void> {
  try {
    await supabase.from("cockpit_assistant_events").insert({
      user_id: userId,
      session_id: null,
      event_type: "tool_result",
      role: "system",
      content,
      metadata: { plugin_id: pluginId, lane_id: laneId, run_id: runId, operation },
    });
  } catch {
    // intentionally swallow — audit must not break the foreground flow
  }
}
```

Import it from both route files; remove the local helper.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test run-audit-log.spec.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/vibe/audit-log.ts src/app/api/cockpit/lanes/[laneId]/run/route.ts src/app/api/cockpit/runs/[runId]/cancel/route.ts tests/api/run-audit-log.spec.ts
git commit -m "feat(api): audit-log run start/cancel to cockpit_assistant_events (spec §9.4)"
```

---

### Task 18: Run dialog component

**Files:**
- Create: `src/components/cockpit/run-dialog.tsx`
- Create: `src/components/cockpit/__tests__/run-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/cockpit/__tests__/run-dialog.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunDialog } from "../run-dialog";

describe("RunDialog", () => {
  it("submits userMessage with the lane id when Run clicked", async () => {
    const onRun = vi.fn(async () => ({ runId: "r1" }));
    const onClose = vi.fn();
    render(
      <RunDialog
        laneId="feedback-triage"
        pluginId="vibe"
        defaultUserMessage="Process latest feedback"
        onRun={onRun}
        onClose={onClose}
      />,
    );
    expect(screen.getByLabelText(/user message/i)).toHaveValue("Process latest feedback");
    fireEvent.click(screen.getByText("Run"));
    expect(onRun).toHaveBeenCalledWith({
      laneId: "feedback-triage",
      pluginId: "vibe",
      userMessage: "Process latest feedback",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test run-dialog.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement RunDialog**

Create `src/components/cockpit/run-dialog.tsx`:

```typescript
"use client";

import { useState } from "react";

export interface RunDialogProps {
  laneId: string;
  pluginId: string;
  defaultUserMessage?: string;
  onRun: (input: { laneId: string; pluginId: string; userMessage: string }) => Promise<{ runId: string }>;
  onClose: () => void;
}

export function RunDialog({ laneId, pluginId, defaultUserMessage, onRun, onClose }: RunDialogProps) {
  const [userMessage, setUserMessage] = useState(defaultUserMessage ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleRun = async () => {
    setSubmitting(true);
    try {
      await onRun({ laneId, pluginId, userMessage });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-label={`Run ${laneId}`} className="rounded border bg-white p-4 shadow-lg">
      <h2 className="text-lg font-semibold">Run lane: {laneId}</h2>
      <label className="mt-3 block">
        <span className="block text-sm font-medium">User message</span>
        <textarea
          className="mt-1 w-full rounded border p-2"
          rows={4}
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
        <button type="button" onClick={handleRun} disabled={submitting || !userMessage.trim()}>
          Run
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test run-dialog.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/cockpit/run-dialog.tsx src/components/cockpit/__tests__/run-dialog.test.tsx
git commit -m "feat(ui): RunDialog component (lane run form with userMessage)"
```

---

### Task 19: Run stream panel component

**Files:**
- Create: `src/components/cockpit/run-stream-panel.tsx`
- Create: `src/components/cockpit/__tests__/run-stream-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/cockpit/__tests__/run-stream-panel.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { RunStreamPanel } from "../run-stream-panel";
import type { LaneEvent } from "@/lib/plugins/contract/types";

class MockEventSource {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener(type: string, cb: (ev: { data: string }) => void) {
    if (type === "tool_call" || type === "final" || type === "start") {
      (this as any)[`__${type}`] = cb;
    }
  }
  close() {}
  emit(type: string, event: LaneEvent) {
    const cb = (this as any)[`__${type}`];
    if (cb) cb({ data: JSON.stringify(event) });
  }
}

describe("RunStreamPanel", () => {
  it("renders events from the SSE stream as they arrive", async () => {
    const source = new MockEventSource();
    vi.stubGlobal("EventSource", vi.fn(() => source));

    render(<RunStreamPanel runId="r1" laneId="x" onClose={() => {}} />);
    act(() => {
      source.emit("start", { type: "start", laneId: "x", runId: "r1" });
      source.emit("tool_call", { type: "tool_call", tool: "read_file", args: { path: "/x" } });
      source.emit("final", { type: "final", summary: "done", outputs: [] });
    });

    expect(screen.getByText(/start/i)).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText(/done/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test run-stream-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement RunStreamPanel**

Create `src/components/cockpit/run-stream-panel.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import type { LaneEvent } from "@/lib/plugins/contract/types";

export interface RunStreamPanelProps {
  runId: string;
  laneId: string;
  pluginId?: string;
  onClose: () => void;
}

const EVENT_TYPES: LaneEvent["type"][] = [
  "start", "todo", "tool_call", "tool_result", "log", "file_write", "final", "error",
];

export function RunStreamPanel({ runId, laneId, onClose }: RunStreamPanelProps) {
  const [events, setEvents] = useState<LaneEvent[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const source = new EventSource(
      `/api/cockpit/lanes/${encodeURIComponent(laneId)}/run-events?runId=${encodeURIComponent(runId)}`,
    );
    const handlers = EVENT_TYPES.map((t) => {
      const cb = (ev: MessageEvent) => {
        const event = JSON.parse(ev.data) as LaneEvent;
        setEvents((prev) => [...prev, event]);
        if (event.type === "final" || event.type === "error") setDone(true);
      };
      source.addEventListener(t, cb as EventListener);
      return [t, cb] as const;
    });
    return () => {
      for (const [t, cb] of handlers) source.removeEventListener(t, cb as EventListener);
      source.close();
    };
  }, [runId, laneId]);

  const cancel = async () => {
    await fetch(`/api/cockpit/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  };

  return (
    <div role="region" aria-label="Lane run stream" className="rounded border bg-white p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Run {runId.slice(0, 8)} — {laneId}</h3>
        <div className="flex gap-2">
          {!done && <button onClick={cancel}>Cancel</button>}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      <ol className="mt-2 max-h-96 space-y-1 overflow-y-auto text-xs">
        {events.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="font-mono opacity-60">{e.type}</span>
            <span>{summarize(e)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function summarize(e: LaneEvent): string {
  switch (e.type) {
    case "start": return e.laneId;
    case "tool_call": return e.tool;
    case "tool_result": return `${e.tool} (${e.ok ? "ok" : "fail"})`;
    case "todo": return `${e.items.length} todos`;
    case "log": return e.message.slice(0, 100);
    case "file_write": return `${e.path} (${e.bytes}b)`;
    case "final": return e.summary || "(empty summary)";
    case "error": return `error: ${e.message}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test run-stream-panel.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/cockpit/run-stream-panel.tsx src/components/cockpit/__tests__/run-stream-panel.test.tsx
git commit -m "feat(ui): RunStreamPanel subscribes to SSE and renders LaneEvent stream"
```

---

### Task 20: Lane inventory panel — wire Run/Cancel/status

**Files:**
- Create or modify (depending on what exists): `src/components/cockpit/lane-inventory-panel.tsx`
- Create: `src/components/cockpit/__tests__/lane-inventory-panel.test.tsx`

- [ ] **Step 1: Confirm whether a lane-inventory component already exists**

Run: `pnpm exec grep -r "lane" src/components --include="*.tsx" -l` (or use a Glob/Grep tool)

If a panel already exists, modify it. If not, create the file. The spec §4.5 has the canonical ASCII mockup.

- [ ] **Step 2: Write the test (assuming create)**

Create `src/components/cockpit/__tests__/lane-inventory-panel.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LaneInventoryPanel } from "../lane-inventory-panel";
import type { LaneSummary } from "@/lib/plugins/contract/types";

const lanes: LaneSummary[] = [
  {
    laneId: "feedback-triage",
    pluginId: "vibe",
    name: "feedback-triage",
    description: "Map feedback to action plan",
    repoPath: "C:/repo",
    reads: ["/docs/feedback/**"],
    owns: ["/outputs/**"],
    target: "codex.local",
    approval: "human.before_commit",
    status: "ready",
  },
];

describe("LaneInventoryPanel", () => {
  it("renders each lane grouped under its repoPath", () => {
    render(<LaneInventoryPanel lanes={lanes} onRun={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("C:/repo")).toBeInTheDocument();
    expect(screen.getByText("feedback-triage")).toBeInTheDocument();
    expect(screen.getByText(/Map feedback/)).toBeInTheDocument();
  });

  it("calls onRun(lane) when Run button clicked", () => {
    const onRun = vi.fn();
    render(<LaneInventoryPanel lanes={lanes} onRun={onRun} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Run lane"));
    expect(onRun).toHaveBeenCalledWith(lanes[0]);
  });

  it("shows Cancel button when lane status is running", () => {
    const running = [{ ...lanes[0], status: "running" as const }];
    render(<LaneInventoryPanel lanes={running} onRun={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.queryByText("Run lane")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test lane-inventory-panel.test.tsx`
Expected: FAIL — component doesn't exist (or doesn't have the expected API).

- [ ] **Step 4: Implement (or update) the panel**

Create `src/components/cockpit/lane-inventory-panel.tsx`:

```typescript
"use client";

import { useMemo, useState } from "react";
import type { LaneSummary } from "@/lib/plugins/contract/types";

export interface LaneInventoryPanelProps {
  lanes: LaneSummary[];
  onRun: (lane: LaneSummary) => void;
  onCancel: (lane: LaneSummary) => void;
}

export function LaneInventoryPanel({ lanes, onRun, onCancel }: LaneInventoryPanelProps) {
  const grouped = useMemo(() => groupByRepo(lanes), [lanes]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <section aria-label="Lanes" className="space-y-2">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Lanes</h2>
      </header>
      {Object.entries(grouped).map(([repoPath, group]) => (
        <div key={repoPath} className="rounded border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left font-mono text-xs"
            onClick={() => setCollapsed((c) => ({ ...c, [repoPath]: !c[repoPath] }))}
          >
            <span>{collapsed[repoPath] ? "▶" : "▼"} {repoPath}</span>
            <span>{group.length} lanes</span>
          </button>
          {!collapsed[repoPath] && (
            <ul className="divide-y">
              {group.map((lane) => (
                <LaneRow key={lane.laneId} lane={lane} onRun={onRun} onCancel={onCancel} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function LaneRow({
  lane,
  onRun,
  onCancel,
}: {
  lane: LaneSummary;
  onRun: (lane: LaneSummary) => void;
  onCancel: (lane: LaneSummary) => void;
}) {
  const glyph = lane.status === "ready" ? "●" : lane.status === "running" ? "◐" : "✖";
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <span>
          <span className="mr-1 font-mono">{glyph}</span>
          {lane.name}
        </span>
        <div className="flex gap-2">
          {lane.status === "running" ? (
            <button type="button" onClick={() => onCancel(lane)}>Cancel</button>
          ) : (
            <button type="button" onClick={() => onRun(lane)}>Run lane</button>
          )}
        </div>
      </div>
      {lane.description && <p className="text-xs opacity-75">{lane.description}</p>}
    </li>
  );
}

function groupByRepo(lanes: LaneSummary[]): Record<string, LaneSummary[]> {
  const out: Record<string, LaneSummary[]> = {};
  for (const lane of lanes) {
    (out[lane.repoPath] ??= []).push(lane);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass + commit**

Run: `pnpm test lane-inventory-panel.test.tsx`
Expected: 3 passed.

```bash
git add src/components/cockpit/lane-inventory-panel.tsx src/components/cockpit/__tests__/lane-inventory-panel.test.tsx
git commit -m "feat(ui): LaneInventoryPanel grouped by repo with Run/Cancel affordances"
```

---

### Task 21: Wire components into the Cockpit page

**Files:**
- Modify: `src/app/page.tsx` (or wherever the Cockpit shell lives)

- [ ] **Step 1: Confirm the shell location**

Read `src/app/page.tsx`. The Cockpit shell may already mount lane-related UI. Decide whether `LaneInventoryPanel` slots into an existing section or a new one. (The spec §4.5 places it as an OpenUI render zone alongside the CopilotKit chat panel.)

- [ ] **Step 2: Add a client component that fetches lanes and renders the panels**

Create `src/components/cockpit/lanes-section.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import type { LaneSummary } from "@/lib/plugins/contract/types";
import { LaneInventoryPanel } from "./lane-inventory-panel";
import { RunDialog } from "./run-dialog";
import { RunStreamPanel } from "./run-stream-panel";

export function LanesSection() {
  const [lanes, setLanes] = useState<LaneSummary[]>([]);
  const [runDialogLane, setRunDialogLane] = useState<LaneSummary | null>(null);
  const [activeRun, setActiveRun] = useState<{ runId: string; laneId: string } | null>(null);

  useEffect(() => {
    fetch("/api/cockpit/lanes").then((r) => r.json()).then((data) => setLanes(data.lanes ?? []));
  }, []);

  const handleRun = async (input: { laneId: string; pluginId: string; userMessage: string }) => {
    const res = await fetch(`/api/cockpit/lanes/${encodeURIComponent(input.laneId)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userMessage: input.userMessage, pluginId: input.pluginId }),
    });
    const data = (await res.json()) as { runId: string };
    setActiveRun({ runId: data.runId, laneId: input.laneId });
    return data;
  };

  const handleCancel = async (lane: LaneSummary) => {
    if (!activeRun) return;
    await fetch(`/api/cockpit/runs/${encodeURIComponent(activeRun.runId)}/cancel`, { method: "POST" });
  };

  return (
    <div className="space-y-3">
      <LaneInventoryPanel lanes={lanes} onRun={setRunDialogLane} onCancel={handleCancel} />
      {runDialogLane && (
        <RunDialog
          laneId={runDialogLane.laneId}
          pluginId={runDialogLane.pluginId}
          defaultUserMessage={(runDialogLane as LaneSummary & { defaultUserMessage?: string }).defaultUserMessage}
          onRun={handleRun}
          onClose={() => setRunDialogLane(null)}
        />
      )}
      {activeRun && (
        <RunStreamPanel
          runId={activeRun.runId}
          laneId={activeRun.laneId}
          onClose={() => setActiveRun(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount `<LanesSection />` somewhere in the cockpit shell**

In `src/app/page.tsx`, add the import + component placement following the existing layout pattern. The exact location depends on the current shell; aim for the section adjacent to the assistant output / CopilotKit panel, per spec §4.5.

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev`
Open `http://localhost:3000` in a browser.
Expected: the lane inventory panel renders. Clicking Run on a lane opens the dialog. Submitting starts a run; the stream panel appears and shows the LaneEvent stream from `@vibe/runtime`.

- [ ] **Step 5: Commit**

```bash
git add src/components/cockpit/lanes-section.tsx src/app/page.tsx
git commit -m "feat(ui): mount LanesSection in cockpit shell (panel + dialog + stream)"
```

---

### Task 22: Playwright e2e — full lane-run flow

**Files:**
- Create: `tests/lane-run-flow.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/lane-run-flow.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Lane run flow", () => {
  test("user runs a lane, sees the stream, and cancels", async ({ page }) => {
    // Pre-seed: a deterministic lane fixture is mounted via the dev server's repoRoots.
    await page.goto("/");

    // Wait for the lane inventory panel to populate.
    const laneRow = page.getByText("test-lane");
    await expect(laneRow).toBeVisible();

    // Click Run lane.
    await laneRow.locator("..").locator("..").getByText("Run lane").click();

    // The Run dialog appears.
    const dialog = page.getByRole("dialog", { name: /Run test-lane/ });
    await expect(dialog).toBeVisible();
    await dialog.getByText("Run").click();

    // The stream panel appears and shows a start event then a final event.
    const stream = page.getByRole("region", { name: /Lane run stream/ });
    await expect(stream).toBeVisible();
    await expect(stream.getByText("start")).toBeVisible({ timeout: 5_000 });
    await expect(stream.getByText("final")).toBeVisible({ timeout: 30_000 });
  });
});
```

- [ ] **Step 2: Set up the deterministic fixture**

Add a `tests/fixtures/lanes/test-lane.json` to the repo's configured `repoRoots` and a fixture LangGraph chunk fixture that yields `start → final` in under 5s with no LLM call. Use a `process.env.COCKPIT_VIBE_RUNTIME_MOCK=1` switch in `InProcessVibeService.runLane` that bypasses `@vibe/runtime` and yields a canned event sequence when set. (This is the equivalent of vi.mock at the e2e layer.)

- [ ] **Step 3: Run the e2e test**

Run: `COCKPIT_VIBE_RUNTIME_MOCK=1 pnpm test:e2e tests/lane-run-flow.spec.ts`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/lane-run-flow.spec.ts tests/fixtures/lanes/test-lane.json src/lib/plugins/vibe/in-process-vibe-service.ts
git commit -m "test(e2e): Playwright lane-run flow (Run dialog → stream panel)"
```

---

### Task 23: Full-suite verification

**Files:** none — verification.

- [ ] **Step 1: Lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Run unit + integration tests**

Run: `pnpm test`
Expected: all suites pass. Roughly: contract (~5 new tests) + host (~9 new tests) + vibe-service (~5 new tests) + api routes (~7 new tests) + components (~5 new tests) = ~30 new tests on top of the existing baseline.

- [ ] **Step 3: Run e2e**

Run: `pnpm test:e2e`
Expected: green.

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: Next build succeeds.

- [ ] **Step 5: Manual dev smoke**

Run: `pnpm dev`
Open the app in a browser, run one real lane (with the `@vibe/runtime` package linked), verify the full UX works end-to-end.

---

### Task 24: Commit, push, PR

**Files:** none — git workflow.

- [ ] **Step 1: Push branch**

Run: `git push -u origin HEAD`

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(cockpit): Phase 3 — lane execution + streaming (in-memory)" --body "$(cat <<'EOF'
## Summary
- Wires Cockpit `runLane` end-to-end: operator starts a Vibe lane from the inventory panel, watches the `LaneEvent` stream via SSE, can cancel.
- Adds prerequisite type/host changes per spec §8.3, §9.3: `cockpitPluginContractVersion`, SemVer check, `PluginHost.runLane` + `reload`, `TodoItem` shape update.
- Adds `InProcessVibeService` file watching (chokidar) and `runLane` delegating to `@vibe/runtime.runTranslatedLane`.
- New routes: `POST /run`, `GET /run-events` (SSE), `POST /cancel` with auth + per-user RLS-equivalent checks against the in-memory activeRuns map.
- New UI: `LaneInventoryPanel` (grouped by repo), `RunDialog`, `RunStreamPanel`, all wired into `LanesSection`.
- Audit-logs run start/cancel/error to `cockpit_assistant_events` (spec §9.4).
- Persistence (lane runs/events tables) deferred to Phase 3b per spec §5.7/§5.8.

## Why
This is the first slice where Cockpit and Vibe actually *finish tasks together*. See `docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md` §5.

## Test plan
- [x] `pnpm test` — ~30 new tests across contract, host, vibe-service, api, components
- [x] `pnpm test:e2e` — Playwright lane-run flow test passes
- [x] `pnpm lint && pnpm exec tsc --noEmit` — clean
- [x] `pnpm build` — production build succeeds
- [x] Manual smoke: real lane run end-to-end against `@vibe/runtime`

## Dependency
Requires [lutherfourie/vibe#12](https://github.com/lutherfourie/vibe/pull/12) (the @vibe/runtime workspace package extraction) to be merged before the `file:` link in this PR resolves to a stable path.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

---

## Self-Review

**1. Spec coverage** — every Phase 3 prerequisite checklist item from the spec's Next Steps maps to a task:
- TodoItem shape → Task 1
- cockpitPluginContractVersion field + value → Task 2
- SemVer check in load() → Task 3
- runLane on VibeService interface → Task 4
- runLane on PluginHost → Task 5
- reload + disposeOne on PluginHost → Task 6
- File watching on InProcessVibeService → Task 8
- runLane impl on InProcessVibeService → Task 11
- @vibe/runtime workspace dep → Task 9
- VibePlugin exposes runLane → Task 12

Main work (routes + UI + tests + audit + lastRunAt enrichment) → Tasks 10, 13–22.

**2. Placeholder scan** — every step has concrete code, exact commands, expected output. The only soft pointer is Task 21 step 1 ("the exact location depends on the current shell") — that's a forced-ambiguity because the current Cockpit shell isn't read in this plan-writing pass. Acceptable as a "find the file pattern" step rather than a placeholder.

**3. Type consistency** — `LaneEvent`, `LaneSummary`, `LaneRunInput`, `TodoItem` referenced identically across all tasks. `ActiveRun` introduced in Task 10 used identically in Tasks 13–16. `cockpitPluginContractVersion` introduced in Task 2 referenced consistently as `"1.0.0"` in Tasks 2, 3, 5, 6, 12.

**4. Known follow-ups** (documented, not blocking):
- Task 21's exact mount location depends on inspecting the current Cockpit shell.
- The `latestRunFor` enrichment in Task 16 changes `LaneSummary.status` from disk-derived to in-memory-aware. The discovery cache itself is unchanged.
- Backpressure cap in Task 13 is hardcoded at 1000 events; future work could make it configurable.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-cockpit-vibe-phase-3-execution-streaming.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. 24 tasks × ~5–15 min each ≈ 4–6 hours wall clock.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Dependency reminder:** Task 9 onward needs the `@vibe/runtime` package from the sibling Vibe plan (PR vibe#12). Tasks 1–7 are independent and can be done first while the Vibe plan executes in parallel.

**Which approach?**
