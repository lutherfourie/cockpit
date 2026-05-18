"use client";

import { CheckCircle2, ClipboardCheck, ListTodo, Target } from "lucide-react";

import type { CockpitAgentOutput } from "@/lib/cockpit/schema";

export function CockpitPanels({ output }: { output: CockpitAgentOutput }) {
  return (
    <div className="grid min-h-0 gap-3">
      <section
        className="cockpit-panel cockpit-panel-goal cockpit-hero-panel border p-5 md:p-6"
        data-testid="current-goal"
      >
        <div className="cockpit-panel-heading mb-4 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-normal">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Target className="size-4" />
            <h2>Current Goal</h2>
          </span>
          <span className="cockpit-live-pill">Mission Objective</span>
        </div>
        <p className="cockpit-hero-copy text-2xl font-semibold leading-tight md:text-3xl xl:text-4xl">
          {output.currentGoal}
        </p>
      </section>

      <section
        className="cockpit-panel cockpit-panel-action border p-5"
        data-testid="next-action"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="cockpit-panel-heading flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-normal">
            <ListTodo className="size-4" />
            <h2>Next Action</h2>
          </div>
          <span className="cockpit-live-pill cockpit-live-pill-muted">Active Move</span>
        </div>

        <div className="cockpit-active-move-grid grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
          <div>
            <p className="cockpit-strong text-base font-semibold leading-7">
              {output.nextAction}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="cockpit-primary min-h-10 px-4 text-sm font-semibold">
                Start
              </button>
              <button type="button" className="cockpit-button min-h-10 border px-4 text-sm font-semibold">
                Refine
              </button>
            </div>
          </div>

          <div
            className="cockpit-proof-box border p-4"
            data-testid="proof-needed"
          >
            <div className="cockpit-panel-heading mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
              <ClipboardCheck className="size-4" />
              <h3>Proof Needed</h3>
            </div>
            <p className="text-sm leading-6">{output.proofNeeded}</p>
            <div className="mt-4 flex items-center gap-2 text-xs">
              <CheckCircle2 className="size-4 text-[var(--cockpit-proof)]" />
              <span className="cockpit-muted">Win condition for this move</span>
            </div>
          </div>
        </div>

        {output.assumptions.length > 0 ? (
          <div className="cockpit-assumptions mt-4 border p-3">
            <p className="cockpit-muted mb-2 text-xs font-semibold uppercase tracking-normal">
              Assumptions
            </p>
            <ul className="grid gap-1 text-sm leading-5">
              {output.assumptions.map((assumption, index) => (
                <li key={`${index}-${assumption}`}>{assumption}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
