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
});
