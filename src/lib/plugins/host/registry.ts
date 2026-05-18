import { InProcessVibeService } from "../vibe/in-process-vibe-service";
import { VibePlugin } from "../vibe/vibe-plugin";
import type { PluginEntry } from "./plugin-host";

/**
 * Build the set of plugin entries based on environment / settings.
 *
 * Env vars (Phase 1):
 *   COCKPIT_PLUGINS              CSV of plugin ids to enable, e.g. "vibe"
 *   COCKPIT_PLUGIN_VIBE_ROOTS    CSV of repo paths the Vibe plugin scans
 */
export function buildPluginRegistry(): PluginEntry[] {
  const enabled = (process.env.COCKPIT_PLUGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const entries: PluginEntry[] = [];

  if (enabled.includes("vibe")) {
    const roots = (process.env.COCKPIT_PLUGIN_VIBE_ROOTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    entries.push({
      id: "vibe",
      factory: () =>
        new VibePlugin(new InProcessVibeService({ repoRoots: roots })),
    });
  }

  return entries;
}
