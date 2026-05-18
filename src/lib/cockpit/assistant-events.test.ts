import { describe, expect, it } from "vitest";

import {
  AssistantEventSchema,
  assistantEventsFromChatMessages,
  createLocalAssistantEvent,
} from "./assistant-events";

describe("assistant events", () => {
  it("parses a canonical assistant timeline event", () => {
    const event = AssistantEventSchema.parse({
      id: "event-1",
      type: "tool_result",
      role: "assistant",
      content: "Parked the distracting idea.",
      metadata: { toolName: "parkAssistantItem", saved: true },
      createdAt: "2026-05-18T06:00:00.000Z",
    });

    expect(event.type).toBe("tool_result");
    expect(event.metadata).toEqual({
      toolName: "parkAssistantItem",
      saved: true,
    });
  });

  it("creates local events when Supabase is unavailable", () => {
    const event = createLocalAssistantEvent({
      type: "assistant_message",
      role: "assistant",
      content: "Live state is unavailable, but local capture still works.",
      metadata: { source: "local" },
    });

    expect(event.id).toMatch(/^local-/);
    expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.metadata).toEqual({ source: "local" });
  });

  it("maps legacy chat rows into assistant message events", () => {
    const events = assistantEventsFromChatMessages([
      { role: "user", content: "I cannot name the mismatch." },
      { role: "assistant", content: "Name one visible mismatch first." },
    ]);

    expect(events).toEqual([
      expect.objectContaining({
        id: "legacy-chat-0",
        type: "user_message",
        role: "user",
        content: "I cannot name the mismatch.",
        metadata: { source: "cockpit_chat_messages" },
      }),
      expect.objectContaining({
        id: "legacy-chat-1",
        type: "assistant_message",
        role: "assistant",
        content: "Name one visible mismatch first.",
        metadata: { source: "cockpit_chat_messages" },
      }),
    ]);
  });
});
