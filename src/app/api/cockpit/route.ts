import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { runCockpitAgent } from "@/lib/cockpit/agent";
import { createCockpitMemoryStoreForRequest } from "@/lib/cockpit/auth-store";
import {
  AgentInputSchema,
  type CockpitPersistence,
  type CockpitTurnResult,
} from "@/lib/cockpit/schema";

export const runtime = "nodejs";

const SessionIdEnvelopeSchema = z.object({
  sessionId: z.string().uuid().optional(),
});

const VALIDATION_PERSISTENCE: CockpitPersistence = {
  saved: false,
  source: "none",
  reason: "Input validation failed.",
};

type ValidationIssue = {
  path: string[];
  message: string;
};

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return validationErrorResponse({
      error: "Invalid JSON body.",
      code: "invalid_json",
      issues: [{ path: [], message: "Request body must be valid JSON." }],
    });
  }

  const parsed = AgentInputSchema.safeParse(body);

  if (!parsed.success) {
    return validationErrorResponse({
      error: "Invalid cockpit input.",
      code: "invalid_cockpit_input",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
      })),
      sessionId: readValidSessionId(body),
    });
  }

  const store = await createCockpitMemoryStoreForRequest(request);
  const result = await runCockpitAgent(parsed.data, { store });

  return NextResponse.json(normalizeTurnResult(result, parsed.data.sessionId));
}

function validationErrorResponse({
  error,
  code,
  issues,
  sessionId,
}: {
  error: string;
  code: "invalid_json" | "invalid_cockpit_input";
  issues: ValidationIssue[];
  sessionId?: string;
}) {
  return NextResponse.json(
    {
      error,
      code,
      issues,
      ...(sessionId ? { sessionId } : {}),
      persistence: VALIDATION_PERSISTENCE,
    },
    { status: 400 },
  );
}

function normalizeTurnResult(
  result: CockpitTurnResult,
  inputSessionId?: string,
): CockpitTurnResult & { sessionId: string } {
  return {
    ...result,
    sessionId: result.sessionId ?? inputSessionId ?? randomUUID(),
    persistence: result.persistence,
  };
}

function readValidSessionId(body: unknown): string | undefined {
  const parsed = SessionIdEnvelopeSchema.safeParse(body);
  return parsed.success ? parsed.data.sessionId : undefined;
}
