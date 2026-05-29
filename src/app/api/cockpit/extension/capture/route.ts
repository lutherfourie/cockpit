import { NextResponse } from "next/server";

import {
  ExtensionCaptureInputSchema,
  buildCockpitInputFromExtensionCapture,
} from "@cockpit/contracts";

import { runCockpitAgent } from "@/lib/cockpit/agent";
import { createCockpitMemoryStoreForRequest } from "@/lib/cockpit/auth-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ExtensionCaptureInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid extension capture input.",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const store = await createCockpitMemoryStoreForRequest(request);
  const input = buildCockpitInputFromExtensionCapture(parsed.data);
  const result = await runCockpitAgent(input, { store });

  return NextResponse.json(result);
}
