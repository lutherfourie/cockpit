// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentPage from "./page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function streamResponse(text: string) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ kind: "text_delta", text })}\n\n`),
        );
        controller.enqueue(encoder.encode('data: {"kind":"done"}\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function waitFor(assertion: () => void) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  throw lastError;
}

describe("AgentPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalFetch = globalThis.fetch;
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("blocks drafts over 4000 characters before fetching", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<AgentPage />);
    });

    const textarea = container.querySelector("textarea");
    const button = container.querySelector("button");
    const form = container.querySelector("form");
    expect(textarea).toBeTruthy();
    expect(button).toBeTruthy();
    expect(form).toBeTruthy();

    await act(async () => {
      setTextareaValue(textarea as HTMLTextAreaElement, "x".repeat(4001));
    });

    expect(container.textContent).toContain("Keep messages under 4000 characters.");
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a bounded recent history window to the turn route", async () => {
    let replyIndex = 0;
    const fetchMock = vi.fn(async () => {
      replyIndex += 1;
      return streamResponse(`reply ${replyIndex}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<AgentPage />);
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const button = container.querySelector("button") as HTMLButtonElement;
    const form = container.querySelector("form") as HTMLFormElement;

    for (let i = 1; i <= 13; i += 1) {
      await act(async () => {
        setTextareaValue(textarea, `message ${i}`);
      });
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await waitFor(() => {
        expect(button.textContent).toBe("Send");
        expect(container.textContent).toContain(`reply ${i}`);
      });
    }

    const lastCall = fetchMock.mock.calls.at(-1) as unknown as
      | [string, RequestInit]
      | undefined;
    expect(lastCall).toBeTruthy();
    const requestBody = JSON.parse(String(lastCall?.[1]?.body)) as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    };

    expect(requestBody.messages.length).toBeLessThanOrEqual(24);
    expect(requestBody.messages[0]?.role).toBe("user");
    expect(requestBody.messages.map((message) => message.content)).not.toContain("message 1");
    expect(requestBody.messages).not.toContainEqual({ role: "assistant", content: "" });
    expect(requestBody.messages.at(-1)).toEqual({ role: "user", content: "message 13" });
  });
});
