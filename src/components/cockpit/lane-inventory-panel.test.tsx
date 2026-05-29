// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaneInventoryPanel } from "./lane-inventory-panel";

const FIXTURES_ROOT = path.resolve(process.cwd(), "tests/fixtures/lanes");

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

  it("skips malformed lane entries while rendering valid lanes", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          lanes: [
            sampleLane,
            {
              laneId: "bad",
              pluginId: "vibe",
              name: { value: "not renderable" },
              repoPath: "/tmp/fixtures",
              reads: [],
              owns: [],
              status: "ready",
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Lanes (1)");
    expect(container.textContent).toContain("Sample feedback triage");
    expect(container.textContent).not.toContain("bad");
  });

  it("shows a controlled error when the lane API payload has no lanes array", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ lanes: "bad" }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Failed to load lanes: Invalid lane inventory response.",
    );
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

  it("shows a controlled error when the lane API returns malformed JSON like bad.json", async () => {
    const badJson = await readFile(path.join(FIXTURES_ROOT, "bad.json"), "utf8");
    globalThis.fetch = vi.fn(async () =>
      new Response(badJson, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<LaneInventoryPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Failed to load lanes: Invalid lane inventory response.",
    );
  });
});
