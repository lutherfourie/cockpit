"use client";

import type { GeneratedSurface } from "@/lib/cockpit/kernel-state";
import { GeneratedSurfaceRenderer } from "@/lib/openui/generated-surface-library";

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
    return (
      <section className="cockpit-alert border p-4" data-testid="generated-surface">
        <div className="mb-2 text-xs font-semibold uppercase tracking-normal">
          Generated Surface Unavailable
        </div>
        <p className="text-sm leading-6">{surface.reason}</p>
      </section>
    );
  }

  return (
    <div data-testid="generated-surface">
      <GeneratedSurfaceRenderer surface={surface} />
    </div>
  );
}
