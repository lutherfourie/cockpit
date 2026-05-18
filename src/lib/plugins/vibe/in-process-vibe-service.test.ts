import { describe, expect, it } from "vitest";
import path from "node:path";

import { InProcessVibeService } from "./in-process-vibe-service";

const FIXTURES_ROOT = path.resolve(process.cwd(), "tests/fixtures");

describe("InProcessVibeService", () => {
  it("listLanes returns lanes found in configured roots", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const lanes = await service.listLanes();
    expect(lanes.length).toBeGreaterThan(0);
    const sample = lanes.find((l) => l.laneId === "sample-feedback-triage");
    expect(sample).toBeDefined();
    expect(sample?.name).toBe("sample-feedback-triage");
    expect(sample?.repoPath).toBe(FIXTURES_ROOT);
    expect(sample?.target).toBe("codex.local");
    expect(sample?.approval).toBe("human.before_commit");
    expect(sample?.reads).toContain("/fixtures/feedback/**");
    expect(sample?.owns).toContain("/outputs/**");
    expect(sample?.status).toBe("ready");
  });

  it("listLanes returns empty when no lanes/ directory in any root", async () => {
    const service = new InProcessVibeService({ repoRoots: [path.resolve(process.cwd(), "node_modules")] });
    const lanes = await service.listLanes();
    expect(lanes).toEqual([]);
  });

  it("listLanes silently skips malformed JSON files (e.g., bad.json) and still returns the valid ones", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const lanes = await service.listLanes();
    // bad.json exists in the fixtures dir but is unparseable. It should be skipped.
    expect(lanes.find((l) => l.laneId === "sample-feedback-triage")).toBeDefined();
    // And no lane summary should have been produced from bad.json.
    expect(lanes.find((l) => l.laneId === "bad")).toBeUndefined();
  });

  it("generateHandoff returns a markdown handoff for codex.cli", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const artifact = await service.generateHandoff(
      "sample-feedback-triage",
      "codex.cli",
    );
    expect(artifact).not.toBeNull();
    expect(artifact?.target).toBe("codex.cli");
    expect(artifact?.format).toBe("markdown");
    expect(artifact?.text).toContain("# Handoff: sample-feedback-triage");
    expect(artifact?.text).toContain("**Target:** codex.cli");
    expect(artifact?.text).toContain("## Read scope");
    expect(artifact?.text).toContain("/fixtures/feedback/**");
    expect(artifact?.text).toContain("## Write scope");
    expect(artifact?.text).toContain("/outputs/**");
    expect(artifact?.text).toContain("sample feedback-triage lane");
    expect(artifact?.recommendedCommand).toBe("codex exec --sandbox read-only -");
  });

  it("generateHandoff sets recommendedCommand per target", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const claude = await service.generateHandoff(
      "sample-feedback-triage",
      "claude.code",
    );
    expect(claude?.recommendedCommand).toBe(
      "claude -p --input-format text --output-format text",
    );

    const human = await service.generateHandoff(
      "sample-feedback-triage",
      "human.review",
    );
    expect(human?.recommendedCommand).toBeUndefined();
  });

  it("generateHandoff returns null for unknown lane", async () => {
    const service = new InProcessVibeService({ repoRoots: [FIXTURES_ROOT] });
    const artifact = await service.generateHandoff(
      "does-not-exist",
      "codex.cli",
    );
    expect(artifact).toBeNull();
  });
});
