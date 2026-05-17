import {
  Agent,
  OpenAIProvider,
  run,
  tool,
  type Model,
  type Tool,
} from "@openai/agents";
import { z } from "zod";

import {
  AgentInputSchema,
  CockpitAgentOutputSchema,
  CockpitProviderSchema,
  createFallbackCockpitOutput,
  normalizeCockpitOutput,
  parseCockpitOutput,
  type CockpitTurnResult,
} from "./schema";
import {
  runCodexExecCockpit,
  type CodexExecRunner,
} from "./codex-exec";
import { summarizeRepoState } from "./repo-state";
import { NullCockpitMemoryStore, type CockpitMemoryStore } from "./storage";

export type RunCockpitAgentOptions = {
  store?: CockpitMemoryStore;
  cwd?: string;
  codexRunner?: CodexExecRunner;
};

type BuildCockpitToolsOptions = {
  includeSessionSaveTool?: boolean;
};

const COCKPIT_INSTRUCTIONS = `
You are the Cockpit coordinator for a personal ADHD development assistant.
Compress messy input into one actionable development step.

Rules:
- Return only the configured structured output.
- Keep nextAction singular and concrete.
- Do not produce a giant task list. Parking lot items are for valid distractions, not the main plan.
- Separate implemented facts, assumptions, blockers, distracting-but-valid ideas, and proof still needed.
- Treat repo-state tool output as read-only evidence.
- Prefer proof that can be checked in the repo, a command result, or a visible UI state.
- For handoff mode, include a concise handoff prompt that another agent can run with.
`.trim();

const COCKPIT_JSON_INSTRUCTIONS = `
${COCKPIT_INSTRUCTIONS}

Return only a JSON object with this exact shape:
{
  "currentGoal": "string",
  "nextAction": "string",
  "proofNeeded": "string",
  "parkingLot": ["string"],
  "handoff": "optional string",
  "assumptions": ["string"],
  "blockers": ["string"]
}
`.trim();

export async function runCockpitAgent(
  rawInput: unknown,
  options: RunCockpitAgentOptions = {},
): Promise<CockpitTurnResult> {
  const input = AgentInputSchema.parse(rawInput);
  const store = options.store ?? new NullCockpitMemoryStore();
  const repoState = await summarizeRepoState(options.cwd);
  const provider = readProvider();

  if (provider === "codex") {
    try {
      const sessionState = await store.loadSessionState(input.sessionId);
      const output = await runCodexExecCockpit({
        input,
        repoState,
        sessionState,
        options: {
          cwd: options.cwd,
          runner: options.codexRunner,
        },
      });
      const saveResult = await store.saveSessionState({
        sessionId: input.sessionId,
        message: input.message,
        output,
      });
      return {
        output,
        sessionId: saveResult.sessionId ?? input.sessionId,
        persistence: createPersistenceResult(saveResult),
      };
    } catch (error) {
      return saveFallback({
        store,
        input,
        reason: `Codex exec failed: ${formatError(error)}`,
      });
    }
  }

  if (provider === "cerebras") {
    if (!process.env.CEREBRAS_API_KEY) {
      return saveFallback({
        store,
        input,
        reason: "CEREBRAS_API_KEY is not set.",
      });
    }

    try {
      const model = await createCerebrasModel();
      return runSdkCockpitAgent({
        input,
        store,
        repoState,
        cwd: options.cwd,
        model,
        structuredOutput: false,
        failurePrefix: "Cerebras agent run failed",
      });
    } catch (error) {
      return saveFallback({
        store,
        input,
        reason: `Cerebras agent run failed: ${formatError(error)}`,
      });
    }
  }

  if (provider === "local" || !process.env.OPENAI_API_KEY) {
    return saveFallback({
      store,
      input,
      reason:
        provider === "local"
          ? "COCKPIT_LLM_PROVIDER is set to local."
          : "OPENAI_API_KEY is not set, so the local fallback handled this turn.",
    });
  }

  return runSdkCockpitAgent({
    input,
    store,
    repoState,
    cwd: options.cwd,
    structuredOutput: true,
    failurePrefix: "Agent run failed",
  });
}

