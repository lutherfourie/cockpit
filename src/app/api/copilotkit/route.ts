import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const copilotRuntime = new CopilotRuntime();

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "CopilotKit runtime is installed, but OPENAI_API_KEY is not configured.",
      },
      { status: 503 },
    );
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    serviceAdapter: new OpenAIAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(request);
}

export async function GET() {
  const available = Boolean(process.env.OPENAI_API_KEY);

  return NextResponse.json({
    ok: available,
    adapter: available ? "OpenAIAdapter" : "local-only",
    ...(available
      ? {}
      : {
          reason:
            "OPENAI_API_KEY is not configured. Cockpit assistant local fallback is active.",
        }),
  });
}
