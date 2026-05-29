import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AppendAssistantEventInputSchema,
  createLocalAssistantEvent,
  type AppendAssistantEventInput,
  type AssistantEvent,
} from "@/lib/cockpit/assistant-events";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/cockpit/supabase-server";
import {
  NullCockpitMemoryStore,
  SupabaseCockpitMemoryStore,
  type CockpitMemoryStore,
} from "@/lib/cockpit/storage";
import { runThoughtChat, type ThoughtChatHistoryMessage } from "@/lib/cockpit/thought-chat";

export const runtime = "nodejs";

const AssistantTurnRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().trim().min(1, "Message is required."),
});

export async function GET(request: Request) {
  try {
    const store = await createStore();
    const { searchParams } = new URL(request.url);
    const sessionId = readSessionId(searchParams.get("sessionId"));
    const events = await store.loadAssistantEvents?.(sessionId);

    return NextResponse.json({ events: events ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Assistant request failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await readRequestJson(request);

  if (body === undefined) {
    return NextResponse.json(
      { error: "Invalid assistant request input." },
      { status: 400 },
    );
  }

  try {
    if (isAssistantTurnRequest(body)) {
      const parsed = AssistantTurnRequestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid assistant request input." },
          { status: 400 },
        );
      }

      const input = parsed.data;
      const store = await createStore();
      const priorEvents = (await store.loadAssistantEvents?.(input.sessionId)) ?? [];
      const userEvent = await appendTimelineEvent(store, {
        sessionId: input.sessionId,
        type: "user_message",
        role: "user",
        content: input.message,
        metadata: { source: "assistant_command_center" },
      });

      await store.saveChatMessage?.({
        sessionId: input.sessionId,
        role: "user",
        content: input.message,
      });

      const result = await runThoughtChat({
        message: input.message,
        history: eventsToThoughtHistory(priorEvents),
      });

      const assistantEvent = await appendTimelineEvent(store, {
        sessionId: input.sessionId,
        type: "assistant_message",
        role: result.message.role,
        content: result.message.content,
        metadata: {
          source: "assistant_command_center",
          modelUsed: result.modelUsed,
          promoteText: result.promoteText,
        },
      });

      await store.saveChatMessage?.({
        sessionId: input.sessionId,
        role: result.message.role,
        content: result.message.content,
      });

      return NextResponse.json({
        events: [userEvent, assistantEvent],
        promoteText: result.promoteText,
      });
    }

    const parsed = AppendAssistantEventInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid assistant event input." },
        { status: 400 },
      );
    }

    const eventInput = parsed.data;
    const store = await createStore();
    await applyAssistantActionSideEffect(store, eventInput);
    const event = await appendTimelineEvent(store, eventInput);

    return NextResponse.json({ event });
  } catch {
    return NextResponse.json(
      { error: "Assistant request failed." },
      { status: 500 },
    );
  }
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function createStore(): Promise<CockpitMemoryStore> {
  if (!isSupabaseConfigured()) {
    return new NullCockpitMemoryStore("Supabase environment variables are not set.");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return new NullCockpitMemoryStore("Supabase server client is unavailable.");
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return new NullCockpitMemoryStore("No authenticated Supabase user is present.");
  }

  return new SupabaseCockpitMemoryStore(supabase, user.id);
}

async function appendTimelineEvent(
  store: CockpitMemoryStore,
  input: AppendAssistantEventInput,
): Promise<AssistantEvent> {
  const result = await store.appendAssistantEvent?.(input);

  if (result?.event) {
    return result.event;
  }

  return createLocalAssistantEvent({
    type: input.type,
    role: input.role,
    content: input.content,
    metadata: {
      ...input.metadata,
      persistence: "local",
      ...(result?.reason ? { reason: result.reason } : {}),
    },
  });
}

async function applyAssistantActionSideEffect(
  store: CockpitMemoryStore,
  input: AppendAssistantEventInput,
) {
  if (input.type === "parked_item") {
    await store.addParkingLotItem({
      sessionId: input.sessionId,
      content: input.content,
      source: "assistant",
    });
  }

  if (input.type === "handoff") {
    await store.createHandoff({
      sessionId: input.sessionId,
      target: "cockpit",
      prompt: input.content,
    });
  }
}

function eventsToThoughtHistory(events: AssistantEvent[]): ThoughtChatHistoryMessage[] {
  return events.flatMap((event) => {
    if (
      (event.type !== "user_message" && event.type !== "assistant_message") ||
      (event.role !== "user" && event.role !== "assistant")
    ) {
      return [];
    }

    return [{ role: event.role, content: event.content }];
  });
}

function isAssistantTurnRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function readSessionId(value: string | null): string | undefined {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
