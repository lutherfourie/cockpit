import { createBrowserClient } from "@supabase/ssr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseBrowserClient } from "./supabase-client";

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: vi.fn(() => ({ kind: "browser" })),
}));

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

describe("createSupabaseBrowserClient", () => {
  afterEach(() => {
    restoreSupabaseEnv();
    vi.clearAllMocks();
  });

  it("returns null when public Supabase env is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(createSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("refuses service-role-like keys in browser public env", () => {
    setSupabaseEnv(createJwtWithRole("service_role"));

    expect(createSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("creates a browser client with a public anon key", () => {
    setSupabaseEnv(createJwtWithRole("anon"));

    expect(createSupabaseBrowserClient()).toEqual({ kind: "browser" });
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      expect.any(String),
    );
  });
});

function setSupabaseEnv(key: string) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
}

function restoreSupabaseEnv() {
  restoreEnvValue("NEXT_PUBLIC_SUPABASE_URL", originalSupabaseUrl);
  restoreEnvValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    originalSupabasePublishableKey,
  );
}

function restoreEnvValue(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function createJwtWithRole(role: string): string {
  return [
    encodeJwtPart({ alg: "HS256", typ: "JWT" }),
    encodeJwtPart({ role }),
    "signature",
  ].join(".");
}

function encodeJwtPart(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