async function runSdkCockpitAgent({
  input,
  store,
  repoState,
  cwd,
  model,
  structuredOutput,
  failurePrefix,
}: {
  input: ReturnType<typeof AgentInputSchema.parse>;
  store: CockpitMemoryStore;
  repoState: Awaited<ReturnType<typeof summarizeRepoState>>;
  cwd?: string;
  model?: Model;
  structuredOutput: boolean;
  failurePrefix: string;
}): Promise<CockpitTurnResult> {
  const agent = structuredOutput
    ? new Agent({
        name: "Cockpit Coordinator",
        instructions: COCKPIT_INSTRUCTIONS,
        outputType: CockpitAgentOutputSchema,
        tools: buildSdkCockpitTools(store, cwd),
        ...(model ? { model } : {}),
      })
    : new Agent({
        name: "Cockpit Coordinator",
        instructions: COCKPIT_JSON_INSTRUCTIONS,
        tools: buildSdkCockpitTools(store, cwd),
        ...(model ? { model } : {}),
      });

  try {
    const result = await run(
      agent,
      JSON.stringify({
        input,
        repoState,
        expectedShape: {
          currentGoal: "string",
          nextAction: "string",
          proofNeeded: "string",
          parkingLot: ["string"],
          handoff: "optional string",
          assumptions: ["string"],
          blockers: ["string"],
        },
      }),
      {
        maxTurns: 4,
      },
    );

    const output = parseCockpitOutput(result.finalOutput);
    const saveResult = await store.saveSessionState({
      sessionId: input.sessionId,
      message: input.message,
      output,
    });
    return {
      output,
      sessionId: saveResult.sessionId ?? input.sessionId,
      persistence: createPersistenceResult(saveResult),
    };
  } catch (error) {
    return saveFallback({
      store,
      input,
      reason: `${failurePrefix}: ${formatError(error)}`,
    });
  }
}

export function buildCockpitTools(
  store: CockpitMemoryStore,
  cwd = process.cwd(),
  options: BuildCockpitToolsOptions = {},
): Tool[] {
  const tools: Tool[] = [
    tool({
      name: "load_session_state",
      description: "Load persisted cockpit state for the active session.",
      parameters: z.object({
        sessionId: z.string().uuid().optional(),
      }),
      execute: async ({ sessionId }) => store.loadSessionState(sessionId),
    }),
    tool({
      name: "add_parking_lot_item",
      description:
        "Save a distracting-but-valid idea without making it the next action.",
      parameters: z.object({
        sessionId: z.string().uuid().optional(),
        content: z.string().min(1),
        source: z.string().optional(),
      }),
      execute: async ({ sessionId, content, source }) =>
        store.addParkingLotItem({ sessionId, content, source }),
    }),
    tool({
      name: "create_handoff",
      description:
        "Create a concise prompt for another agent or a future continuation.",
      parameters: z.object({
        sessionId: z.string().uuid().optional(),
        target: z.string().min(1),
        prompt: z.string().min(1),
      }),
      execute: async ({ sessionId, target, prompt }) =>
        store.createHandoff({ sessionId, target, prompt }),
    }),
    tool({
      name: "summarize_repo_state",
      description:
        "Read-only repo snapshot: branch, dirty files, package manager, and scripts.",
      parameters: z.object({}),
      execute: async () => summarizeRepoState(cwd),
    }),
  ];

  if (options.includeSessionSaveTool ?? true) {
    tools.splice(
      1,
      0,
      tool({
        name: "save_session_state",
        description:
          "Persist the structured cockpit state for the authenticated user.",
        parameters: z.object({
          sessionId: z.string().uuid().optional(),
          message: z.string(),
          output: CockpitAgentOutputSchema,
        }),
        execute: async ({ sessionId, message, output }) =>
          store.saveSessionState({
            sessionId,
            message,
            output: normalizeCockpitOutput(output),
          }),
      }),
    );
  }

  return tools;
}

export function buildSdkCockpitTools(
  store: CockpitMemoryStore,
  cwd = process.cwd(),
): Tool[] {
  return buildCockpitTools(store, cwd, { includeSessionSaveTool: false });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createCerebrasModel(): Promise<Model> {
  const provider = new OpenAIProvider({
    apiKey: process.env.CEREBRAS_API_KEY,
    baseURL: "https://api.cerebras.ai/v1",
    useResponses: false,
  });

  return provider.getModel(process.env.CEREBRAS_MODEL || "zai-glm-4.7");
}

async function saveFallback({
  store,
  input,
  reason,
}: {
  store: CockpitMemoryStore;
  input: ReturnType<typeof AgentInputSchema.parse>;
  reason: string;
}): Promise<CockpitTurnResult> {
  const fallback = createFallbackCockpitOutput({
    message: input.message,
    mode: input.mode,
    reason,
  });
  const saveResult = await store.saveSessionState({
    sessionId: input.sessionId,
    message: input.message,
    output: fallback,
  });
  return {
    output: fallback,
    sessionId: saveResult.sessionId ?? input.sessionId,
    persistence: createPersistenceResult(saveResult),
  };
}

function createPersistenceResult(
  saveResult: Awaited<ReturnType<CockpitMemoryStore["saveSessionState"]>>,
): CockpitTurnResult["persistence"] {
  return {
    saved: saveResult.saved,
    source: saveResult.saved ? "supabase" : "none",
    reason: saveResult.reason,
  };
}

function readProvider() {
  const parsed = CockpitProviderSchema.safeParse(process.env.COCKPIT_LLM_PROVIDER);
  if (parsed.success) {
    return parsed.data;
  }

  return process.env.OPENAI_API_KEY ? "openai" : "local";
}
