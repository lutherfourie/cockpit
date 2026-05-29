// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratedSurfaceSlot } from "./generated-surface-slot";

const openUiMock = vi.hoisted(() => ({
  renderedSurfaces: [] as unknown[],
  shouldThrow: false,
}));

vi.mock("../../lib/openui/generated-surface-library", () => ({
  GeneratedSurfaceRenderer: ({ surface }: { surface: unknown }) => {
    openUiMock.renderedSurfaces.push(surface);
    if (openUiMock.shouldThrow) {
      throw new Error("OpenUI render failed");
    }

    return <div data-testid="openui-renderer">Rendered OpenUI surface</div>;
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
    openUiMock.renderedSurfaces = [];
    openUiMock.shouldThrow = false;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders the empty state without invoking OpenUI", () => {
    act(() => {
      root.render(<GeneratedSurfaceSlot surface={{ status: "empty" }} />);
    });

    expect(container.textContent).toContain("No generated surface");
    expect(openUiMock.renderedSurfaces).toHaveLength(0);
  });

  it("renders unavailable surfaces without invoking OpenUI", () => {
    act(() => {
      root.render(
        <GeneratedSurfaceSlot
          surface={{
            status: "unavailable",
            reason: "Malformed OpenUI artifact",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Generated Surface Unavailable");
    expect(container.textContent).toContain("Malformed OpenUI artifact");
    expect(openUiMock.renderedSurfaces).toHaveLength(0);
  });

  it("sanitizes unavailable reasons before displaying them", () => {
    act(() => {
      root.render(
        <GeneratedSurfaceSlot
          surface={{
            status: "unavailable",
            reason: `  OpenUI\u0000\nreason ${"x".repeat(400)}  `,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("OpenUI reason");
    expect(container.textContent).not.toContain("\u0000");
    expect(container.textContent).not.toContain("x".repeat(241));
    expect(container.textContent).toContain("...");
  });

  it("keeps ready OpenUI rendering inside the bounded generated slot", () => {
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

    const slot = container.querySelector('[data-testid="generated-surface"]');
    expect(slot?.className).toContain("max-h-80");
    expect(slot?.className).toContain("overflow-auto");
    expect(container.textContent).toContain("Rendered OpenUI surface");
    expect(openUiMock.renderedSurfaces).toHaveLength(1);
  });

  it("degrades only the generated slot when ready OpenUI rendering fails", () => {
    openUiMock.shouldThrow = true;

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
    expect(
      container.querySelector('[data-testid="generated-surface"]'),
    ).not.toBeNull();
  });
});
