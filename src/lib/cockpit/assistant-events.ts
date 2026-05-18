import { z } from "zod";

import type { ThoughtChatHistoryMessage } from "./thought-chat";

export const AssistantEventTypeSchema = z.enum([
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_result",
  "artifact",
  "promotion",
  "parked_item",
  "handoff",
]);

export const AssistantEventRoleSchema = z.enum(["user", "assistant", "system"]);

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
  rows: {
    id: string;
    event_type: string;
    role: string | null;
    content: string;
    metadata: unknown;
    created_at: string;
  }[],
): AssistantEvent[] {
  return rows.flatMap((row) => {
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
}
