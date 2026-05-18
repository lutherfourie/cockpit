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
 * Cockpit-mediated memory API. Plugin writes are namespaced under the
 * plugin id (host enforces). Phase 1 is read-mostly; full bridge lands in
 * Phase 4 per spec Section 7.
 */
export interface HostMemoryApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  delete(key: string): Promise<void>;
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
 * Memory capability hook exposed BY the plugin TO Cockpit.
 *
 * Direction: plugin → host (contrast with `HostMemoryApi`, which is host → plugin).
 * Phase 1 plugins MAY omit this — `CockpitPlugin.memoryBridge` is optional.
 * Full bridge semantics (sync direction, conflict resolution, namespacing)
 * are deferred to Phase 4 per spec Section 7.
 */
export interface PluginMemoryBridge {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export interface CockpitPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
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
