import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/cockpit/supabase-server";
import {
  NullCockpitMemoryStore,
  SupabaseCockpitMemoryStore,
  type CockpitMemoryStore,
} from "@/lib/cockpit/storage";

export const runtime = "nodejs";

const ParkingLotPostSchema = z.object({
  content: z.string().trim().min(1, "Parking-lot content is required."),
  sessionId: z.string().uuid().optional(),
  source: z.string().trim().min(1).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") ?? undefined;

  const store = await createStore();
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

  const store = await createStore();
  const result = await store.addParkingLotItem(parsed.data);

  return NextResponse.json(result);
}

async function createStore(): Promise<CockpitMemoryStore> {
  if (!isSupabaseConfigured()) {
    return new NullCockpitMemoryStore("Supabase environment variables are not set.");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return new NullCockpitMemoryStore("Supabase server client is unavailable.");
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return new NullCockpitMemoryStore("No authenticated Supabase user is present.");
  }

  return new SupabaseCockpitMemoryStore(supabase, user.id);
}
