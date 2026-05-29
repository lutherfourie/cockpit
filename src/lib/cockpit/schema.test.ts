import { describe, expect, it } from "vitest";

import outputJsonSchema from "./cockpit-output.schema.json";
import {
  AgentInputSchema,
  CockpitAgentOutputSchema,
  CockpitProviderSchema,
  CockpitTurnResultSchema,
  createFallbackCockpitOutput,
  MAX_PARKING_LOT_ITEMS,
  normalizeCockpitOutput,
  parseCockpitOutput,
} from "./schema";

const VALID_OUTPUT = {
  currentGoal: "Keep Cockpit useful without models",
  nextAction: "Return a typed turn result",
  proofNeeded: "Route response includes output and persistence",
  parkingLot: [],
  assumptions: [],
  blockers: [],
};

const OUTPUT_FIELD_DESCRIPTIONS = {
  currentGoal: "The single active goal the cockpit should keep in view.",
  nextAction: "The one concrete next action that moves the active goal forward.",
  proofNeeded: "The evidence that will prove the next action is complete.",
  parkingLot: "Bounded distracting-but-valid ideas that should not become the next action.",
  handoff: "Optional concise prompt for continuing the same goal in another turn or agent.",
  assumptions: "Bounded assumptions that shaped this cockpit state.",
  blockers: "Bounded blockers or missing facts that prevent straightforward progress.",
} as const;

