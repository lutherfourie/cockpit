"use client";

import {
  Renderer,
  createLibrary,
  defineComponent,
} from "@openuidev/react-lang";
import { Sparkles } from "lucide-react";
import { z } from "zod";

import type { GeneratedSurface } from "@/lib/cockpit/kernel-state";

const AssistantNote = defineComponent({
  name: "AssistantNote",
  description:
    "Renders a bounded assistant-generated note inside an approved cockpit zone.",
  props: z.object({
    title: z.string(),
    body: z.string(),
  }),
  component: ({ props }) => (
    <section className="cockpit-panel cockpit-panel-quiet border p-4">
      <div className="cockpit-panel-heading cockpit-muted mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
        <span className="cockpit-panel-icon">
          <Sparkles className="size-4" />
        </span>
        <h2>{props.title}</h2>
      </div>
      <p className="text-sm leading-6">{props.body}</p>
    </section>
  ),
});

export const generatedSurfaceLibrary = createLibrary({
  components: [AssistantNote],
  root: "AssistantNote",
});

export function GeneratedSurfaceRenderer({
  surface,
}: {
  surface: GeneratedSurface;
}) {
  const response = toGeneratedSurfaceResponse(surface);
  if (!response) {
    return null;
  }

  return <Renderer response={response} library={generatedSurfaceLibrary} />;
}

export function toGeneratedSurfaceResponse(
  surface: GeneratedSurface,
): string | null {
  if (surface.status !== "ready") {
    return null;
  }

  return `root = AssistantNote(${JSON.stringify(surface.title)}, ${JSON.stringify(
    surface.body,
  )})`;
}
