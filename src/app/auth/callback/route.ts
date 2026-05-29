import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/cockpit/supabase-server";

export const runtime = "nodejs";

type AuthCallbackStatus =
  | "signed-in"
  | "missing-code"
  | "callback-error"
  | "unconfigured";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const hasProviderError =
    requestUrl.searchParams.has("error") ||
    requestUrl.searchParams.has("error_description");

  if (!code) {
    return redirectWithStatus(
      requestUrl,
      hasProviderError ? "callback-error" : "missing-code",
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return redirectWithStatus(requestUrl, "unconfigured");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  return redirectWithStatus(requestUrl, error ? "callback-error" : "signed-in");
}

function redirectWithStatus(requestUrl: URL, status: AuthCallbackStatus) {
  const redirectUrl = new URL("/", requestUrl.origin);
  redirectUrl.searchParams.set("auth", status);
  return NextResponse.redirect(redirectUrl);
}
