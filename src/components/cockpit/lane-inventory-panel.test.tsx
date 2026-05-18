// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaneInventoryPanel } from "./lane-inventory-panel";

const sampleLane = {
  laneId: "sample-feedback-triage",
  pluginId: "vibe",
  name: "Sample feedback triage",
  description: "Map feedback bullets.",
  repoPath: "/tmp/fixtures",
  reads: ["/fixtures/**"],
  owns: ["/outputs/**"],
  target: "codex.local",
  approval: "human.before_commit",
  status: "ready" as const,
};

describe("LaneInventoryPanel", () => {
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

  it("renders 'no lanes' when the API returns an empty list", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ lanes: [] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("No lanes discovered");
  });

  it("renders a lane card per discovered lane", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ lanes: [sampleLane] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Sample feedback triage");
    expect(container.textContent).toContain("Map feedback bullets.");
    expect(container.textContent).toContain("codex.local");
  });

  it("shows an error message when the API returns non-200", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    ) as unknown as typeof globalThis.fetch;
    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/failed|error/i);
  });
});
