import { z } from "zod";

export const COCKPIT_MODES = [
  "auto",
  "clarify",
  "plan",
  "focus",
  "recover",
  "review",
  "handoff",
] as const;

const MAX_LIST_ITEMS = 5;
// The parking lot is durable scratch space — capping it at MAX_LIST_ITEMS would
// silently drop ideas the user explicitly chose to keep. Keep a high ceiling so
// items are never lost without intent.
export const MAX_PARKING_LOT_ITEMS = 200;

const OUTPUT_FIELD_DESCRIPTIONS = {
  currentGoal: "The single active goal the cockpit should keep in view.",
  nextAction: "The one concrete next action that moves the active goal forward.",
  proofNeeded: "The evidence that will prove the next action is complete.",
  parkingLot: "Bounded distracting-but-valid ideas that should not become the next action.",
  handoff: "Optional concise prompt for continuing the same goal in another turn or agent.",
  assumptions: "Bounded assumptions that shaped this cockpit state.",
  blockers: "Bounded blockers or missing facts that prevent straightforward progress.",
} as const;

export const CockpitModeSchema = z.enum(COCKPIT_MODES);

export const AgentInputSchema = z.strictObject({
  /** Raw user thought or instruction to compress into cockpit state. */
  message: z
    .string()
    .trim()
    .min(1, "Message is required.")
    .describe("Raw user thought or instruction to compress into cockpit state."),
  /** Optional persisted cockpit session identifier. */
  sessionId: z
    .string()
    .uuid()
    .optional()
    .describe("Optional persisted cockpit session identifier."),
  /** Assistant operating mode for shaping the next cockpit output. */
  mode: CockpitModeSchema.default("auto").describe(
    "Assistant operating mode for shaping the next cockpit output.",
  ),
});

export const CockpitProviderSchema = z.enum([
  "local",
  "openai",
  "codex",
  "cerebras",
]);

export const CockpitAgentOutputSchema = z.strictObject({
  /** The single active goal the cockpit should keep in view. */
  currentGoal: z
    .string()
    .trim()
    .min(1)
    .describe(OUTPUT_FIELD_DESCRIPTIONS.currentGoal),
  /** The one concrete next action that moves the active goal forward. */
  nextAction: z
    .string()
    .trim()
    .min(1)
    .describe(OUTPUT_FIELD_DESCRIPTIONS.nextAction),
  /** The evidence that will prove the next action is complete. */
  proofNeeded: z
    .string()
    .trim()
    .min(1)
    .describe(OUTPUT_FIELD_DESCRIPTIONS.proofNeeded),
  /** Bounded distracting-but-valid ideas that should not become the next action. */
  parkingLot: z
    .array(z.string().trim().min(1))
    .max(MAX_PARKING_LOT_ITEMS)
    .default([])
    .describe(OUTPUT_FIELD_DESCRIPTIONS.parkingLot),
  /** Optional concise prompt for continuing the same goal in another turn or agent. */
  handoff: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(OUTPUT_FIELD_DESCRIPTIONS.handoff),
  /** Bounded assumptions that shaped this cockpit state. */
  assumptions: z
    .array(z.string().trim().min(1))
    .max(MAX_LIST_ITEMS)
    .default([])
    .describe(OUTPUT_FIELD_DESCRIPTIONS.assumptions),
  /** Bounded blockers or missing facts that prevent straightforward progress. */
  blockers: z
    .array(z.string().trim().min(1))
    .max(MAX_LIST_ITEMS)
    .default([])
    .describe(OUTPUT_FIELD_DESCRIPTIONS.blockers),
});

export const CockpitPersistenceSchema = z.strictObject({
  /** Whether this turn was persisted to durable storage. */
  saved: z
    .boolean()
    .describe("Whether this turn was persisted to durable storage."),
  /** Storage backend that handled persistence for this turn. */
  source: z
    .enum(["supabase", "local", "none"])
    .describe("Storage backend that handled persistence for this turn."),
  /** Optional explanation when persistence was skipped or degraded. */
  reason: z
    .string()
    .optional()
    .describe("Optional explanation when persistence was skipped or degraded."),
});

export const CockpitTurnResultSchema = z.strictObject({
  /** Schema-valid cockpit state returned for the current turn. */
  output: CockpitAgentOutputSchema.describe(
    "Schema-valid cockpit state returned for the current turn.",
  ),
  /** Persisted session identifier for the current or resumed cockpit session. */
  sessionId: z
    .string()
    .uuid()
    .optional()
    .describe("Persisted session identifier for the current or resumed cockpit session."),
  /** Persistence status for the current cockpit turn. */
  persistence: CockpitPersistenceSchema.describe(
    "Persistence status for the current cockpit turn.",
  ),
});

