import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  NullCockpitMemoryStore,
  SupabaseCockpitMemoryStore,
  createCockpitMemoryStore,
} from "./storage";

type CapturedFilter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "is"; column: string; value: unknown };

type CapturedQuery = {
  table: string;
  operation?: "insert" | "update";
  selectColumns?: string;
  filters: CapturedFilter[];
  orderBy?: { column: string; ascending: boolean };
  limitCount?: number;
  row?: unknown;
};

type QueryResponse = {
  data?: unknown;
  error?: { message: string } | null;
};

function createSupabaseStub(responses: QueryResponse[]) {
  const queries: CapturedQuery[] = [];
  const pendingResponses = [...responses];

  class QueryBuilder implements PromiseLike<QueryResponse> {
    constructor(
      private readonly query: CapturedQuery,
      private readonly response: QueryResponse,
    ) {}

    select(columns: string) {
      this.query.selectColumns = columns;
      return this;
    }

    eq(column: string, value: unknown) {
      this.query.filters.push({ kind: "eq", column, value });
      return this;
    }

    is(column: string, value: unknown) {
      this.query.filters.push({ kind: "is", column, value });
      return this;
    }

    order(column: string, options: { ascending?: boolean }) {
      this.query.orderBy = {
        column,
        ascending: options.ascending ?? true,
      };
      return this;
    }

    limit(count: number) {
      this.query.limitCount = count;
      return this;
    }

    insert(row: unknown) {
      this.query.operation = "insert";
      this.query.row = row;
      return this;
    }

    update(row: unknown) {
      this.query.operation = "update";
      this.query.row = row;
      return this;
    }

    maybeSingle() {
      return Promise.resolve(this.response);
    }

    single() {
      return Promise.resolve(this.response);
    }

    then<TResult1 = QueryResponse, TResult2 = never>(
      onfulfilled?:
        | ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.response).then(onfulfilled, onrejected);
    }
  }

  return {
    client: {
      from(table: string) {
        const query: CapturedQuery = { table, filters: [] };
        queries.push(query);
        return new QueryBuilder(query, pendingResponses.shift() ?? {});
      },
    } as unknown as SupabaseClient,
    queries,
  };
}

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

