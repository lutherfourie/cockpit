import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  NullCockpitMemoryStore,
  SupabaseCockpitMemoryStore,
  createCockpitMemoryStore,
} from "./storage";

describe("Cockpit memory storage", () => {
  it("creates a null store when no Supabase client is available", async () => {
    const store = await createCockpitMemoryStore(null);

    expect(store).toBeInstanceOf(NullCockpitMemoryStore);
    await expect(
      store.saveSessionState({
        message: "keep working",
        output: {
          currentGoal: "Keep working",
          nextAction: "Write a test",
          proofNeeded: "A failing test",
          parkingLot: [],
          handoff: "Continue from tests",
          assumptions: [],
          blockers: [],
        },
      }),
    ).resolves.toMatchObject({
      saved: false,
      reason: "Supabase server client is unavailable.",
    });
  });

  it("creates a null store when Supabase has no authenticated user", async () => {
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: null,
        })),
      },
    } as unknown as SupabaseClient;

    const store = await createCockpitMemoryStore(supabase);

    expect(supabase.auth.getUser).toHaveBeenCalledOnce();
    expect(store).toBeInstanceOf(NullCockpitMemoryStore);
    await expect(
      store.saveChatMessage?.({
        role: "user",
        content: "hello",
      }),
    ).resolves.toEqual({
      saved: false,
      reason: "No authenticated Supabase user is present.",
    });
  });

  it("does not write through a Supabase store without a user id", async () => {
    const from = vi.fn();
    const store = new SupabaseCockpitMemoryStore(
      { from } as unknown as SupabaseClient,
      "",
    );

    const result = await store.saveChatMessage({
      role: "user",
      content: "hello",
    });

    expect(result).toEqual({
      saved: false,
      reason: "No authenticated Supabase user is present.",
    });
    expect(from).not.toHaveBeenCalled();
  });
});