export type CockpitMode = z.infer<typeof CockpitModeSchema>;
export type CockpitProvider = z.infer<typeof CockpitProviderSchema>;
export type AgentInput = z.infer<typeof AgentInputSchema>;
export type CockpitAgentOutput = z.infer<typeof CockpitAgentOutputSchema>;
export type CockpitPersistence = z.infer<typeof CockpitPersistenceSchema>;
export type CockpitTurnResult = z.infer<typeof CockpitTurnResultSchema>;

function cleanText(value: string, fallback: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact : fallback;
}

function cleanList(items: string[], max: number = MAX_LIST_ITEMS): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const compact = item.replace(/\s+/g, " ").trim();
    if (!compact || seen.has(compact)) {
      continue;
    }
    seen.add(compact);
    result.push(compact);
    if (result.length >= max) {
      break;
    }
  }
  return result;
}

export function normalizeCockpitOutput(
  output: CockpitAgentOutput,
): CockpitAgentOutput {
  return {
    currentGoal: cleanText(output.currentGoal, "Clarify the current goal."),
    nextAction: cleanText(output.nextAction, "Choose one concrete next action."),
    proofNeeded: cleanText(
      output.proofNeeded,
      "Define the proof that would show progress.",
    ),
    parkingLot: cleanList(output.parkingLot, MAX_PARKING_LOT_ITEMS),
    handoff: output.handoff ? cleanText(output.handoff, "") : undefined,
    assumptions: cleanList(output.assumptions),
    blockers: cleanList(output.blockers),
  };
}

export function parseCockpitOutput(value: unknown): CockpitAgentOutput {
  const candidate = normalizeCandidate(
    typeof value === "string" ? tryParseJson(value) ?? value : value,
  );

  const parsed = CockpitAgentOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return createFallbackCockpitOutput({
      message:
        typeof value === "string"
          ? value
          : "Assistant output could not be parsed.",
      mode: "recover",
      reason: "The assistant returned output outside the cockpit schema.",
    });
  }

  return normalizeCockpitOutput(parsed.data);
}

export function createFallbackCockpitOutput({
  message,
  mode,
  reason,
}: {
  message: string;
  mode: CockpitMode;
  reason?: string;
}): CockpitAgentOutput {
  const compact = cleanText(message, "No input provided.");
  const firstClause = cleanText(
    compact.split(/[\n.?!;]/)[0] ?? compact,
    "Clarify the current development goal.",
  ).slice(0, 160);

  const modeNextAction: Record<CockpitMode, string> = {
    auto: "Do the smallest concrete step that moves the active goal forward.",
    clarify: "Rewrite the messy input as one question the assistant must answer next.",
    plan: "Pick the first repo-visible slice and define the proof for that slice only.",
    focus: "Do the smallest concrete step that moves the active goal forward.",
    recover: "State what is known, what is blocked, and the one restart step.",
    handoff: "Create a short handoff prompt with goal, context, and proof needed.",
    review: "Inspect the changed surface and report the highest-risk issue first.",
  };

  return normalizeCockpitOutput({
    currentGoal: `Stabilize: ${firstClause}`,
    nextAction: modeNextAction[mode],
    proofNeeded:
      "A repo artifact, command result, UI check, or explicit user decision confirms the next action is complete.",
    parkingLot: [],
    handoff:
      mode === "handoff"
        ? `Continue from this goal: ${firstClause}. Keep the next step narrow and report proof.`
        : undefined,
    assumptions: ["Local deterministic fallback was used before live model output."],
    blockers: reason ? [reason] : [],
  });
}

function tryParseJson(value: string): unknown {
  const compact = value.trim();
  const fenced = compact.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) {
    const parsedFence = tryParseJson(fenced);
    if (parsedFence !== undefined) {
      return parsedFence;
    }
  }

  const objectStart = compact.indexOf("{");
  const objectEnd = compact.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    const objectSlice = compact.slice(objectStart, objectEnd + 1);
    try {
      return JSON.parse(objectSlice);
    } catch {
      // Fall through to parsing the whole string.
    }
  }

  try {
    return JSON.parse(compact);
  } catch {
    return undefined;
  }
}

function normalizeCandidate(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const candidate = { ...(value as Record<string, unknown>) };
  if (candidate.handoff === null || candidate.handoff === "") {
    delete candidate.handoff;
  }

  for (const key of ["parkingLot", "assumptions", "blockers"]) {
    if (candidate[key] === null) {
      candidate[key] = [];
    }
  }

  return candidate;
}
