"use client";

import type { KeyboardEvent } from "react";
import { CheckCircle2, ClipboardCheck, ListTodo, Target } from "lucide-react";

import type { CockpitAgentOutput } from "@/lib/cockpit/schema";

const PANEL_NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

export function CockpitPanels({ output }: { output: CockpitAgentOutput }) {
  function movePanelFocus(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.dataset.panelNavItem !== "true" ||
      !PANEL_NAV_KEYS.has(event.key)
    ) {
      return;
    }

    const panels = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[data-panel-nav-item='true']"),
    );
    const currentIndex = panels.indexOf(target);
    if (currentIndex < 0) {
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = panels.length - 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + panels.length) % panels.length;
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % panels.length;
    }

    event.preventDefault();
    panels[nextIndex]?.focus();
  }

  return (
    <div
      role="group"
      aria-label="Stable cockpit panels"
      aria-describedby="cockpit-panels-keyboard-help"
      className="grid min-h-0 gap-3"
      onKeyDown={movePanelFocus}
    >
      <p id="cockpit-panels-keyboard-help" className="sr-only">
        Use arrow keys, Home, and End while focused on a panel region to move between
        stable cockpit panels.
      </p>
      <section
        role="region"
        aria-labelledby="current-goal-heading"
        aria-describedby="current-goal-copy"
        tabIndex={0}
        className="cockpit-panel cockpit-panel-goal cockpit-hero-panel border p-5 md:p-6"
        data-testid="current-goal"
        data-panel-nav-item="true"
      >
        <div className="cockpit-panel-heading mb-4 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-normal">
          <div className="inline-flex min-w-0 items-center gap-2">
            <Target className="size-4" aria-hidden="true" focusable="false" />
            <h2 id="current-goal-heading">Current Goal</h2>
          </div>
          <span className="cockpit-live-pill">Mission Objective</span>
        </div>
        <p
          id="current-goal-copy"
          className="cockpit-hero-copy text-2xl font-semibold leading-tight md:text-3xl xl:text-4xl"
        >
          {output.currentGoal}
        </p>
      </section>

      <section
        role="region"
        aria-labelledby="next-action-heading"
        aria-describedby="next-action-copy"
        tabIndex={0}
        className="cockpit-panel cockpit-panel-action border p-5"
        data-testid="next-action"
        data-panel-nav-item="true"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="cockpit-panel-heading flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-normal">
            <ListTodo className="size-4" aria-hidden="true" focusable="false" />
            <h2 id="next-action-heading">Next Action</h2>
          </div>
          <span className="cockpit-live-pill cockpit-live-pill-muted">Active Move</span>
        </div>

        <div className="cockpit-active-move-grid grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
          <div>
            <p
              id="next-action-copy"
              className="cockpit-strong text-base font-semibold leading-7"
            >
              {output.nextAction}
            </p>
            <div
              role="group"
              aria-label="Next action controls"
              className="mt-5 flex flex-wrap gap-2"
            >
              <button
                type="button"
                aria-label="Start next action"
                className="cockpit-primary min-h-10 px-4 text-sm font-semibold"
              >
                Start
              </button>
              <button
                type="button"
                aria-label="Refine next action"
                className="cockpit-button min-h-10 border px-4 text-sm font-semibold"
              >
                Refine
              </button>
            </div>
          </div>

          <section
            role="region"
            aria-labelledby="proof-needed-heading"
            aria-describedby="proof-needed-copy"
            tabIndex={0}
            className="cockpit-proof-box border p-4"
            data-testid="proof-needed"
            data-panel-nav-item="true"
          >
            <div className="cockpit-panel-heading mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
              <ClipboardCheck className="size-4" aria-hidden="true" focusable="false" />
              <h3 id="proof-needed-heading">Proof Needed</h3>
            </div>
            <p id="proof-needed-copy" className="text-sm leading-6">
              {output.proofNeeded}
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs">
              <CheckCircle2
                className="size-4 text-[var(--cockpit-proof)]"
                aria-hidden="true"
                focusable="false"
              />
              <span className="cockpit-muted">Win condition for this move</span>
            </div>
          </section>
        </div>

        {output.assumptions.length > 0 ? (
          <section
            role="region"
            aria-labelledby="assumptions-heading"
            tabIndex={0}
            className="cockpit-assumptions mt-4 border p-3"
            data-panel-nav-item="true"
          >
            <h3
              id="assumptions-heading"
              className="cockpit-muted mb-2 text-xs font-semibold uppercase tracking-normal"
            >
              Assumptions
            </h3>
            <ul className="grid gap-1 text-sm leading-5">
              {output.assumptions.map((assumption, index) => (
                <li key={`${index}-${assumption}`}>{assumption}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </div>
  );
}
