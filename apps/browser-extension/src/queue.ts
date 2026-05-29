import type { ExtensionCaptureInput } from "@cockpit/contracts";

export type QueuedCapture = {
  id: string;
  input: ExtensionCaptureInput;
  status: "queued" | "sending" | "failed";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export function createQueuedCapture(
  input: ExtensionCaptureInput,
  now: Date = new Date(),
): QueuedCapture {
  const timestamp = now.toISOString();
  return {
    id: `capture-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    input,
    status: "queued",
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function addQueuedCapture(
  queue: QueuedCapture[],
  capture: QueuedCapture,
): QueuedCapture[] {
  return [...queue, capture].slice(-50);
}

export function markCaptureSending(
  queue: QueuedCapture[],
  id: string,
  now: Date = new Date(),
): QueuedCapture[] {
  return queue.map((capture) =>
    capture.id === id
      ? {
          ...capture,
          status: "sending",
          attempts: capture.attempts + 1,
          updatedAt: now.toISOString(),
          error: undefined,
        }
      : capture,
  );
}

export function markCaptureFailed(
  queue: QueuedCapture[],
  id: string,
  error: string,
  now: Date = new Date(),
): QueuedCapture[] {
  return queue.map((capture) =>
    capture.id === id
      ? {
          ...capture,
          status: "failed",
          updatedAt: now.toISOString(),
          error,
        }
      : capture,
  );
}

export function removeQueuedCapture(
  queue: QueuedCapture[],
  id: string,
): QueuedCapture[] {
  return queue.filter((capture) => capture.id !== id);
}

export function getNextQueuedCapture(
  queue: QueuedCapture[],
): QueuedCapture | undefined {
  return queue.find((capture) => capture.status === "queued" || capture.status === "failed");
}
