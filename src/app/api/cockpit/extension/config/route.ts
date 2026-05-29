import { NextResponse } from "next/server";

import { ExtensionConfigResponseSchema } from "@cockpit/contracts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const response = ExtensionConfigResponseSchema.parse({
    defaultBackendUrl: origin,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    capabilities: {
      sidePanel: true,
      newTab: true,
      tabRescue: true,
      offlineQueue: true,
    },
  });

  return NextResponse.json(response);
}
