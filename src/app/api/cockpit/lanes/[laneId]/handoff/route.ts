import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";
import type { HandoffTarget } from "@/lib/plugins/contract/types";

export const runtime = "nodejs";

const HANDOFF_TARGETS = [
  "codex.web",
  "codex.cli",
  "codex.github_pr",
  "claude.code",
  "claude.web",
  "human.review",
] as const satisfies readonly HandoffTarget[];

const TargetSchema = z.enum(HANDOFF_TARGETS);

const NamespacedLaneIdSchema = z
  .string()
  .trim()
  .min(1, "Lane id is required.")
  .refine((value) => {
    const [pluginId, ...laneIdParts] = value.split(":");
    return pluginId.trim().length > 0 && laneIdParts.join(":").trim().length > 0;
  }, "Lane id must be namespaced as <pluginId>:<laneId>.");

const HandoffRequestSchema = z.object({
  laneId: NamespacedLaneIdSchema,
  target: TargetSchema,
});

const HandoffArtifactSchema = z
  .object({
    text: z.string().refine((value) => value.trim().length > 0, {
      message: "Handoff text is required.",
    }),
    target: TargetSchema,
    format: z.enum(["markdown", "json"]),
    recommendedCommand: z
      .string()
      .refine((value) => value.trim().length > 0, {
        message: "Recommended command cannot be empty.",
      })
      .optional(),
  })
  .passthrough();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ laneId: string }> },
): Promise<NextResponse> {
  try {
    const { laneId } = await params;
    const parsedRequest = HandoffRequestSchema.safeParse({
      laneId,
      target: request.nextUrl.searchParams.get("target"),
    });

    if (!parsedRequest.success) {
      return errorResponse(
        "Invalid handoff request.",
        "INVALID_HANDOFF_REQUEST",
        400,
        parsedRequest.error.flatten().fieldErrors,
      );
    }

    const host = await getPluginHost();
    const artifact = await host.generateHandoff(
      parsedRequest.data.laneId,
      parsedRequest.data.target,
    );

    if (!artifact) {
      return errorResponse("Lane not found.", "LANE_NOT_FOUND", 404);
    }

    const parsedArtifact = HandoffArtifactSchema.safeParse(artifact);
    if (!parsedArtifact.success) {
      return errorResponse(
        "Invalid handoff response.",
        "INVALID_HANDOFF_RESPONSE",
        502,
        parsedArtifact.error.flatten().fieldErrors,
      );
    }

    if (parsedArtifact.data.target !== parsedRequest.data.target) {
      return errorResponse(
        "Invalid handoff response.",
        "INVALID_HANDOFF_RESPONSE",
        502,
        { target: ["Handoff target does not match request target."] },
      );
    }

    return NextResponse.json({ artifact: parsedArtifact.data });
  } catch {
    return errorResponse(
      "Failed to generate handoff.",
      "HANDOFF_UNAVAILABLE",
      500,
    );
  }
}

function errorResponse(
  error: string,
  code: string,
  status: number,
  issues?: unknown,
): NextResponse {
  return NextResponse.json(
    {
      error,
      code,
      ...(issues ? { issues } : {}),
    },
    { status },
  );
}
