import { describe, expect, it } from "vitest";

import {
  ExtensionCaptureInputSchema,
  ExtensionStateResponseSchema,
  buildCockpitInputFromExtensionCapture,
} from "@cockpit/contracts";

describe("cockpit extension contracts", () => {
  it("requires a meaningful capture source", () => {
    const parsed = ExtensionCaptureInputSchema.safeParse({
      target: "focus",
    });

    expect(parsed.success).toBe(false);
  });

  it("builds a focused cockpit input from page and selection context", () => {
    const input = buildCockpitInputFromExtensionCapture({
      target: "focus",
      sessionId: "00000000-0000-4000-8000-000000000000",
      note: "This is the active debugging thread.",
      page: {
        title: "Vitest failing test",
        url: "https://example.com/failure",
        selection: "expected true to be false",
      },
    });

    expect(input.mode).toBe("focus");
    expect(input.sessionId).toBe("00000000-0000-4000-8000-000000000000");
    expect(input.message).toContain("Browser extension capture");
    expect(input.message).toContain("Target: focus");
    expect(input.message).toContain("Vitest failing test");
    expect(input.message).toContain("expected true to be false");
  });

  it("builds a tab rescue cockpit input without losing tab order", () => {
    const input = buildCockpitInputFromExtensionCapture({
      target: "parking",
      tabs: [
        { title: "Docs", url: "https://example.com/docs" },
        { title: "Issue", url: "https://example.com/issue" },
      ],
    });

    expect(input.mode).toBe("recover");
    expect(input.message).toContain("Tab rescue");
    expect(input.message).toContain("1. Docs - https://example.com/docs");
    expect(input.message).toContain("2. Issue - https://example.com/issue");
  });

  it("parses the state response used by side panel, popup, and new tab", () => {
    const parsed = ExtensionStateResponseSchema.parse({
      sessionId: "00000000-0000-4000-8000-000000000000",
      output: {
        currentGoal: "Ship the extension",
        nextAction: "Load the unpacked extension",
        proofNeeded: "New Tab renders current state",
        parkingLot: ["later"],
        assumptions: [],
        blockers: [],
      },
      parkingLot: ["later"],
      persistence: { saved: true, source: "supabase" },
    });

    expect(parsed.output.currentGoal).toBe("Ship the extension");
    expect(parsed.parkingLot).toEqual(["later"]);
  });
});
