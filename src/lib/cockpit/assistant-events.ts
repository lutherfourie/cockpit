import { z } from "zod";

import type { ThoughtChatHistoryMessage } from "./thought-chat";

export const ASSISTANT_EVENT_TYPES = [
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_result",
  "artifact",
  "promotion",
  "parked_item",
  "handoff",
] as const;

export const ASSISTANT_EVENT_ROLES = ["user", "assistant", "system"] as const;

export const AssistantEventTypeSchema = z.enum(ASSISTANT_EVENT_TYPES);

export const AssistantEventRoleSchema = z.enum(ASSISTANT_EVENT_ROLES);

export const AssistantEventSchema = z.object({
  id: z.string().min(1),
  type: AssistantEventTypeSchema,
  role: AssistantEventRoleSchema.optional(),
  content: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
});

export const AppendAssistantEventInputSchema = z.object({
  sessionId: z.string().uuid().optional(),
  type: AssistantEventTypeSchema,
  role: AssistantEventRoleSchema.optional(),
  content: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AssistantEventType = z.infer<typeof AssistantEventTypeSchema>;
export type AssistantEventRole = z.infer<typeof AssistantEventRoleSchema>;
export type AssistantEvent = z.infer<typeof AssistantEventSchema>;
export type AppendAssistantEventInput = z.infer<
  typeof AppendAssistantEventInputSchema
>;

export type AssistantEventRow = {
  readonly id: string;
  readonly event_type: string;
  readonly role: string | null;
  readonly content: string;
  readonly metadata: unknown;
  readonly created_at: string;
};

export function createLocalAssistantEvent({
  type,
  role,
  content,
  metadata = {},
}: Omit<AppendAssistantEventInput, "sessionId">): AssistantEvent {
  return {
    id: `local-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
    type,
    ...(role ? { role } : {}),
    content,
    metadata,
    createdAt: new Date().toISOString(),
  };
}

export function assistantEventsFromChatMessages(
  messages: ThoughtChatHistoryMessage[],
): AssistantEvent[] {
  return messages.map((message, index) => ({
    id: `legacy-chat-${index}`,
    type: message.role === "user" ? "user_message" : "assistant_message",
    role: message.role,
    content: message.content,
    metadata: { source: "cockpit_chat_messages" },
    createdAt: new Date(0).toISOString(),
  }));
}

export function parseAssistantEventRows(
  rows: readonly AssistantEventRow[],
): AssistantEvent[] {
  const events = rows.flatMap((row) => {
    const parsed = AssistantEventSchema.safeParse({
      id: row.id,
      type: row.event_type,
      role: row.role ?? undefined,
      content: row.content,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    });

    return parsed.success ? [parsed.data] : [];
  });

  return replayAssistantEvents([], events);
}

export function replayAssistantEvents(
  currentEvents: readonly AssistantEvent[],
  incomingEvents: readonly AssistantEvent[],
): AssistantEvent[] {
  const eventsById = new Map<
    string,
    { event: AssistantEvent; firstSeenIndex: number }
  >();
  let nextIndex = 0;

  for (const event of [...currentEvents, ...incomingEvents]) {
    const existingEvent = eventsById.get(event.id);
    eventsById.set(event.id, {
      event,
      firstSeenIndex: existingEvent?.firstSeenIndex ?? nextIndex,
    });
    nextIndex += 1;
  }

  return [...eventsById.values()]
    .sort(compareAssistantEventReplayRecords)
    .map(({ event }) => event);
}

function compareAssistantEventReplayRecords(
  left: { event: AssistantEvent; firstSeenIndex: number },
  right: { event: AssistantEvent; firstSeenIndex: number },
): number {
  const byCreatedAt =
    assistantEventTimestamp(left.event.createdAt) -
    assistantEventTimestamp(right.event.createdAt);

  return byCreatedAt === 0
    ? left.firstSeenIndex - right.firstSeenIndex
    : byCreatedAt;
}

function assistantEventTimestamp(createdAt: string): number {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}
