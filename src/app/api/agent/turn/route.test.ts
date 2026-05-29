import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cockpit/assistant-persona", async () => {
  return import("../../../../lib/cockpit/assistant-persona");
});

const VALIDATION_ERROR =
  "Invalid agent turn input. Send 1-24 user/assistant messages under 4000 characters each.";

function requestWithBody(body: unknown) {
  return new Request("http://localhost/api/agent/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readSseEvents(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const line = chunk.split("\n").find((part) => part.startsWith("data:"));
      if (!line) return null;
      return JSON.parse(line.slice("data:".length).trim()) as unknown;
    })
    .filter(Boolean);
}

function daemonSseResponse() {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"kind":"done"}\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("/api/agent/turn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns an SSE validation error instead of filtering malformed messages", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");

    const response = await POST(requestWithBody({ messages: "hello" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await readSseEvents(response)).toEqual([
      { kind: "error", err: VALIDATION_ERROR },
      { kind: "done" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects overlong message content before contacting the daemon", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");

    const response = await POST(
      requestWithBody({
        messages: [{ role: "user", content: "x".repeat(4001) }],
      }),
    );

    expect(await readSseEvents(response)).toEqual([
      { kind: "error", err: VALIDATION_ERROR },
      { kind: "done" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trims validated messages and session id before proxying to the daemon", async () => {
    const fetchMock = vi.fn(async () => daemonSseResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");

    await POST(
      requestWithBody({
        sessionId: " focus-thread ",
        messages: [
          { role: "user", content: " hello " },
          { role: "assistant", content: " hi there " },
          { role: "user", content: " next " },
        ],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8787/v1/turn");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as {
      provider: string;
      sessionId: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.provider).toBe("cerebras");
    expect(body.sessionId).toBe("focus-thread");
    expect(body.messages.slice(1)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "next" },
    ]);
    expect(body.messages[0]?.role).toBe("system");
  });
});
