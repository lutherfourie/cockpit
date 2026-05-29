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

import { POST } from "./route";

describe("POST /api/cockpit/chat", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const actual =
      await vi.importActual<typeof import("@/lib/cockpit/thought-chat")>(
        "@/lib/cockpit/thought-chat",
      );
    thoughtChatMock.runThoughtChat.mockImplementation(actual.runThoughtChat);
  });

  it("returns a bounded JSON response instead of opening an event stream", async () => {
    const response = await POST(
      jsonRequest({ message: "I cannot name the mismatch.", history: [] }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");

    const body = (await response.json()) as {
      message?: { role?: string; content?: string };
      promoteText?: string;
    };
    expect(body.message?.role).toBe("assistant");
    expect(body.message?.content).toContain("What feels wrong");
    expect(body.promoteText).toContain("Messy thought");
  });

  it("returns a generic 400 when request JSON cannot be parsed", async () => {
    const response = await POST(
      new Request("http://localhost/api/cockpit/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid thought chat input.",
    });
  });

  it("returns a generic 500 when thought chat execution fails", async () => {
    vi.mocked(runThoughtChat).mockRejectedValueOnce(
      new Error("provider exploded with sensitive details"),
    );

    const response = await POST(jsonRequest({ message: "Help me phrase this." }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Thought chat request failed.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/cockpit/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
