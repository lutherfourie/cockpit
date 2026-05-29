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
