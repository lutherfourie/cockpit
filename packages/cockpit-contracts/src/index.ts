import { z } from "zod";

export const CockpitModeSchema = z.enum([
  "auto",
  "clarify",
  "plan",
  "focus",
  "recover",
  "review",
  "handoff",
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

export const ExtensionCaptureTargetSchema = z.enum([
  "focus",
  "proof",
  "parking",
]);

export const ExtensionCaptureOriginSchema = z.enum([
  "sidepanel",
  "popup",
  "newtab",
  "contextMenu",
  "background",
]);

export const ExtensionPageContextSchema = z.object({
  title: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  selection: z.string().trim().min(1).optional(),
});

export const ExtensionTabContextSchema = z.object({
  title: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1),
});

export const ExtensionCaptureInputSchema = z
  .object({
    target: ExtensionCaptureTargetSchema.default("focus"),
    origin: ExtensionCaptureOriginSchema.default("sidepanel"),
    sessionId: z.string().uuid().optional(),
    note: z.string().trim().min(1).optional(),
    page: ExtensionPageContextSchema.optional(),
    tabs: z.array(ExtensionTabContextSchema).max(100).optional(),
  })
  .superRefine((input, ctx) => {
    const hasPage =
      Boolean(input.page?.title) ||
      Boolean(input.page?.url) ||
      Boolean(input.page?.selection);
    const hasTabs = Boolean(input.tabs && input.tabs.length > 0);
    if (!input.note && !hasPage && !hasTabs) {
      ctx.addIssue({
        code: "custom",
        message: "Capture requires a note, page context, selection, or tabs.",
        path: ["note"],
      });
    }
  });

export const ExtensionConfigResponseSchema = z.object({
  defaultBackendUrl: z.string().trim().min(1),
  supabaseUrl: z.string().trim(),
  supabasePublishableKey: z.string().trim(),
  capabilities: z.object({
    sidePanel: z.boolean(),
    newTab: z.boolean(),
    tabRescue: z.boolean(),
    offlineQueue: z.boolean(),
  }),
});

export const ExtensionStateResponseSchema = z.object({
  sessionId: z.string().uuid().optional(),
  output: CockpitAgentOutputSchema,
  parkingLot: z.array(z.string().trim().min(1)).default([]),
  persistence: CockpitPersistenceSchema,
});

export type CockpitMode = z.infer<typeof CockpitModeSchema>;
export type CockpitAgentOutput = z.infer<typeof CockpitAgentOutputSchema>;
export type CockpitTurnResult = z.infer<typeof CockpitTurnResultSchema>;
export type ExtensionCaptureInput = z.infer<typeof ExtensionCaptureInputSchema>;
export type ExtensionConfigResponse = z.infer<
  typeof ExtensionConfigResponseSchema
>;
export type ExtensionStateResponse = z.infer<
  typeof ExtensionStateResponseSchema
>;

export function buildCockpitInputFromExtensionCapture(
  rawInput: ExtensionCaptureInput,
): {
  message: string;
  mode: CockpitMode;
  sessionId?: string;
} {
  const input = ExtensionCaptureInputSchema.parse(rawInput);
  const sections = [
    "Browser extension capture",
    `Target: ${input.target}`,
    `Origin: ${input.origin}`,
  ];

  if (input.note) {
    sections.push(`Note: ${input.note}`);
  }

  if (input.page) {
    sections.push(
      [
        "Page context:",
        input.page.title ? `Title: ${input.page.title}` : undefined,
        input.page.url ? `URL: ${input.page.url}` : undefined,
        input.page.selection ? `Selection: ${input.page.selection}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (input.tabs?.length) {
    sections.push(
      [
        "Tab rescue:",
        ...input.tabs.map((tab, index) => {
          const title = tab.title?.trim() || "Untitled tab";
          return `${index + 1}. ${title} - ${tab.url}`;
        }),
      ].join("\n"),
    );
  }

  return {
    message: sections.join("\n\n"),
    mode: modeForTarget(input.target),
    sessionId: input.sessionId,
  };
}

function modeForTarget(target: z.infer<typeof ExtensionCaptureTargetSchema>): CockpitMode {
  if (target === "proof") {
    return "review";
  }

  if (target === "parking") {
    return "recover";
  }

  return "focus";
}