describe("cockpit schema", () => {
  it("defaults mode to auto and trims the message", () => {
    const parsed = AgentInputSchema.parse({ message: "  ship this  " });
    expect(parsed.mode).toBe("auto");
    expect(parsed.message).toBe("ship this");
  });

  it("rejects malformed agent input", () => {
    const malformedInputs = [
      {},
      { message: "" },
      { message: "   " },
      { message: "ship this", sessionId: "not-a-uuid" },
      { message: "ship this", mode: "wander" },
      { message: "ship this", unexpected: true },
    ];

    for (const input of malformedInputs) {
      expect(AgentInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts all configured providers", () => {
    expect(CockpitProviderSchema.parse("local")).toBe("local");
    expect(CockpitProviderSchema.parse("openai")).toBe("openai");
    expect(CockpitProviderSchema.parse("codex")).toBe("codex");
    expect(CockpitProviderSchema.parse("cerebras")).toBe("cerebras");
    expect(CockpitProviderSchema.safeParse("anthropic").success).toBe(false);
  });

  it("describes every cockpit output field in both schema forms", () => {
    for (const [field, description] of Object.entries(
      OUTPUT_FIELD_DESCRIPTIONS,
    )) {
      const typedField =
        CockpitAgentOutputSchema.shape[
          field as keyof typeof OUTPUT_FIELD_DESCRIPTIONS
        ];
      const jsonField =
        outputJsonSchema.properties[
          field as keyof typeof OUTPUT_FIELD_DESCRIPTIONS
        ];

      expect(typedField.description).toBe(description);
      expect(jsonField.description).toBe(description);
    }
  });

  it("parses a cockpit turn result with persistence status", () => {
    const parsed = CockpitTurnResultSchema.parse({
      output: VALID_OUTPUT,
      sessionId: "00000000-0000-4000-8000-000000000000",
      persistence: { saved: true, source: "supabase" },
    });

    expect(parsed.persistence.source).toBe("supabase");
  });

  it("defaults optional cockpit output lists without changing valid input values", () => {
    const parsed = CockpitAgentOutputSchema.parse({
      currentGoal: "Keep this goal",
      nextAction: "Do one thing",
      proofNeeded: "A visible check",
      handoff: "Continue from this state",
    });

    expect(parsed).toEqual({
      currentGoal: "Keep this goal",
      nextAction: "Do one thing",
      proofNeeded: "A visible check",
      parkingLot: [],
      handoff: "Continue from this state",
      assumptions: [],
      blockers: [],
    });
  });

  it("accepts cockpit output list fields up to the bounded maximum", () => {
    const fiveItems = ["one", "two", "three", "four", "five"];

    const parsed = CockpitAgentOutputSchema.parse({
      ...VALID_OUTPUT,
      parkingLot: fiveItems,
      assumptions: fiveItems,
      blockers: fiveItems,
    });

    expect(parsed.parkingLot).toEqual(fiveItems);
    expect(parsed.assumptions).toEqual(fiveItems);
    expect(parsed.blockers).toEqual(fiveItems);
  });

  it("rejects malformed cockpit output fields", () => {
    const malformedOutputs = [
      { ...VALID_OUTPUT, currentGoal: "" },
      { ...VALID_OUTPUT, currentGoal: "   " },
      { ...VALID_OUTPUT, nextAction: 42 },
      { ...VALID_OUTPUT, proofNeeded: null },
      { ...VALID_OUTPUT, parkingLot: "later" },
      { ...VALID_OUTPUT, parkingLot: [""] },
      { ...VALID_OUTPUT, parkingLot: ["   "] },
      {
        ...VALID_OUTPUT,
        parkingLot: Array.from(
          { length: MAX_PARKING_LOT_ITEMS + 1 },
          (_, i) => `item ${i}`,
        ),
      },
      { ...VALID_OUTPUT, assumptions: [false] },
      { ...VALID_OUTPUT, blockers: ["one", "two", "three", "four", "five", "six"] },
      { ...VALID_OUTPUT, handoff: "" },
      { ...VALID_OUTPUT, handoff: "   " },
      { ...VALID_OUTPUT, extra: "not allowed" },
      { nextAction: "Do one thing", proofNeeded: "A visible check" },
    ];

    for (const output of malformedOutputs) {
      expect(CockpitAgentOutputSchema.safeParse(output).success).toBe(false);
    }
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

  it("falls back for malformed parsed output", () => {
    const malformedOutputs = [
      "not json",
      [],
      { ...VALID_OUTPUT, currentGoal: "" },
      {
        ...VALID_OUTPUT,
        parkingLot: Array.from(
          { length: MAX_PARKING_LOT_ITEMS + 1 },
          (_, i) => `item ${i}`,
        ),
      },
      { ...VALID_OUTPUT, extra: "not allowed" },
    ];

    for (const value of malformedOutputs) {
      const output = parseCockpitOutput(value);

      expect(output.currentGoal).toContain("Stabilize:");
      expect(output.blockers).toEqual([
        "The assistant returned output outside the cockpit schema.",
      ]);
    }
  });

  it("keeps trusted normalization bounded and whitespace-stable", () => {
    const output = normalizeCockpitOutput({
      currentGoal: "  Build\n\ncockpit  ",
      nextAction: "  Run\tone check  ",
      proofNeeded: "  Check\r\npasses  ",
      parkingLot: [" one ", "", " two\nthings ", "three", "four", "five", "six"],
      assumptions: ["  app\texists  "],
      blockers: ["   "],
    });

    expect(output).toEqual({
      currentGoal: "Build cockpit",
      nextAction: "Run one check",
      proofNeeded: "Check passes",
      parkingLot: ["one", "two things", "three", "four", "five", "six"],
      handoff: undefined,
      assumptions: ["app exists"],
      blockers: [],
    });
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

  it("keeps the JSON output schema strict and bounded", () => {
    expect(outputJsonSchema.additionalProperties).toBe(false);
    expect(outputJsonSchema.required).toEqual([
      "currentGoal",
      "nextAction",
      "proofNeeded",
      "parkingLot",
      "handoff",
      "assumptions",
      "blockers",
    ]);

    for (const field of ["currentGoal", "nextAction", "proofNeeded"] as const) {
      expect(outputJsonSchema.properties[field].minLength).toBe(1);
      expect(outputJsonSchema.properties[field].pattern).toBe("\\S");
    }

    expect(outputJsonSchema.properties.parkingLot.maxItems).toBe(
      MAX_PARKING_LOT_ITEMS,
    );
    expect(outputJsonSchema.properties.parkingLot.items.minLength).toBe(1);
    expect(outputJsonSchema.properties.parkingLot.items.pattern).toBe("\\S");

    for (const field of ["assumptions", "blockers"] as const) {
      const property = outputJsonSchema.properties[field];
      expect(property.maxItems).toBe(5);
      expect(property.items.minLength).toBe(1);
      expect(property.items.pattern).toBe("\\S");
    }

    expect(outputJsonSchema.properties.handoff.minLength).toBe(1);
    expect(outputJsonSchema.properties.handoff.pattern).toBe("\\S");
  });
});
