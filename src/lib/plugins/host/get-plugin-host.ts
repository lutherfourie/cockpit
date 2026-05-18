import type { PluginHostContext } from "../contract/types";
import { PluginHost } from "./plugin-host";
import { buildPluginRegistry } from "./registry";

let cached: Promise<PluginHost> | null = null;

/**
 * Get the process-wide plugin host. Lazily initialized on first call.
 *
 * Concurrent callers during init share the same promise — we never run init
 * twice in parallel.
 */
export function getPluginHost(): Promise<PluginHost> {
  if (cached) return cached;
  const host = new PluginHost(makeDefaultContext());
  cached = host.load(buildPluginRegistry()).then(() => host);
  return cached;
}

/** Test-only: clear the singleton so the next call rebuilds. */
export function resetPluginHostForTesting(): void {
  cached = null;
}

function makeDefaultContext(): PluginHostContext {
  return {
    log: {
      info: (msg, fields) => console.info(`[plugin]`, msg, fields ?? {}),
      warn: (msg, fields) => console.warn(`[plugin]`, msg, fields ?? {}),
      error: (msg, fields) => console.error(`[plugin]`, msg, fields ?? {}),
    },
    settings: new Map(),
    memory: {
      // Phase 1: no-op memory. Real implementation in Phase 4 (spec Section 7).
      get: async () => null,
      set: async () => {},
      list: async () => [],
      delete: async () => {},
    },
    events: {
      // Phase 1: log only. Real persistence in Phase 5 alongside execution.
      emit: (event) => console.info(`[plugin event]`, event),
    },
  };
}
