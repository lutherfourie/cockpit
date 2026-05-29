import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HandoffArtifact } from "@/lib/plugins/contract/types";
import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

import { GET } from "./route";

vi.mock("@/lib/plugins/host/get-plugin-host", () => ({
  getPluginHost: vi.fn(),
}));

const getPluginHostMock = vi.mocked(getPluginHost);

const sampleArtifact = {
  text: "# Handoff: sample-feedback-triage",
  target: "claude.code",
  format: "markdown",
  recommendedCommand: "claude -p --input-format text --output-format text",
} satisfies HandoffArtifact;

type MockHost = {
  generateHandoff(laneId: string, target: string): Promise<unknown>;
};

function mockPluginHost(host: MockHost): void {
  getPluginHostMock.mockResolvedValue(
    host as Awaited<ReturnType<typeof getPluginHost>>,
  );
}

function requestFor(target?: string): NextRequest {
  const url = new URL(
    "http://localhost/api/cockpit/lanes/vibe%3Asample-feedback-triage/handoff",
  );
  if (target !== undefined) {
    url.searchParams.set("target", target);
  }
  return { nextUrl: url } as NextRequest;
}

function contextFor(laneId: string) {
  return { params: Promise.resolve({ laneId }) };
}

describe("GET /api/cockpit/lanes/[laneId]/handoff", () => {
  beforeEach(() => {
    getPluginHostMock.mockReset();
  });

  it("returns a validated handoff artifact for a namespaced lane id and target", async () => {
    const generateHandoff = vi.fn(async () => sampleArtifact);
    mockPluginHost({ generateHandoff });

    const response = await GET(
      requestFor("claude.code"),
      contextFor("vibe:sample-feedback-triage"),
    );

    expect(generateHandoff).toHaveBeenCalledWith(
      "vibe:sample-feedback-triage",
      "claude.code",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ artifact: sampleArtifact });
  });

  it("returns a stable 400 when target is missing", async () => {
    const response = await GET(
      requestFor(),
      contextFor("vibe:sample-feedback-triage"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid handoff request.",
      code: "INVALID_HANDOFF_REQUEST",
    });
    expect(getPluginHostMock).not.toHaveBeenCalled();
  });

  it("returns a stable 400 when lane id is not plugin-prefixed", async () => {
    const response = await GET(requestFor("codex.cli"), contextFor("lane-only"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid handoff request.",
      code: "INVALID_HANDOFF_REQUEST",
    });
    expect(getPluginHostMock).not.toHaveBeenCalled();
  });

  it("returns a stable 404 when the lane is unknown", async () => {
    mockPluginHost({
      async generateHandoff() {
        return null;
      },
    });

    const response = await GET(
      requestFor("codex.cli"),
      contextFor("vibe:missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Lane not found.",
      code: "LANE_NOT_FOUND",
    });
  });

  it("returns a stable 502 when the plugin returns a malformed handoff artifact", async () => {
    mockPluginHost({
      async generateHandoff() {
        return { ...sampleArtifact, text: "" };
      },
    });

    const response = await GET(
      requestFor("claude.code"),
      contextFor("vibe:sample-feedback-triage"),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Invalid handoff response.",
      code: "INVALID_HANDOFF_RESPONSE",
    });
  });

  it("returns a stable 500 without leaking plugin exception text", async () => {
    mockPluginHost({
      async generateHandoff() {
        throw new Error("private handoff detail");
      },
    });

    const response = await GET(
      requestFor("codex.cli"),
      contextFor("vibe:sample-feedback-triage"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to generate handoff.",
      code: "HANDOFF_UNAVAILABLE",
    });
  });
});
