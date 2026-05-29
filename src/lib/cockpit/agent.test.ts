import { describe, expect, it, vi } from "vitest";

import {
  buildCockpitTools,
  buildSdkCockpitTools,
  resolveCockpitProvider,
  runCockpitAgent,
} from "./agent";
import { NullCockpitMemoryStore, type CockpitMemoryStore } from "./storage";

describe("cockpit agent", () => {
  it.each([
    ["local", "key", "local"],
    ["openai", "key", "openai"],
    ["openai", "", "openai"],
    ["codex", "", "codex"],
    ["cerebras", "", "cerebras"],
    [undefined, "key", "openai"],
    [undefined, "", "local"],
    ["unsupported", "key", "openai"],
    ["unsupported", "", "local"],
  ] as const)(
    "resolves provider %s with OPENAI_API_KEY=%s to %s",
    (configuredProvider, openAiKey, expectedProvider) => {
      expect(
        resolveCockpitProvider({
          COCKPIT_LLM_PROVIDER: configuredProvider,
          OPENAI_API_KEY: openAiKey,
        }),
      ).toBe(expectedProvider);
    },
  );

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

  it("falls back locally when OpenAI is selected without OPENAI_API_KEY", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    const store = createMockStore();

    const result = await runCockpitAgent(
      { message: "try the OpenAI provider", mode: "focus" },
      { store },
    );

    expect(result.output.blockers).toEqual([
      "OPENAI_API_KEY is not set, so the local fallback handled this turn.",
    ]);
    expect(result.output.assumptions).toEqual([
      "Local deterministic fallback was used before live model output.",
    ]);
    expect(result.persistence.saved).toBe(true);
    expect(result.persistence.source).toBe("supabase");
    expect(store.saveSessionState).toHaveBeenCalledOnce();
  });

  it("reports unsaved local fallback persistence from the memory store", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "local");
    vi.stubEnv("OPENAI_API_KEY", "");
    const store = new NullCockpitMemoryStore("test reason");

    const result = await runCockpitAgent(
      { message: "keep moving without persistence", mode: "focus" },
      { store },
    );

    expect(result.persistence.saved).toBe(false);
    expect(result.persistence.source).toBe("none");
    expect(result.persistence.reason).toBe("test reason");
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

  it("excludes session save from SDK runtime tools while preserving other tools", () => {
    const store = createMockStore();

    expect(getToolNames(buildCockpitTools(store))).toEqual([
      "load_session_state",
      "save_session_state",
      "add_parking_lot_item",
      "create_handoff",
      "summarize_repo_state",
    ]);

    expect(getToolNames(buildSdkCockpitTools(store))).toEqual([
      "load_session_state",
      "add_parking_lot_item",
      "create_handoff",
      "summarize_repo_state",
    ]);
  });
});

function createMockStore(): CockpitMemoryStore {
  return {
    loadSessionState: vi.fn(async () => null),
    loadLatestSessionState: vi.fn(async () => null),
    saveSessionState: vi.fn(async () => ({
      sessionId: "00000000-0000-4000-8000-000000000000",
      saved: true,
    })),
    addParkingLotItem: vi.fn(async () => ({ saved: true })),
    createHandoff: vi.fn(async () => ({ saved: true })),
  };
}

function getToolNames(tools: ReturnType<typeof buildCockpitTools>): string[] {
  return tools.flatMap((cockpitTool) =>
    cockpitTool.type === "function" ? [cockpitTool.name] : [],
  );
}
