// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CockpitPanels } from "./cockpit-panels";

const output = {
  currentGoal: "Stabilize the cockpit kernel without an LLM",
  nextAction: "Render the stable panels from structured state",
  proofNeeded: "The current goal, next action, and proof are visible",
  parkingLot: ["Later plugin polish"],
  assumptions: ["Supabase may be unavailable locally"],
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

  it("renders the model-independent stable panels from cockpit output", () => {
    act(() => {
      root.render(<CockpitPanels output={output} />);
    });

    expect(
      container.querySelector('[data-testid="current-goal"]')?.textContent,
    ).toContain("Stabilize the cockpit kernel without an LLM");
    expect(
      container.querySelector('[data-testid="next-action"]')?.textContent,
    ).toContain("Render the stable panels from structured state");
    expect(
      container.querySelector('[data-testid="proof-needed"]')?.textContent,
    ).toContain("The current goal, next action, and proof are visible");
    expect(container.textContent).toContain("Start");
    expect(container.textContent).toContain("Refine");
    expect(container.textContent).toContain("Supabase may be unavailable locally");
  });

  it("omits the assumptions block when there are no assumptions", () => {
    act(() => {
      root.render(<CockpitPanels output={{ ...output, assumptions: [] }} />);
    });

    expect(container.textContent).not.toContain("Assumptions");
    expect(container.textContent).toContain("Next Action");
  });
});
