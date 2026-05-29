import type { ExtensionCaptureInput } from "@cockpit/contracts";
import { browser } from "wxt/browser";

import { isAuthenticated, loadState, sendCapture, signInWithOtp, signOutSupabase, verifyOtp } from "./api";
import { normalizeTabsForCapture, summarizeQueueStatus } from "./capture";
import type { CaptureActivePagePayload } from "./messages";
import {
  addQueuedCapture,
  createQueuedCapture,
  getNextQueuedCapture,
  markCaptureFailed,
  markCaptureSending,
  removeQueuedCapture,
  type QueuedCapture,
} from "./queue";

const QUEUE_KEY = "cockpit:capture-queue";

export async function getExtensionStatus() {
  const [state, queue, authenticated] = await Promise.all([
    loadState().catch((error) => ({
      error: error instanceof Error ? error.message : "State request failed.",
    })),
    loadQueue(),
    isAuthenticated().catch(() => false),
  ]);

  return {
    state,
    queuedCount: queue.length,
    authenticated,
    status: summarizeQueueStatus({ queuedCount: queue.length, authenticated }),
  };
}

export async function captureActivePage(payload: CaptureActivePagePayload) {
  const page = payload.pageOverride ?? (await readActivePageContext());
  const input: ExtensionCaptureInput = {
    target: payload.target,
    origin: payload.origin,
    sessionId: payload.sessionId,
    note: payload.note,
    page,
  };

  return sendOrQueue(input);
}

export async function rescueCurrentWindowTabs(
  payload: Pick<ExtensionCaptureInput, "target" | "origin" | "note" | "sessionId">,
) {
  const granted = await browser.permissions.request({ permissions: ["tabs"] });
  if (!granted) {
    throw new Error("Tabs permission was not granted.");
  }

  const tabs = await browser.tabs.query({ currentWindow: true });
  return sendOrQueue({
    target: payload.target,
    origin: payload.origin,
    sessionId: payload.sessionId,
    note: payload.note,
    tabs: normalizeTabsForCapture(tabs),
  });
}

export async function signInWithEmail(email: string) {
  await signInWithOtp(email);
  return { sent: true };
}

export async function verifyEmailOtp(email: string, token: string) {
  await verifyOtp(email, token);
  await flushQueue();
  return { verified: true };
}

export async function signOut() {
  await signOutSupabase();
  return { signedOut: true };
}

async function sendOrQueue(input: ExtensionCaptureInput) {
  try {
    const result = await sendCapture(input);
    await flushQueue();
    return { queued: false, result };
  } catch (error) {
    const queue = await loadQueue();
    const capture = createQueuedCapture(input);
    await saveQueue(addQueuedCapture(queue, capture));
    return {
      queued: true,
      error: error instanceof Error ? error.message : "Capture queued.",
    };
  }
}

async function flushQueue() {
  let queue = await loadQueue();
  let next = getNextQueuedCapture(queue);

  while (next) {
    queue = markCaptureSending(queue, next.id);
    await saveQueue(queue);

    try {
      await sendCapture(next.input);
      queue = removeQueuedCapture(await loadQueue(), next.id);
      await saveQueue(queue);
    } catch (error) {
      queue = markCaptureFailed(
        await loadQueue(),
        next.id,
        error instanceof Error ? error.message : "Retry failed.",
      );
      await saveQueue(queue);
      return;
    }

    next = getNextQueuedCapture(queue);
  }
}

async function readActivePageContext(): Promise<ExtensionCaptureInput["page"]> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let selection: string | undefined;

  if (tab.id !== undefined) {
    try {
      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || undefined,
      });
      selection = typeof result?.result === "string" ? result.result : undefined;
    } catch {
      selection = undefined;
    }
  }

  return {
    title: tab.title,
    url: tab.url,
    selection,
  };
}

async function loadQueue(): Promise<QueuedCapture[]> {
  const value = (await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY];
  return Array.isArray(value) ? (value as QueuedCapture[]) : [];
}

async function saveQueue(queue: QueuedCapture[]): Promise<void> {
  await browser.storage.local.set({ [QUEUE_KEY]: queue });
}
