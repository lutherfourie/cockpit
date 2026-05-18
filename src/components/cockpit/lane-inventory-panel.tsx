"use client";

import { useCallback, useEffect, useState } from "react";

interface LaneSummary {
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
}

const TARGETS = [
  "codex.web",
  "codex.cli",
  "codex.github_pr",
  "claude.code",
  "claude.web",
  "human.review",
] as const;

type Target = (typeof TARGETS)[number];

interface HandoffArtifact {
  text: string;
  target: Target;
  format: "markdown" | "json";
  recommendedCommand?: string;
}

interface PanelState {
  status: "loading" | "ready" | "error";
  lanes: LaneSummary[];
  error?: string;
  handoffs: Record<string, HandoffArtifact | undefined>;
  handoffErrors: Record<string, string | undefined>;
  generating: Record<string, boolean>;
}

const INITIAL_STATE: PanelState = {
  status: "loading",
  lanes: [],
  handoffs: {},
  handoffErrors: {},
  generating: {},
};

export function LaneInventoryPanel() {
  const [state, setState] = useState<PanelState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cockpit/lanes");
        if (!res.ok) {
          if (!cancelled) {
            setState((s) => ({
              ...s,
              status: "error",
              error: `HTTP ${res.status}`,
            }));
          }
          return;
        }
        const body = (await res.json()) as { lanes: LaneSummary[] };
        if (!cancelled) {
          setState((s) => ({ ...s, status: "ready", lanes: body.lanes }));
        }
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onGenerateHandoff = useCallback(
    async (fullLaneId: string, target: Target): Promise<void> => {
      setState((s) => ({ ...s, generating: { ...s.generating, [fullLaneId]: true } }));
      try {
        const res = await fetch(
          `/api/cockpit/lanes/${encodeURIComponent(fullLaneId)}/handoff?target=${encodeURIComponent(target)}`,
        );
        if (!res.ok) {
          const errMsg = `HTTP ${res.status}`;
          setState((s) => ({
            ...s,
            generating: { ...s.generating, [fullLaneId]: false },
            handoffErrors: { ...s.handoffErrors, [fullLaneId]: errMsg },
          }));
          return;
        }
        const body = (await res.json()) as { artifact: HandoffArtifact };
        setState((s) => ({
          ...s,
          generating: { ...s.generating, [fullLaneId]: false },
          handoffs: { ...s.handoffs, [fullLaneId]: body.artifact },
          handoffErrors: { ...s.handoffErrors, [fullLaneId]: undefined },
        }));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Request failed";
        setState((s) => ({
          ...s,
          generating: { ...s.generating, [fullLaneId]: false },
          handoffErrors: { ...s.handoffErrors, [fullLaneId]: errMsg },
        }));
      }
    },
    [],
  );

  if (state.status === "loading") {
    return <div className="p-4 text-sm opacity-70">Loading lanes…</div>;
  }

  if (state.status === "error") {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load lanes: {state.error ?? "unknown error"}
      </div>
    );
  }

  if (state.lanes.length === 0) {
    return (
      <div className="p-4 text-sm opacity-70">
        No lanes discovered. Configure <code>COCKPIT_PLUGIN_VIBE_ROOTS</code> in
        <code>.env.local</code> with paths to repos containing{" "}
        <code>lanes/*.json</code> files.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">Lanes ({state.lanes.length})</h2>
      {state.lanes.map((lane) => {
        const fullLaneId = `${lane.pluginId}:${lane.laneId}`;
        const handoff = state.handoffs[fullLaneId];
        const generating = !!state.generating[fullLaneId];
        return (
          <article
            key={fullLaneId}
            className="rounded-md border border-zinc-700 p-3 text-sm"
          >
            <header className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-medium">{lane.name}</h3>
              <span className="text-xs opacity-60">{lane.pluginId}</span>
            </header>
            {lane.description && (
              <p className="mb-2 opacity-80">{lane.description}</p>
            )}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs opacity-70">
              <dt>Repo</dt>
              <dd className="font-mono">{lane.repoPath}</dd>
              {lane.target && (
                <>
                  <dt>Target</dt>
                  <dd>{lane.target}</dd>
                </>
              )}
              {lane.approval && (
                <>
                  <dt>Approval</dt>
                  <dd>{lane.approval}</dd>
                </>
              )}
            </dl>
            <HandoffControls
              fullLaneId={fullLaneId}
              generating={generating}
              onGenerate={onGenerateHandoff}
            />
            {handoff && (
              <pre className="mt-3 max-h-72 overflow-auto rounded bg-zinc-900 p-2 text-xs whitespace-pre-wrap">
                {handoff.text}
              </pre>
            )}
            {state.handoffErrors[fullLaneId] && !handoff && (
              <p className="mt-3 text-xs text-red-500">
                Handoff failed: {state.handoffErrors[fullLaneId]}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function HandoffControls(props: {
  fullLaneId: string;
  generating: boolean;
  onGenerate(fullLaneId: string, target: Target): void;
}) {
  const [target, setTarget] = useState<Target>("codex.cli");
  const selectId = `handoff-target-${props.fullLaneId}`;
  return (
    <div className="mt-3 flex items-center gap-2">
      <label className="sr-only" htmlFor={selectId}>
        Handoff target for {props.fullLaneId}
      </label>
      <select
        id={selectId}
        value={target}
        onChange={(e) => setTarget(e.target.value as Target)}
        className="rounded border border-zinc-700 bg-transparent px-2 py-1 text-xs"
      >
        {TARGETS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={props.generating}
        onClick={() => props.onGenerate(props.fullLaneId, target)}
        className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
      >
        {props.generating ? "Generating…" : "Generate handoff"}
      </button>
    </div>
  );
}
