// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratedSurfaceSlot } from "./generated-surface-slot";

vi.mock("../../lib/openui/generated-surface-library", () => ({
  GeneratedSurfaceRenderer: () => {
    throw new Error("OpenUI render failed");
  },
}));

describe("GeneratedSurfaceSlot", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("degrades only the generated slot when ready OpenUI rendering fails", () => {
    act(() => {
      root.render(
        <GeneratedSurfaceSlot
          surface={{
            status: "ready",
            kind: "assistant_note",
            title: "Prompt Mentor",
            body: "Ask for proof before broad implementation.",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Generated Surface Unavailable");
    expect(container.textContent).toContain("OpenUI render failed");
  });
});
