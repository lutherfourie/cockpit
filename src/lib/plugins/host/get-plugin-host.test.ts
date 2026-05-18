import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";

import {
  getPluginHost,
  resetPluginHostForTesting,
} from "./get-plugin-host";

const FIXTURES_ROOT = path.resolve(process.cwd(), "tests/fixtures");

describe("getPluginHost (singleton)", () => {
  const originalEnabled = process.env.COCKPIT_PLUGINS;
  const originalRoots = process.env.COCKPIT_PLUGIN_VIBE_ROOTS;

  beforeEach(() => {
    process.env.COCKPIT_PLUGINS = "vibe";
    process.env.COCKPIT_PLUGIN_VIBE_ROOTS = FIXTURES_ROOT;
    resetPluginHostForTesting();
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.COCKPIT_PLUGINS;
    else process.env.COCKPIT_PLUGINS = originalEnabled;
    if (originalRoots === undefined) delete process.env.COCKPIT_PLUGIN_VIBE_ROOTS;
    else process.env.COCKPIT_PLUGIN_VIBE_ROOTS = originalRoots;
    resetPluginHostForTesting();
  });

  it("returns the same host instance on repeat calls", async () => {
    const a = await getPluginHost();
    const b = await getPluginHost();
    expect(a).toBe(b);
  });

  it("loaded host exposes vibe plugin lanes from fixtures", async () => {
    const host = await getPluginHost();
    const lanes = await host.listAllLanes();
    expect(lanes.some((l) => l.pluginId === "vibe")).toBe(true);
  });

  it("returns an empty host when COCKPIT_PLUGINS is unset", async () => {
    process.env.COCKPIT_PLUGINS = "";
    resetPluginHostForTesting();
    const host = await getPluginHost();
    const lanes = await host.listAllLanes();
    expect(lanes).toEqual([]);
  });
});
