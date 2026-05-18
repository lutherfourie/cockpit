// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActivityFeed,
  AssistantCommandCenter,
} from "./assistant-command-center";

const events = [
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
    const onPromote = vi.fn();
    const onPark = vi.fn();
    const onCreateHandoff = vi.fn();

    act(() => {
      root.render(
        <AssistantCommandCenter
          isOpen
          events={events}
          isSubmitting={false}
          runtimeStatus="Local assistant fallback active."
          onClose={vi.fn()}
          onSubmitMessage={vi.fn()}
          onPromote={onPromote}
          onPark={onPark}
          onCreateHandoff={onCreateHandoff}
        />,
      );
    });

    expect(container.textContent).toContain("Assistant Command Center");
    expect(container.textContent).toContain(
      "Treat Assistant as Cockpit's command layer",
    );
    expect(container.textContent).toContain("Use in Cockpit");
    expect(container.textContent).toContain("Park");
    expect(container.textContent).toContain("Handoff");
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
