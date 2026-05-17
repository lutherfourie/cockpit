import { writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { runCodexExecCockpit, type CodexExecRunner } from "./codex-exec";
import type { RepoState } from "./repo-state";

describe("codex exec provider", () => {
  it("runs codex exec with read-only sandbox and schema output", async () => {
    const runner: CodexExecRunner = vi.fn(async (request) => {
      await writeFile(
        request.outputPath,
        JSON.stringify({
          currentGoal: "Ship provider abstraction",
          nextAction: "Run the provider unit test",
          proofNeeded: "The mocked Codex output validates against the schema",
          parkingLot: ["Wire Claude later"],
          assumptions: ["Codex CLI auth is already configured"],
          blockers: [],
        }),
      );

      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const output = await runCodexExecCockpit({
      input: {
        message: "use my Codex subscription",
        mode: "focus",
      },
      repoState: createRepoState(),
      options: { runner, cwd: process.cwd(), timeoutMs: 10_000 },
    });

    expect(output.nextAction).toBe("Run the provider unit test");
    expect(runner).toHaveBeenCalledOnce();
    const [request] = vi.mocked(runner).mock.calls[0];
    expect(request.args).toContain("--sandbox");
    expect(request.args).toContain("read-only");
    expect(request.args).toContain("--ignore-rules");
    expect(request.args).toContain("--output-schema");
    expect(request.args.at(-1)).toBe("-");
    expect(request.stdin).toContain("Return only JSON");
  });
});

function createRepoState(): RepoState {
  return {
    cwd: process.cwd(),
    branch: "main",
    dirtyFiles: [],
    packageManager: "pnpm",
    scripts: { test: "vitest run" },
    summary: "main; clean worktree; package manager pnpm",
    errors: [],
  };
}
