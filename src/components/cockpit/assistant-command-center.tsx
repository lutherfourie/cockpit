"use client";

import { FormEvent, type ReactNode, useState } from "react";
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
  const selectedEvent = [...events]
    .reverse()
    .find((event) => event.type === "assistant_message" || event.type === "artifact");

  if (!isOpen) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
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
        aria-label="Assistant Command Center"
      >
        <header className="cockpit-command-center-header border-b px-4 py-3">
          <div>
            <p className="cockpit-muted flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
              <Sparkles className="size-4" />
              Cockpit assistant
            </p>
            <h2 className="text-xl font-semibold">Assistant Command Center</h2>
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
              Threads
            </h3>
            <div className="cockpit-mini-readout border px-3 py-2 text-xs">
              <History className="size-4" />
              <span>Active session</span>
              <strong>{events.length}</strong>
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
                      {event.role === "assistant" ||
                      event.type === "artifact" ||
                      event.type === "tool_result" ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ActionButton onClick={() => onPromote(event.content)}>
                            Use in Cockpit
                          </ActionButton>
                          <ActionButton onClick={() => onPark(event.content)}>
                            Park
                          </ActionButton>
                          <ActionButton onClick={() => onCreateHandoff(event.content)}>
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
                  disabled={isSubmitting}
                  className="cockpit-primary inline-flex min-h-12 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <SendHorizonal className="size-4" />
                  )}
                  Ask
                </button>
              </div>
            </form>
          </div>

          <aside className="cockpit-command-artifact hidden border-l p-4 lg:block">
            <h3 className="cockpit-muted mb-3 text-xs font-semibold uppercase tracking-normal">
              Actions
            </h3>
            {selectedEvent ? (
              <div className="cockpit-panel cockpit-panel-action border p-3">
                <p className="mb-3 text-sm leading-5">{selectedEvent.content}</p>
                <div className="grid gap-2">
                  <ActionButton onClick={() => onPromote(selectedEvent.content)}>
                    Use in Cockpit
                  </ActionButton>
                  <ActionButton onClick={() => onPark(selectedEvent.content)}>
                    Park
                  </ActionButton>
                  <ActionButton onClick={() => onCreateHandoff(selectedEvent.content)}>
                    Create handoff
                  </ActionButton>
                </div>
              </div>
            ) : (
              <p className="cockpit-muted text-sm leading-6">
                Assistant outputs and tool cards will collect here.
              </p>
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
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cockpit-button inline-flex min-h-8 items-center justify-center gap-2 border px-3 text-xs font-semibold"
    >
      {children === "Park" ? <ParkingCircle className="size-3.5" /> : null}
      {children}
    </button>
  );
}

function formatEventLabel(event: AssistantEvent): string {
  return event.type.replace(/_/g, " ");
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
