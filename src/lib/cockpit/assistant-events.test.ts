import { describe, expect, it } from "vitest";

import {
  type AssistantEvent,
  type AssistantEventRow,
  AssistantEventSchema,
  assistantEventsFromChatMessages,
  createLocalAssistantEvent,
  parseAssistantEventRows,
  replayAssistantEvents,
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

  it("parses database rows into chronological replay order", () => {
    const rows = [
      {
        id: "event-3",
        event_type: "assistant_message",
        role: "assistant",
        content: "Name the proof.",
        metadata: { source: "assistant" },
        created_at: "2026-05-18T06:02:00.000Z",
      },
      {
        id: "event-1",
        event_type: "user_message",
        role: "user",
        content: "I need the next move.",
        metadata: { source: "user" },
        created_at: "2026-05-18T06:00:00.000Z",
      },
      {
        id: "event-2",
        event_type: "tool_call",
        role: null,
        content: "Load current cockpit state.",
        metadata: { toolName: "loadCockpitState" },
        created_at: "2026-05-18T06:01:00.000Z",
      },
    ] satisfies AssistantEventRow[];

    expect(parseAssistantEventRows(rows).map((event) => event.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
  });

  it("replays incoming events by id without losing chronological ordering", () => {
    const existingEvents = [
      assistantEvent({
        id: "event-2",
        type: "assistant_message",
        role: "assistant",
        content: "Draft an answer.",
        createdAt: "2026-05-18T06:02:00.000Z",
      }),
      assistantEvent({
        id: "event-1",
        type: "user_message",
        role: "user",
        content: "What should I do next?",
        createdAt: "2026-05-18T06:00:00.000Z",
      }),
    ];
    const incomingEvents = [
      assistantEvent({
        id: "event-2",
        type: "assistant_message",
        role: "assistant",
        content: "Draft a bounded answer.",
        metadata: { replayed: true },
        createdAt: "2026-05-18T06:02:00.000Z",
      }),
      assistantEvent({
        id: "event-1.5",
        type: "tool_result",
        role: "system",
        content: "Loaded current cockpit state.",
        createdAt: "2026-05-18T06:01:00.000Z",
      }),
    ];

    const replayed = replayAssistantEvents(existingEvents, incomingEvents);

    expect(replayed.map((event) => event.id)).toEqual([
      "event-1",
      "event-1.5",
      "event-2",
    ]);
    expect(replayed[2]).toEqual(
      expect.objectContaining({
        content: "Draft a bounded answer.",
        metadata: { replayed: true },
      }),
    );
  });
});

function assistantEvent(
  event: Partial<AssistantEvent> & Pick<AssistantEvent, "id">,
) {
  return AssistantEventSchema.parse({
    type: "tool_call",
    content: "Assistant event.",
    metadata: {},
    createdAt: "2026-05-18T06:00:00.000Z",
    ...event,
  });
}
