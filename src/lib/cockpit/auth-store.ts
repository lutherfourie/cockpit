import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "./supabase-server";
import {
  NullCockpitMemoryStore,
  SupabaseCockpitMemoryStore,
  type CockpitMemoryStore,
} from "./storage";

export type CockpitSupabaseAuthClient = SupabaseClient;

export type CockpitStoreFactory = (
  client: CockpitSupabaseAuthClient,
  userId: string,
) => CockpitMemoryStore;

export type CockpitStoreRequestDeps = {
  isConfigured?: () => boolean;
  createCookieClient?: () => Promise<CockpitSupabaseAuthClient | null>;
  createBearerClient?: (token: string) => CockpitSupabaseAuthClient;
  createStore?: CockpitStoreFactory;
};

export async function createCockpitMemoryStoreForRequest(
  request: Request,
  deps: CockpitStoreRequestDeps = {},
): Promise<CockpitMemoryStore> {
  const configured = deps.isConfigured ?? isSupabaseConfigured;
  if (!configured()) {
    return new NullCockpitMemoryStore("Supabase environment variables are not set.");
  }

  const bearerToken = readBearerToken(request);
  const createBearerClient = deps.createBearerClient ?? createSupabaseBearerClient;
  const createCookieClient = deps.createCookieClient ?? createSupabaseServerClient;
  const supabase = bearerToken
    ? createBearerClient(bearerToken)
    : await createCookieClient();

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

  const createStore =
    deps.createStore ??
    ((client, userId) => new SupabaseCockpitMemoryStore(client, userId));

  return createStore(supabase, user.id);
}

export function createSupabaseBearerClient(token: string): CockpitSupabaseAuthClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );
}

function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
