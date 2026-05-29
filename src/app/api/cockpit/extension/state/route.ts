import { NextResponse } from "next/server";

import {
  ExtensionStateResponseSchema,
  type CockpitAgentOutput,
} from "@cockpit/contracts";

import { createCockpitMemoryStoreForRequest } from "@/lib/cockpit/auth-store";
import type { SessionState } from "@/lib/cockpit/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedSessionId = searchParams.get("sessionId") ?? undefined;
  const store = await createCockpitMemoryStoreForRequest(request);
  const session = requestedSessionId
    ? await store.loadSessionState(requestedSessionId)
    : await store.loadLatestSessionState();
  const sessionId = session?.id ?? requestedSessionId;
  const parkingLot = store.loadParkingLotItems
    ? await store.loadParkingLotItems(sessionId)
    : [];

  const response = ExtensionStateResponseSchema.parse({
    sessionId,
    output: outputFromSession(session, parkingLot),
    parkingLot,
    persistence: session
      ? { saved: true, source: "supabase" }
      : {
          saved: false,
          source: "none",
          reason: "No authenticated Cockpit session is available yet.",
        },
  });

  return NextResponse.json(response);
}

function outputFromSession(
  session: SessionState | null,
  parkingLot: string[],
): CockpitAgentOutput {
  return {
    currentGoal:
      session?.activeGoal ?? "Capture the next browser thought without expanding scope.",
    nextAction:
      session?.nextAction ??
      "Use the extension to capture a page, park a distraction, or resume one action.",
    proofNeeded:
      session?.proofNeeded ??
      "A captured page, note, or tab set appears in Cockpit.",
    parkingLot,
    assumptions: session ? [] : ["No persisted Cockpit session has been loaded."],
    blockers: [],
  };
}
