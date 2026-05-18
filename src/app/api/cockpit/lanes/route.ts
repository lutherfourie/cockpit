import { NextResponse } from "next/server";

import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const host = await getPluginHost();
    const lanes = await host.listAllLanes();
    return NextResponse.json({ lanes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load lanes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
