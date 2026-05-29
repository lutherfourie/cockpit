import { describe, expect, it, vi } from "vitest";

import {
  createCockpitMemoryStoreForRequest,
  type CockpitStoreFactory,
  type CockpitSupabaseAuthClient,
} from "./auth-store";
import type { CockpitMemoryStore } from "./storage";

describe("cockpit request auth store", () => {
  it("prefers bearer auth when the extension sends an access token", async () => {
    const createStore = vi.fn<CockpitStoreFactory>((_client, userId) =>
      createFakeStore(userId),
    );
    const cookieClient = createFakeClient("cookie-user");
    const bearerClient = createFakeClient("bearer-user");

    const store = await createCockpitMemoryStoreForRequest(
      new Request("http://127.0.0.1/api/cockpit", {
        headers: { Authorization: "Bearer extension-token" },
      }),
      {
        isConfigured: () => true,
        createCookieClient: async () => cookieClient,
        createBearerClient: (token) => {
          expect(token).toBe("extension-token");
          return bearerClient;
        },
        createStore,
      },
    );

    expect(createStore).toHaveBeenCalledWith(bearerClient, "bearer-user");
    expect(await store.saveSessionState({ message: "", output: minimalOutput() })).toEqual({
      saved: true,
      sessionId: "bearer-user",
    });
  });

  it("keeps cookie auth for existing browser routes", async () => {
    const createStore = vi.fn<CockpitStoreFactory>((_client, userId) =>
      createFakeStore(userId),
    );
    const cookieClient = createFakeClient("cookie-user");
    const createBearerClient = vi.fn();

    await createCockpitMemoryStoreForRequest(
      new Request("http://127.0.0.1/api/cockpit"),
      {
        isConfigured: () => true,
        createCookieClient: async () => cookieClient,
        createBearerClient,
        createStore,
      },
    );

    expect(createBearerClient).not.toHaveBeenCalled();
    expect(createStore).toHaveBeenCalledWith(cookieClient, "cookie-user");
  });

  it("returns a null store when auth is absent", async () => {
    const store = await createCockpitMemoryStoreForRequest(
      new Request("http://127.0.0.1/api/cockpit"),
      {
        isConfigured: () => true,
        createCookieClient: async () => createFakeClient(null),
        createBearerClient: () => createFakeClient(null),
      },
    );

    const result = await store.saveSessionState({
      message: "unsaved",
      output: minimalOutput(),
    });

    expect(result.saved).toBe(false);
    expect(result.reason).toBe("No authenticated Supabase user is present.");
  });
});

function createFakeClient(userId: string | null): CockpitSupabaseAuthClient {
  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as CockpitSupabaseAuthClient;
}

function createFakeStore(userId: string): CockpitMemoryStore {
  return {
    loadSessionState: async () => null,
    loadLatestSessionState: async () => null,
    saveSessionState: async () => ({ saved: true, sessionId: userId }),
    addParkingLotItem: async () => ({ saved: true }),
    createHandoff: async () => ({ saved: true }),
  };
}

function minimalOutput() {
  return {
    currentGoal: "Goal",
    nextAction: "Action",
    proofNeeded: "Proof",
    parkingLot: [],
    assumptions: [],
    blockers: [],
  };
}
