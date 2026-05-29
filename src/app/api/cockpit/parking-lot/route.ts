import { NextResponse } from "next/server";
import { z } from "zod";

import { createCockpitMemoryStoreForRequest } from "@/lib/cockpit/auth-store";

export const runtime = "nodejs";

const ParkingLotPostSchema = z.object({
  content: z.string().trim().min(1, "Parking-lot content is required."),
  sessionId: z.string().uuid().optional(),
  source: z.string().trim().min(1).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") ?? undefined;

  const store = await createCockpitMemoryStoreForRequest(request);
  const items = store.loadParkingLotItems
    ? await store.loadParkingLotItems(sessionId)
    : [];

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ParkingLotPostSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid parking-lot item.",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const store = await createCockpitMemoryStoreForRequest(request);
  const result = await store.addParkingLotItem(parsed.data);

  return NextResponse.json(result);
}
