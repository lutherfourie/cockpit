import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
  PluginHostContext,
} from "../contract/types";

export interface PluginEntry {
  id: string;
  /** Factory returns a fresh plugin instance. Allows re-init on reload. */
  factory: () => CockpitPlugin;
}

type PluginStatus = "ready" | "errored" | "disposed";

interface LoadedPlugin {
  id: string;
  entry: PluginEntry;
  instance: CockpitPlugin | null;
  status: PluginStatus;
  lastError?: string;
}

/**
 * The plugin host. Owns the lifecycle of all registered plugins.
 *
 * Failure isolation: a plugin that throws during init or any capability hook
 * is marked `errored` and excluded from subsequent calls. The host itself
 * never throws on plugin failure — callers see empty results / null and a
 * logged error.
 *
 * Lane identifiers crossing the host boundary use `<pluginId>:<laneId>` form
 * so the host can route by prefix. Internal plugin-side laneIds do NOT carry
 * the prefix.
 */
export class PluginHost {
  private plugins = new Map<string, LoadedPlugin>();

  constructor(private readonly context: PluginHostContext) {}

  /**
   * Load plugins. Each is init'd; failures are contained.
   *
   * If a plugin id is already loaded, the duplicate is skipped with a warning.
   * Callers wanting to re-load must call `dispose()` first.
   */
  async load(entries: PluginEntry[]): Promise<void> {
    for (const entry of entries) {
      if (this.plugins.has(entry.id)) {
        this.context.log.warn(`plugin ${entry.id} already loaded; call dispose() before re-loading`);
        continue;
      }
      const loaded: LoadedPlugin = {
        id: entry.id,
        entry,
        instance: null,
        status: "ready",
      };
      try {
        const instance = entry.factory();
        await instance.init(this.context);
        loaded.instance = instance;
        loaded.status = "ready";
      } catch (err) {
        loaded.status = "errored";
        loaded.lastError = err instanceof Error ? err.message : String(err);
        this.context.log.error(`plugin ${entry.id} init failed`, {
          error: loaded.lastError,
        });
      }
      this.plugins.set(entry.id, loaded);
    }
  }

  /** Aggregate lanes across all ready plugins implementing discovery. */
  async listAllLanes(): Promise<LaneSummary[]> {
    const out: LaneSummary[] = [];
    for (const loaded of this.plugins.values()) {
      if (loaded.status !== "ready" || !loaded.instance) continue;
      if (!loaded.instance.capabilities.includes("discovery")) continue;
      if (!loaded.instance.listLanes) continue;
      try {
        const lanes = await loaded.instance.listLanes();
        for (const lane of lanes) {
          out.push({ ...lane, pluginId: loaded.id });
        }
      } catch (err) {
        this.context.log.error(`plugin ${loaded.id} listLanes failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        // Do not change status — capability call failures are recoverable.
      }
    }
    return out;
  }

  /**
   * Generate a handoff for a lane.
   *
   * @param fullLaneId  Namespaced lane id of the form `<pluginId>:<laneId>`.
   * @param target      Handoff target surface.
   * @returns The handoff artifact, or null if not found or capability missing.
   */
  async generateHandoff(
    fullLaneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null> {
    const [pluginId, ...rest] = fullLaneId.split(":");
    const laneId = rest.join(":");
    if (!pluginId || !laneId) return null;
    const loaded = this.plugins.get(pluginId);
    if (!loaded || loaded.status !== "ready" || !loaded.instance) return null;
    if (!loaded.instance.capabilities.includes("handoff")) return null;
    if (!loaded.instance.generateHandoff) return null;
    try {
      return await loaded.instance.generateHandoff(laneId, target);
    } catch (err) {
      this.context.log.error(`plugin ${pluginId} generateHandoff failed`, {
        laneId,
        target,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** For tests / introspection: the current status of a plugin. */
  getPluginStatus(id: string): PluginStatus | "unknown" {
    return this.plugins.get(id)?.status ?? "unknown";
  }

  /** Dispose all loaded plugins. Idempotent. */
  async dispose(): Promise<void> {
    for (const loaded of this.plugins.values()) {
      if (loaded.instance && loaded.status === "ready") {
        try {
          await loaded.instance.dispose();
        } catch (err) {
          this.context.log.error(`plugin ${loaded.id} dispose failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      loaded.status = "disposed";
      loaded.instance = null;
    }
  }
}
