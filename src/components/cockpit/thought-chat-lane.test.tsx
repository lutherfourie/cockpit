// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThoughtChatMessage } from "@/lib/cockpit/kernel-state";

import { ThoughtChatLane } from "./thought-chat-lane";

describe("ThoughtChatLane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens existing scratch history but renders only the latest bounded messages", () => {
    const messages = createMessages(8);

    renderLane({ messages });

    expect(getToggleButton().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Latest 6 of 8");
    expect(container.textContent).not.toContain("message 1");
    expect(container.textContent).toContain("message 3");
    expect(container.textContent).toContain("message 8");
  });

  it("bounds the draft and sends only recent history to the chat route", async () => {
    const messages = createMessages(15);
    const pendingResponse = new Promise<Response>(() => {});
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return pendingResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLane({ messages });

    const textarea = getTextarea();
    await inputText(textarea, "x".repeat(650));

    expect(textarea.value).toHaveLength(600);

    await submitForm();

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      message: string;
      history: { role: string; content: string }[];
    };

    expect(body.message).toBe("x".repeat(600));
    expect(body.history).toHaveLength(12);
    expect(body.history[0]).toEqual({
      role: messages[3].role,
      content: messages[3].content,
    });
    expect(body.history.at(-1)).toEqual({
      role: messages[14].role,
      content: messages[14].content,
    });
  });

  it("clears stale promotion while a new phrasing request is pending", async () => {
    let resolveSecondRequest:
      | ((response: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const secondRequest = new Promise<{ ok: boolean; json: () => Promise<unknown> }>(
      (resolve) => {
        resolveSecondRequest = resolve;
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "First phrasing." },
          promoteText: "First promotion.",
        }),
      })
      .mockImplementationOnce(() => secondRequest);
    vi.stubGlobal("fetch", fetchMock);

    renderLane({ messages: [] });
    await click(getToggleButton());

    await inputText(getTextarea(), "first rough thought");
    await submitForm();
    await flushAsyncWork();

    expect(container.textContent).toContain("Use As Cockpit Input");

    await inputText(getTextarea(), "second rough thought");
    await submitForm();

    expect(container.textContent).not.toContain("Use As Cockpit Input");
    expect(getSubmitButton().textContent).toContain("Phrasing");

    resolveSecondRequest?.({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "Second phrasing." },
        promoteText: "Second promotion.",
      }),
    });
    await flushAsyncWork();
  });

  function renderLane(
    props: Partial<ComponentProps<typeof ThoughtChatLane>> = {},
  ) {
    act(() => {
      root.render(
        <ThoughtChatLane
          messages={props.messages ?? []}
          onAppendMessage={props.onAppendMessage ?? vi.fn()}
          onPromote={props.onPromote ?? vi.fn()}
          compact={props.compact}
          testId={props.testId}
        />,
      );
    });
  }

  function getToggleButton() {
    const button = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Assistant / Thought Chat"),
    );

    if (!button) {
      throw new Error("Thought Chat toggle button not found.");
    }

    return button;
  }

  function getSubmitButton() {
    const button = container.querySelector('button[type="submit"]');

    if (!button) {
      throw new Error("Thought Chat submit button not found.");
    }

    return button;
  }

  function getTextarea() {
    const textarea = container.querySelector("textarea");

    if (!textarea) {
      throw new Error("Thought Chat textarea not found.");
    }

    return textarea;
  }

  async function click(button: HTMLButtonElement) {
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function inputText(textarea: HTMLTextAreaElement, value: string) {
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, value);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
  }

  async function submitForm() {
    const form = container.querySelector("form");

    if (!form) {
      throw new Error("Thought Chat form not found.");
    }

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  async function flushAsyncWork() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function createMessages(count: number): ThoughtChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index + 1}`,
    createdAt: `2026-05-18T06:${String(index).padStart(2, "0")}:00.000Z`,
  }));
}
