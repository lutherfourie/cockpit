import { beforeEach, describe, expect, it, vi } from "vitest";

const thoughtChatMock = vi.hoisted(() => ({
  runThoughtChat: vi.fn(),
}));

vi.mock("@/lib/cockpit/thought-chat", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/cockpit/thought-chat")>();

  return {
    ...actual,
    runThoughtChat: thoughtChatMock.runThoughtChat,
  };
});

vi.mock("@/lib/cockpit/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
}));

import { runThoughtChat } from "@/lib/cockpit/thought-chat";

import { GET, POST } from "./route";

describe("/api/cockpit/assistant route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const actual =
      await vi.importActual<typeof import("@/lib/cockpit/thought-chat")>(
        "@/lib/cockpit/thought-chat",
      );
    thoughtChatMock.runThoughtChat.mockImplementation(actual.runThoughtChat);
  });

  it("loads assistant events as bounded JSON rather than an event stream", async () => {
    const response = await GET(
      new Request("http://localhost/api/cockpit/assistant"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    await expect(response.json()).resolves.toEqual({ events: [] });
  });

  it("returns assistant turn events as bounded JSON", async () => {
    const response = await POST(
      jsonRequest({ message: "I need the next action named." }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");

    const body = (await response.json()) as {
      events?: { type?: string; role?: string; metadata?: Record<string, unknown> }[];
      promoteText?: string;
    };
    expect(body.events).toHaveLength(2);
    expect(body.events?.[0]).toEqual(
      expect.objectContaining({
        type: "user_message",
        role: "user",
        metadata: expect.objectContaining({ persistence: "local" }),
      }),
    );
    expect(body.events?.[1]).toEqual(
      expect.objectContaining({
        type: "assistant_message",
        role: "assistant",
        metadata: expect.objectContaining({ persistence: "local" }),
      }),
    );
    expect(body.promoteText).toContain("Messy thought");
  });

  it("returns a generic 400 when request JSON cannot be parsed", async () => {
    const response = await POST(
      new Request("http://localhost/api/cockpit/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid assistant request input.",
    });
  });

  it("returns a generic 500 when assistant turn execution fails", async () => {
    vi.mocked(runThoughtChat).mockRejectedValueOnce(
      new Error("provider exploded with sensitive details"),
    );

    const response = await POST(jsonRequest({ message: "Help me phrase this." }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Assistant request failed.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/cockpit/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
