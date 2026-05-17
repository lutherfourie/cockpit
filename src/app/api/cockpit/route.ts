import { NextResponse } from "next/server";

import { runCockpitAgent } from "@/lib/cockpit/agent";
import { AgentInputSchema } from "@/lib/cockpit/schema";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/cockpit/supabase-server";
import {
  NullCockpitMemoryStore,
  SupabaseCockpitMemoryStore,
} from "@/lib/cockpit/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = AgentInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid cockpit input.",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const store = await createStore();
  const result = await runCockpitAgent(parsed.data, { store });

  return NextResponse.json(result);
}

async function createStore() {
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
