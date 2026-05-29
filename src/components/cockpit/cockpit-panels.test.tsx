// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CockpitPanels } from "./cockpit-panels";

const output = {
  currentGoal: "Ship an accessible cockpit panel pass.",
  nextAction: "Add named regions and keyboard movement.",
  proofNeeded: "A focused component test covers the behavior.",
  parkingLot: [],
  assumptions: ["The local kernel output is enough to render the panels."],
  blockers: [],
};

describe("CockpitPanels", () => {
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

  function renderPanels() {
    act(() => {
      root.render(<CockpitPanels output={output} />);
    });
  }

  it("exposes named regions for the stable cockpit panels", () => {
    renderPanels();

    expect(
      container.querySelector('[role="region"][aria-labelledby="current-goal-heading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[role="region"][aria-labelledby="next-action-heading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[role="region"][aria-labelledby="proof-needed-heading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[role="region"][aria-labelledby="assumptions-heading"]'),
    ).not.toBeNull();
  });

  it("labels action controls without depending on assistant providers", () => {
    renderPanels();

    expect(
      container
        .querySelector('[data-testid="next-action"] button:nth-of-type(1)')
        ?.getAttribute("aria-label"),
    ).toBe("Start next action");
    expect(
      container
        .querySelector('[data-testid="next-action"] button:nth-of-type(2)')
        ?.getAttribute("aria-label"),
    ).toBe("Refine next action");
  });

  it("moves keyboard focus through panel regions with arrow keys", () => {
    renderPanels();
    const currentGoal = container.querySelector<HTMLElement>(
      '[aria-labelledby="current-goal-heading"]',
    );
    const nextAction = container.querySelector<HTMLElement>(
      '[aria-labelledby="next-action-heading"]',
    );
    const assumptions = container.querySelector<HTMLElement>(
      '[aria-labelledby="assumptions-heading"]',
    );

    expect(currentGoal).not.toBeNull();
    expect(nextAction).not.toBeNull();
    expect(assumptions).not.toBeNull();

    currentGoal?.focus();
    expect(document.activeElement).toBe(currentGoal);

    act(() => {
      currentGoal?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(nextAction);

    act(() => {
      nextAction?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(assumptions);
  });
});
