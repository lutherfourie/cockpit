import { describe, expect, it, vi } from "vitest";

import { runCockpitAgent } from "./agent";
import type { CockpitMemoryStore } from "./storage";

describe("cockpit agent", () => {
  it("uses deterministic fallback when OPENAI_API_KEY is absent", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "local");
    vi.stubEnv("OPENAI_API_KEY", "");
    const store = createMockStore();

    const result = await runCockpitAgent(
      { message: "I need to fix tests but also rethink auth", mode: "focus" },
      { store },
    );

    expect(result.output.currentGoal).toContain("I need to fix tests");
    expect(result.output.nextAction).toContain("smallest concrete step");
    expect(result.persistence.saved).toBe(true);
    expect(result.persistence.source).toBe("supabase");
    expect(store.saveSessionState).toHaveBeenCalledOnce();
  });

  it("uses codex exec provider when configured", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "codex");
    const store = createMockStore();

    const result = await runCockpitAgent(
      { message: "make this use Codex", mode: "focus" },
      {
        store,
        codexRunner: async ({ outputPath }) => {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(
            outputPath,
            JSON.stringify({
              currentGoal: "Use Codex subscription locally",
              nextAction: "Shell out through codex exec",
              proofNeeded: "Validated JSON reaches the UI",
              parkingLot: [],
              assumptions: ["Codex auth exists"],
              blockers: [],
            }),
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result.output.currentGoal).toBe("Use Codex subscription locally");
    expect(result.output.nextAction).toBe("Shell out through codex exec");
    expect(result.sessionId).toBe("00000000-0000-4000-8000-000000000000");
    expect(result.persistence.saved).toBe(true);
    expect(result.persistence.source).toBe("supabase");
    expect(store.loadSessionState).toHaveBeenCalledOnce();
    expect(store.saveSessionState).toHaveBeenCalledOnce();
  });

  it("falls back clearly when Cerebras is configured without a key", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "cerebras");
    vi.stubEnv("CEREBRAS_API_KEY", "");
    const store = createMockStore();

    const result = await runCockpitAgent(
      { message: "use Cerebras for now", mode: "focus" },
      { store },
    );

    expect(result.output.blockers).toEqual(["CEREBRAS_API_KEY is not set."]);
    expect(result.output.nextAction).toContain("smallest concrete step");
    expect(result.sessionId).toBe("00000000-0000-4000-8000-000000000000");
    expect(result.persistence.saved).toBe(true);
    expect(result.persistence.source).toBe("supabase");
    expect(store.saveSessionState).toHaveBeenCalledOnce();
  });
});

function createMockStore(): CockpitMemoryStore {
  return {
    loadSessionState: vi.fn(async () => null),
    saveSessionState: vi.fn(async () => ({
      sessionId: "00000000-0000-4000-8000-000000000000",
      saved: true,
    })),
    addParkingLotItem: vi.fn(async () => ({ saved: true })),
    createHandoff: vi.fn(async () => ({ saved: true })),
  };
}
