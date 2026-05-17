import { describe, expect, it } from "vitest";

import {
  createInitialKernelState,
  parseKernelState,
  promoteThoughtMessage,
  reduceKernelState,
} from "./kernel-state";

describe("cockpit kernel state", () => {
  it("falls back to a usable initial state when persisted data is invalid", () => {
    const state = parseKernelState("{not json");

    expect(state.output.currentGoal).toContain("Capture the next development move");
    expect(state.mode).toBe("focus");
    expect(state.theme).toBe("dim");
    expect(state.generatedSurface.status).toBe("empty");
  });

  it("falls back to the full initial state when a persisted field is invalid", () => {
    const state = parseKernelState(
      JSON.stringify({
        output: {
          currentGoal: "Keep this only if the whole persisted state is valid.",
          nextAction: "Continue.",
          proofNeeded: "A passing test.",
          parkingLot: ["persisted"],
          assumptions: [],
          blockers: [],
        },
        mode: "invalid-mode",
        theme: "light",
      }),
    );

    expect(state.output.currentGoal).toContain("Capture the next development move");
    expect(state.output.parkingLot).toEqual([]);
    expect(state.mode).toBe("focus");
    expect(state.theme).toBe("dim");
  });

  it("rejects malformed generated surface actions in persisted state", () => {
    const state = parseKernelState(
      JSON.stringify({
        generatedSurface: {
          status: "ready",
          kind: "assistant_note",
          title: "Prompt Mentor",
          body: "Ask for proof before broad refactors.",
          actions: [{ label: "Use it", value: 42 }],
        },
      }),
    );

    expect(state.generatedSurface.status).toBe("empty");
  });

  it("adds parking items without growing beyond the cockpit limit", () => {
    let state = createInitialKernelState();

    for (const item of ["one", "two", "three", "four", "five", "six"]) {
      state = reduceKernelState(state, { type: "park", content: item });
    }

    expect(state.output.parkingLot).toEqual(["two", "three", "four", "five", "six"]);
  });

  it("promotes a thought chat message into cockpit-ready input text", () => {
    const text = promoteThoughtMessage({
      id: "message-1",
      role: "assistant",
      content:
        "  You seem to be trying\n\n  to decide whether   OpenUI owns core state.  ",
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    expect(text).toBe(
      "You seem to be trying to decide whether OpenUI owns core state.",
    );
  });

  it("keeps generated surface separate from durable cockpit output", () => {
    const state = reduceKernelState(createInitialKernelState(), {
      type: "setGeneratedSurface",
      surface: {
        status: "ready",
        kind: "assistant_note",
        title: "Prompt Mentor",
        body: "Ask for proof before broad refactors.",
      },
    });

    expect(state.output.currentGoal).toContain("Capture the next development move");
    expect(state.generatedSurface.status).toBe("ready");
  });
});
