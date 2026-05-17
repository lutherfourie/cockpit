import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ThoughtChatInputSchema, runThoughtChat } from "@/lib/cockpit/thought-chat";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/cockpit/supabase-server";
import {
  NullCockpitMemoryStore,
  SupabaseCockpitMemoryStore,
} from "@/lib/cockpit/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = ThoughtChatInputSchema.parse(body);
    const store = await createStore();
    const sessionId = readSessionId(body);
    const storedHistory = await store.loadChatMessages(sessionId);
    await store.saveChatMessage({
      sessionId,
      role: "user",
      content: input.message,
    });
    const result = await runThoughtChat({
      ...input,
      history: storedHistory.length > 0 ? storedHistory : input.history,
    });
    await store.saveChatMessage({
      sessionId,
      role: result.message.role,
      content: result.message.content,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof ZodError
        ? "Invalid thought chat input."
        : error instanceof Error
          ? error.message
          : "Thought chat request failed.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function createStore() {
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

function readSessionId(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "sessionId" in body &&
    typeof body.sessionId === "string" &&
    body.sessionId.length > 0
  ) {
    return body.sessionId;
  }

  return undefined;
}
