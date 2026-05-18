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
    async dispose() {},
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
