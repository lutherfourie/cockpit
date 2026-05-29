import { describe, expect, it } from "vitest";

import {
  ASSISTANT_PERSONA_SYSTEM_PROMPT,
  buildAgentMessages,
  type AgentChatMessage,
} from "./assistant-persona";

describe("assistant persona", () => {
  it("prepends the persona system message and preserves conversation order", () => {
    const history: AgentChatMessage[] = [
      { role: "user", content: "I keep losing the thread." },
      { role: "assistant", content: "Let's hold the thread together." },
    ];

    expect(buildAgentMessages(history)).toEqual([
      { role: "system", content: ASSISTANT_PERSONA_SYSTEM_PROMPT },
      { role: "user", content: "I keep losing the thread." },
      { role: "assistant", content: "Let's hold the thread together." },
    ]);
  });

  it("supports a typed persona config override", () => {
    const history: AgentChatMessage[] = [{ role: "user", content: "Use the test config." }];

    expect(
      buildAgentMessages(history, {
        version: "v-test",
        systemPrompt: "You are the test assistant persona.",
      }),
    ).toEqual([
      { role: "system", content: "You are the test assistant persona." },
      { role: "user", content: "Use the test config." },
    ]);
  });
});
