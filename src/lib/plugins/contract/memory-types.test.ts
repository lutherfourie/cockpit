import { describe, expect, it } from "vitest";

import type {
  HostMemoryApi,
  MemoryEntryMeta,
  PluginMemoryBridge,
  VibeMemoryHandle,
} from "./types";

describe("memory bridge contract types (spec §7.7)", () => {
  it("HostMemoryApi takes unknown values and lists MemoryEntryMeta", async () => {
    const api: HostMemoryApi = {
      async set(_key: string, _value: unknown) {},
      async get(_key: string): Promise<unknown | undefined> {
        return undefined;
      },
      async list(_prefix?: string): Promise<MemoryEntryMeta[]> {
        return [];
      },
      async delete(_key: string) {},
    };
    await api.set("run:1", { status: "done" });
    expect(await api.list("run:")).toEqual([]);
  });

  it("MemoryEntryMeta exposes bare key + ISO timestamps", () => {
    const meta: MemoryEntryMeta = {
      key: "run:1",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:00.000Z",
    };
    expect(meta.key).toBe("run:1");
  });

  it("PluginMemoryBridge is host-calls-plugin (refresh / beforeDelete), both optional", async () => {
    const empty: PluginMemoryBridge = {};
    const full: PluginMemoryBridge = {
      async refresh() {},
      async beforeDelete(_key: string): Promise<boolean> {
        return true;
      },
    };
    expect(empty.refresh).toBeUndefined();
    expect(await full.beforeDelete!("k")).toBe(true);
  });

  it("VibeMemoryHandle mirrors HostMemoryApi for the service layer", () => {
    const handle: VibeMemoryHandle = {
      async set() {},
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async delete() {},
    };
    expect(typeof handle.set).toBe("function");
  });
});
