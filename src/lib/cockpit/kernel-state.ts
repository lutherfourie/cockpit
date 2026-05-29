import {
  COCKPIT_MODES,
  CockpitAgentOutputSchema,
  MAX_PARKING_LOT_ITEMS,
  normalizeCockpitOutput,
  type CockpitAgentOutput,
  type CockpitMode,
} from "./schema";
import {
  AssistantEventSchema,
  type AssistantEvent,
} from "./assistant-events";

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
  assistantWorkspace: AssistantWorkspaceState;
};

export type AssistantWorkspaceState = {
  isOpen: boolean;
  activeThreadId?: string;
  selectedEventId?: string;
  activityFeed: AssistantEvent[];
};

export type KernelAction =
  | { type: "setOutput"; output: CockpitAgentOutput; sessionId?: string }
  | { type: "setMode"; mode: CockpitMode }
  | { type: "setTheme"; theme: CockpitTheme }
  | { type: "park"; content: string }
  | { type: "hydrateParkingLot"; items: string[] }
  | { type: "appendThoughtMessage"; message: ThoughtChatMessage }
  | { type: "setGeneratedSurface"; surface: GeneratedSurface }
  | {
      type: "setAssistantWorkspace";
      workspace: Partial<Omit<AssistantWorkspaceState, "activityFeed">>;
    }
  | { type: "setAssistantEvents"; events: AssistantEvent[] }
  | { type: "appendAssistantEvent"; event: AssistantEvent };

export const COCKPIT_STATE_STORAGE_KEY = "cockpit:v1:state";

const MAX_ASSISTANT_EVENTS = 40;
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
    output: createInitialOutput(),
    mode: "auto",
    theme: "dim",
    generatedSurface: { status: "empty" },
    thoughtChat: [],
    assistantWorkspace: createInitialAssistantWorkspace(),
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

    const generatedSurface =
      "generatedSurface" in parsed
        ? parseGeneratedSurface(parsed.generatedSurface)
        : undefined;

    return {
      output:
        "output" in parsed
          ? parseCockpitOutput(parsed.output) ?? initial.output
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
        generatedSurface !== undefined ? generatedSurface : initial.generatedSurface,
      thoughtChat:
        "thoughtChat" in parsed && Array.isArray(parsed.thoughtChat)
          ? parsed.thoughtChat.slice(-20)
          : initial.thoughtChat,
      assistantWorkspace:
        "assistantWorkspace" in parsed
          ? parseAssistantWorkspace(parsed.assistantWorkspace) ??
            initial.assistantWorkspace
          : initial.assistantWorkspace,
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
    case "setOutput": {
      const output = parseCockpitOutput(action.output);
      if (!output) {
        return state;
      }

      return {
        ...state,
        output: {
          ...output,
          parkingLot: mergeParkingLot(
            state.output.parkingLot,
            output.parkingLot,
          ),
        },
        sessionId: action.sessionId ?? state.sessionId,
      };
    }
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
          parkingLot: mergeParkingLot(state.output.parkingLot, [content]),
        },
      };
    }
    case "hydrateParkingLot":
      return {
        ...state,
        output: {
          ...state.output,
          parkingLot: mergeParkingLot(state.output.parkingLot, action.items),
        },
      };
    case "appendThoughtMessage":
      return {
        ...state,
        thoughtChat: [...state.thoughtChat, action.message].slice(-20),
      };
    case "setGeneratedSurface":
      return { ...state, generatedSurface: action.surface };
    case "setAssistantWorkspace":
      return {
        ...state,
        assistantWorkspace: {
          ...state.assistantWorkspace,
          ...action.workspace,
          activityFeed: state.assistantWorkspace.activityFeed,
        },
      };
    case "setAssistantEvents":
      return {
        ...state,
        assistantWorkspace: {
          ...state.assistantWorkspace,
          activityFeed: action.events.slice(-MAX_ASSISTANT_EVENTS),
        },
      };
    case "appendAssistantEvent":
      return {
        ...state,
        assistantWorkspace: {
          ...state.assistantWorkspace,
          activityFeed: [
            ...state.assistantWorkspace.activityFeed.filter(
              (event) => event.id !== action.event.id,
            ),
            action.event,
          ].slice(-MAX_ASSISTANT_EVENTS),
        },
      };
  }
}

