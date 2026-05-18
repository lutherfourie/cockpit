import { describe, expect, it } from "vitest";

import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  LaneEvent,
  LaneRunInput,
  LaneSummary,
  PluginCapability,
  TodoItem,
} from "./types";

describe("plugin contract types", () => {
  it("CockpitPlugin requires id, displayName, version, capabilities, init, dispose", () => {
    const plugin: CockpitPlugin = {
      id: "test",
      displayName: "Test",
      version: "0.0.0",
      cockpitPluginContractVersion: "1.0.0",
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

  it("TodoItem fits inside the LaneEvent todo variant", () => {
    const item: TodoItem = { id: "t1", content: "write tests", status: "pending" };
    const event: LaneEvent = { type: "todo", items: [item] };
    expect(event.type).toBe("todo");
    if (event.type === "todo") {
      expect(event.items[0].content).toBe("write tests");
      expect(event.items[0].status).toBe("pending");
    }
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
