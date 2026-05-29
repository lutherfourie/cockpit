import { browser } from "wxt/browser";

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";

const BACKEND_URL_KEY = "cockpit:backend-url";

export async function getBackendUrl(): Promise<string> {
  const result = await browser.storage.local.get(BACKEND_URL_KEY);
  return normalizeBackendUrl(result[BACKEND_URL_KEY]) ?? DEFAULT_BACKEND_URL;
}

export async function setBackendUrl(value: string): Promise<void> {
  const backendUrl = normalizeBackendUrl(value);
  if (!backendUrl) {
    throw new Error("Backend URL is required.");
  }

  await browser.storage.local.set({ [BACKEND_URL_KEY]: backendUrl });
}

function normalizeBackendUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.replace(/\/+$/, "").trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}
