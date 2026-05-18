import { NextResponse } from "next/server";

import { getPluginHost } from "@/lib/plugins/host/get-plugin-host";

export async function GET(): Promise<NextResponse> {
  const host = await getPluginHost();
  const lanes = await host.listAllLanes();
  return NextResponse.json({ lanes });
}
