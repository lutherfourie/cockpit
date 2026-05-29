import { z } from "zod";

import { buildAgentMessages, type AgentChatMessage } from "@/lib/cockpit/assistant-persona";

// Streams a warm assistant turn by proxying the Vibe daemon's /v1/turn SSE.
// The persona system prompt is assembled here (server-side) so it never leaves
// the server; the browser only sends user/assistant history. Provider defaults
// to "cerebras" so the daemon routes through the OpenAI-compatible adapter
// pointed at the user's Cerebras key.
export const runtime = "nodejs";

const DAEMON_URL = process.env.VIBE_DAEMON_URL ?? "http://127.0.0.1:8787";
const PROVIDER = process.env.AGENT_PROVIDER ?? "cerebras";
const MAX_AGENT_MESSAGES = 24;
const MAX_AGENT_MESSAGE_CHARS = 4000;
const VALIDATION_ERROR =
  "Invalid agent turn input. Send 1-24 user/assistant messages under 4000 characters each.";

const TurnBodySchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(MAX_AGENT_MESSAGE_CHARS),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_AGENT_MESSAGES),
    sessionId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

function sseError(message: string): Response {
  const body = `data: ${JSON.stringify({ kind: "error", err: message })}\n\ndata: ${JSON.stringify({ kind: "done" })}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return sseError("Could not read the message you sent.");
  }

  const parsed = TurnBodySchema.safeParse(body);
  if (!parsed.success) {
    return sseError(VALIDATION_ERROR);
  }

  const history: AgentChatMessage[] = parsed.data.messages;
  const messages = buildAgentMessages(history);

  let daemonResponse: Response;
  try {
    daemonResponse = await fetch(`${DAEMON_URL}/v1/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER, sessionId: parsed.data.sessionId, messages }),
      signal: request.signal,
    });
  } catch {
    return sseError(`I couldn't reach the assistant engine. Is the Vibe daemon running? (vibe serve at ${DAEMON_URL})`);
  }

  if (!daemonResponse.ok || !daemonResponse.body) {
    const detail = await daemonResponse.text().catch(() => "");
    return sseError(`The assistant engine returned an error (${daemonResponse.status}). ${detail}`.trim());
  }

  // Pass the daemon's SSE stream straight through to the browser.
  return new Response(daemonResponse.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
