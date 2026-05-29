// Self-development surface: lets Cockpit edit its own source by driving the
// Vibe daemon's claude provider against the repo with file-edit permissions.
//
// This is powerful and local-only by design — a running web app that can write
// to its own checkout. It is therefore OFF unless COCKPIT_SELFDEV_ENABLED is
// set, and the working directory + permission mode are fixed SERVER-SIDE. The
// browser supplies only the task text; it can never choose where edits land or
// escalate permissions.
export const runtime = "nodejs";

const DAEMON_URL = process.env.VIBE_DAEMON_URL ?? "http://127.0.0.1:8787";
const SELFDEV_CWD = process.env.COCKPIT_SELFDEV_CWD ?? process.cwd();
const PERMISSION_MODE = process.env.COCKPIT_SELFDEV_PERMISSION_MODE ?? "acceptEdits";
const ENABLED = process.env.COCKPIT_SELFDEV_ENABLED === "1";

const SELFDEV_SYSTEM_PROMPT = `You are Cockpit's self-development agent, running against Cockpit's own source checkout. Make the change the user asks for directly in the repository using your file tools. Read before you edit, keep changes minimal and focused on the request, and follow the conventions already present in the code (including AGENTS.md). When the work is complete, reply with a short summary of exactly what you changed.`;

type TurnBody = {
  task?: string;
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
  if (!ENABLED) {
    return sseError("Self-development is disabled. Set COCKPIT_SELFDEV_ENABLED=1 to allow Cockpit to edit its own source.");
  }

  let parsed: TurnBody;
  try {
    parsed = (await request.json()) as TurnBody;
  } catch {
    return sseError("Could not read the task you sent.");
  }

  const task = typeof parsed.task === "string" ? parsed.task.trim() : "";
  if (!task) {
    return sseError("Describe the change you want Cockpit to make to itself.");
  }

  const messages = [
    { role: "system", content: SELFDEV_SYSTEM_PROMPT },
    { role: "user", content: task },
  ];

  let daemonResponse: Response;
  try {
    daemonResponse = await fetch(`${DAEMON_URL}/v1/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude",
        sessionId: parsed.sessionId,
        cwd: SELFDEV_CWD,
        permissionMode: PERMISSION_MODE,
        messages,
      }),
      signal: request.signal,
    });
  } catch {
    return sseError(`I couldn't reach the self-dev engine. Is the Vibe daemon running? (vibe serve at ${DAEMON_URL})`);
  }

  if (!daemonResponse.ok || !daemonResponse.body) {
    const detail = await daemonResponse.text().catch(() => "");
    return sseError(`The self-dev engine returned an error (${daemonResponse.status}). ${detail}`.trim());
  }

  return new Response(daemonResponse.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
