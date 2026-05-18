import { describe, it, expect, expectTypeOf } from "vitest";
import type { CockpitPlugin } from "./types";

describe("CockpitPlugin.cockpitPluginContractVersion", () => {
  it("is a readonly string on the plugin interface", () => {
    const stub: CockpitPlugin = {
      id: "stub",
      displayName: "Stub",
      version: "0.0.0",
      cockpitPluginContractVersion: "1.0.0",
      capabilities: [],
      init: async () => {},
      dispose: async () => {},
    };
    expect(stub.cockpitPluginContractVersion).toBe("1.0.0");
    expectTypeOf<CockpitPlugin["cockpitPluginContractVersion"]>().toEqualTypeOf<string>();
  });
});
