"use client";

import { Component, type ReactNode } from "react";

import type { GeneratedSurface } from "@/lib/cockpit/kernel-state";
import { GeneratedSurfaceRenderer } from "../../lib/openui/generated-surface-library";

type GeneratedSurfaceErrorBoundaryState = {
  error: Error | null;
};

class GeneratedSurfaceErrorBoundary extends Component<
  { children: ReactNode },
  GeneratedSurfaceErrorBoundaryState
> {
  state: GeneratedSurfaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <GeneratedSurfaceUnavailable
          reason={this.state.error.message || "Generated surface failed to render."}
          includeTestId={false}
        />
      );
    }

    return this.props.children;
  }
}

export function GeneratedSurfaceSlot({
  surface,
}: {
  surface: GeneratedSurface;
}) {
  if (surface.status === "empty") {
    return (
      <section
        className="cockpit-panel cockpit-panel-quiet border p-4"
        data-testid="generated-surface"
      >
        <div className="cockpit-panel-heading cockpit-muted mb-3 text-xs font-semibold uppercase tracking-normal">
          Generated Surface
        </div>
        <p className="cockpit-muted text-sm leading-6">
          No generated surface for this turn.
        </p>
      </section>
    );
  }

  if (surface.status === "unavailable") {
    return <GeneratedSurfaceUnavailable reason={surface.reason} />;
  }

  return (
    <div data-testid="generated-surface">
      <GeneratedSurfaceErrorBoundary
        key={`${surface.kind}:${surface.title}:${surface.body}`}
      >
        <GeneratedSurfaceRenderer surface={surface} />
      </GeneratedSurfaceErrorBoundary>
    </div>
  );
}

function GeneratedSurfaceUnavailable({
  reason,
  includeTestId = true,
}: {
  reason: string;
  includeTestId?: boolean;
}) {
  return (
    <section
      className="cockpit-alert border p-4"
      data-testid={includeTestId ? "generated-surface" : undefined}
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-normal">
        Generated Surface Unavailable
      </div>
      <p className="text-sm leading-6">{reason}</p>
    </section>
  );
}
