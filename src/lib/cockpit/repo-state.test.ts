import { describe, expect, it } from "vitest";

import { summarizeRepoState } from "./repo-state";

describe("repo state", () => {
  it("summarizes this repo without mutating it", async () => {
    const state = await summarizeRepoState(process.cwd());

    expect(state.cwd).toBe(process.cwd());
    expect(state.packageManager).toBe("pnpm");
    expect(state.scripts).toHaveProperty("build");
    expect(Array.isArray(state.dirtyFiles)).toBe(true);
  });
});
