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

export const CockpitModeSchema = z.enum(COCKPIT_MODES);

export const AgentInputSchema = z.object({
  message: z.string().trim().min(1, "Message is required."),
  sessionId: z.string().uuid().optional(),
  mode: CockpitModeSchema.default("auto"),
});

export const CockpitProviderSchema = z.enum([
  "local",
  "openai",
  "codex",
  "cerebras",
]);

export const CockpitAgentOutputSchema = z.object({
  currentGoal: z.string().trim().min(1),
  nextAction: z.string().trim().min(1),
  proofNeeded: z.string().trim().min(1),
  parkingLot: z.array(z.string().trim().min(1)).default([]),
  handoff: z.string().trim().min(1).optional(),
  assumptions: z.array(z.string().trim().min(1)).default([]),
  blockers: z.array(z.string().trim().min(1)).default([]),
});

export const CockpitPersistenceSchema = z.object({
  saved: z.boolean(),
  source: z.enum(["supabase", "local", "none"]),
  reason: z.string().optional(),
});

export const CockpitTurnResultSchema = z.object({
  output: CockpitAgentOutputSchema,
  sessionId: z.string().uuid().optional(),
  persistence: CockpitPersistenceSchema,
});

export type CockpitMode = z.infer<typeof CockpitModeSchema>;
export type CockpitProvider = z.infer<typeof CockpitProviderSchema>;
export type AgentInput = z.infer<typeof AgentInputSchema>;
export type CockpitAgentOutput = z.infer<typeof CockpitAgentOutputSchema>;
export type CockpitPersistence = z.infer<typeof CockpitPersistenceSchema>;
export type CockpitTurnResult = z.infer<typeof CockpitTurnResultSchema>;

const MAX_LIST_ITEMS = 5;
// The parking lot is durable scratch space — capping it at MAX_LIST_ITEMS would
// silently drop ideas the user explicitly chose to keep. Keep a high ceiling so
// items are never lost without intent.
export const MAX_PARKING_LOT_ITEMS = 200;

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
