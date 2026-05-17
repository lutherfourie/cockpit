"use client";

import type { ReactNode } from "react";
import {
  ClipboardCheck,
  Forward,
  ListTodo,
  ParkingCircle,
  Target,
} from "lucide-react";

import type { CockpitAgentOutput } from "@/lib/cockpit/schema";

export function CockpitPanels({ output }: { output: CockpitAgentOutput }) {
  return (
    <div className="cockpit-panel-grid grid min-h-0 gap-3 lg:grid-cols-[1.1fr_1fr]">
      <CockpitPanel
        title="Current Goal"
        icon={<Target className="size-4" />}
        value={output.currentGoal}
        emphasis="strong"
        variant="goal"
      />
      <CockpitPanel
        title="Next Action"
        icon={<ListTodo className="size-4" />}
        value={output.nextAction}
        emphasis="strong"
        variant="action"
      />
      <CockpitPanel
        title="Proof Needed"
        icon={<ClipboardCheck className="size-4" />}
        value={output.proofNeeded}
        variant="proof"
      />
      <CockpitPanel
        title="Parking Lot"
        icon={<ParkingCircle className="size-4" />}
        items={output.parkingLot}
        emptyText="No parked items yet."
        variant="parking"
      />
      <CockpitPanel
        title="Handoff"
        icon={<Forward className="size-4" />}
        value={output.handoff || "No handoff drafted for this turn."}
        variant="handoff"
        wide
      />
      <div className="grid gap-3 md:grid-cols-2 lg:col-span-2">
        <CockpitPanel
          title="Assumptions"
          items={output.assumptions}
          emptyText="No assumptions recorded."
          quiet
          variant="quiet"
        />
        <CockpitPanel
          title="Blockers"
          items={output.blockers}
          emptyText="No blockers recorded."
          quiet
          variant="blocker"
        />
      </div>
    </div>
  );
}

function CockpitPanel({
  title,
  icon,
  value,
  items,
  emptyText,
  quiet,
  emphasis,
  variant = "default",
  wide,
}: {
  title: string;
  icon?: ReactNode;
  value?: string;
  items?: string[];
  emptyText?: string;
  quiet?: boolean;
  emphasis?: "strong";
  variant?:
    | "default"
    | "goal"
    | "action"
    | "proof"
    | "parking"
    | "handoff"
    | "quiet"
    | "blocker";
  wide?: boolean;
}) {
  const listItems = items ?? [];

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
      {items ? (
        listItems.length > 0 ? (
          <ul className="space-y-2 text-sm leading-6">
            {listItems.map((item, index) => (
              <li
                key={`${index}-${item}`}
                className="cockpit-list-item border-l-2 pl-3"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="cockpit-muted text-sm leading-6">{emptyText}</p>
        )
      ) : (
        <p
          className={[
            "text-sm leading-6",
            emphasis === "strong"
              ? "cockpit-strong text-base font-semibold"
              : "",
          ].join(" ")}
        >
          {value}
        </p>
      )}
    </section>
  );
}
