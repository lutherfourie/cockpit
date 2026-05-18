import type {
  HandoffArtifact,
  HandoffTarget,
  LaneSummary,
} from "../contract/types";

/**
 * Vibe runtime interface — Phase 1 subset.
 *
 * Per spec Section 3, there will be two implementations:
 *   - InProcessVibeService (default; runs in Cockpit's process)
 *   - RemoteVibeService    (Phase 5; HTTP/WS client to a Vibe daemon)
 *
 * Phase 1 only needs discovery and handoff. Execution + streaming and
 * memory bridge come in later phases and will extend this interface.
 */
export interface VibeService {
  /** Discover all lanes under configured repo roots. */
  listLanes(): Promise<LaneSummary[]>;

  /**
   * Produce a handoff artifact for the given lane targeted at the given surface.
   *
   * @param laneId  Plugin-internal lane id (NOT namespaced; host strips prefix).
   * @param target  Handoff target surface.
   * @returns Artifact, or null if the lane is unknown.
   */
  generateHandoff(
    laneId: string,
    target: HandoffTarget,
  ): Promise<HandoffArtifact | null>;
}
