import { NextResponse } from "next/server";
import { z } from "zod";

import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

export const runtime = "nodejs";

const LaneSummarySchema = z
  .object({
    laneId: z.string().min(1),
    pluginId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    repoPath: z.string().min(1),
    reads: z.array(z.string()),
    owns: z.array(z.string()),
    target: z.string().optional(),
    approval: z.string().optional(),
    verify: z.array(z.string()).optional(),
    status: z.enum(["ready", "running", "error"]),
    lastRunAt: z.string().optional(),
  })
  .passthrough();

const LanesResponseSchema = z.array(LaneSummarySchema);

export async function GET(): Promise<NextResponse> {
  try {
    const host = await getPluginHost();
    const lanes = await host.listAllLanes();
    const parsed = LanesResponseSchema.safeParse(lanes);

    if (!parsed.success) {
      return errorResponse(
        "Invalid lanes response.",
        "INVALID_LANES_RESPONSE",
        502,
        parsed.error.flatten().fieldErrors,
      );
    }

    return NextResponse.json({ lanes: parsed.data });
  } catch {
    return errorResponse("Failed to load lanes.", "LANES_UNAVAILABLE", 500);
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
