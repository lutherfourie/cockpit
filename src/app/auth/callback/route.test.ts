import { afterEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cockpit/supabase-server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import { GET } from "./route";

describe("auth callback route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects missing codes to a bounded auth status", async () => {
    const response = await GET(new Request("https://cockpit.test/auth/callback"));

    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://cockpit.test/?auth=missing-code",
    );
  });

  it("redirects unconfigured Supabase callbacks without exchanging a code", async () => {
    createSupabaseServerClientMock.mockResolvedValue(null);

    const response = await GET(
      new Request("https://cockpit.test/auth/callback?code=auth-code"),
    );

    expect(createSupabaseServerClientMock).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      "https://cockpit.test/?auth=unconfigured",
    );
  });

  it("redirects exchange failures without leaking the code or provider error", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({
      data: { session: null },
      error: { message: "service_role token leaked by provider" },
    }));
    createSupabaseServerClientMock.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });

    const response = await GET(
      new Request(
        "https://cockpit.test/auth/callback?code=auth-code&error_description=raw-provider-secret",
      ),
    );
    const location = response.headers.get("location") ?? "";

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    expect(location).toBe("https://cockpit.test/?auth=callback-error");
    expect(location).not.toContain("auth-code");
    expect(location).not.toContain("raw-provider-secret");
    expect(location).not.toContain("service_role");
  });

  it("redirects successful exchanges to a bounded signed-in status", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    }));
    createSupabaseServerClientMock.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });

    const response = await GET(
      new Request("https://cockpit.test/auth/callback?code=auth-code"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    expect(response.headers.get("location")).toBe(
      "https://cockpit.test/?auth=signed-in",
    );
  });
});
