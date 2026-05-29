"use client";

import { FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  CheckCircle2,
  FileText,
  History,
  Loader2,
  MessageSquareText,
  ParkingCircle,
  SendHorizonal,
  Sparkles,
  X,
} from "lucide-react";

import type { AssistantEvent } from "@/lib/cockpit/assistant-events";

const ACTIONABLE_EVENT_TYPES = new Set<AssistantEvent["type"]>([
  "assistant_message",
  "artifact",
  "tool_result",
]);

type AssistantCommandCenterProps = {
  isOpen: boolean;
  events: AssistantEvent[];
  isSubmitting: boolean;
  runtimeStatus: string;
  onClose: () => void;
  onSubmitMessage: (message: string) => void | Promise<void>;
  onPromote: (text: string) => void;
  onPark: (text: string) => void;
  onCreateHandoff: (text: string) => void;
};

export function AssistantCommandCenter({
  isOpen,
  events,
  isSubmitting,
  runtimeStatus,
  onClose,
  onSubmitMessage,
  onPromote,
  onPark,
  onCreateHandoff,
}: AssistantCommandCenterProps) {
  const [draft, setDraft] = useState("");
  const actionableEvents = events.filter(isActionableEvent);
  const selectedEvent = actionableEvents[actionableEvents.length - 1];
  const draftIsEmpty = draft.trim().length === 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isSubmitting) {
      return;
    }

    await onSubmitMessage(trimmed);
    setDraft("");
  }

  return (
    <div className="cockpit-command-center fixed inset-0 z-40 p-3 md:p-6">
      <div className="cockpit-command-center-backdrop absolute inset-0" />
      <section
        className="cockpit-command-center-shell cockpit-surface relative mx-auto grid h-full max-w-[1320px] overflow-hidden border"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-command-center-title"
        aria-label="Assistant Command Center"
      >
        <header className="cockpit-command-center-header border-b px-4 py-3">
          <div>
            <p className="cockpit-muted flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
              <Sparkles className="size-4" />
              Cockpit assistant
            </p>
            <h2 id="assistant-command-center-title" className="text-xl font-semibold">
              Assistant Command Center
            </h2>
            <p className="cockpit-muted mt-1 text-xs">{runtimeStatus}</p>
          </div>
          <button
            type="button"
            aria-label="Close Assistant Command Center"
            onClick={onClose}
            className="cockpit-button inline-flex size-9 items-center justify-center border"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
          <aside className="cockpit-command-side hidden border-r p-4 lg:block">
            <h3 className="cockpit-muted mb-3 text-xs font-semibold uppercase tracking-normal">
              Session
            </h3>
            <div className="cockpit-mini-readout mb-2 border px-3 py-2 text-xs">
              <History className="size-4" />
              <span>Timeline</span>
              <strong>{events.length}</strong>
            </div>
            <div className="cockpit-mini-readout mb-2 border px-3 py-2 text-xs">
              <Sparkles className="size-4" />
              <span>Actionable outputs</span>
              <strong>{actionableEvents.length}</strong>
            </div>
            <div className="cockpit-mini-readout border px-3 py-2 text-xs">
              <CheckCircle2 className="size-4" />
              <span>Status</span>
              <strong>{isSubmitting ? "Sending" : "Ready"}</strong>
            </div>
          </aside>

          <div className="grid min-h-0 grid-rows-[1fr_auto]">
            <div className="min-h-0 overflow-auto p-4">
              {events.length > 0 ? (
                <ol className="grid gap-3">
                  {events.map((event) => (
                    <li
                      key={event.id}
                      className={[
                        "cockpit-timeline-event border p-3",
                        event.role === "user" ? "is-user" : "is-assistant",
                      ].join(" ")}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="cockpit-muted text-xs font-semibold uppercase tracking-normal">
                          {formatEventLabel(event)}
                        </span>
                        <span className="cockpit-muted text-xs">
                          {formatEventTime(event.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {event.content}
                      </p>
                      {isActionableEvent(event) ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ActionButton
                            icon={<CheckCircle2 className="size-3.5" />}
                            onClick={() => onPromote(event.content)}
                          >
                            Use in Cockpit
                          </ActionButton>
                          <ActionButton
                            icon={<ParkingCircle className="size-3.5" />}
                            onClick={() => onPark(event.content)}
                          >
                            Park
                          </ActionButton>
                          <ActionButton
                            icon={<FileText className="size-3.5" />}
                            onClick={() => onCreateHandoff(event.content)}
                          >
                            Handoff
                          </ActionButton>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="cockpit-panel cockpit-panel-quiet border p-4">
                  <p className="text-sm leading-6">
                    Ask Cockpit here when the work needs conversation, tool calls,
                    generated UI, or a decision trail.
                  </p>
                </div>
              )}
            </div>

            <form
              onSubmit={submit}
              className="cockpit-command-composer border-t p-3"
            >
              <label className="sr-only" htmlFor="assistant-command-input">
                Assistant message
              </label>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <textarea
                  id="assistant-command-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask Cockpit to reason, inspect, phrase, or create a next move."
                  rows={2}
                  className="cockpit-input min-h-12 resize-none border px-3 py-2 text-sm outline-none"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || draftIsEmpty}
                  className="cockpit-primary inline-flex min-h-12 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <SendHorizonal className="size-4" />
                  )}
                  {isSubmitting ? "Sending" : "Ask"}
                </button>
              </div>
            </form>
          </div>

          <aside className="cockpit-command-artifact hidden border-l p-4 lg:block">
            <h3 className="cockpit-muted mb-3 text-xs font-semibold uppercase tracking-normal">
              Actions
            </h3>
            {selectedEvent ? (
              <div
                className="cockpit-panel cockpit-panel-action border p-3"
                data-testid="assistant-action-panel"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="cockpit-muted text-xs font-semibold uppercase tracking-normal">
                      Latest actionable output
                    </p>
                    <p className="text-sm font-semibold">
                      {formatEventLabel(selectedEvent)}
                    </p>
                  </div>
                  <span className="cockpit-muted text-xs">
                    {formatEventTime(selectedEvent.createdAt)}
                  </span>
                </div>
                <p className="mb-3 whitespace-pre-wrap text-sm leading-5">
                  {selectedEvent.content}
                </p>
                <div className="grid gap-2">
                  <ActionButton
                    icon={<CheckCircle2 className="size-3.5" />}
                    onClick={() => onPromote(selectedEvent.content)}
                  >
                    Use in Cockpit
                  </ActionButton>
                  <ActionButton
                    icon={<ParkingCircle className="size-3.5" />}
                    onClick={() => onPark(selectedEvent.content)}
                  >
                    Park
                  </ActionButton>
                  <ActionButton
                    icon={<FileText className="size-3.5" />}
                    onClick={() => onCreateHandoff(selectedEvent.content)}
                  >
                    Create handoff
                  </ActionButton>
                </div>
              </div>
            ) : (
              <div
                className="cockpit-panel cockpit-panel-quiet border p-3"
                data-testid="assistant-action-panel"
              >
                <p className="cockpit-muted text-sm leading-6">
                  No assistant output ready for cockpit actions.
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

export function ActivityFeed({
  events,
  proofNeeded,
}: {
  events: AssistantEvent[];
  proofNeeded: string;
}) {
  const latestAssistantEvent = [...events]
    .reverse()
    .find((event) => event.role === "assistant");

  return (
    <div className="grid gap-3" data-testid="activity-feed">
      <section className="cockpit-panel border p-4">
        <div className="cockpit-panel-heading mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
          <MessageSquareText className="size-4" />
          <h2>Activity</h2>
        </div>
        <ActivityItem
          icon={<Sparkles className="size-4" />}
          label="Latest assistant output"
          text={latestAssistantEvent?.content ?? "No assistant activity yet."}
        />
        <ActivityItem
          icon={<CheckCircle2 className="size-4" />}
          label="Proof status"
          text={proofNeeded}
        />
        <ActivityItem
          icon={<FileText className="size-4" />}
          label="Event stream"
          text={`${events.length} assistant timeline events`}
        />
      </section>
    </div>
  );
}

function ActivityItem({
  icon,
  label,
  text,
}: {
  icon: ReactNode;
  label: string;
  text: string;
}) {
  return (
    <div className="cockpit-activity-item border px-3 py-2">
      <div className="cockpit-muted mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
        {icon}
        {label}
      </div>
      <p className="text-sm leading-5">{text}</p>
    </div>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cockpit-button inline-flex min-h-8 items-center justify-center gap-2 border px-3 text-xs font-semibold"
    >
      {icon}
      {children}
    </button>
  );
}

function isActionableEvent(event: AssistantEvent): boolean {
  return event.role !== "user" && ACTIONABLE_EVENT_TYPES.has(event.type);
}

function formatEventLabel(event: AssistantEvent): string {
  return event.type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Time unknown";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
