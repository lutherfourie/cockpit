import { describe, expect, it, vi } from "vitest";

import {
  THOUGHT_CHAT_HISTORY_LIMIT,
  ThoughtChatInputSchema,
  promoteText,
  runThoughtChat,
} from "./thought-chat";

describe("thought chat", () => {
  it("normalizes overflowing history to the bounded runtime window", () => {
    const history = Array.from(
      { length: THOUGHT_CHAT_HISTORY_LIMIT + 1 },
      (_, index) =>
        ({
          role: index % 2 === 0 ? "user" : "assistant",
          content: `history ${index + 1}`,
        }) as const,
    );

    const parsed = ThoughtChatInputSchema.parse({
      message: "Here is the current thought.",
      history,
    });

    expect(parsed.history).toHaveLength(THOUGHT_CHAT_HISTORY_LIMIT);
    expect(parsed.history[0]?.content).toBe("history 2");
    expect(parsed.history.at(-1)?.content).toBe("history 13");
  });

  it("validates only messages inside the bounded history window", () => {
    const history = [
      { role: "system", content: "This overflow entry is outside the runtime window." },
      ...Array.from(
        { length: THOUGHT_CHAT_HISTORY_LIMIT },
        (_, index) =>
          ({
            role: index % 2 === 0 ? "user" : "assistant",
            content: `recent history ${index + 1}`,
          }) as const,
      ),
    ];

    const parsed = ThoughtChatInputSchema.parse({
      message: "Keep the context bounded.",
      history,
    });

    expect(parsed.history).toHaveLength(THOUGHT_CHAT_HISTORY_LIMIT);
    expect(parsed.history[0]?.content).toBe("recent history 1");
  });

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
