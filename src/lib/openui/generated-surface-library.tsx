"use client";

import {
  Renderer,
  createLibrary,
  defineComponent,
} from "@openuidev/react-lang";
import { Sparkles } from "lucide-react";
import { z } from "zod";

import type { GeneratedSurface } from "@/lib/cockpit/kernel-state";

const MAX_GENERATED_SURFACE_TITLE_LENGTH = 80;
const MAX_GENERATED_SURFACE_BODY_LENGTH = 600;
const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE_PATTERN = /\s+/g;
const GENERATED_SURFACE_KINDS = [
  "assistant_note",
  "prompt_mentor",
  "experiment_setup",
] as const;

const AssistantNote = defineComponent({
  name: "AssistantNote",
  description:
    "Renders a bounded assistant-generated note inside an approved cockpit zone.",
  props: z.object({
    title: z.string().max(MAX_GENERATED_SURFACE_TITLE_LENGTH),
    body: z.string().max(MAX_GENERATED_SURFACE_BODY_LENGTH),
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
  if (
    surface.status !== "ready" ||
    !GENERATED_SURFACE_KINDS.includes(surface.kind)
  ) {
    return null;
  }

  const title = sanitizeGeneratedSurfaceText(
    surface.title,
    "Generated Surface",
    MAX_GENERATED_SURFACE_TITLE_LENGTH,
  );
  const body = sanitizeGeneratedSurfaceText(
    surface.body,
    "No generated surface content was provided.",
    MAX_GENERATED_SURFACE_BODY_LENGTH,
  );

  // Only synthesized text props enter OpenUI. Actions and durable cockpit state
  // are intentionally not serialized into the generated surface artifact.
  return `root = AssistantNote(${JSON.stringify(title)}, ${JSON.stringify(body)})`;
}

function sanitizeGeneratedSurfaceText(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  const normalized =
    typeof value === "string"
      ? value
          .replace(CONTROL_CHARACTERS_PATTERN, "")
          .replace(WHITESPACE_PATTERN, " ")
          .trim()
      : "";

  const text = normalized || fallback;
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}
