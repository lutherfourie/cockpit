import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  HostMemoryApi,
  MemoryEntryMeta,
  PluginMemoryBridge,
  VibeMemoryHandle,
} from "./types";

describe("memory bridge contract types (spec §7.7)", () => {
  it("HostMemoryApi takes unknown values and lists MemoryEntryMeta", async () => {
    expectTypeOf<HostMemoryApi["set"]>().toEqualTypeOf<
      (key: string, value: unknown) => Promise<void>
    >();
    expectTypeOf<HostMemoryApi["get"]>().toEqualTypeOf<
      (key: string) => Promise<unknown | undefined>
    >();
    expectTypeOf<HostMemoryApi["list"]>().toEqualTypeOf<
      (prefix?: string) => Promise<MemoryEntryMeta[]>
    >();
    expectTypeOf<HostMemoryApi["delete"]>().toEqualTypeOf<
      (key: string) => Promise<void>
    >();

    // Sanity: a concrete instance is constructable and a structured value is accepted.
    const api: HostMemoryApi = {
      async set(_key, _value) {},
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async delete() {},
    };
    await api.set("run:1", { status: "done" });
    expect(await api.list("run:")).toEqual([]);
  });

  it("MemoryEntryMeta exposes bare key + ISO timestamps", () => {
    expectTypeOf<MemoryEntryMeta["key"]>().toEqualTypeOf<string>();
    expectTypeOf<MemoryEntryMeta["createdAt"]>().toEqualTypeOf<string>();
    expectTypeOf<MemoryEntryMeta["updatedAt"]>().toEqualTypeOf<string>();

    // Sanity: a concrete instance is constructable.
    const meta: MemoryEntryMeta = {
      key: "run:1",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:00.000Z",
    };
    expect(meta.key).toBe("run:1");
  });

  it("PluginMemoryBridge is host-calls-plugin (refresh / beforeDelete), both optional", async () => {
    expectTypeOf<PluginMemoryBridge["refresh"]>().toEqualTypeOf<
      (() => Promise<void>) | undefined
    >();
    expectTypeOf<PluginMemoryBridge["beforeDelete"]>().toEqualTypeOf<
      ((key: string) => Promise<boolean>) | undefined
    >();

    // Both hooks are optional: an empty object satisfies the interface.
    const empty: PluginMemoryBridge = {};
    const full: PluginMemoryBridge = {
      async refresh() {},
      async beforeDelete(_key) {
        return true;
      },
    };
    expect(empty.refresh).toBeUndefined();
    expect(await full.beforeDelete!("k")).toBe(true);
  });

  it("VibeMemoryHandle mirrors HostMemoryApi for the service layer", () => {
    // The "mirrors HostMemoryApi" claim is encoded at the type level so the
    // two interfaces cannot silently drift.
    expectTypeOf<VibeMemoryHandle>().toEqualTypeOf<HostMemoryApi>();

    // Sanity: a concrete instance is constructable.
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