describe("cockpit memory storage", () => {
  it("keeps the null store as a complete no-op persistence boundary", async () => {
    const store = new NullCockpitMemoryStore("No signed-in user.");

    await expect(store.loadSessionState("session-1")).resolves.toBeNull();
    await expect(store.loadChatMessages("session-1")).resolves.toEqual([]);
    await expect(store.loadAssistantEvents("session-1")).resolves.toEqual([]);
    await expect(
      store.saveSessionState({
        sessionId: "session-1",
        message: "ship it",
        output: {
          currentGoal: "Keep local mode usable",
          nextAction: "Return a no-op save result",
          proofNeeded: "The caller receives a reason",
          parkingLot: [],
          assumptions: [],
          blockers: [],
        },
      }),
    ).resolves.toEqual({ saved: false, reason: "No signed-in user." });
    await expect(
      store.saveChatMessage({
        sessionId: "session-1",
        role: "user",
        content: "hello",
      }),
    ).resolves.toEqual({ saved: false, reason: "No signed-in user." });
    await expect(
      store.appendAssistantEvent({
        sessionId: "00000000-0000-4000-8000-000000000001",
        type: "assistant_message",
        role: "assistant",
        content: "hello",
        metadata: {},
      }),
    ).resolves.toEqual({ saved: false, reason: "No signed-in user." });
    await expect(
      store.addParkingLotItem({
        sessionId: "session-1",
        content: "later",
      }),
    ).resolves.toEqual({ saved: false, reason: "No signed-in user." });
    await expect(
      store.createHandoff({
        sessionId: "session-1",
        target: "codex",
        prompt: "continue",
      }),
    ).resolves.toEqual({ saved: false, reason: "No signed-in user." });
  });

  it("loads session state through user-scoped session lookup", async () => {
    const { client, queries } = createSupabaseStub([
      {
        data: {
          id: "session-1",
          title: "Scoped session",
          active_goal: "Keep cockpit state user-owned",
          next_action: "Read the saved next action",
          proof_needed: "Mapped state reaches the UI",
          status: "active",
        },
        error: null,
      },
    ]);
    const store = new SupabaseCockpitMemoryStore(client, "user-1");

    await expect(store.loadSessionState("session-1")).resolves.toEqual({
      id: "session-1",
      title: "Scoped session",
      activeGoal: "Keep cockpit state user-owned",
      nextAction: "Read the saved next action",
      proofNeeded: "Mapped state reaches the UI",
      status: "active",
    });

    expect(queries[0]).toMatchObject({
      table: "cockpit_sessions",
      selectColumns: "id,title,active_goal,next_action,proof_needed,status",
      filters: [
        { kind: "eq", column: "id", value: "session-1" },
        { kind: "eq", column: "user_id", value: "user-1" },
      ],
    });
  });

  it("returns unsessioned chat messages in chronological order", async () => {
    const { client, queries } = createSupabaseStub([
      {
        data: [
          {
            role: "assistant",
            content: "newest",
            created_at: "2026-05-18T00:02:00.000Z",
          },
          {
            role: "user",
            content: "oldest",
            created_at: "2026-05-18T00:01:00.000Z",
          },
        ],
        error: null,
      },
    ]);
    const store = new SupabaseCockpitMemoryStore(client, "user-1");

    await expect(store.loadChatMessages()).resolves.toEqual([
      { role: "user", content: "oldest" },
      { role: "assistant", content: "newest" },
    ]);

    expect(queries[0]).toMatchObject({
      table: "cockpit_chat_messages",
      selectColumns: "role,content,created_at",
      filters: [
        { kind: "eq", column: "user_id", value: "user-1" },
        { kind: "is", column: "session_id", value: null },
      ],
      orderBy: { column: "created_at", ascending: false },
      limitCount: 20,
    });
  });

  it("falls back from assistant events to legacy chat messages", async () => {
    const { client } = createSupabaseStub([
      { data: [], error: null },
      {
        data: [
          {
            role: "assistant",
            content: "second",
            created_at: "2026-05-18T00:02:00.000Z",
          },
          {
            role: "user",
            content: "first",
            created_at: "2026-05-18T00:01:00.000Z",
          },
        ],
        error: null,
      },
    ]);
    const store = new SupabaseCockpitMemoryStore(client, "user-1");

    await expect(store.loadAssistantEvents("session-1")).resolves.toEqual([
      {
        id: "legacy-chat-0",
        type: "user_message",
        role: "user",
        content: "first",
        metadata: { source: "cockpit_chat_messages" },
        createdAt: "1970-01-01T00:00:00.000Z",
      },
      {
        id: "legacy-chat-1",
        type: "assistant_message",
        role: "assistant",
        content: "second",
        metadata: { source: "cockpit_chat_messages" },
        createdAt: "1970-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("creates session rows with compact titles and cockpit output fields", async () => {
    const { client, queries } = createSupabaseStub([
      { data: { id: "session-new" }, error: null },
    ]);
    const store = new SupabaseCockpitMemoryStore(client, "user-1");

    await expect(
      store.saveSessionState({
        message:
          "   This is a long scattered thought that should become a compact title without line breaks or trailing noise.   ",
        output: {
          currentGoal: "Persist the current goal",
          nextAction: "Save the next action",
          proofNeeded: "The row is inserted",
          parkingLot: [],
          assumptions: [],
          blockers: [],
        },
      }),
    ).resolves.toEqual({ sessionId: "session-new", saved: true });

    expect(queries[0].operation).toBe("insert");
    expect(queries[0].row).toMatchObject({
      user_id: "user-1",
      active_goal: "Persist the current goal",
      next_action: "Save the next action",
      proof_needed: "The row is inserted",
    });
    expect((queries[0].row as { title: string }).title).toHaveLength(72);
    expect((queries[0].row as { title: string }).title).toMatch(/\.\.\.$/);
    expect((queries[0].row as { updated_at: string }).updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  it("updates existing session rows through user and session filters", async () => {
    const { client, queries } = createSupabaseStub([
      { data: { id: "session-1" }, error: null },
    ]);
    const store = new SupabaseCockpitMemoryStore(client, "user-1");

    await expect(
      store.saveSessionState({
        sessionId: "session-1",
        message: "   ",
        output: {
          currentGoal: "Use fallback goal as title",
          nextAction: "Update the row",
          proofNeeded: "The row remains user scoped",
          parkingLot: [],
          assumptions: [],
          blockers: [],
        },
      }),
    ).resolves.toEqual({ sessionId: "session-1", saved: true });

    expect(queries[0]).toMatchObject({
      table: "cockpit_sessions",
      operation: "update",
      filters: [
        { kind: "eq", column: "id", value: "session-1" },
        { kind: "eq", column: "user_id", value: "user-1" },
      ],
    });
    expect(queries[0].row).toMatchObject({
      title: "Use fallback goal as title",
      active_goal: "Use fallback goal as title",
    });
  });
});
