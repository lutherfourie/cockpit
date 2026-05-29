// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThoughtChatMessage } from "../../lib/cockpit/kernel-state";
import { ThoughtChatLane } from "./thought-chat-lane";

const history: ThoughtChatMessage[] = [
  {
    id: "history-1",
    role: "assistant",
    content: "I can hold that thread while you sort the next move.",
    createdAt: "2026-05-18T00:00:00.000Z",
  },
];

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ThoughtChatLane", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("stays collapsed until the user opens the bounded chat lane", () => {
    act(() => {
      root.render(
        <ThoughtChatLane
          messages={history}
          onAppendMessage={vi.fn()}
          onPromote={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Assistant / Thought Chat");
    expect(container.textContent).not.toContain(
      "I can hold that thread while you sort the next move.",
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-controls="thought-chat-lane"]',
      )?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("rejects blank phrasing requests without appending or fetching", async () => {
    const onAppendMessage = vi.fn();
    globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;

    act(() => {
      root.render(
        <ThoughtChatLane
          messages={[]}
          onAppendMessage={onAppendMessage}
          onPromote={vi.fn()}
        />,
      );
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="thought-chat-lane"]',
        )
        ?.click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });

    expect(container.textContent).toContain("Add a thought to phrase.");
    expect(onAppendMessage).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends trimmed thought input, appends the assistant response, and promotes returned text", async () => {
    const onAppendMessage = vi.fn();
    const onPromote = vi.fn();
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            message: {
              role: "assistant",
              content: "That sounds tangled, but there is one clear next move.",
            },
            promoteText: "Name the single next move.",
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    act(() => {
      root.render(
        <ThoughtChatLane
          messages={history}
          onAppendMessage={onAppendMessage}
          onPromote={onPromote}
        />,
      );
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="thought-chat-lane"]',
        )
        ?.click();
    });
    act(() => {
      setInputValue(
        container.querySelector<HTMLInputElement>("#thought-chat-input")!,
        "   I have too many possible next steps.   ",
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
      await flushPromises();
    });

    expect(onAppendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: "user",
        content: "I have too many possible next steps.",
      }),
    );
    expect(onAppendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: "assistant",
        content: "That sounds tangled, but there is one clear next move.",
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0]!;
    expect(requestInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      message: "I have too many possible next steps.",
      history: [
        {
          role: "assistant",
          content: "I can hold that thread while you sort the next move.",
        },
      ],
    });

    expect(container.textContent).toContain("Use As Cockpit Input");
    act(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Use As Cockpit Input"))
        ?.click();
    });
    expect(onPromote).toHaveBeenCalledWith("Name the single next move.");
  });

  it("shows a bounded error when the chat route fails", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Assistant unavailable" }), {
        status: 503,
      }),
    ) as unknown as typeof globalThis.fetch;

    act(() => {
      root.render(
        <ThoughtChatLane
          messages={[]}
          onAppendMessage={vi.fn()}
          onPromote={vi.fn()}
        />,
      );
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="thought-chat-lane"]',
        )
        ?.click();
    });
    act(() => {
      setInputValue(
        container.querySelector<HTMLInputElement>("#thought-chat-input")!,
        "Phrase this gently",
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
      await flushPromises();
    });

    expect(container.textContent).toContain("Assistant unavailable");
    expect(container.textContent).not.toContain("Use As Cockpit Input");
  });
});
