"use client";

import { Component, type ReactNode } from "react";

import type { GeneratedSurface } from "@/lib/cockpit/kernel-state";
import { GeneratedSurfaceRenderer } from "../../lib/openui/generated-surface-library";

const MAX_GENERATED_SURFACE_REASON_LENGTH = 240;
const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE_PATTERN = /\s+/g;

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
    <div
      className="max-h-80 overflow-auto overscroll-contain"
      data-testid="generated-surface"
    >
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
  const safeReason = sanitizeGeneratedSurfaceReason(reason);

  return (
    <section
      className="cockpit-alert border p-4"
      data-testid={includeTestId ? "generated-surface" : undefined}
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-normal">
        Generated Surface Unavailable
      </div>
      <p className="text-sm leading-6">{safeReason}</p>
    </section>
  );
}

function sanitizeGeneratedSurfaceReason(reason: string): string {
  const normalized = reason
    .replace(CONTROL_CHARACTERS_PATTERN, "")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();

  const message = normalized || "Generated surface is unavailable.";
  if (message.length <= MAX_GENERATED_SURFACE_REASON_LENGTH) {
    return message;
  }

  return `${message
    .slice(0, MAX_GENERATED_SURFACE_REASON_LENGTH - 3)
    .trimEnd()}...`;
}
