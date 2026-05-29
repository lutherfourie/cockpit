import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CockpitTurnResultSchema,
  ExtensionConfigResponseSchema,
  ExtensionStateResponseSchema,
  type CockpitTurnResult,
  type ExtensionCaptureInput,
  type ExtensionConfigResponse,
  type ExtensionStateResponse,
} from "@cockpit/contracts";
import { browser } from "wxt/browser";

import { getBackendUrl } from "./settings";

let cachedClient:
  | {
      backendUrl: string;
      supabaseUrl: string;
      publishableKey: string;
      client: SupabaseClient;
    }
  | undefined;

export async function loadConfig(): Promise<ExtensionConfigResponse> {
  const backendUrl = await getBackendUrl();
  const response = await fetch(`${backendUrl}/api/cockpit/extension/config`);
  if (!response.ok) {
    throw new Error(`Config request failed with ${response.status}.`);
  }

  return ExtensionConfigResponseSchema.parse(await response.json());
}

export async function loadState(): Promise<ExtensionStateResponse> {
  const response = await cockpitFetch("/api/cockpit/extension/state");
  return ExtensionStateResponseSchema.parse(await response.json());
}

export async function sendCapture(
  input: ExtensionCaptureInput,
): Promise<CockpitTurnResult> {
  const response = await cockpitFetch("/api/cockpit/extension/capture", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return CockpitTurnResultSchema.parse(await response.json());
}

export async function signInWithOtp(email: string): Promise<void> {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function verifyOtp(email: string, token: string): Promise<void> {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function signOutSupabase(): Promise<void> {
  const supabase = await getSupabaseClient();
  await supabase.auth.signOut();
}

export async function getAccessToken(): Promise<string | undefined> {
  const supabase = await getOptionalSupabaseClient();
  if (!supabase) {
    return undefined;
  }

  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await getAccessToken());
}

async function cockpitFetch(path: string, init: RequestInit = {}) {
  const backendUrl = await getBackendUrl();
  const token = await getAccessToken();
  const response = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Cockpit request failed with ${response.status}.`);
  }

  return response;
}

async function getSupabaseClient(): Promise<SupabaseClient> {
  const config = await loadConfig();
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error("Cockpit Supabase config is not available.");
  }

  if (
    cachedClient?.backendUrl === config.defaultBackendUrl &&
    cachedClient.supabaseUrl === config.supabaseUrl &&
    cachedClient.publishableKey === config.supabasePublishableKey
  ) {
    return cachedClient.client;
  }

  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage: extensionAuthStorage,
    },
  });

  cachedClient = {
    backendUrl: config.defaultBackendUrl,
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
    client,
  };

  return client;
}

async function getOptionalSupabaseClient(): Promise<SupabaseClient | undefined> {
  try {
    return await getSupabaseClient();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Cockpit Supabase config is not available."
    ) {
      return undefined;
    }

    throw error;
  }
}

const extensionAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const value = (await browser.storage.local.get(key))[key];
    return typeof value === "string" ? value : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};
