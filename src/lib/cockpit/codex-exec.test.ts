import { writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  CodexExecError,
  runCodexExecCockpit,
  type CodexExecRunner,
} from "./codex-exec";
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
          handoff: null,
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

  it("rejects when the runner exceeds the configured timeout", async () => {
    const runner: CodexExecRunner = vi.fn(
      () => new Promise<never>(() => undefined),
    );

    await expect(runWithRunner(runner, { timeoutMs: 1 })).rejects.toMatchObject({
      code: "timeout",
      message: "codex exec timed out after 1ms",
    });
  });

  it("maps a missing Codex CLI process error to an actionable message", async () => {
    const error = Object.assign(new Error("spawn codex ENOENT"), {
      code: "ENOENT",
    });
    const runner: CodexExecRunner = vi.fn(async () => {
      throw error;
    });

    await expect(runWithRunner(runner)).rejects.toMatchObject({
      code: "cli_not_found",
      message: expect.stringContaining("codex CLI was not found on PATH"),
    });
  });

  it("maps non-zero Codex exits with trimmed stderr context", async () => {
    const runner: CodexExecRunner = vi.fn(async () => ({
      exitCode: 2,
      stdout: "unused stdout",
      stderr: "  permission denied\ncheck auth  ",
    }));

    await expect(runWithRunner(runner)).rejects.toMatchObject({
      code: "exit",
      message: "codex exec exited with code 2: permission denied check auth",
    });
  });

  it("rejects malformed JSON instead of treating it as a successful fallback", async () => {
    const runner: CodexExecRunner = vi.fn(async ({ outputPath }) => {
      await writeFile(outputPath, "{ nope");
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await expect(runWithRunner(runner)).rejects.toMatchObject({
      code: "malformed_json",
      message: expect.stringContaining("codex exec returned malformed JSON"),
    });
  });

  it("rejects schema-invalid JSON with a mapped output error", async () => {
    const runner: CodexExecRunner = vi.fn(async ({ outputPath }) => {
      await writeFile(
        outputPath,
        JSON.stringify({ currentGoal: "Missing fields" }),
      );
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await expect(runWithRunner(runner)).rejects.toMatchObject({
      code: "invalid_output",
      message: expect.stringContaining(
        "codex exec returned JSON outside the cockpit schema",
      ),
    });
  });

  it("exposes provider errors as Error instances", () => {
    expect(new CodexExecError("exit", "failed")).toBeInstanceOf(Error);
  });
});

function runWithRunner(
  runner: CodexExecRunner,
  options: { timeoutMs?: number } = {},
) {
  return runCodexExecCockpit({
    input: {
      message: "use my Codex subscription",
      mode: "focus",
    },
    repoState: createRepoState(),
    options: {
      runner,
      cwd: process.cwd(),
      timeoutMs: options.timeoutMs ?? 10_000,
    },
  });
}

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
