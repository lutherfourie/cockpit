"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };
const MAX_AGENT_HISTORY_MESSAGES = 24;
const MAX_AGENT_MESSAGE_CHARS = 4000;
const MESSAGE_TOO_LONG_ERROR = "Keep messages under 4000 characters.";

type StreamEvent =
  | { kind: "text_delta"; text?: string }
  | { kind: "error"; err?: string }
  | { kind: "done" }
  | { kind: string; [k: string]: unknown };

function buildBoundedHistory(messages: ChatMessage[]): ChatMessage[] {
  const cleaned = messages
    .map((message) => ({ ...message, content: message.content.trim() }))
    .filter(
      (message) =>
        message.content.length > 0 && message.content.length <= MAX_AGENT_MESSAGE_CHARS,
    )
    .slice(-MAX_AGENT_HISTORY_MESSAGES);

  return cleaned[0]?.role === "assistant" ? cleaned.slice(1) : cleaned;
}

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftTooLong = draft.trim().length > MAX_AGENT_MESSAGE_CHARS;
  const validationError = draftTooLong ? MESSAGE_TOO_LONG_ERROR : error;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    if (text.length > MAX_AGENT_MESSAGE_CHARS) {
      setError(MESSAGE_TOO_LONG_ERROR);
      return;
    }

    setError(null);
    setDraft("");

    const history = buildBoundedHistory([...messages, { role: "user", content: text }]);
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.body) throw new Error("No response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const json = line.slice(line.indexOf("data:") + 5).trim();
          if (!json) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(json) as StreamEvent;
          } catch {
            continue;
          }
          if (evt.kind === "text_delta" && typeof evt.text === "string") {
            const delta = evt.text;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + delta };
              return next;
            });
          } else if (evt.kind === "error") {
            setError(typeof evt.err === "string" ? evt.err : "Something went wrong.");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStreaming(false);
    }
  }, [draft, messages, streaming]);

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col px-4">
      <header className="py-6 text-center">
        <h1 className="text-lg font-medium text-neutral-100">Here with you</h1>
        <p className="text-sm text-neutral-400">Say whatever&apos;s on your mind — no pressure, no right answer.</p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <p className="mt-16 text-center text-sm text-neutral-500">
            What&apos;s rattling around up there? Dump it out — I&apos;ll help you make sense of it.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-2xl bg-neutral-700 px-4 py-2 text-neutral-50"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-4 py-2 leading-relaxed text-neutral-100 ring-1 ring-neutral-800"
              }
            >
              {m.content || (streaming && i === messages.length - 1 ? <span className="text-neutral-500">…</span> : "")}
            </div>
          </div>
        ))}
        {validationError && <p className="px-1 text-sm text-amber-400">{validationError}</p>}
      </div>

      <form
        className="sticky bottom-0 flex items-end gap-2 bg-transparent py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Talk to me…"
          className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-2xl bg-neutral-900 px-4 py-3 text-neutral-100 ring-1 ring-neutral-800 outline-none placeholder:text-neutral-500 focus:ring-neutral-600"
        />
        <button
          type="submit"
          disabled={streaming || !draft.trim() || draftTooLong}
          className="h-[2.75rem] rounded-2xl bg-neutral-100 px-5 font-medium text-neutral-900 disabled:opacity-40"
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </main>
  );
}
