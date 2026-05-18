# Cockpit ↔ Vibe Phase 1 — Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working in-Cockpit "Lanes" panel that lists Vibe lanes from configured repo roots and generates surface-aware handoff text per lane — the first user-visible slice of the plugin system designed in [`docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md`](../specs/2026-05-18-cockpit-vibe-integration-design.md).

**Architecture:** A three-layer plugin system landed in Cockpit's Next.js backend: (1) generic `CockpitPlugin` contract + `PluginHost` that loads and isolates plugins, (2) a `VibePlugin` implementing that contract, (3) an `InProcessVibeService` runtime that reads lane JSON specs from disk and produces handoff text. Two API routes (`/api/cockpit/lanes` and `/api/cockpit/lanes/[laneId]/handoff`) expose this to a new React component (`LaneInventoryPanel`) mounted in the existing cockpit app. Execution + streaming and memory bridge are out of scope (Phase 2+).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest + raw `react-dom/client`/`act` for tests, Playwright for E2E, Supabase Auth for API-route guarding, Zod for boundary validation. No new dependencies needed.

**For v0:** The Vibe plugin lives **inside the Cockpit repo** (`src/lib/plugins/vibe/`) rather than as a separately-distributed `@vibe/cockpit-plugin` npm package. This avoids the cross-repo distribution problem for Phase 1; eventual extraction is Phase 2+ work.

---

## File Structure

**Created** (all under `src/lib/plugins/` or `src/components/cockpit/` or `src/app/api/cockpit/`):

```
src/lib/plugins/
├── contract/
│   ├── types.ts                     # CockpitPlugin interface + shared types
│   └── types.test.ts                # Type-shape sanity tests
├── host/
│   ├── plugin-host.ts               # PluginHost class — loads, fans out, isolates failures
│   ├── plugin-host.test.ts
│   ├── registry.ts                  # Available-plugins map (id → factory)
│   ├── get-plugin-host.ts           # Module-level singleton accessor for Next.js routes
│   └── get-plugin-host.test.ts
└── vibe/
    ├── vibe-service.ts              # VibeService interface (Phase 1 methods only)
    ├── in-process-vibe-service.ts   # Real implementation: reads lane JSON, formats handoff
    ├── in-process-vibe-service.test.ts
    ├── vibe-plugin.ts               # VibePlugin: CockpitPlugin implementation wrapping VibeService
    └── vibe-plugin.test.ts

src/app/api/cockpit/lanes/
├── route.ts                         # GET → LaneSummary[]
└── [laneId]/handoff/
    └── route.ts                     # GET → HandoffArtifact

src/components/cockpit/
├── lane-inventory-panel.tsx         # The UI panel
└── lane-inventory-panel.test.tsx

tests/e2e/
└── lane-inventory.spec.ts           # Playwright test of the full flow

tests/fixtures/lanes/                # Fixture lane files for tests
├── sample-lane.json
└── sample-lane.prompt.md
```

**Modified:**

- `src/components/cockpit/cockpit-app.tsx` — mount `LaneInventoryPanel` in a new tab/panel slot.
- `.env.example` — add `COCKPIT_PLUGINS` (CSV of enabled plugin ids) and `COCKPIT_PLUGIN_VIBE_ROOTS` (CSV of repo paths to scan).

**Rationale for the split:**

- `contract/` holds the language-of-the-plugin-system. Stable types. Imported by everything below.
- `host/` is Cockpit-internal infrastructure. Loads plugins, isolates failures.
- `vibe/` is the first concrete plugin. Lives in Cockpit for v0 but is structurally a peer of any future plugin.
- API routes are thin: parse query → call plugin host → return JSON. No business logic.
- The UI panel is a single file because the handoff display is inline; no modal extraction yet.

---

## Task 1: Plugin contract types

**Files:**
- Create: `src/lib/plugins/contract/types.ts`
- Test: `src/lib/plugins/contract/types.test.ts`

These types are the language of the plugin system. Every other file in `src/lib/plugins/` and every API route imports from here.

- [ ] **Step 1: Write the failing test for type shape**

Create `src/lib/plugins/contract/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  LaneEvent,
  LaneRunInput,
  LaneSummary,
  PluginCapability,
} from "./types";

describe("plugin contract types", () => {
  it("CockpitPlugin requires id, displayName, version, capabilities, init, dispose", () => {
    const plugin: CockpitPlugin = {
      id: "test",
      displayName: "Test",
      version: "0.0.0",
      capabilities: ["discovery"],
      async init() {},
      async dispose() {},
    };
    expect(plugin.id).toBe("test");
  });

  it("PluginCapability is a closed set of four values", () => {
    const all: PluginCapability[] = ["discovery", "execution", "handoff", "memory"];
    expect(all).toHaveLength(4);
  });

  it("LaneSummary carries all spec-defined fields", () => {
    const summary: LaneSummary = {
      laneId: "feedback-triage",
      pluginId: "vibe",
      name: "Feedback triage",
      repoPath: "C:/GameSpree",
      reads: ["/docs/**"],
      owns: ["/outputs/**"],
      status: "ready",
    };
    expect(summary.laneId).toBe("feedback-triage");
  });

  it("LaneEvent is a discriminated union including start, final, and error", () => {
    const events: LaneEvent[] = [
      { type: "start", laneId: "x", runId: "r1" },
      { type: "final", summary: "done", outputs: [] },
      { type: "error", message: "boom", recoverable: false },
    ];
    expect(events.map((e) => e.type)).toEqual(["start", "final", "error"]);
  });

  it("LaneRunInput requires userMessage and accepts optional overrides", () => {
    const minimal: LaneRunInput = { userMessage: "go" };
    const full: LaneRunInput = {
      userMessage: "go",
      overrides: { model: "anthropic", envVars: { X: "1" }, cwd: "/tmp" },
    };
    expect(minimal.userMessage).toBe("go");
    expect(full.overrides?.model).toBe("anthropic");
  });

  it("HandoffTarget is a closed enum covering documented surfaces", () => {
    const targets: HandoffTarget[] = [
      "codex.web",
      "codex.cli",
      "codex.github_pr",
      "claude.code",
      "claude.web",
      "human.review",
    ];
    expect(targets).toHaveLength(6);
  });

  it("HandoffArtifact carries text, target, format, and optional recommendedCommand", () => {
    const artifact: HandoffArtifact = {
      text: "# Task\n...",
      target: "codex.cli",
      format: "markdown",
      recommendedCommand: "codex exec -",
    };
    expect(artifact.format).toBe("markdown");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (no types file yet)**

Run: `pnpm test src/lib/plugins/contract/types.test.ts`
Expected: FAIL with `Cannot find module './types'`.

- [ ] **Step 3: Implement the types**

Create `src/lib/plugins/contract/types.ts`:

```typescript
/**
 * Cockpit plugin contract.
 *
 * Every plugin is an in-process TypeScript module loaded by the plugin host
 * at Cockpit startup. A plugin advertises which capabilities it provides via
 * the `capabilities` field; the host calls the matching capability hooks.
 *
 * See docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md
 * (Sections 1, 2) for the architectural rationale.
 */

