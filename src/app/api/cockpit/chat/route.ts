import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { runThoughtChat } from "@/lib/cockpit/thought-chat";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runThoughtChat(body);

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
