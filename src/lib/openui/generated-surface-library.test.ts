import { describe, expect, it } from "vitest";

import { toGeneratedSurfaceResponse } from "./generated-surface-library";

describe("generated surface OpenUI adapter", () => {
  it("serializes a ready assistant note artifact", () => {
    const response = toGeneratedSurfaceResponse({
      status: "ready",
      kind: "assistant_note",
      title: "Prompt Mentor",
      body: "Ask for proof before broad implementation.",
    });

    expect(response).toContain("root = AssistantNote");
    expect(response).toContain('"Prompt Mentor"');
    expect(response).toContain('"Ask for proof before broad implementation."');
  });

  it("does not serialize empty or unavailable surfaces", () => {
    expect(toGeneratedSurfaceResponse({ status: "empty" })).toBeNull();
    expect(
      toGeneratedSurfaceResponse({
        status: "unavailable",
        reason: "Malformed OpenUI artifact",
      }),
    ).toBeNull();
  });

  it("sanitizes generated text before serializing it for OpenUI", () => {
    const response = toGeneratedSurfaceResponse({
      status: "ready",
      kind: "assistant_note",
      title: "  Prompt\u0000\n\tMentor  ",
      body: `  ${"x".repeat(900)}\u0007  `,
    });

    expect(response).toContain('"Prompt Mentor"');
    expect(response).not.toContain("\u0000");
    expect(response).not.toContain("\u0007");
    expect(response).not.toContain("x".repeat(601));
    expect(response).toContain("...");
  });

  it("keeps the OpenUI artifact rooted to the approved assistant note component", () => {
    const response = toGeneratedSurfaceResponse({
      status: "ready",
      kind: "experiment_setup",
      title: 'Experiment"); root = StablePanel("currentGoal")',
      body: "Use this as an auxiliary note only.",
      actions: [{ label: "Overwrite goal", value: "setOutput" }],
    });

    expect(response?.startsWith("root = AssistantNote(")).toBe(true);
    expect(response).not.toContain("Overwrite goal");
    expect(response).not.toContain("setOutput");
  });

  it("rejects runtime ready surfaces with unapproved kinds", () => {
    expect(
      toGeneratedSurfaceResponse({
        status: "ready",
        kind: "stable_panel",
        title: "Current Goal",
        body: "Move this into the stable panel grid.",
      } as unknown as Parameters<typeof toGeneratedSurfaceResponse>[0]),
    ).toBeNull();
  });
});