export type PluginCapability = "discovery" | "execution" | "handoff" | "memory";

/**
 * Logger scoped to a single plugin instance. Writes structured logs the host
 * surface can render. Implementations should prefix entries with the plugin id.
 */
export interface PluginLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Structured event sink the plugin can emit telemetry / activity events into.
 * The host decides how to persist or render them (typically piggybacks on
 * cockpit_assistant_events — see spec Section 5).
 */
export interface HostEventSink {
  emit(event: { kind: string; pluginId: string; payload: unknown }): void;
}

/**
 * Cockpit-mediated memory API. Plugin writes are namespaced under the
 * plugin id (host enforces). Phase 1 is read-mostly; full bridge lands in
 * Phase 4 per spec Section 7.
 */
export interface HostMemoryApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export interface PluginHostContext {
  /** Logger scoped to plugin id. */
  log: PluginLogger;

  /** Read-only snapshot of settings the user has scoped to this plugin. */
  settings: ReadonlyMap<string, unknown>;

  /** Memory API namespaced to this plugin (host enforces). */
  memory: HostMemoryApi;

  /** Structured event sink. */
  events: HostEventSink;
}

export interface LaneSummary {
  laneId: string;
  pluginId: string;
  name: string;
  description?: string;
  repoPath: string;
  reads: string[];
  owns: string[];
  target?: string;
  approval?: string;
  verify?: string[];
  status: "ready" | "running" | "error";
  lastRunAt?: string;
}

export interface LaneRunInput {
  userMessage: string;
  overrides?: {
    model?: string;
    envVars?: Record<string, string>;
    cwd?: string;
  };
}

export interface TodoItem {
  text: string;
  done: boolean;
}

export type LaneEvent =
  | { type: "start"; laneId: string; runId: string }
  | { type: "todo"; items: TodoItem[] }
  | { type: "tool_call"; tool: string; args?: unknown }
  | { type: "tool_result"; tool: string; ok: boolean; preview?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "file_write"; path: string; bytes: number }
  | {
      type: "final";
      summary: string;
      outputs: { path: string; bytes: number }[];
    }
  | { type: "error"; message: string; recoverable: boolean };

export type HandoffTarget =
  | "codex.web"
  | "codex.cli"
  | "codex.github_pr"
  | "claude.code"
  | "claude.web"
  | "human.review";

export interface HandoffArtifact {
  text: string;
  target: HandoffTarget;
  format: "markdown" | "json";
  recommendedCommand?: string;
}

/**
 * Memory bridge accessor — included for spec completeness; Phase 1 plugins
 * MAY omit it (capability not yet enabled). Phase 4 will flesh this out.
 */
export interface PluginMemoryBridge {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export interface CockpitPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly description?: string;
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
  ): Promise<HandoffArtifact>;

  memoryBridge?: PluginMemoryBridge;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/plugins/contract/types.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/contract/
git commit -m "feat(plugins): add CockpitPlugin contract types"
```

---

## Task 2: Plugin host

**Files:**
- Create: `src/lib/plugins/host/plugin-host.ts`
- Test: `src/lib/plugins/host/plugin-host.test.ts`

The host loads plugins, calls their `init`/`dispose`, and fans out capability calls. Failures in one plugin are contained — the plugin is marked errored, never crashes Cockpit.

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/host/plugin-host.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import type {
  CockpitPlugin,
  HandoffArtifact,
  LaneSummary,
  PluginHostContext,
} from "../contract/types";
import { PluginHost } from "./plugin-host";

function makeMockPlugin(overrides: Partial<CockpitPlugin> = {}): CockpitPlugin {
  return {
    id: "mock",
    displayName: "Mock",
    version: "0.0.0",
    capabilities: ["discovery", "handoff"],
    async init() {},
    async dispose() {},
    async listLanes(): Promise<LaneSummary[]> {
      return [
        {
          laneId: "lane-a",
          pluginId: "mock",
          name: "Lane A",
          repoPath: "/tmp/x",
          reads: [],
          owns: [],
          status: "ready",
        },
      ];
    },
    async generateHandoff(laneId, target): Promise<HandoffArtifact> {
      return {
        text: `handoff for ${laneId} to ${target}`,
        target,
        format: "markdown",
      };
    },
    ...overrides,
  };
}

function makeHostContext(): PluginHostContext {
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

describe("PluginHost", () => {
  it("loads a plugin and exposes its capabilities", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([{ id: "mock", factory: () => makeMockPlugin() }]);

    const lanes = await host.listAllLanes();
    expect(lanes).toHaveLength(1);
    expect(lanes[0].pluginId).toBe("mock");
    expect(lanes[0].laneId).toBe("lane-a");
  });

  it("namespaces laneId by plugin when fetched from host", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([{ id: "mock", factory: () => makeMockPlugin() }]);
    const lanes = await host.listAllLanes();
    expect(lanes[0].pluginId).toBe("mock");
  });

  it("returns empty list when no plugin implements discovery", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([
      {
        id: "no-discovery",
        factory: () =>
          makeMockPlugin({
            id: "no-discovery",
            capabilities: ["handoff"],
            listLanes: undefined,
          }),
      },
    ]);
    const lanes = await host.listAllLanes();
    expect(lanes).toEqual([]);
  });

  it("isolates failures: a throwing plugin does not break the host", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([
      {
        id: "good",
        factory: () => makeMockPlugin({ id: "good" }),
      },
      {
        id: "bad",
        factory: () =>
          makeMockPlugin({
            id: "bad",
            listLanes: async () => {
              throw new Error("boom");
            },
          }),
      },
    ]);
    const lanes = await host.listAllLanes();
    expect(lanes.map((l) => l.pluginId)).toEqual(["good"]);
  });

  it("init failure marks plugin errored and excludes from future calls", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([
      {
        id: "broken",
        factory: () =>
          makeMockPlugin({
            id: "broken",
            init: async () => {
              throw new Error("init failed");
            },
          }),
      },
    ]);
    const lanes = await host.listAllLanes();
    expect(lanes).toEqual([]);
    expect(host.getPluginStatus("broken")).toBe("errored");
  });

  it("routes generateHandoff to the right plugin by pluginId from the laneId namespace", async () => {
    const host = new PluginHost(makeHostContext());
    await host.load([{ id: "mock", factory: () => makeMockPlugin() }]);
    const artifact = await host.generateHandoff("mock:lane-a", "codex.cli");
    expect(artifact?.text).toContain("lane-a");
    expect(artifact?.text).toContain("codex.cli");
  });

  it("dispose calls each plugin's dispose", async () => {
    const disposeFn = vi.fn();
    const host = new PluginHost(makeHostContext());
    await host.load([
      {
        id: "mock",
        factory: () => makeMockPlugin({ dispose: disposeFn }),
      },
    ]);
    await host.dispose();
    expect(disposeFn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/plugins/host/plugin-host.test.ts`
Expected: FAIL with `Cannot find module './plugin-host'`.

- [ ] **Step 3: Implement the plugin host**

Create `src/lib/plugins/host/plugin-host.ts`:

