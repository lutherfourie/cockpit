// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActivityFeed,
  AssistantCommandCenter,
} from "./assistant-command-center";
import type { AssistantEvent } from "@/lib/cockpit/assistant-events";

const events: AssistantEvent[] = [
  {
    id: "event-user",
    type: "user_message" as const,
    role: "user" as const,
    content: "I cannot explain why the chat layout feels wrong.",
    metadata: {},
    createdAt: "2026-05-18T06:00:00.000Z",
  },
  {
    id: "event-assistant",
    type: "assistant_message" as const,
    role: "assistant" as const,
    content: "Treat Assistant as Cockpit's command layer, not a side chat.",
    metadata: { source: "local" },
    createdAt: "2026-05-18T06:01:00.000Z",
  },
];

function dispatchInput(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AssistantCommandCenter", () => {
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
  });

  function renderCommandCenter(
    props: Partial<Parameters<typeof AssistantCommandCenter>[0]> = {},
  ) {
    const handlers = {
      onClose: vi.fn(),
      onSubmitMessage: vi.fn().mockResolvedValue(undefined),
      onPromote: vi.fn(),
      onPark: vi.fn(),
      onCreateHandoff: vi.fn(),
    };

    act(() => {
      root.render(
        <AssistantCommandCenter
          isOpen
          events={events}
          isSubmitting={false}
          runtimeStatus="Local assistant fallback active."
          {...handlers}
          {...props}
        />,
      );
    });

    return handlers;
  }

  it("renders nothing when closed", () => {
    act(() => {
      root.render(
        <AssistantCommandCenter
          isOpen={false}
          events={events}
          isSubmitting={false}
          runtimeStatus="Local assistant fallback active."
          onClose={vi.fn()}
          onSubmitMessage={vi.fn()}
          onPromote={vi.fn()}
          onPark={vi.fn()}
          onCreateHandoff={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toBe("");
  });

  it("renders timeline events and Cockpit promotion actions", () => {
    renderCommandCenter();

    expect(container.textContent).toContain("Assistant Command Center");
    expect(container.textContent).toContain(
      "Treat Assistant as Cockpit's command layer",
    );
    expect(container.textContent).toContain("Use in Cockpit");
    expect(container.textContent).toContain("Park");
    expect(container.textContent).toContain("Handoff");
  });

  it("renders as a modal dialog and closes on Escape", () => {
    const handlers = renderCommandCenter();
    const dialog = container.querySelector('[role="dialog"]');

    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe(
      "assistant-command-center-title",
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("submits trimmed messages and keeps empty drafts disabled", async () => {
    const handlers = renderCommandCenter();
    const textarea = container.querySelector<HTMLTextAreaElement>(
      "#assistant-command-input",
    );
    const form = container.querySelector("form");
    const submitButton = container.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );

    expect(textarea).toBeTruthy();
    expect(form).toBeTruthy();
    expect(submitButton?.disabled).toBe(true);

    act(() => {
      dispatchInput(textarea!, "   ");
    });

    expect(submitButton?.disabled).toBe(true);

    act(() => {
      dispatchInput(textarea!, "  Promote this next move.  ");
    });

    expect(submitButton?.disabled).toBe(false);

    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(handlers.onSubmitMessage).toHaveBeenCalledWith(
      "Promote this next move.",
    );
    expect(textarea?.value).toBe("");
  });

  it("anchors the actions sidebar to the latest actionable output", () => {
    renderCommandCenter({
      events: [
        ...events,
        {
          id: "event-promotion",
          type: "promotion",
          role: "system",
          content: "Already promoted earlier output.",
          metadata: {},
          createdAt: "2026-05-18T06:02:00.000Z",
        },
        {
          id: "event-tool-result",
          type: "tool_result",
          role: "assistant",
          content: "Focused test command failed before loading config.",
          metadata: {},
          createdAt: "not-a-date",
        },
      ],
    });

    const actionPanel = container.querySelector(
      '[data-testid="assistant-action-panel"]',
    );

    expect(actionPanel?.textContent).toContain("Latest actionable output");
    expect(actionPanel?.textContent).toContain(
      "Focused test command failed before loading config.",
    );
    expect(actionPanel?.textContent).toContain("Tool Result");
    expect(actionPanel?.textContent).toContain("Time unknown");
    expect(actionPanel?.textContent).not.toContain(
      "Already promoted earlier output.",
    );
  });

  it("renders an activity feed without chat transcript chrome", () => {
    act(() => {
      root.render(<ActivityFeed events={events} proofNeeded="A passing e2e run." />);
    });

    expect(container.textContent).toContain("Activity");
    expect(container.textContent).toContain("Latest assistant output");
    expect(container.textContent).toContain("A passing e2e run.");
  });
});
