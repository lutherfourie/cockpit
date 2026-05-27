/**
 * Cockpit plugin contract.
 *
 * Every plugin is an in-process TypeScript module loaded by the plugin host
 * at Cockpit startup. A plugin advertises which capabilities it provides via
 * the `capabilities` field; the host calls the matching capability hooks.
 *
 * See docs/superpowers/specs/2026-05-18-cockpit-vibe-integration-design.md
 * (Sections 1, 2) for the architectural rationale.
 */

export type PluginCapability = "discovery" | "execution" | "handoff" | "memory";

/**
 * Logger scoped to a single plugin instance. Writes structured logs the host
 * surface can render. Implementations should prefix entries with the plugin id.
 */
export interface PluginLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * A structured event a plugin emits via the host-provided event sink.
 * Persistence / rendering is the host's responsibility; the plugin only
 * tags and submits.
 */
export interface PluginEvent {
  kind: string;
  pluginId: string;
  payload: unknown;
}

/**
 * Structured event sink the plugin can emit telemetry / activity events into.
 * The host decides how to persist or render them (typically piggybacks on
 * cockpit_assistant_events — see spec Section 5).
 */
export interface HostEventSink {
  emit(event: PluginEvent): void;
}

/**
 * Cockpit-mediated, per-plugin memory API (spec §7.7). The host binds the
 * `<plugin.id>` namespace and injects this at init; the plugin supplies only
 * the bare key. Last-write-wins per (user, namespace, key). No-ops when
 * Supabase is unconfigured or no user is signed in.
 */
export interface HostMemoryApi {
  /** Upsert a value under the host-injected namespace. */
  set(key: string, value: unknown): Promise<void>;
  /** Read back a value the plugin previously wrote, or undefined. */
  get(key: string): Promise<unknown | undefined>;
  /** List entry metadata (not values) under this namespace, newest-first. `prefix` filters keys. */
  list(prefix?: string): Promise<MemoryEntryMeta[]>;
  /** Delete one entry. Idempotent. */
  delete(key: string): Promise<void>;
}

/** Metadata for one plugin-memory entry (spec §7.7). */
export interface MemoryEntryMeta {
  /** Bare key, namespace stripped. */
  key: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface PluginHostContext {
  /** Logger scoped to plugin id. */
  log: PluginLogger;

  /** Read-only snapshot of settings the user has scoped to this plugin. */
  settings: ReadonlyMap<string, unknown>;

  /** Memory API namespaced to this plugin (host enforces). */
  memory: HostMemoryApi;

  /** Structured event sink. */
  events: HostEventSink;
}

export interface LaneSummary {
  laneId: string;
  pluginId: string;
  name: string;
  description?: string;
  repoPath: string;
  reads: string[];
  owns: string[];
  target?: string;
  approval?: string;
  verify?: string[];
  status: "ready" | "running" | "error";
  lastRunAt?: string;
}

export interface LaneRunInput {
  userMessage: string;
  overrides?: {
    model?: string;
    envVars?: Record<string, string>;
    cwd?: string;
  };
}

/** A single to-do item emitted by the `todo` LaneEvent variant during lane execution. */
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export type LaneEvent =
  | { type: "start"; laneId: string; runId: string }
  | { type: "todo"; items: TodoItem[] }
  | { type: "tool_call"; tool: string; args?: unknown }
  | { type: "tool_result"; tool: string; ok: boolean; preview?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "file_write"; path: string; bytes: number }
  | {
      type: "final";
      summary: string;
      outputs: { path: string; bytes: number }[];
    }
  | { type: "error"; message: string; recoverable: boolean };

export type HandoffTarget =
  | "codex.web"
  | "codex.cli"
  | "codex.github_pr"
  | "claude.code"
  | "claude.web"
  | "human.review";

export interface HandoffArtifact {
  text: string;
  target: HandoffTarget;
  format: "markdown" | "json";
  recommendedCommand?: string;
}

/**
 * Optional capability hook exposed BY the plugin TO Cockpit (host→plugin
 * direction, spec §7.7). Most plugins won't override the defaults.
 */
export interface PluginMemoryBridge {
  /** Host invokes on "refresh from plugin"; plugin re-emits anything that belongs in Cockpit. Default: no-op. */
  refresh?(): Promise<void>;
  /** Host invokes BEFORE deleting a key from the UI; return false to refuse. Default: allow. */
  beforeDelete?(key: string): Promise<boolean>;
}

/**
 * Service-layer handle (spec §7.7). Always present on VibeService.memory; a
 * write before the host wires a HostMemoryApi throws (loud failure), reads
 * are inert. Added to the VibeService interface in the plugin-side task.
 */
export interface VibeMemoryHandle {
  set(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown | undefined>;
  list(prefix?: string): Promise<MemoryEntryMeta[]>;
  delete(key: string): Promise<void>;
}

export interface CockpitPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  /** SemVer matching the contract version this plugin was built against. See spec §8.3. */
  readonly cockpitPluginContractVersion: string;
  readonly description?: string;
  readonly capabilities: readonly PluginCapability[];

  init(host: PluginHostContext): Promise<void>;
  dispose(): Promise<void>;

  listLanes?(): Promise<LaneSummary[]>;

  runLane?(
    laneId: string,
    input: LaneRunInput,
    signal: AbortSignal,
  ): AsyncIterable<LaneEvent>;

  /**
   * Handoff: produce a ready-to-paste handoff for a target surface.
   * Returns null if the lane is unknown to the plugin (HTTP routes can map to 404).
   * Plugin exceptions (e.g. backend network failure) propagate to the caller
   * (HTTP routes can map to 500).
   */
  generateHandoff?(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null>;

  memoryBridge?: PluginMemoryBridge;
}
