import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { runCockpitAgent } from "../../../lib/cockpit/agent";

vi.mock("../../../lib/cockpit/agent", () => ({
  runCockpitAgent: vi.fn(),
}));

vi.mock("../../../lib/cockpit/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
}));

const SESSION_ID = "00000000-0000-4000-8000-000000000000";

describe("cockpit route", () => {
  beforeEach(() => {
    vi.mocked(runCockpitAgent).mockReset();
  });

  it("returns a stable validation error envelope", async () => {
    const response = await POST(
      jsonRequest({
        message: "",
        mode: "focus",
        sessionId: SESSION_ID,
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "Invalid cockpit input.",
      code: "invalid_cockpit_input",
      issues: [{ path: ["message"], message: "Message is required." }],
      sessionId: SESSION_ID,
      persistence: {
        saved: false,
        source: "none",
        reason: "Input validation failed.",
      },
    });
    expect(runCockpitAgent).not.toHaveBeenCalled();
  });

  it("returns a session id and persistence status when the agent cannot persist", async () => {
    vi.mocked(runCockpitAgent).mockResolvedValue({
      output: {
        currentGoal: "Stabilize the cockpit turn route",
        nextAction: "Return a normalized route envelope",
        proofNeeded: "Route test covers session and persistence fields",
        parkingLot: [],
        assumptions: [],
        blockers: [],
      },
      persistence: {
        saved: false,
        source: "none",
        reason: "Supabase environment variables are not set.",
      },
    });

    const response = await POST(
      jsonRequest({
        message: "tighten the route response",
        mode: "focus",
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(payload.persistence).toEqual({
      saved: false,
      source: "none",
      reason: "Supabase environment variables are not set.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/cockpit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