export function promoteThoughtMessage(message: ThoughtChatMessage): string {
  return message.content.replace(/\s+/g, " ").trim();
}

// Parking-lot items are durable scratch notes the user explicitly chose to keep.
// Assistant turns emit their own parkingLot (often empty), so a reducer must never
// replace the existing list — it unions new items in, deduped and order-preserving,
// so a model turn can add to the lot but can never silently erase it.
function mergeParkingLot(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of [...existing, ...incoming]) {
    const compact = item.replace(/\s+/g, " ").trim();
    if (!compact || seen.has(compact)) {
      continue;
    }
    seen.add(compact);
    result.push(compact);
    if (result.length >= MAX_PARKING_LOT_ITEMS) {
      break;
    }
  }
  return result;
}

function createInitialOutput(): CockpitAgentOutput {
  return {
    ...INITIAL_OUTPUT,
    parkingLot: [...INITIAL_OUTPUT.parkingLot],
    assumptions: [...INITIAL_OUTPUT.assumptions],
    blockers: [...INITIAL_OUTPUT.blockers],
  };
}

function createInitialAssistantWorkspace(): AssistantWorkspaceState {
  return {
    isOpen: false,
    activityFeed: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return parseCockpitOutput(value) !== undefined;
}

function parseCockpitOutput(value: unknown): CockpitAgentOutput | undefined {
  const parsed = CockpitAgentOutputSchema.safeParse(value);
  return parsed.success ? normalizeCockpitOutput(parsed.data) : undefined;
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
      parseGeneratedSurface(value.generatedSurface) !== undefined) &&
    (!("thoughtChat" in value) ||
      (Array.isArray(value.thoughtChat) &&
        value.thoughtChat.every(isThoughtChatMessage))) &&
    (!("assistantWorkspace" in value) ||
      parseAssistantWorkspace(value.assistantWorkspace) !== undefined)
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

function parseGeneratedSurface(value: unknown): GeneratedSurface | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.status === "empty") {
    return { status: "empty" };
  }

  if (value.status === "unavailable") {
    return typeof value.reason === "string"
      ? { status: "unavailable", reason: value.reason }
      : undefined;
  }

  if (
    value.status === "ready" &&
    (value.kind === "assistant_note" ||
      value.kind === "prompt_mentor" ||
      value.kind === "experiment_setup") &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    (value.actions === undefined || isGeneratedSurfaceActions(value.actions))
  ) {
    return {
      status: "ready",
      kind: value.kind,
      title: value.title,
      body: value.body,
      ...(value.actions === undefined
        ? {}
        : {
            actions: value.actions.map((action) => ({
              label: action.label,
              value: action.value,
            })),
          }),
    };
  }

  return undefined;
}

function parseAssistantWorkspace(
  value: unknown,
): AssistantWorkspaceState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.isOpen !== "boolean") {
    return undefined;
  }

  if (
    "activeThreadId" in value &&
    value.activeThreadId !== undefined &&
    typeof value.activeThreadId !== "string"
  ) {
    return undefined;
  }

  if (
    "selectedEventId" in value &&
    value.selectedEventId !== undefined &&
    typeof value.selectedEventId !== "string"
  ) {
    return undefined;
  }

  if (
    "activityFeed" in value &&
    (!Array.isArray(value.activityFeed) ||
      !value.activityFeed.every(
        (event) => AssistantEventSchema.safeParse(event).success,
      ))
  ) {
    return undefined;
  }

  return {
    isOpen: value.isOpen,
    activeThreadId:
      typeof value.activeThreadId === "string" ? value.activeThreadId : undefined,
    selectedEventId:
      typeof value.selectedEventId === "string"
        ? value.selectedEventId
        : undefined,
    activityFeed: Array.isArray(value.activityFeed)
      ? value.activityFeed
          .flatMap((event) => {
            const parsed = AssistantEventSchema.safeParse(event);
            return parsed.success ? [parsed.data] : [];
          })
          .slice(-MAX_ASSISTANT_EVENTS)
      : [],
  };
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
