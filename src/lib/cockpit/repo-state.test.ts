import { describe, expect, it } from "vitest";

import { parseGitStatusOutput, summarizeRepoState } from "./repo-state";

describe("repo state", () => {
  it("summarizes this repo without mutating it", async () => {
    const state = await summarizeRepoState(process.cwd());

    expect(state.cwd).toBe(process.cwd());
    expect(state.packageManager).toBe("pnpm");
    expect(state.scripts).toHaveProperty("build");
    expect(Array.isArray(state.dirtyFiles)).toBe(true);
  });

  it("reports an unknown branch when git status output is missing", () => {
    const status = parseGitStatusOutput("");

    expect(status.branch).toBe("unknown branch");
    expect(status.dirtyFiles).toEqual([]);
    expect(status.errors).toEqual(["git status produced no output"]);
  });

  it("does not treat a dirty file as the branch when git output lacks a branch line", () => {
    const status = parseGitStatusOutput(" M src/lib/cockpit/repo-state.ts\n?? CODEX_TASK.md\n");

    expect(status.branch).toBe("unknown branch");
    expect(status.dirtyFiles).toEqual([
      "src/lib/cockpit/repo-state.ts",
      "CODEX_TASK.md",
    ]);
    expect(status.errors).toEqual(["git status output missing branch line"]);
  });

  it("ignores unparseable dirty lines while preserving valid git status entries", () => {
    const status = parseGitStatusOutput("## codex/repo-state-robust\nnot git status\n M package.json\n");

    expect(status.branch).toBe("codex/repo-state-robust");
    expect(status.dirtyFiles).toEqual(["package.json"]);
    expect(status.errors).toEqual([
      "git status output contained 1 unparseable line(s)",
    ]);
  });
});
