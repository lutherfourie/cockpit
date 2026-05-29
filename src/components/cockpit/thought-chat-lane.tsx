"use client";

import { FormEvent, useState } from "react";
import {
  ChevronDown,
  Loader2,
  MessageSquareText,
  SendHorizonal,
} from "lucide-react";

import type { ThoughtChatMessage } from "@/lib/cockpit/kernel-state";
import type { ThoughtChatResult } from "@/lib/cockpit/thought-chat";

type ThoughtChatLaneProps = {
  messages: ThoughtChatMessage[];
  onAppendMessage: (message: ThoughtChatMessage) => void;
  onPromote: (text: string) => void;
  compact?: boolean;
  testId?: string;
};

const MAX_VISIBLE_MESSAGES = 6;
const MAX_HISTORY_MESSAGES = 12;
const MAX_DRAFT_CHARACTERS = 600;

export function ThoughtChatLane({
  messages,
  onAppendMessage,
  onPromote,
  compact = false,
  testId = "thought-chat",
}: ThoughtChatLaneProps) {
  const [isOpen, setIsOpen] = useState(() => messages.length > 0);
  const [draft, setDraft] = useState("");
  const [promoteText, setPromoteText] = useState("");
  const [isPhrasing, setIsPhrasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const laneId = `${testId}-lane`;
  const inputId = `${testId}-input`;
  const visibleMessages = messages.slice(-MAX_VISIBLE_MESSAGES);
  const hiddenMessageCount = Math.max(
    0,
    messages.length - visibleMessages.length,
  );
  const hasDraft = draft.trim().length > 0;
  const statusText =
    messages.length > 0
      ? `Latest ${visibleMessages.length} of ${messages.length}`
      : "No scratch history";

  async function phraseThought(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPhrasing) {
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Add a thought to phrase.");
      return;
    }

    const userMessage = createThoughtMessage("user", trimmed);
    onAppendMessage(userMessage);
    setDraft("");
    setPromoteText("");
    setError(null);
    setIsPhrasing(true);

    try {
      const boundedHistory = messages
        .slice(-MAX_HISTORY_MESSAGES)
        .map(({ role, content }) => ({ role, content }));
      const response = await fetch("/api/cockpit/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: boundedHistory,
        }),
      });
      const payload = (await response.json()) as Partial<ThoughtChatResult> & {
        error?: string;
      };

      if (!response.ok || !payload.message || !payload.promoteText) {
        throw new Error(payload.error ?? "Thought Chat request failed.");
      }

      onAppendMessage(createThoughtMessage("assistant", payload.message.content));
      setPromoteText(payload.promoteText);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Thought Chat request failed.",
      );
    } finally {
      setIsPhrasing(false);
    }
  }

  return (
    <section
      data-testid={testId}
      className={compact ? "grid gap-3" : "cockpit-surface border-t px-4 py-3"}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={laneId}
        onClick={() => setIsOpen((current) => !current)}
        className="cockpit-button flex min-h-12 w-full items-center justify-between gap-3 border px-3 py-2 text-left text-sm font-semibold"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="cockpit-mini-readout inline-flex size-8 shrink-0 items-center justify-center border">
            <MessageSquareText className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block">Assistant / Thought Chat</span>
            <span className="cockpit-muted block text-xs font-medium">
              {isPhrasing ? "Phrasing" : statusText}
            </span>
          </span>
        </span>
        <ChevronDown
          className={[
            "size-4 transition-transform",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {isOpen ? (
        <div id={laneId} className="mt-3 grid gap-3">
          {visibleMessages.length > 0 ? (
            <div className="grid max-h-48 gap-2 overflow-auto text-sm">
              {hiddenMessageCount > 0 ? (
                <p className="cockpit-muted text-xs font-medium">
                  Latest {visibleMessages.length} of {messages.length} shown.
                  {hiddenMessageCount} older hidden.
                </p>
              ) : null}
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={[
                    "border px-3 py-2 text-left",
                    message.role === "assistant"
                      ? "cockpit-mini-readout"
                      : "cockpit-surface-alt",
                  ].join(" ")}
                >
                  <p className="cockpit-muted mb-1 text-xs font-semibold uppercase tracking-normal">
                    {message.role === "assistant" ? "Assistant" : "You"}
                  </p>
                  <p className="whitespace-pre-wrap leading-5">{message.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="cockpit-mini-readout border px-3 py-2 text-sm">
              No scratch messages yet.
            </div>
          )}

          {error ? (
            <div className="cockpit-alert border px-3 py-2 text-sm" role="alert">
              {error}
            </div>
          ) : null}

          <form onSubmit={phraseThought} className="grid gap-2">
            <label className="sr-only" htmlFor={inputId}>
              Thought Chat
            </label>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <textarea
                id={inputId}
                value={draft}
                maxLength={MAX_DRAFT_CHARACTERS}
                rows={compact ? 2 : 3}
                onChange={(event) => {
                  setDraft(event.target.value.slice(0, MAX_DRAFT_CHARACTERS));
                  if (error && event.target.value.trim()) {
                    setError(null);
                  }
                }}
                placeholder="Help me put this into words"
                className="cockpit-input min-h-20 resize-none border px-3 py-3 text-sm leading-5 outline-none"
              />
              <button
                type="submit"
                disabled={isPhrasing || !hasDraft}
                aria-busy={isPhrasing}
                className="cockpit-primary inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:cursor-not-allowed md:min-h-20"
              >
                {isPhrasing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <SendHorizonal className="size-4" />
                )}
                {isPhrasing ? "Phrasing" : "Phrase"}
              </button>
            </div>
            <div className="cockpit-muted flex items-center justify-between gap-3 text-xs">
              <span aria-live="polite">
                {isPhrasing ? "Request in progress." : statusText}
              </span>
              <span>
                {draft.length}/{MAX_DRAFT_CHARACTERS}
              </span>
            </div>
          </form>

          {promoteText ? (
            <button
              type="button"
              onClick={() => onPromote(promoteText)}
              className="cockpit-button inline-flex min-h-10 items-center justify-center border px-3 text-sm font-semibold md:w-fit"
            >
              Use As Cockpit Input
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function createThoughtMessage(
  role: ThoughtChatMessage["role"],
  content: string,
): ThoughtChatMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${role}-${Date.now()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
