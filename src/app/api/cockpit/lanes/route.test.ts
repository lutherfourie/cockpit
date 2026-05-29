import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LaneSummary } from "@/lib/plugins/contract/types";
import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

import { GET } from "./route";

vi.mock("@/lib/plugins/host/get-plugin-host", () => ({
  getPluginHost: vi.fn(),
}));

const getPluginHostMock = vi.mocked(getPluginHost);

const sampleLane = {
  laneId: "sample-feedback-triage",
  pluginId: "vibe",
  name: "Sample feedback triage",
  description: "Map feedback bullets.",
  repoPath: "/tmp/fixtures",
  reads: ["/fixtures/**"],
  owns: ["/outputs/**"],
  target: "codex.local",
  approval: "human.before_commit",
  verify: ["pnpm test"],
  status: "ready",
} satisfies LaneSummary;

type MockHost = {
  listAllLanes(): Promise<unknown>;
};

function mockPluginHost(host: MockHost): void {
  getPluginHostMock.mockResolvedValue(
    host as Awaited<ReturnType<typeof getPluginHost>>,
  );
}

describe("GET /api/cockpit/lanes", () => {
  beforeEach(() => {
    getPluginHostMock.mockReset();
  });

  it("returns validated lanes from the plugin host", async () => {
    mockPluginHost({
      async listAllLanes() {
        return [sampleLane];
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ lanes: [sampleLane] });
  });

  it("returns a stable 502 when the plugin host returns malformed lanes", async () => {
    mockPluginHost({
      async listAllLanes() {
        return [{ ...sampleLane, status: "paused" }];
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Invalid lanes response.",
      code: "INVALID_LANES_RESPONSE",
    });
  });

  it("returns a stable 500 without leaking plugin exception text", async () => {
    mockPluginHost({
      async listAllLanes() {
        throw new Error("private plugin detail");
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Failed to load lanes.",
      code: "LANES_UNAVAILABLE",
    });
  });
});
