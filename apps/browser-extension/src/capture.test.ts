import { describe, expect, it } from "vitest";

import { normalizeTabsForCapture, summarizeQueueStatus } from "./capture";
import {
  addQueuedCapture,
  createQueuedCapture,
  getNextQueuedCapture,
  markCaptureFailed,
  markCaptureSending,
  removeQueuedCapture,
} from "./queue";

describe("extension capture helpers", () => {
  it("normalizes tab rescue input and keeps browser tab order", () => {
    expect(
      normalizeTabsForCapture([
        { title: " Docs  ", url: "https://example.com/docs" },
        { title: "No URL" },
        { url: "https://example.com/issue" },
      ]),
    ).toEqual([
      { title: "Docs", url: "https://example.com/docs" },
      { title: "Untitled tab", url: "https://example.com/issue" },
    ]);
  });

  it("keeps queued captures bounded and retryable", () => {
    const capture = createQueuedCapture(
      { target: "focus", note: "Recover this thread" },
      new Date("2026-05-29T00:00:00.000Z"),
    );
    const queued = addQueuedCapture([], capture);
    const sending = markCaptureSending(
      queued,
      capture.id,
      new Date("2026-05-29T00:00:01.000Z"),
    );
    const failed = markCaptureFailed(
      sending,
      capture.id,
      "offline",
      new Date("2026-05-29T00:00:02.000Z"),
    );

    expect(failed[0]).toMatchObject({
      attempts: 1,
      status: "failed",
      error: "offline",
    });
    expect(getNextQueuedCapture(failed)?.id).toBe(capture.id);
    expect(removeQueuedCapture(failed, capture.id)).toEqual([]);
  });

  it("summarizes auth and queue status for all extension surfaces", () => {
    expect(summarizeQueueStatus({ authenticated: false, queuedCount: 0 })).toBe(
      "Auth required",
    );
    expect(summarizeQueueStatus({ authenticated: true, queuedCount: 2 })).toBe(
      "2 queued",
    );
    expect(summarizeQueueStatus({ authenticated: true, queuedCount: 0 })).toBe(
      "Synced",
    );
  });
});
