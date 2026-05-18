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
