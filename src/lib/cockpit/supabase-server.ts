import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function isSupabaseConfigured(): boolean {
  return readSupabasePublicConfig() !== null;
}

export async function createSupabaseServerClient() {
  const config = readSupabasePublicConfig();

  if (!config) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(
    config.url,
    config.publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always set cookies. Route handlers can.
          }
        },
      },
    },
  );
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
