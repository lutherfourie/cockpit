"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const config = readSupabasePublicConfig();

  if (!config) {
    return null;
  }

  return createBrowserClient(config.url, config.publishableKey);
}

function readSupabasePublicConfig():
  | { url: string; publishableKey: string }
  | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey || isServiceRoleLikeKey(publishableKey)) {
    return null;
  }

  return { url, publishableKey };
}

function isServiceRoleLikeKey(key: string): boolean {
  const normalized = key.trim();
  const lowered = normalized.toLowerCase();

  return (
    lowered.startsWith("sb_secret_") ||
    lowered.includes("service_role") ||
    readJwtRole(normalized) === "service_role"
  );
}

function readJwtRole(key: string): string | null {
  const [, payload] = key.split(".");

  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  return globalThis.atob(base64);
}
