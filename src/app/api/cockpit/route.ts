import { NextResponse } from "next/server";

import { runCockpitAgent } from "@/lib/cockpit/agent";
import { createCockpitMemoryStoreForRequest } from "@/lib/cockpit/auth-store";
import { AgentInputSchema } from "@/lib/cockpit/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = AgentInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid cockpit input.",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const store = await createCockpitMemoryStoreForRequest(request);
  const result = await runCockpitAgent(parsed.data, { store });

  return NextResponse.json(result);
}
