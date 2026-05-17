"use client";

import type { ReactNode } from "react";
import {
  Renderer,
  createLibrary,
  defineComponent,
} from "@openuidev/react-lang";
import {
  ClipboardCheck,
  Forward,
  ListTodo,
  ParkingCircle,
  Target,
} from "lucide-react";
import { z } from "zod";

import type { CockpitAgentOutput } from "@/lib/cockpit/schema";

const CockpitStream = defineComponent({
  name: "CockpitStream",
  description:
    "Renders the constrained cockpit output with current goal, next action, proof, parking lot, and handoff.",
  props: z.object({
    currentGoal: z.string(),
    nextAction: z.string(),
    proofNeeded: z.string(),
    parkingLot: z.string().optional(),
    handoff: z.string().optional(),
    assumptions: z.string().optional(),
    blockers: z.string().optional(),
  }),
  component: ({ props }) => {
    const {
      currentGoal,
      nextAction,
      proofNeeded,
      parkingLot,
      handoff,
      assumptions,
      blockers,
    } = props;

    return (
      <div className="cockpit-panel-grid grid min-h-0 gap-3 lg:grid-cols-[1.1fr_1fr]">
        <CockpitPanel
          title="Current Goal"
          icon={<Target className="size-4" />}
          value={currentGoal}
          emphasis="strong"
          variant="goal"
        />
        <CockpitPanel
          title="Next Action"
          icon={<ListTodo className="size-4" />}
          value={nextAction}
          emphasis="strong"
          variant="action"
        />
        <CockpitPanel
          title="Proof Needed"
          icon={<ClipboardCheck className="size-4" />}
          value={proofNeeded}
          variant="proof"
        />
        <CockpitPanel
          title="Parking Lot"
          icon={<ParkingCircle className="size-4" />}
          value={parkingLot || "No parked items yet."}
          list
          variant="parking"
        />
        <CockpitPanel
          title="Handoff"
          icon={<Forward className="size-4" />}
          value={handoff || "No handoff drafted for this turn."}
          variant="handoff"
          wide
        />
        <div className="grid gap-3 md:grid-cols-2 lg:col-span-2">
          <CockpitPanel
            title="Assumptions"
            value={assumptions || "No assumptions recorded."}
            list
            quiet
            variant="quiet"
          />
          <CockpitPanel
            title="Blockers"
            value={blockers || "No blockers recorded."}
            list
            quiet
            variant="blocker"
          />
        </div>
      </div>
    );
  },
});

export const cockpitOpenUiLibrary = createLibrary({
  components: [CockpitStream],
  root: "CockpitStream",
});

export function CockpitOpenUiRenderer({
  output,
  isStreaming,
}: {
  output: CockpitAgentOutput;
  isStreaming?: boolean;
}) {
  return (
    <Renderer
      response={toOpenUiResponse(output)}
      library={cockpitOpenUiLibrary}
      isStreaming={Boolean(isStreaming)}
    />
  );
}

export function toOpenUiResponse(output: CockpitAgentOutput): string {
  return `root = CockpitStream(${[
    openUiString(output.currentGoal),
    openUiString(output.nextAction),
    openUiString(output.proofNeeded),
    openUiString(formatList(output.parkingLot)),
    openUiString(output.handoff ?? ""),
    openUiString(formatList(output.assumptions)),
    openUiString(formatList(output.blockers)),
  ].join(", ")})`;
}

function CockpitPanel({
  title,
  icon,
  value,
  list,
  quiet,
  emphasis,
  variant = "default",
  wide,
}: {
  title: string;
  icon?: ReactNode;
  value: string;
  list?: boolean;
  quiet?: boolean;
  emphasis?: "strong";
  variant?: "default" | "goal" | "action" | "proof" | "parking" | "handoff" | "quiet" | "blocker";
  wide?: boolean;
}) {
  const items = list
    ? value
        .split(/\n+/)
        .map((item) => item.replace(/^-\s*/, "").trim())
        .filter(Boolean)
    : [];

  return (
    <section
      className={[
        "cockpit-panel min-h-[132px] border p-4 shadow-sm",
        `cockpit-panel-${variant}`,
        wide ? "lg:col-span-2" : "",
        quiet ? "cockpit-panel-quiet" : "",
      ].join(" ")}
      data-testid={title.toLowerCase().replace(/\s+/g, "-")}
    >
      <div className="cockpit-panel-heading cockpit-muted mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
        {icon ? <span className="cockpit-panel-icon">{icon}</span> : null}
        <h2>{title}</h2>
      </div>
      {list ? (
        <ul className="space-y-2 text-sm leading-6">
          {items.map((item) => (
            <li key={item} className="cockpit-list-item border-l-2 pl-3">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p
          className={[
            "text-sm leading-6",
            emphasis === "strong" ? "cockpit-strong text-base font-semibold" : "",
          ].join(" ")}
        >
          {value}
        </p>
      )}
    </section>
  );
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "";
}

function openUiString(value: string): string {
  return JSON.stringify(value);
}
