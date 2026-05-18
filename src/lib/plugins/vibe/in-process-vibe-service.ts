import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type {
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
} from "../contract/types";
import type { VibeService } from "./vibe-service";

const LaneSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  promptFile: z.string().optional(),
  prompt: z.string().optional(),
  defaultUserMessage: z.string().optional(),
  reads: z.array(z.string()).optional(),
  owns: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  target: z.string().optional(),
  approval: z.string().optional(),
  verify: z.array(z.string()).optional(),
});

type LaneSpec = z.infer<typeof LaneSpecSchema>;

interface ResolvedLane {
  laneId: string;
  spec: LaneSpec;
  repoPath: string;
  jsonPath: string;
  promptResolver: () => Promise<string>;
}

export interface InProcessVibeServiceOptions {
  repoRoots: string[];
}

/**
 * Phase 1 implementation. Scans `<root>/lanes/*.json` files. Each lane JSON
 * may reference a sibling `.prompt.md` via `promptFile` (or carry the prompt
 * inline via `prompt`).
 *
 * No file watching yet — `listLanes()` re-scans on every call. Caching and
 * watch-based invalidation land alongside Phase 2 (execution).
 */
export class InProcessVibeService implements VibeService {
  constructor(private readonly options: InProcessVibeServiceOptions) {}

  async listLanes(): Promise<LaneSummary[]> {
    const resolved = await this.discoverAllLanes();
    return resolved.map((r) => this.toSummary(r));
  }

  async generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null> {
    const resolved = await this.discoverAllLanes();
    const lane = resolved.find((r) => r.laneId === laneId);
    if (!lane) return null;
    const prompt = await lane.promptResolver();
    const text = this.formatHandoff(lane, prompt, target);
    return {
      text,
      target,
      format: "markdown",
      recommendedCommand: recommendedCommandFor(target),
    };
  }

  /** Phase 1: no long-lived resources to release. Phase 2 will close watchers here. */
  async dispose(): Promise<void> {
    // no-op for Phase 1
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async discoverAllLanes(): Promise<ResolvedLane[]> {
    const out: ResolvedLane[] = [];
    for (const root of this.options.repoRoots) {
      const lanesDir = path.join(root, "lanes");
      let entries: string[] = [];
      try {
        entries = await fs.readdir(lanesDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const jsonPath = path.join(lanesDir, entry);
        let raw: string;
        try {
          raw = await fs.readFile(jsonPath, "utf8");
        } catch {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        const result = LaneSpecSchema.safeParse(parsed);
        if (!result.success) continue;
        const spec = result.data;
        // laneId is the spec's `name` (matches what toSummary exposes), so
        // `generateHandoff(laneId, ...)` agrees with `listLanes()` output.
        const laneId = spec.name;
        out.push({
          laneId,
          spec,
          repoPath: root,
          jsonPath,
          promptResolver: () => this.resolvePrompt(spec, jsonPath),
        });
      }
    }
    return out;
  }

  private async resolvePrompt(spec: LaneSpec, jsonPath: string): Promise<string> {
    if (spec.prompt) return spec.prompt;
    if (spec.promptFile) {
      const promptPath = path.isAbsolute(spec.promptFile)
        ? spec.promptFile
        : path.join(path.dirname(jsonPath), spec.promptFile);
      try {
        return await fs.readFile(promptPath, "utf8");
      } catch {
        return "(prompt file not found)";
      }
    }
    return "(no prompt defined)";
  }

  private toSummary(lane: ResolvedLane): LaneSummary {
    return {
      laneId: lane.spec.name,
      pluginId: "",
      name: lane.spec.name,
      description: lane.spec.description,
      repoPath: lane.repoPath,
      reads: lane.spec.reads ?? [],
      owns: lane.spec.owns ?? [],
      target: lane.spec.target,
      approval: lane.spec.approval,
      verify: lane.spec.verify,
      status: "ready",
    };
  }

  private formatHandoff(
    lane: ResolvedLane,
    prompt: string,
    target: HandoffTarget,
  ): string {
    const reads = (lane.spec.reads ?? []).map((p) => `- ${p}`).join("\n") || "- (none)";
    const writes = (lane.spec.owns ?? []).map((p) => `- ${p}`).join("\n") || "- (none)";
    const verify =
      (lane.spec.verify ?? []).map((v) => `- ${v}`).join("\n") || "- (none specified)";
    return [
      `# Handoff: ${lane.spec.name}`,
      "",
      `**Target:** ${target}`,
      `**Repo:** ${lane.repoPath}`,
      lane.spec.approval ? `**Approval gate:** ${lane.spec.approval}` : "",
      "",
      "## Task",
      "",
      prompt.trim(),
      "",
      "## Read scope",
      "",
      reads,
      "",
      "## Write scope",
      "",
      writes,
      "",
      "## Verification",
      "",
      verify,
      "",
      "## Instructions",
      "",
      "You are taking over this lane. Stay within the read and write scope. Run the verification commands before declaring complete.",
      "",
    ].join("\n");
  }
}

function recommendedCommandFor(target: HandoffTarget): string | undefined {
  switch (target) {
    case "codex.cli":
      return "codex exec --sandbox read-only -";
    case "claude.code":
      return "claude -p --input-format text --output-format text";
    case "codex.web":
    case "codex.github_pr":
    case "claude.web":
    case "human.review":
      return undefined;
  }
}
