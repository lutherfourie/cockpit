import { z } from "zod";

import { CockpitProviderSchema, type CockpitProvider } from "./schema";

const MAX_HISTORY_MESSAGES = 12;

export const ThoughtChatRoleSchema = z.enum(["user", "assistant"]);

export const ThoughtChatHistoryMessageSchema = z.object({
  role: ThoughtChatRoleSchema,
  content: z.string().trim().min(1),
});

export const ThoughtChatInputSchema = z.object({
  message: z.string().trim().min(1, "Message is required."),
  history: z.array(ThoughtChatHistoryMessageSchema).default([]),
});

export const ThoughtChatAssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().trim().min(1),
});

export const ThoughtChatResultSchema = z.object({
  message: ThoughtChatAssistantMessageSchema,
  modelUsed: z.literal("local"),
  promoteText: z.string().trim().min(1),
});

export type ThoughtChatRole = z.infer<typeof ThoughtChatRoleSchema>;
export type ThoughtChatHistoryMessage = z.infer<
  typeof ThoughtChatHistoryMessageSchema
>;
export type ThoughtChatInput = z.infer<typeof ThoughtChatInputSchema>;
export type ThoughtChatAssistantMessage = z.infer<
  typeof ThoughtChatAssistantMessageSchema
>;
export type ThoughtChatResult = z.infer<typeof ThoughtChatResultSchema>;

export async function runThoughtChat(rawInput: unknown): Promise<ThoughtChatResult> {
  const input = ThoughtChatInputSchema.parse(rawInput);
  readProvider();

  const compactMessage = compactText(input.message);
  const recentHistory = input.history.slice(-MAX_HISTORY_MESSAGES);
  const lastAssistant = [...recentHistory]
    .reverse()
    .find((message) => message.role === "assistant");
  const assistantText = buildLocalAssistantText(compactMessage, lastAssistant?.content);

  return ThoughtChatResultSchema.parse({
    message: {
      role: "assistant",
      content: assistantText,
    },
    modelUsed: "local",
    promoteText: promoteText({
      userText: compactMessage,
      assistantText,
    }),
  });
}

export function promoteText({
  userText,
  assistantText,
}: {
  userText: string;
  assistantText?: string;
}): string {
  const compactUserText = compactText(userText);
  const compactAssistantText = assistantText ? compactText(assistantText) : "";

  if (!compactAssistantText) {
    return compactUserText;
  }

  return `Messy thought: ${compactUserText}\n\nPossible phrasing: ${compactAssistantText}`;
}

function buildLocalAssistantText(
  compactMessage: string,
  previousAssistantText?: string,
): string {
  const continuity = previousAssistantText
    ? " Keep the last thread, but make this sharper."
    : "";

  return [
    `What feels wrong: ${compactMessage}.`,
    `A cleaner way to say it: I can tell something is off, and I need to name the mismatch before changing the work.${continuity}`,
    "Next check: point at one screen, one expectation, and one visible mismatch.",
  ].join("\n");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readProvider(): CockpitProvider {
  const parsed = CockpitProviderSchema.safeParse(process.env.COCKPIT_LLM_PROVIDER);
  if (parsed.success) {
    return parsed.data;
  }

  return process.env.OPENAI_API_KEY ? "openai" : "local";
}
