import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "./supabase-server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ kind: "server" })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

describe("Supabase server client helpers", () => {
  afterEach(() => {
    restoreSupabaseEnv();
    vi.clearAllMocks();
  });

  it("reports unconfigured Supabase when public env is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(isSupabaseConfigured()).toBe(false);
  });

  it("refuses service-role-like keys before reading request cookies", async () => {
    setSupabaseEnv(createJwtWithRole("service_role"));

    await expect(createSupabaseServerClient()).resolves.toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
    expect(cookies).not.toHaveBeenCalled();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("creates a per-request server client with a public anon key", async () => {
    setSupabaseEnv(createJwtWithRole("anon"));

    await expect(createSupabaseServerClient()).resolves.toEqual({ kind: "server" });
    expect(cookies).toHaveBeenCalledOnce();
    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      expect.any(String),
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      }),
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
