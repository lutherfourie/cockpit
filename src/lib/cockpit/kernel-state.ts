import {
  COCKPIT_MODES,
  type CockpitAgentOutput,
  type CockpitMode,
} from "./schema";

export type CockpitTheme = "dim" | "light";

export type ThoughtChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type GeneratedSurface =
  | { status: "empty" }
  | { status: "unavailable"; reason: string }
  | {
      status: "ready";
      kind: "assistant_note" | "prompt_mentor" | "experiment_setup";
      title: string;
      body: string;
      actions?: { label: string; value: string }[];
    };

export type CockpitKernelState = {
  output: CockpitAgentOutput;
  sessionId?: string;
  mode: CockpitMode;
  theme: CockpitTheme;
  generatedSurface: GeneratedSurface;
  thoughtChat: ThoughtChatMessage[];
};

export type KernelAction =
  | { type: "setOutput"; output: CockpitAgentOutput; sessionId?: string }
  | { type: "setMode"; mode: CockpitMode }
  | { type: "setTheme"; theme: CockpitTheme }
  | { type: "park"; content: string }
  | { type: "appendThoughtMessage"; message: ThoughtChatMessage }
  | { type: "setGeneratedSurface"; surface: GeneratedSurface };

export const COCKPIT_STATE_STORAGE_KEY = "cockpit:v1:state";

const MAX_PARKING_ITEMS = 5;
const THEMES = ["dim", "light"] as const;

const INITIAL_OUTPUT: CockpitAgentOutput = {
  currentGoal: "Capture the next development move without expanding the scope.",
  nextAction: "Paste the messy thought, choose a mode, and ask Cockpit to compress it.",
  proofNeeded:
    "The three primary panels update into one coherent, checkable slice.",
  parkingLot: [],
  assumptions: ["No assistant turn has run yet."],
  blockers: [],
};

export function createInitialKernelState(): CockpitKernelState {
  return {
    output: INITIAL_OUTPUT,
    mode: "focus",
    theme: "dim",
    generatedSurface: { status: "empty" },
    thoughtChat: [],
  };
}

export function parseKernelState(rawState: string | null): CockpitKernelState {
  if (!rawState) {
    return createInitialKernelState();
  }

  try {
    const parsed = JSON.parse(rawState) as unknown;
    if (!isRecord(parsed)) {
      return createInitialKernelState();
    }

    const initial = createInitialKernelState();

    if (!isValidPersistedKernelState(parsed)) {
      return initial;
    }

    return {
      output:
        "output" in parsed && isCockpitOutput(parsed.output)
          ? parsed.output
          : initial.output,
      sessionId:
        typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
          ? parsed.sessionId
          : undefined,
      mode:
        "mode" in parsed && isCockpitMode(parsed.mode)
          ? parsed.mode
          : initial.mode,
      theme: "theme" in parsed && isTheme(parsed.theme) ? parsed.theme : initial.theme,
      generatedSurface:
        "generatedSurface" in parsed &&
        isGeneratedSurface(parsed.generatedSurface)
          ? parsed.generatedSurface
          : initial.generatedSurface,
      thoughtChat:
        "thoughtChat" in parsed && Array.isArray(parsed.thoughtChat)
          ? parsed.thoughtChat.slice(-20)
          : initial.thoughtChat,
    };
  } catch {
    return createInitialKernelState();
  }
}

export function serializeKernelState(state: CockpitKernelState): string {
  return JSON.stringify(state);
}

export function reduceKernelState(
  state: CockpitKernelState,
  action: KernelAction,
): CockpitKernelState {
  switch (action.type) {
    case "setOutput":
      return {
        ...state,
        output: action.output,
        sessionId: action.sessionId ?? state.sessionId,
      };
    case "setMode":
      return { ...state, mode: action.mode };
    case "setTheme":
      return { ...state, theme: action.theme };
    case "park": {
      const content = action.content.replace(/\s+/g, " ").trim();
      if (!content) {
        return state;
      }

      return {
        ...state,
        output: {
          ...state.output,
          parkingLot: [...state.output.parkingLot, content].slice(
            -MAX_PARKING_ITEMS,
          ),
        },
      };
    }
    case "appendThoughtMessage":
      return {
        ...state,
        thoughtChat: [...state.thoughtChat, action.message].slice(-20),
      };
    case "setGeneratedSurface":
      return { ...state, generatedSurface: action.surface };
  }
}

export function promoteThoughtMessage(message: ThoughtChatMessage): string {
  return message.content.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCockpitMode(value: unknown): value is CockpitMode {
  return (
    typeof value === "string" &&
    (COCKPIT_MODES as readonly string[]).includes(value)
  );
}

function isTheme(value: unknown): value is CockpitTheme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

function isCockpitOutput(value: unknown): value is CockpitAgentOutput {
  return (
    isRecord(value) &&
    typeof value.currentGoal === "string" &&
    typeof value.nextAction === "string" &&
    typeof value.proofNeeded === "string" &&
    isStringArray(value.parkingLot) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.blockers) &&
    (value.handoff === undefined || typeof value.handoff === "string")
  );
}

function isValidPersistedKernelState(
  value: Record<string, unknown>,
): value is Partial<CockpitKernelState> {
  return (
    (!("output" in value) || isCockpitOutput(value.output)) &&
    (!("sessionId" in value) ||
      (typeof value.sessionId === "string" && value.sessionId.length > 0)) &&
    (!("mode" in value) || isCockpitMode(value.mode)) &&
    (!("theme" in value) || isTheme(value.theme)) &&
    (!("generatedSurface" in value) ||
      isGeneratedSurface(value.generatedSurface)) &&
    (!("thoughtChat" in value) ||
      (Array.isArray(value.thoughtChat) &&
        value.thoughtChat.every(isThoughtChatMessage)))
  );
}

function isThoughtChatMessage(value: unknown): value is ThoughtChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
}

function isGeneratedSurface(value: unknown): value is GeneratedSurface {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === "empty") {
    return true;
  }

  if (value.status === "unavailable") {
    return typeof value.reason === "string";
  }

  return (
    value.status === "ready" &&
    (value.kind === "assistant_note" ||
      value.kind === "prompt_mentor" ||
      value.kind === "experiment_setup") &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    (value.actions === undefined || isGeneratedSurfaceActions(value.actions))
  );
}

function isGeneratedSurfaceActions(
  value: unknown,
): value is { label: string; value: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (action) =>
        isRecord(action) &&
        typeof action.label === "string" &&
        typeof action.value === "string",
    )
  );
}
