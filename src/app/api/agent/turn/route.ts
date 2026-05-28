import { buildAgentMessages, type AgentChatMessage } from "@/lib/cockpit/assistant-persona";

// Streams a warm assistant turn by proxying the Vibe daemon's /v1/turn SSE.
// The persona system prompt is assembled here (server-side) so it never leaves
// the server; the browser only sends user/assistant history. Provider defaults
// to "cerebras" so the daemon routes through the OpenAI-compatible adapter
// pointed at the user's Cerebras key.
export const runtime = "nodejs";

const DAEMON_URL = process.env.VIBE_DAEMON_URL ?? "http://127.0.0.1:8787";
const PROVIDER = process.env.AGENT_PROVIDER ?? "cerebras";

type TurnBody = {
  messages?: AgentChatMessage[];
  sessionId?: string;
};

function sseError(message: string): Response {
  const body = `data: ${JSON.stringify({ kind: "error", err: message })}\n\ndata: ${JSON.stringify({ kind: "done" })}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let parsed: TurnBody;
  try {
    parsed = (await request.json()) as TurnBody;
  } catch {
    return sseError("Could not read the message you sent.");
  }

  const history = (parsed.messages ?? []).filter(
    (m): m is AgentChatMessage =>
      !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );
  if (history.length === 0) {
    return sseError("There's nothing to respond to yet — say something and I'm here.");
  }

  const messages = buildAgentMessages(history);

  let daemonResponse: Response;
  try {
    daemonResponse = await fetch(`${DAEMON_URL}/v1/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER, sessionId: parsed.sessionId, messages }),
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
