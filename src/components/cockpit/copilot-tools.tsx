"use client";

import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

type CopilotToolBridgeProps = {
  onPromote: (text: string) => void;
  onPark: (text: string) => void;
  onCreateHandoff: (text: string) => void;
  onAttachGeneratedSurface: (surface: {
    title: string;
    body: string;
    kind: "assistant_note" | "prompt_mentor" | "experiment_setup";
  }) => void;
  onCompressToOutput: (output: {
    currentGoal: string;
    nextAction: string;
    proofNeeded: string;
    assumptions?: string[];
    blockers?: string[];
  }) => void;
};

export function CopilotToolBridge({
  onPromote,
  onPark,
  onCreateHandoff,
  onAttachGeneratedSurface,
  onCompressToOutput,
}: CopilotToolBridgeProps) {
  useFrontendTool(
    {
      name: "compressToCockpitOutput",
      description:
        "Update the Cockpit focus loop with a compressed goal, next action, proof requirement, assumptions, and blockers.",
      parameters: z.object({
        currentGoal: z.string().min(1),
        nextAction: z.string().min(1),
        proofNeeded: z.string().min(1),
        assumptions: z.array(z.string().min(1)).optional(),
        blockers: z.array(z.string().min(1)).optional(),
      }),
      handler: async (args) => {
        onCompressToOutput(args);
        return "Cockpit focus loop updated.";
      },
    },
    [onCompressToOutput],
  );

  useFrontendTool(
    {
      name: "promoteToCockpitInput",
      description: "Move useful assistant text into the Cockpit composer.",
      parameters: z.object({
        text: z.string().min(1),
      }),
      handler: async ({ text }) => {
        onPromote(text);
        return "Promoted into Cockpit input.";
      },
    },
    [onPromote],
  );

  useFrontendTool(
    {
      name: "attachGeneratedSurface",
      description:
        "Attach a bounded generated UI or note surface to Cockpit without making it the durable source of truth.",
      parameters: z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        kind: z
          .enum(["assistant_note", "prompt_mentor", "experiment_setup"])
          .default("assistant_note"),
      }),
      handler: async (args) => {
        onAttachGeneratedSurface(args);
        return "Generated surface attached to Cockpit.";
      },
    },
    [onAttachGeneratedSurface],
  );

  useFrontendTool(
    {
      name: "parkAssistantItem",
      description: "Park a valid side idea without making it the active goal.",
      parameters: z.object({
        text: z.string().min(1),
      }),
      handler: async ({ text }) => {
        onPark(text);
        return "Parked in Cockpit.";
      },
    },
    [onPark],
  );

  useFrontendTool(
    {
      name: "createCockpitHandoff",
      description: "Create a handoff draft from assistant context.",
      parameters: z.object({
        text: z.string().min(1),
      }),
      handler: async ({ text }) => {
        onCreateHandoff(text);
        return "Handoff text sent to Cockpit.";
      },
    },
    [onCreateHandoff],
  );

  return null;
}
