import { describe, expect, it } from "vitest";

import {
  AgentInputSchema,
  CockpitProviderSchema,
  CockpitTurnResultSchema,
  createFallbackCockpitOutput,
  parseCockpitOutput,
} from "./schema";

describe("cockpit schema", () => {
  it("defaults mode to auto", () => {
    const parsed = AgentInputSchema.parse({ message: "ship this" });
    expect(parsed.mode).toBe("auto");
  });

  it("accepts all configured providers", () => {
    expect(CockpitProviderSchema.parse("local")).toBe("local");
    expect(CockpitProviderSchema.parse("openai")).toBe("openai");
    expect(CockpitProviderSchema.parse("codex")).toBe("codex");
    expect(CockpitProviderSchema.parse("cerebras")).toBe("cerebras");
  });

  it("parses a cockpit turn result with persistence status", () => {
    const parsed = CockpitTurnResultSchema.parse({
      output: {
        currentGoal: "Keep Cockpit useful without models",
        nextAction: "Return a typed turn result",
        proofNeeded: "Route response includes output and persistence",
        parkingLot: [],
        assumptions: [],
        blockers: [],
      },
      sessionId: "00000000-0000-4000-8000-000000000000",
      persistence: { saved: true, source: "supabase" },
    });

    expect(parsed.persistence.source).toBe("supabase");
  });

  it("parses and normalizes structured output", () => {
    const output = parseCockpitOutput({
      currentGoal: "  Build cockpit  ",
      nextAction: "  Run build  ",
      proofNeeded: "  Build passes  ",
      parkingLot: [" later idea "],
      assumptions: [" app exists "],
      blockers: [],
    });

    expect(output.currentGoal).toBe("Build cockpit");
    expect(output.nextAction).toBe("Run build");
    expect(output.parkingLot).toEqual(["later idea"]);
  });

  it("extracts json from fenced model output", () => {
    const output = parseCockpitOutput(`
\`\`\`json
{
  "currentGoal": "Use Codex locally",
  "nextAction": "Select the codex provider",
  "proofNeeded": "A schema-valid response renders",
  "parkingLot": [],
  "handoff": "",
  "assumptions": [],
  "blockers": null
}
\`\`\`
`);

    expect(output.currentGoal).toBe("Use Codex locally");
    expect(output.handoff).toBeUndefined();
    expect(output.blockers).toEqual([]);
  });

  it("creates a bounded fallback", () => {
    const output = createFallbackCockpitOutput({
      message: "Too many things. also docs. also tests.",
      mode: "focus",
      reason: "no model",
    });

    expect(output.currentGoal).toContain("Too many things");
    expect(output.nextAction).toContain("smallest concrete step");
    expect(output.blockers).toEqual(["no model"]);
  });
});