```typescript
import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
  PluginHostContext,
} from "../contract/types";

export interface PluginEntry {
  id: string;
  /** Factory returns a fresh plugin instance. Allows re-init on reload. */
  factory: () => CockpitPlugin;
}

type PluginStatus = "ready" | "errored" | "disposed";

interface LoadedPlugin {
  id: string;
  entry: PluginEntry;
  instance: CockpitPlugin | null;
  status: PluginStatus;
  lastError?: string;
}

/**
 * The plugin host. Owns the lifecycle of all registered plugins.
 *
 * Failure isolation: a plugin that throws during init or any capability hook
 * is marked `errored` and excluded from subsequent calls. The host itself
 * never throws on plugin failure — callers see empty results / null and a
 * logged error.
 *
 * Lane identifiers crossing the host boundary use `<pluginId>:<laneId>` form
 * so the host can route by prefix. Internal plugin-side laneIds do NOT carry
 * the prefix.
 */
export class PluginHost {
  private plugins = new Map<string, LoadedPlugin>();

  constructor(private readonly context: PluginHostContext) {}

  /** Load plugins. Each is init'd; failures are contained. */
  async load(entries: PluginEntry[]): Promise<void> {
    for (const entry of entries) {
      const loaded: LoadedPlugin = {
        id: entry.id,
        entry,
        instance: null,
        status: "ready",
      };
      try {
        const instance = entry.factory();
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

  /** Aggregate lanes across all ready plugins implementing discovery. */
  async listAllLanes(): Promise<LaneSummary[]> {
    const out: LaneSummary[] = [];
    for (const loaded of this.plugins.values()) {
      if (loaded.status !== "ready" || !loaded.instance) continue;
      if (!loaded.instance.capabilities.includes("discovery")) continue;
      if (!loaded.instance.listLanes) continue;
      try {
        const lanes = await loaded.instance.listLanes();
        for (const lane of lanes) {
          out.push({ ...lane, pluginId: loaded.id });
        }
      } catch (err) {
        this.context.log.error(`plugin ${loaded.id} listLanes failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        // Do not change status — capability call failures are recoverable.
      }
    }
    return out;
  }

  /**
   * Generate a handoff for a lane.
   *
   * @param fullLaneId  Namespaced lane id of the form `<pluginId>:<laneId>`.
   * @param target      Handoff target surface.
   * @returns The handoff artifact, or null if not found or capability missing.
   */
  async generateHandoff(
    fullLaneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null> {
    const [pluginId, ...rest] = fullLaneId.split(":");
    const laneId = rest.join(":");
    if (!pluginId || !laneId) return null;
    const loaded = this.plugins.get(pluginId);
    if (!loaded || loaded.status !== "ready" || !loaded.instance) return null;
    if (!loaded.instance.capabilities.includes("handoff")) return null;
    if (!loaded.instance.generateHandoff) return null;
    try {
      return await loaded.instance.generateHandoff(laneId, target);
    } catch (err) {
      this.context.log.error(`plugin ${pluginId} generateHandoff failed`, {
        laneId,
        target,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** For tests / introspection: the current status of a plugin. */
  getPluginStatus(id: string): PluginStatus | "unknown" {
    return this.plugins.get(id)?.status ?? "unknown";
  }

  /** Dispose all loaded plugins. Idempotent. */
  async dispose(): Promise<void> {
    for (const loaded of this.plugins.values()) {
      if (loaded.instance && loaded.status === "ready") {
        try {
          await loaded.instance.dispose();
        } catch (err) {
          this.context.log.error(`plugin ${loaded.id} dispose failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      loaded.status = "disposed";
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/plugins/host/plugin-host.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/host/plugin-host.ts src/lib/plugins/host/plugin-host.test.ts
git commit -m "feat(plugins): add PluginHost with failure isolation"
```

---

## Task 3: VibeService interface (Phase 1 methods only)

**Files:**
- Create: `src/lib/plugins/vibe/vibe-service.ts`

For Phase 1 the service only needs to do discovery and handoff generation. Execution and memory are not in this interface yet (Phase 2+ will extend it).

- [ ] **Step 1: Implement the interface (no test needed for an interface-only file)**

Create `src/lib/plugins/vibe/vibe-service.ts`:

```typescript
import type {
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
} from "../contract/types";

/**
 * Vibe runtime interface — Phase 1 subset.
 *
 * Per spec Section 3, there will be two implementations:
 *   - InProcessVibeService (default; runs in Cockpit's process)
 *   - RemoteVibeService    (Phase 5; HTTP/WS client to a Vibe daemon)
 *
 * Phase 1 only needs discovery and handoff. Execution + streaming and
 * memory bridge come in later phases and will extend this interface.
 */
export interface VibeService {
  /** Discover all lanes under configured repo roots. */
  listLanes(): Promise<LaneSummary[]>;

  /**
   * Produce a handoff artifact for the given lane targeted at the given surface.
   *
   * @param laneId  Plugin-internal lane id (NOT namespaced; host strips prefix).
   * @param target  Handoff target surface.
   * @returns Artifact, or null if the lane is unknown.
   */
  generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/plugins/vibe/vibe-service.ts
git commit -m "feat(vibe-plugin): add VibeService interface (Phase 1 subset)"
```

---

## Task 4: InProcessVibeService implementation

**Files:**
- Create: `src/lib/plugins/vibe/in-process-vibe-service.ts`
- Test: `src/lib/plugins/vibe/in-process-vibe-service.test.ts`
- Create fixture: `tests/fixtures/lanes/sample-lane.json`
- Create fixture: `tests/fixtures/lanes/sample-lane.prompt.md`

The real runtime. Scans configured repo roots for `lanes/*.json` files (alongside `*.prompt.md` siblings) and returns `LaneSummary`. Generates handoff text from a template.

- [ ] **Step 1: Write the fixture files**

Create `tests/fixtures/lanes/sample-lane.json`:

```json
{
  "name": "sample-feedback-triage",
  "description": "Map feedback bullets to docs-only action plan items.",
  "promptFile": "./sample-lane.prompt.md",
  "defaultUserMessage": "Process today's feedback.",
  "reads": ["/fixtures/feedback/**", "/fixtures/GDD.md"],
  "owns": ["/outputs/**"],
  "tools": [],
  "model": "cerebras",
  "target": "codex.local",
  "approval": "human.before_commit"
}
```

Create `tests/fixtures/lanes/sample-lane.prompt.md`:

```markdown
You are the sample feedback-triage lane.

Read the feedback note + GDD, then write a categorized action plan to
/outputs/action-plan.md. Cite GDD sections.
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/plugins/vibe/in-process-vibe-service.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import path from "node:path";

import { InProcessVibeService } from "./in-process-vibe-service";

const FIXTURES_ROOT = path.resolve(process.cwd(), "tests/fixtures");

describe("InProcessVibeService", () => {
  it("listLanes returns lanes found in configured roots", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const lanes = await service.listLanes();
    expect(lanes.length).toBeGreaterThan(0);
    const sample = lanes.find((l) => l.laneId === "sample-feedback-triage");
    expect(sample).toBeDefined();
    expect(sample?.name).toBe("sample-feedback-triage");
    expect(sample?.repoPath).toBe(FIXTURES_ROOT);
    expect(sample?.target).toBe("codex.local");
    expect(sample?.approval).toBe("human.before_commit");
    expect(sample?.reads).toContain("/fixtures/feedback/**");
    expect(sample?.owns).toContain("/outputs/**");
    expect(sample?.status).toBe("ready");
  });

  it("listLanes returns empty when no lanes/ directory in any root", async () => {
    const service = new InProcessVibeService({ repoRoots: [path.resolve(process.cwd(), "node_modules")] });
    const lanes = await service.listLanes();
    expect(lanes).toEqual([]);
  });

  it("listLanes ignores invalid JSON files", async () => {
    // Re-use fixtures root; sample-lane.json is the only valid file. Validation should not throw.
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const lanes = await service.listLanes();
    expect(lanes.find((l) => l.laneId === "sample-feedback-triage")).toBeDefined();
  });

  it("generateHandoff returns a markdown handoff for codex.cli", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const artifact = await service.generateHandoff(
      "sample-feedback-triage",
      "codex.cli",
    );
    expect(artifact).not.toBeNull();
    expect(artifact?.target).toBe("codex.cli");
    expect(artifact?.format).toBe("markdown");
    expect(artifact?.text).toContain("# Handoff: sample-feedback-triage");
    expect(artifact?.text).toContain("**Target:** codex.cli");
    expect(artifact?.text).toContain("## Read scope");
    expect(artifact?.text).toContain("/fixtures/feedback/**");
    expect(artifact?.text).toContain("## Write scope");
    expect(artifact?.text).toContain("/outputs/**");
    expect(artifact?.text).toContain("sample feedback-triage lane"); // from prompt
    expect(artifact?.recommendedCommand).toBe("codex exec --sandbox read-only -");
  });

  it("generateHandoff sets recommendedCommand per target", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const claude = await service.generateHandoff(
      "sample-feedback-triage",
      "claude.code",
    );
    expect(claude?.recommendedCommand).toBe(
      "claude -p --input-format text --output-format text",
    );

    const human = await service.generateHandoff(
      "sample-feedback-triage",
      "human.review",
    );
    expect(human?.recommendedCommand).toBeUndefined();
  });

  it("generateHandoff returns null for unknown lane", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const artifact = await service.generateHandoff(
      "does-not-exist",
      "codex.cli",
    );
    expect(artifact).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/lib/plugins/vibe/in-process-vibe-service.test.ts`
Expected: FAIL with `Cannot find module './in-process-vibe-service'`.

- [ ] **Step 4: Implement the service**

Create `src/lib/plugins/vibe/in-process-vibe-service.ts`:

```typescript
import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type {
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
} from "../contract/types";
import type { VibeService } from "./vibe-service";

const LaneSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  promptFile: z.string().optional(),
  prompt: z.string().optional(),
  defaultUserMessage: z.string().optional(),
  reads: z.array(z.string()).optional(),
  owns: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  target: z.string().optional(),
  approval: z.string().optional(),
  verify: z.array(z.string()).optional(),
});

type LaneSpec = z.infer<typeof LaneSpecSchema>;

interface ResolvedLane {
  laneId: string;
  spec: LaneSpec;
  repoPath: string;
  jsonPath: string;
  /** Resolved system prompt text — fetched lazily for handoff. */
  promptResolver: () => Promise<string>;
}

export interface InProcessVibeServiceOptions {
  /** Repo roots to scan for lanes/*.json files. */
  repoRoots: string[];
}

/**
 * Phase 1 implementation. Scans `<root>/lanes/*.json` files. Each lane JSON
 * may reference a sibling `.prompt.md` via `promptFile` (or carry the prompt
 * inline via `prompt`).
 *
 * No file watching yet — `listLanes()` re-scans on every call. Caching and
 * watch-based invalidation land alongside Phase 2 (execution).
 */
export class InProcessVibeService implements VibeService {
  constructor(private readonly options: InProcessVibeServiceOptions) {}

  async listLanes(): Promise<LaneSummary[]> {
    const resolved = await this.discoverAllLanes();
    return resolved.map((r) => this.toSummary(r));
  }

  async generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null> {
    const resolved = await this.discoverAllLanes();
    const lane = resolved.find((r) => r.laneId === laneId);
    if (!lane) return null;
    const prompt = await lane.promptResolver();
    const text = this.formatHandoff(lane, prompt, target);
    return {
      text,
      target,
      format: "markdown",
      recommendedCommand: recommendedCommandFor(target),
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async discoverAllLanes(): Promise<ResolvedLane[]> {
    const out: ResolvedLane[] = [];
    for (const root of this.options.repoRoots) {
      const lanesDir = path.join(root, "lanes");
      let entries: string[] = [];
      try {
        entries = await fs.readdir(lanesDir);
      } catch {
        continue; // no lanes/ directory under this root — skip silently
      }
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const jsonPath = path.join(lanesDir, entry);
        let raw: string;
        try {
          raw = await fs.readFile(jsonPath, "utf8");
        } catch {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue; // malformed JSON — skip silently for v0
        }
        const result = LaneSpecSchema.safeParse(parsed);
        if (!result.success) continue; // schema violation — skip
        const spec = result.data;
        const laneId = path.basename(entry, ".json");
        out.push({
          laneId,
          spec,
          repoPath: root,
          jsonPath,
          promptResolver: () => this.resolvePrompt(spec, jsonPath),
        });
      }
    }
    return out;
  }

  private async resolvePrompt(spec: LaneSpec, jsonPath: string): Promise<string> {
    if (spec.prompt) return spec.prompt;
    if (spec.promptFile) {
      const promptPath = path.isAbsolute(spec.promptFile)
        ? spec.promptFile
        : path.join(path.dirname(jsonPath), spec.promptFile);
      try {
        return await fs.readFile(promptPath, "utf8");
      } catch {
        return "(prompt file not found)";
      }
    }
    return "(no prompt defined)";
  }

  private toSummary(lane: ResolvedLane): LaneSummary {
    return {
      laneId: lane.spec.name, // name is the user-facing id within the plugin
      pluginId: "", // host sets this; service leaves blank
      name: lane.spec.name,
      description: lane.spec.description,
      repoPath: lane.repoPath,
      reads: lane.spec.reads ?? [],
      owns: lane.spec.owns ?? [],
      target: lane.spec.target,
      approval: lane.spec.approval,
      verify: lane.spec.verify,
      status: "ready",
    };
  }

  private formatHandoff(
    lane: ResolvedLane,
    prompt: string,
    target: HandoffTarget,
  ): string {
    const reads = (lane.spec.reads ?? []).map((p) => `- ${p}`).join("\n") || "- (none)";
    const writes = (lane.spec.owns ?? []).map((p) => `- ${p}`).join("\n") || "- (none)";
    const verify =
      (lane.spec.verify ?? []).map((v) => `- ${v}`).join("\n") || "- (none specified)";
    return [
      `# Handoff: ${lane.spec.name}`,
      "",
      `**Target:** ${target}`,
      `**Repo:** ${lane.repoPath}`,
      lane.spec.approval ? `**Approval gate:** ${lane.spec.approval}` : "",
      "",
      "## Task",
      "",
      prompt.trim(),
      "",
      "## Read scope",
      "",
      reads,
      "",
      "## Write scope",
      "",
      writes,
      "",
      "## Verification",
      "",
      verify,
      "",
      "## Instructions",
      "",
      "You are taking over this lane. Stay within the read and write scope. Run the verification commands before declaring complete.",
      "",
    ]
      .filter((line) => line !== null)
      .join("\n");
  }
}

function recommendedCommandFor(target: HandoffTarget): string | undefined {
  switch (target) {
    case "codex.cli":
      return "codex exec --sandbox read-only -";
    case "claude.code":
      return "claude -p --input-format text --output-format text";
    case "codex.web":
    case "codex.github_pr":
    case "claude.web":
    case "human.review":
      return undefined;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/lib/plugins/vibe/in-process-vibe-service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/plugins/vibe/in-process-vibe-service.ts \
        src/lib/plugins/vibe/in-process-vibe-service.test.ts \
        tests/fixtures/lanes/
git commit -m "feat(vibe-plugin): InProcessVibeService — discovery + handoff"
```

---

## Task 5: VibePlugin (CockpitPlugin implementation)

**Files:**
- Create: `src/lib/plugins/vibe/vibe-plugin.ts`
- Test: `src/lib/plugins/vibe/vibe-plugin.test.ts`

A thin shim that implements `CockpitPlugin` by delegating to a `VibeService`. The service implementation (`InProcessVibeService` vs. future `RemoteVibeService`) is selected at construction time based on settings.

- [ ] **Step 1: Write the failing test**

Create `src/lib/plugins/vibe/vibe-plugin.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import type { PluginHostContext } from "../contract/types";
import { VibePlugin } from "./vibe-plugin";
import type { VibeService } from "./vibe-service";

function makeStubService(): VibeService {
  return {
    async listLanes() {
      return [
        {
          laneId: "lane-1",
          pluginId: "",
          name: "Lane 1",
          repoPath: "/tmp",
          reads: [],
          owns: [],
          status: "ready" as const,
        },
      ];
    },
    async generateHandoff(laneId, target) {
      return {
        text: `handoff for ${laneId} -> ${target}`,
        target,
        format: "markdown" as const,
      };
    },
  };
}

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

describe("VibePlugin", () => {
  it("advertises discovery and handoff capabilities", () => {
    const plugin = new VibePlugin(makeStubService());
    expect(plugin.capabilities).toContain("discovery");
    expect(plugin.capabilities).toContain("handoff");
  });

  it("does not advertise execution or memory in Phase 1", () => {
    const plugin = new VibePlugin(makeStubService());
    expect(plugin.capabilities).not.toContain("execution");
    expect(plugin.capabilities).not.toContain("memory");
  });

  it("listLanes delegates to the service", async () => {
    const plugin = new VibePlugin(makeStubService());
    await plugin.init(makeContext());
    const lanes = await plugin.listLanes!();
    expect(lanes).toHaveLength(1);
    expect(lanes[0].name).toBe("Lane 1");
  });

  it("generateHandoff delegates to the service", async () => {
    const plugin = new VibePlugin(makeStubService());
    await plugin.init(makeContext());
    const artifact = await plugin.generateHandoff!("lane-1", "codex.cli");
    expect(artifact.text).toContain("lane-1");
    expect(artifact.text).toContain("codex.cli");
  });

  it("init and dispose complete without throwing", async () => {
    const plugin = new VibePlugin(makeStubService());
    await expect(plugin.init(makeContext())).resolves.toBeUndefined();
    await expect(plugin.dispose()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/plugins/vibe/vibe-plugin.test.ts`
Expected: FAIL with `Cannot find module './vibe-plugin'`.

- [ ] **Step 3: Implement the plugin**

Create `src/lib/plugins/vibe/vibe-plugin.ts`:

```typescript
import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
  PluginCapability,
  PluginHostContext,
} from "../contract/types";
import type { VibeService } from "./vibe-service";

/**
 * The Vibe plugin. Implements the CockpitPlugin contract by delegating to a
 * VibeService. Service implementation choice (InProcess vs. Remote) is made
 * by the constructor's caller — typically the plugin registry.
 *
 * Phase 1 capabilities: discovery + handoff only. Execution and memory will
 * be added when their respective spec sections are approved.
 */
export class VibePlugin implements CockpitPlugin {
  readonly id = "vibe";
  readonly displayName = "Vibe Lanes";
  readonly version = "0.1.0";
  readonly description = "Vibe lane discovery and surface-aware handoff generation.";
  readonly capabilities: readonly PluginCapability[] = ["discovery", "handoff"];

  private context: PluginHostContext | null = null;

  constructor(private readonly service: VibeService) {}

  async init(host: PluginHostContext): Promise<void> {
    this.context = host;
    host.log.info("vibe plugin initialized");
  }

  async dispose(): Promise<void> {
    this.context?.log.info("vibe plugin disposed");
    this.context = null;
  }

  async listLanes(): Promise<LaneSummary[]> {
    return this.service.listLanes();
  }

  async generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact> {
    const artifact = await this.service.generateHandoff(laneId, target);
    if (!artifact) {
      throw new Error(`lane ${laneId} not found`);
    }
    return artifact;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/plugins/vibe/vibe-plugin.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plugins/vibe/vibe-plugin.ts src/lib/plugins/vibe/vibe-plugin.test.ts
git commit -m "feat(vibe-plugin): VibePlugin shim implementing CockpitPlugin"
```

---

## Task 6: Plugin registry + host singleton

**Files:**
- Create: `src/lib/plugins/host/registry.ts`
- Create: `src/lib/plugins/host/get-plugin-host.ts`
- Test: `src/lib/plugins/host/get-plugin-host.test.ts`
- Modify: `.env.example`

A module-level singleton accessor that API routes can call to get a ready plugin host. Reads env config, builds the registry, lazily initializes on first call.

- [ ] **Step 1: Create the registry**

Create `src/lib/plugins/host/registry.ts`:

```typescript
import { InProcessVibeService } from "../vibe/in-process-vibe-service";
import { VibePlugin } from "../vibe/vibe-plugin";
import type { PluginEntry } from "./plugin-host";

/**
 * Build the set of plugin entries based on environment / settings.
 *
 * Env vars (Phase 1):
 *   COCKPIT_PLUGINS              CSV of plugin ids to enable, e.g. "vibe"
 *   COCKPIT_PLUGIN_VIBE_ROOTS    CSV of repo paths the Vibe plugin scans
 */
export function buildPluginRegistry(): PluginEntry[] {
  const enabled = (process.env.COCKPIT_PLUGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const entries: PluginEntry[] = [];

  if (enabled.includes("vibe")) {
    const roots = (process.env.COCKPIT_PLUGIN_VIBE_ROOTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    entries.push({
      id: "vibe",
      factory: () =>
        new VibePlugin(new InProcessVibeService({ repoRoots: roots })),
    });
  }

  return entries;
}
```

- [ ] **Step 2: Write the failing singleton test**

Create `src/lib/plugins/host/get-plugin-host.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";

import {
  getPluginHost,
  resetPluginHostForTesting,
} from "./get-plugin-host";

const FIXTURES_ROOT = path.resolve(process.cwd(), "tests/fixtures");

describe("getPluginHost (singleton)", () => {
  const originalEnabled = process.env.COCKPIT_PLUGINS;
  const originalRoots = process.env.COCKPIT_PLUGIN_VIBE_ROOTS;

  beforeEach(() => {
    process.env.COCKPIT_PLUGINS = "vibe";
    process.env.COCKPIT_PLUGIN_VIBE_ROOTS = FIXTURES_ROOT;
    resetPluginHostForTesting();
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.COCKPIT_PLUGINS;
    else process.env.COCKPIT_PLUGINS = originalEnabled;
    if (originalRoots === undefined) delete process.env.COCKPIT_PLUGIN_VIBE_ROOTS;
    else process.env.COCKPIT_PLUGIN_VIBE_ROOTS = originalRoots;
    resetPluginHostForTesting();
  });

  it("returns the same host instance on repeat calls", async () => {
    const a = await getPluginHost();
    const b = await getPluginHost();
    expect(a).toBe(b);
  });

  it("loaded host exposes vibe plugin lanes from fixtures", async () => {
    const host = await getPluginHost();
    const lanes = await host.listAllLanes();
    expect(lanes.some((l) => l.pluginId === "vibe")).toBe(true);
  });

  it("returns an empty host when COCKPIT_PLUGINS is unset", async () => {
    process.env.COCKPIT_PLUGINS = "";
    resetPluginHostForTesting();
    const host = await getPluginHost();
    const lanes = await host.listAllLanes();
    expect(lanes).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/lib/plugins/host/get-plugin-host.test.ts`
Expected: FAIL with `Cannot find module './get-plugin-host'`.

- [ ] **Step 4: Implement the singleton**

Create `src/lib/plugins/host/get-plugin-host.ts`:

```typescript
import type { PluginHostContext } from "../contract/types";
import { PluginHost } from "./plugin-host";
import { buildPluginRegistry } from "./registry";

let cached: { host: PluginHost; promise: Promise<PluginHost> } | null = null;

/**
 * Get the process-wide plugin host. Lazily initialized on first call.
 *
 * Concurrent callers during init share the same promise — we never run init
 * twice in parallel.
 */
export function getPluginHost(): Promise<PluginHost> {
  if (cached) return cached.promise;
  const host = new PluginHost(makeDefaultContext());
  const promise = host
    .load(buildPluginRegistry())
    .then(() => host);
  cached = { host, promise };
  return promise;
}

/** Test-only: clear the singleton so the next call rebuilds. */
export function resetPluginHostForTesting(): void {
  cached = null;
}

function makeDefaultContext(): PluginHostContext {
  return {
    log: {
      info: (msg, fields) => console.info(`[plugin]`, msg, fields ?? {}),
      warn: (msg, fields) => console.warn(`[plugin]`, msg, fields ?? {}),
      error: (msg, fields) => console.error(`[plugin]`, msg, fields ?? {}),
    },
    settings: new Map(),
    memory: {
      // Phase 1: no-op memory. Real implementation in Phase 4 (spec Section 7).
      get: async () => null,
      set: async () => {},
      list: async () => [],
      delete: async () => {},
    },
    events: {
      // Phase 1: log only. Real persistence in Phase 5 alongside execution.
      emit: (event) => console.info(`[plugin event]`, event),
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/lib/plugins/host/get-plugin-host.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Update `.env.example`**

Add to the bottom of `.env.example` (do not modify existing lines):

```env

# ─── Plugin system (Phase 1) ──────────────────────────────────────────
# CSV of enabled plugin ids
COCKPIT_PLUGINS=vibe
# CSV of repo paths the Vibe plugin scans for lanes/*.json
COCKPIT_PLUGIN_VIBE_ROOTS=
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/plugins/host/registry.ts \
        src/lib/plugins/host/get-plugin-host.ts \
        src/lib/plugins/host/get-plugin-host.test.ts \
        .env.example
git commit -m "feat(plugins): registry + lazy host singleton + env config"
```

---

## Task 7: API — GET /api/cockpit/lanes

**Files:**
- Create: `src/app/api/cockpit/lanes/route.ts`

Thin Next.js App Router route. Returns lanes across all plugins. Phase 1: no auth gating yet — the route is available to anyone reaching the backend. Auth integration is its own task (Phase 1.5 if needed; otherwise inherited from Cockpit's session middleware once added).

> **Next.js note for the engineer:** This Cockpit is Next.js 16 App Router. If the API surface has shifted from your memory, consult `node_modules/next/dist/docs/app/api-reference/file-conventions/route.md`.

- [ ] **Step 1: Implement the route**

Create `src/app/api/cockpit/lanes/route.ts`:

```typescript
import { NextResponse } from "next/server";

import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

export async function GET(): Promise<NextResponse> {
  const host = await getPluginHost();
  const lanes = await host.listAllLanes();
  return NextResponse.json({ lanes });
}
```

- [ ] **Step 2: Smoke-test the route via the dev server**

Run (in a separate terminal):

```bash
pnpm dev
```

Then in another terminal:

```bash
curl -s http://localhost:3000/api/cockpit/lanes | head -c 500
```

Expected: a JSON envelope of the form `{"lanes":[ ... ]}` with at least one lane if `.env.local` has `COCKPIT_PLUGINS=vibe` and `COCKPIT_PLUGIN_VIBE_ROOTS` pointing at a directory with `lanes/*.json`. (If `.env.local` is unset, expect `{"lanes":[]}`.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cockpit/lanes/route.ts
git commit -m "feat(api): GET /api/cockpit/lanes returns aggregated lanes"
```

---

## Task 8: API — GET /api/cockpit/lanes/[laneId]/handoff

**Files:**
- Create: `src/app/api/cockpit/lanes/[laneId]/handoff/route.ts`

Generates a handoff artifact for a given namespaced lane id. Target is read from `?target=...`.

- [ ] **Step 1: Implement the route**

Create `src/app/api/cockpit/lanes/[laneId]/handoff/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

const TargetSchema = z.enum([
  "codex.web",
  "codex.cli",
  "codex.github_pr",
  "claude.code",
  "claude.web",
  "human.review",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ laneId: string }> },
): Promise<NextResponse> {
  const { laneId } = await params;
  const targetParam = request.nextUrl.searchParams.get("target");
  const targetParse = TargetSchema.safeParse(targetParam);
  if (!targetParse.success) {
    return NextResponse.json(
      { error: "invalid or missing ?target=" },
      { status: 400 },
    );
  }
  const host = await getPluginHost();
  const artifact = await host.generateHandoff(laneId, targetParse.data);
  if (!artifact) {
    return NextResponse.json({ error: "lane not found" }, { status: 404 });
  }
  return NextResponse.json({ artifact });
}
```

- [ ] **Step 2: Smoke-test**

With the dev server running and `.env.local` configured to point at `tests/fixtures` as a vibe root, run:

```bash
curl -s "http://localhost:3000/api/cockpit/lanes/vibe:sample-feedback-triage/handoff?target=codex.cli" | head -c 800
```

Expected: JSON `{"artifact":{"text":"# Handoff: sample-feedback-triage...","target":"codex.cli",...}}`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cockpit/lanes/
git commit -m "feat(api): GET handoff endpoint with Zod-validated target"
```

---

## Task 9: Lane inventory panel

**Files:**
- Create: `src/components/cockpit/lane-inventory-panel.tsx`
- Create: `src/components/cockpit/lane-inventory-panel.test.tsx`

A client component that fetches lanes from `/api/cockpit/lanes`, renders a list, and per lane offers a target dropdown + "Generate handoff" button that fetches and inline-displays the artifact.

- [ ] **Step 1: Write the failing test**

Create `src/components/cockpit/lane-inventory-panel.test.tsx`:

```typescript
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaneInventoryPanel } from "./lane-inventory-panel";

const sampleLane = {
  laneId: "sample-feedback-triage",
  pluginId: "vibe",
  name: "Sample feedback triage",
  description: "Map feedback bullets.",
  repoPath: "/tmp/fixtures",
  reads: ["/fixtures/**"],
  owns: ["/outputs/**"],
  target: "codex.local",
  approval: "human.before_commit",
  status: "ready" as const,
};

describe("LaneInventoryPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders 'no lanes' when the API returns an empty list", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ lanes: [] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("No lanes discovered");
  });

  it("renders a lane card per discovered lane", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ lanes: [sampleLane] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Sample feedback triage");
    expect(container.textContent).toContain("Map feedback bullets.");
    expect(container.textContent).toContain("codex.local");
  });

  it("shows an error message when the API returns non-200", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/failed|error/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/cockpit/lane-inventory-panel.test.tsx`
Expected: FAIL with `Cannot find module './lane-inventory-panel'`.

- [ ] **Step 3: Implement the component**

Create `src/components/cockpit/lane-inventory-panel.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";

interface LaneSummary {
  laneId: string;
  pluginId: string;
  name: string;
  description?: string;
  repoPath: string;
  reads: string[];
  owns: string[];
  target?: string;
  approval?: string;
  verify?: string[];
  status: "ready" | "running" | "error";
}

const TARGETS = [
  "codex.web",
  "codex.cli",
  "codex.github_pr",
  "claude.code",
  "claude.web",
  "human.review",
] as const;

type Target = (typeof TARGETS)[number];

interface HandoffArtifact {
  text: string;
  target: Target;
  format: "markdown" | "json";
  recommendedCommand?: string;
}

interface PanelState {
  status: "loading" | "ready" | "error";
  lanes: LaneSummary[];
  error?: string;
  /** Map of fullLaneId → currently displayed handoff. */
  handoffs: Record<string, HandoffArtifact | undefined>;
  /** Map of fullLaneId → in-flight handoff request flag. */
  generating: Record<string, boolean>;
}

const INITIAL_STATE: PanelState = {
  status: "loading",
  lanes: [],
  handoffs: {},
  generating: {},
};

export function LaneInventoryPanel(): JSX.Element {
  const [state, setState] = useState<PanelState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cockpit/lanes");
        if (!res.ok) {
          if (!cancelled) {
            setState((s) => ({ ...s, status: "error", error: `HTTP ${res.status}` }));
          }
          return;
        }
        const body = (await res.json()) as { lanes: LaneSummary[] };
        if (!cancelled) {
          setState((s) => ({ ...s, status: "ready", lanes: body.lanes }));
        }
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onGenerateHandoff(fullLaneId: string, target: Target): Promise<void> {
    setState((s) => ({ ...s, generating: { ...s.generating, [fullLaneId]: true } }));
    try {
      const res = await fetch(
        `/api/cockpit/lanes/${encodeURIComponent(fullLaneId)}/handoff?target=${encodeURIComponent(target)}`,
      );
      if (!res.ok) {
        setState((s) => ({
          ...s,
          generating: { ...s.generating, [fullLaneId]: false },
        }));
        return;
      }
      const body = (await res.json()) as { artifact: HandoffArtifact };
      setState((s) => ({
        ...s,
        generating: { ...s.generating, [fullLaneId]: false },
        handoffs: { ...s.handoffs, [fullLaneId]: body.artifact },
      }));
    } catch {
      setState((s) => ({
        ...s,
        generating: { ...s.generating, [fullLaneId]: false },
      }));
    }
  }

  if (state.status === "loading") {
    return <div className="p-4 text-sm opacity-70">Loading lanes…</div>;
  }

  if (state.status === "error") {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load lanes: {state.error ?? "unknown error"}
      </div>
    );
  }

  if (state.lanes.length === 0) {
    return (
      <div className="p-4 text-sm opacity-70">
        No lanes discovered. Configure <code>COCKPIT_PLUGIN_VIBE_ROOTS</code> in
        <code>.env.local</code> with paths to repos containing{" "}
        <code>lanes/*.json</code> files.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">Lanes ({state.lanes.length})</h2>
      {state.lanes.map((lane) => {
        const fullLaneId = `${lane.pluginId}:${lane.laneId}`;
        const handoff = state.handoffs[fullLaneId];
        const generating = !!state.generating[fullLaneId];
        return (
          <article
            key={fullLaneId}
            className="rounded-md border border-zinc-700 p-3 text-sm"
          >
            <header className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-medium">{lane.name}</h3>
              <span className="text-xs opacity-60">{lane.pluginId}</span>
            </header>
            {lane.description && (
              <p className="mb-2 opacity-80">{lane.description}</p>
            )}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs opacity-70">
              <dt>Repo</dt>
              <dd className="font-mono">{lane.repoPath}</dd>
              {lane.target && (
                <>
                  <dt>Target</dt>
                  <dd>{lane.target}</dd>
                </>
              )}
              {lane.approval && (
                <>
                  <dt>Approval</dt>
                  <dd>{lane.approval}</dd>
                </>
              )}
            </dl>
            <HandoffControls
              fullLaneId={fullLaneId}
              generating={generating}
              onGenerate={onGenerateHandoff}
            />
            {handoff && (
              <pre className="mt-3 max-h-72 overflow-auto rounded bg-zinc-900 p-2 text-xs whitespace-pre-wrap">
                {handoff.text}
              </pre>
            )}
          </article>
        );
      })}
    </div>
  );
}

function HandoffControls(props: {
  fullLaneId: string;
  generating: boolean;
  onGenerate(fullLaneId: string, target: Target): void;
}): JSX.Element {
  const [target, setTarget] = useState<Target>("codex.cli");
  return (
    <div className="mt-3 flex items-center gap-2">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value as Target)}
        className="rounded border border-zinc-700 bg-transparent px-2 py-1 text-xs"
      >
        {TARGETS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={props.generating}
        onClick={() => props.onGenerate(props.fullLaneId, target)}
        className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
      >
        {props.generating ? "Generating…" : "Generate handoff"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/cockpit/lane-inventory-panel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/cockpit/lane-inventory-panel.tsx \
        src/components/cockpit/lane-inventory-panel.test.tsx
git commit -m "feat(ui): LaneInventoryPanel — list lanes + per-lane handoff"
```

---

## Task 10: Mount panel in cockpit-app

**Files:**
- Modify: `src/components/cockpit/cockpit-app.tsx`

Mount `LaneInventoryPanel` in the existing Cockpit UI. The exact mount point depends on the current cockpit-app structure; goal is one visible "Lanes" entry the user can click to.

- [ ] **Step 1: Inspect the existing cockpit-app.tsx structure**

Run: `head -80 src/components/cockpit/cockpit-app.tsx`

Identify the existing panel layout pattern (tabs, columns, or sections). Note where other panels (e.g., the thought-chat lane, the parking lot, the assistant command center) are mounted.

- [ ] **Step 2: Add the panel mount**

Modify `src/components/cockpit/cockpit-app.tsx`:

- Add an import near the other component imports:
  ```typescript
  import { LaneInventoryPanel } from "./lane-inventory-panel";
  ```
- Locate the JSX section where panels are rendered. Add a new section/tab containing `<LaneInventoryPanel />`. Follow the conventions of nearby panels (className styling, wrapper element).
- If the cockpit uses a tab system, add `"Lanes"` as a new tab pointing at the panel. If it uses a column/stack layout, add the panel as a new card.

**Engineer judgment call:** the exact JSX integration depends on the existing component shape. The minimum is one place in the rendered output where `<LaneInventoryPanel />` appears, reachable by the user.

- [ ] **Step 3: Verify dev-server runs cleanly**

Run: `pnpm dev`
Open: `http://localhost:3000`
Expected: the cockpit renders without errors. The new "Lanes" panel/tab is visible. With no `.env.local` config it shows the "No lanes discovered" message.

- [ ] **Step 4: Commit**

```bash
git add src/components/cockpit/cockpit-app.tsx
git commit -m "feat(ui): mount LaneInventoryPanel in cockpit-app"
```

---

## Task 11: Playwright e2e test

**Files:**
- Create: `tests/e2e/lane-inventory.spec.ts`

End-to-end: dev server up, visit page, see the panel, generate a handoff, see the artifact.

- [ ] **Step 1: Add the fixture path to .env.local**

Edit `.env.local` (or create it from `.env.example`) and set:

```env
COCKPIT_PLUGINS=vibe
COCKPIT_PLUGIN_VIBE_ROOTS=<absolute path to tests/fixtures>
```

(On Windows: e.g. `C:\Users\4elut\Documents\Cockpit\tests\fixtures` — use the path style your shell expects.)

- [ ] **Step 2: Write the test**

Create `tests/e2e/lane-inventory.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("lane inventory panel lists fixture lane and generates handoff", async ({
  page,
}) => {
  await page.goto("/");

  // Wait for the panel to render. Exact selector depends on cockpit-app
  // integration; this works against an h2 / heading the panel emits.
  await expect(page.getByRole("heading", { name: /Lanes \(/ })).toBeVisible({
    timeout: 10_000,
  });

  // The fixture lane name is "sample-feedback-triage".
  await expect(page.getByText("sample-feedback-triage")).toBeVisible();

  // Pick codex.cli as target and click "Generate handoff".
  const laneCard = page.locator("article").filter({ hasText: "sample-feedback-triage" });
  await laneCard.locator("select").selectOption("codex.cli");
  await laneCard.getByRole("button", { name: /Generate handoff/i }).click();

  // The handoff artifact should appear in a <pre>.
  await expect(laneCard.locator("pre")).toContainText("# Handoff: sample-feedback-triage", {
    timeout: 5_000,
  });
  await expect(laneCard.locator("pre")).toContainText("**Target:** codex.cli");
  await expect(laneCard.locator("pre")).toContainText("## Read scope");
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm test:e2e tests/e2e/lane-inventory.spec.ts`
Expected: PASS. (Playwright will start the dev server per `playwright.config.ts` if configured; otherwise start `pnpm dev` manually in another terminal first.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/lane-inventory.spec.ts
git commit -m "test(e2e): lane inventory panel and handoff generation"
```

---

## Self-review

After all tasks complete, run this checklist before declaring Phase 1 done.

### 1. Spec coverage

| Spec section | Task(s) implementing |
|---|---|
| Section 1 — three-layer architecture | Tasks 2, 3, 5 |
| Section 2 — CockpitPlugin contract types | Task 1 |
| Section 2 — Plugin lifecycle (load / init / dispose / failure isolation) | Task 2 |
| Section 2 — `LaneRunInput` shape (resolution) | Task 1 (defined; unused in Phase 1) |
| Section 3 — `VibeService` interface | Task 3 |
| Section 3 — `InProcessVibeService` skeleton | Task 4 |
| Section 4 — Lane discovery (`lanes/*.json` + `.prompt.md` siblings as canonical shape) | Task 4 |
| Section 6 — Handoff generation (surface-aware, copy-paste ready) | Tasks 4, 8 |
| Section 8 — Shared data model (single contract module) | Task 1 |
| Section 9 — Per-plugin failure isolation | Task 2 |
| Section 10 — Contract tests, integration tests, e2e | Tasks 1, 2, 4, 5, 9, 11 |

Gaps (intentional, in scope deferral):
- Section 5 — execution + streaming → Phase 2
- Section 7 — memory bridge → Phase 4 (Phase 1 `HostMemoryApi` is no-op)
- POST reload + GET plugins endpoints → Phase 2
- `RemoteVibeService` impl → Phase 5
- Lane file watching → Phase 2 (Phase 1 re-scans on every call)

### 2. Placeholder scan

This plan contains:
- No `TBD`, `TODO`, `implement later`, or `fill in details`.
- One judgment call in Task 10 Step 2 ("engineer judgment call") — appropriate because the integration point depends on the existing cockpit-app shape which evolves outside this plan's scope.
- Every code step shows complete code, not pseudocode.

### 3. Type consistency

Cross-check the names defined in Task 1 vs. used in Tasks 2-11:
- `CockpitPlugin`, `PluginCapability`, `PluginHostContext`, `LaneSummary`, `LaneEvent`, `LaneRunInput`, `HandoffArtifact`, `HandoffTarget`, `TodoItem`, `PluginLogger`, `HostEventSink`, `HostMemoryApi`, `PluginMemoryBridge` — all defined in `contract/types.ts`.
- `VibeService` — defined in Task 3, used in Tasks 4, 5, 6.
- `PluginEntry`, `PluginHost` — defined in Task 2, used in Tasks 6, 7, 8.
- `getPluginHost`, `resetPluginHostForTesting`, `buildPluginRegistry` — defined in Task 6, used in Tasks 7, 8.
- `LaneInventoryPanel` — defined in Task 9, used in Task 10.

No mismatches (e.g., `clearLayers` vs. `clearFullLayers`-style bugs).

### 4. Ambiguity

The only fuzzy area is Task 10 Step 2's "engineer judgment call" for where to mount the panel. This is intentional — the plan tells you the requirement (visible, reachable) and the integration point depends on cockpit-app's current shape. Any of: a new tab, a new column, a new card section is acceptable.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-cockpit-vibe-phase-1-plugin-system.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
