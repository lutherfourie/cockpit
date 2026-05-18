import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

export const runtime = "nodejs";

const TargetSchema = z.enum([
  "codex.web",
  "codex.cli",
  "codex.github_pr",
  "claude.code",
  "claude.web",
  "human.review",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ laneId: string }> },
): Promise<NextResponse> {
  try {
    const { laneId } = await params;
    const targetParam = request.nextUrl.searchParams.get("target");
    const targetParse = TargetSchema.safeParse(targetParam);
    if (!targetParse.success) {
      return NextResponse.json(
        { error: "invalid or missing ?target=" },
        { status: 400 },
      );
    }
    const host = await getPluginHost();
    const artifact = await host.generateHandoff(laneId, targetParse.data);
    if (!artifact) {
      return NextResponse.json({ error: "lane not found" }, { status: 404 });
    }
    return NextResponse.json({ artifact });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate handoff.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
