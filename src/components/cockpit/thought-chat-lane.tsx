"use client";

import { FormEvent, useState } from "react";
import { ChevronDown, MessageSquareText, SendHorizonal } from "lucide-react";

import type { ThoughtChatMessage } from "@/lib/cockpit/kernel-state";
import type { ThoughtChatResult } from "@/lib/cockpit/thought-chat";

type ThoughtChatLaneProps = {
  messages: ThoughtChatMessage[];
  onAppendMessage: (message: ThoughtChatMessage) => void;
  onPromote: (text: string) => void;
};

export function ThoughtChatLane({
  messages,
  onAppendMessage,
  onPromote,
}: ThoughtChatLaneProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [promoteText, setPromoteText] = useState("");
  const [isPhrasing, setIsPhrasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function phraseThought(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Add a thought to phrase.");
      return;
    }

    const userMessage = createThoughtMessage("user", trimmed);
    onAppendMessage(userMessage);
    setDraft("");
    setError(null);
    setIsPhrasing(true);

    try {
      const response = await fetch("/api/cockpit/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.map(({ role, content }) => ({ role, content })),
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
    <section className="cockpit-surface border-t px-4 py-3">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="thought-chat-lane"
        onClick={() => setIsOpen((current) => !current)}
        className="cockpit-button flex min-h-10 w-full items-center justify-between gap-3 border px-3 text-sm font-semibold"
      >
        <span className="inline-flex items-center gap-2">
          <MessageSquareText className="size-4" />
          Thought Chat
        </span>
        <ChevronDown
          className={[
            "size-4 transition-transform",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {isOpen ? (
        <div id="thought-chat-lane" className="mt-3 grid gap-3">
          {messages.length > 0 ? (
            <div className="grid max-h-48 gap-2 overflow-auto text-sm">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={[
                    "border px-3 py-2",
                    message.role === "assistant"
                      ? "cockpit-mini-readout"
                      : "cockpit-alert",
                  ].join(" ")}
                >
                  <p className="cockpit-muted mb-1 text-xs font-semibold uppercase tracking-normal">
                    {message.role === "assistant" ? "Assistant" : "You"}
                  </p>
                  <p className="whitespace-pre-wrap leading-5">{message.content}</p>
                </div>
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="cockpit-alert border px-3 py-2 text-sm">{error}</div>
          ) : null}

          <form onSubmit={phraseThought} className="grid gap-2 md:grid-cols-[1fr_auto]">
            <label className="sr-only" htmlFor="thought-chat-input">
              Thought Chat
            </label>
            <input
              id="thought-chat-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Help me put this into words"
              className="cockpit-input min-h-10 border px-3 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={isPhrasing}
              className="cockpit-primary inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:cursor-not-allowed"
            >
              <SendHorizonal className="size-4" />
              Phrase
            </button>
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
