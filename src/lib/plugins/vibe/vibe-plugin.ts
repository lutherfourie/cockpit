import type {
  CockpitPlugin,
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
  PluginCapability,
  PluginHostContext,
} from "../contract/types";
import type { VibeService } from "./vibe-service";

/**
 * The Vibe plugin. Implements the CockpitPlugin contract by delegating to a
 * VibeService. Service implementation choice (InProcess vs. Remote) is made
 * by the constructor's caller — typically the plugin registry.
 *
 * Phase 1 capabilities: discovery + handoff only. Execution and memory will
 * be added when their respective spec sections are approved.
 */
export class VibePlugin implements CockpitPlugin {
  readonly id = "vibe";
  readonly displayName = "Vibe Lanes";
  readonly version = "0.1.0";
  readonly description = "Vibe lane discovery and surface-aware handoff generation.";
  readonly capabilities: readonly PluginCapability[] = ["discovery", "handoff"];

  private context: PluginHostContext | null = null;

  constructor(private readonly service: VibeService) {}

  async init(host: PluginHostContext): Promise<void> {
    this.context = host;
    host.log.info("vibe plugin initialized");
  }

  async dispose(): Promise<void> {
    this.context?.log.info("vibe plugin disposed");
    await this.service.dispose();
    this.context = null;
  }

  async listLanes(): Promise<LaneSummary[]> {
    return this.service.listLanes();
  }

  async generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null> {
    return this.service.generateHandoff(laneId, target);
  }
}
