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
    expect(state.mode).toBe("auto");
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
    expect(state.mode).toBe("auto");
    expect(state.theme).toBe("dim");
  });

  it("falls back to the full initial state when persisted output has blank required text", () => {
    const state = parseKernelState(
      JSON.stringify({
        output: {
          currentGoal: "   ",
          nextAction: "Continue.",
          proofNeeded: "A passing test.",
          parkingLot: [],
          assumptions: [],
          blockers: [],
        },
        mode: "review",
        theme: "light",
      }),
    );

    expect(state.output.currentGoal).toContain("Capture the next development move");
    expect(state.mode).toBe("auto");
    expect(state.theme).toBe("dim");
  });

  it("creates fresh initial output arrays for each state", () => {
    const first = createInitialKernelState();
    first.output.currentGoal = "Mutated outside the reducer.";
    first.output.parkingLot.push("leaked");
    first.output.assumptions.push("leaked assumption");

    const second = createInitialKernelState();

    expect(second.output.currentGoal).toContain("Capture the next development move");
    expect(second.output.parkingLot).toEqual([]);
    expect(second.output.assumptions).toEqual(["No assistant turn has run yet."]);
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

  it("canonicalizes persisted generated surface variants", () => {
    const emptyState = parseKernelState(
      JSON.stringify({
        generatedSurface: {
          status: "empty",
          reason: 123,
        },
      }),
    );
    const unavailableState = parseKernelState(
      JSON.stringify({
        generatedSurface: {
          status: "unavailable",
          reason: "OpenUI adapter has not run.",
          body: 42,
        },
      }),
    );

    expect(emptyState.generatedSurface).toEqual({ status: "empty" });
    expect(unavailableState.generatedSurface).toEqual({
      status: "unavailable",
      reason: "OpenUI adapter has not run.",
    });
  });

  it("canonicalizes ready generated surface actions", () => {
    const state = parseKernelState(
      JSON.stringify({
        generatedSurface: {
          status: "ready",
          kind: "assistant_note",
          title: "Prompt Mentor",
          body: "Ask for proof before broad refactors.",
          actions: [{ label: "Use", value: "use", extra: "drop me" }],
        },
      }),
    );

    expect(state.generatedSurface).toEqual({
      status: "ready",
      kind: "assistant_note",
      title: "Prompt Mentor",
      body: "Ask for proof before broad refactors.",
      actions: [{ label: "Use", value: "use" }],
    });
  });

  it("keeps parked items beyond the old 5-item limit (no silent drop)", () => {
    let state = createInitialKernelState();

    for (const item of ["one", "two", "three", "four", "five", "six"]) {
      state = reduceKernelState(state, { type: "park", content: item });
    }

    expect(state.output.parkingLot).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
  });

  it("does not park duplicate items", () => {
    let state = createInitialKernelState();
    state = reduceKernelState(state, { type: "park", content: "idea" });
    state = reduceKernelState(state, { type: "park", content: "  idea  " });

    expect(state.output.parkingLot).toEqual(["idea"]);
  });

  it("preserves manually parked items across an assistant turn (setOutput merges, never clobbers)", () => {
    let state = createInitialKernelState();
    state = reduceKernelState(state, { type: "park", content: "browser extension" });
    state = reduceKernelState(state, { type: "park", content: "IFTTT" });

    state = reduceKernelState(state, {
      type: "setOutput",
      output: {
        currentGoal: "Ship the turn route.",
        nextAction: "Wire the daemon.",
        proofNeeded: "Stream events end to end.",
        parkingLot: [],
        assumptions: [],
        blockers: [],
      },
    });

    expect(state.output.parkingLot).toEqual(["browser extension", "IFTTT"]);
  });

  it("unions new model parking items with existing ones, deduped and order-preserving", () => {
    let state = createInitialKernelState();
    state = reduceKernelState(state, { type: "park", content: "browser extension" });

    state = reduceKernelState(state, {
      type: "setOutput",
      output: {
        currentGoal: "Ship the turn route.",
        nextAction: "Wire the daemon.",
        proofNeeded: "Stream events end to end.",
        parkingLot: ["browser extension", "default new-tab page"],
        assumptions: [],
        blockers: [],
      },
    });

    expect(state.output.parkingLot).toEqual([
      "browser extension",
      "default new-tab page",
    ]);
  });

  it("merges hydrated durable parking items with existing ones, deduped and order-preserving", () => {
    let state = createInitialKernelState();
    state = reduceKernelState(state, { type: "park", content: "local idea" });

    state = reduceKernelState(state, {
      type: "hydrateParkingLot",
      items: ["durable idea", "  local idea  ", "another durable"],
    });

    expect(state.output.parkingLot).toEqual([
      "local idea",
      "durable idea",
      "another durable",
    ]);
  });

  it("ignores blank hydrated parking items", () => {
    let state = createInitialKernelState();

    state = reduceKernelState(state, {
      type: "hydrateParkingLot",
      items: ["  ", "real idea", ""],
    });

    expect(state.output.parkingLot).toEqual(["real idea"]);
  });

  it("keeps only the last 20 thought chat messages", () => {
    let state = createInitialKernelState();

    for (let index = 1; index <= 21; index += 1) {
      state = reduceKernelState(state, {
        type: "appendThoughtMessage",
        message: {
          id: `message-${index}`,
          role: index % 2 === 0 ? "assistant" : "user",
          content: `message ${index}`,
          createdAt: "2026-05-17T00:00:00.000Z",
        },
      });
    }

    expect(state.thoughtChat).toHaveLength(20);
    expect(state.thoughtChat[0]?.id).toBe("message-2");
    expect(state.thoughtChat[19]?.id).toBe("message-21");
  });

  it("falls back to the full initial state when persisted thought chat is malformed", () => {
    const state = parseKernelState(
      JSON.stringify({
        theme: "light",
        thoughtChat: [
          {
            id: "message-1",
            role: "assistant",
            content: "valid",
            createdAt: "2026-05-17T00:00:00.000Z",
          },
          {
            id: "message-2",
            role: "assistant",
            createdAt: "2026-05-17T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(state.theme).toBe("dim");
    expect(state.thoughtChat).toEqual([]);
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

  it("tracks assistant workspace state and activity events", () => {
    let state = createInitialKernelState();

    state = reduceKernelState(state, {
      type: "setAssistantWorkspace",
      workspace: {
        isOpen: true,
        activeThreadId: "thread-1",
        selectedEventId: "event-1",
      },
    });
    state = reduceKernelState(state, {
      type: "appendAssistantEvent",
      event: {
        id: "event-1",
        type: "assistant_message",
        role: "assistant",
        content: "Use this as the next Cockpit input.",
        metadata: { source: "test" },
        createdAt: "2026-05-18T06:00:00.000Z",
      },
    });

    expect(state.assistantWorkspace.isOpen).toBe(true);
    expect(state.assistantWorkspace.activeThreadId).toBe("thread-1");
    expect(state.assistantWorkspace.activityFeed).toEqual([
      expect.objectContaining({ id: "event-1", type: "assistant_message" }),
    ]);
  });

  it("keeps only the last 40 assistant activity events", () => {
    let state = createInitialKernelState();

    for (let index = 1; index <= 41; index += 1) {
      state = reduceKernelState(state, {
        type: "appendAssistantEvent",
        event: {
          id: `event-${index}`,
          type: "tool_call",
          content: `event ${index}`,
          metadata: {},
          createdAt: "2026-05-18T06:00:00.000Z",
        },
      });
    }

    expect(state.assistantWorkspace.activityFeed).toHaveLength(40);
    expect(state.assistantWorkspace.activityFeed[0]?.id).toBe("event-2");
    expect(state.assistantWorkspace.activityFeed[39]?.id).toBe("event-41");
  });
});
