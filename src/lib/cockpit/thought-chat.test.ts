import { describe, expect, it, vi } from "vitest";

import { promoteText, runThoughtChat } from "./thought-chat";

describe("thought chat", () => {
  it("uses deterministic local phrasing when configured without an OpenAI key", async () => {
    vi.stubEnv("COCKPIT_LLM_PROVIDER", "local");
    vi.stubEnv("OPENAI_API_KEY", "");

    const result = await runThoughtChat({
      message: "I know the UI is wrong but I cannot explain it",
      history: [],
    });

    expect(result.modelUsed).toBe("local");
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toContain("What feels wrong");
  });

  it("promoteText preserves the compacted user text", () => {
    const result = promoteText({
      userText: "  I know   the UI is wrong\nbut I cannot explain it  ",
      assistantText: "What feels wrong: the UI does not match the work.",
    });

    expect(result).toContain("I know the UI is wrong but I cannot explain it");
  });
});
