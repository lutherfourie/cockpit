"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LogEntry =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "result"; detail: string; isError: boolean }
  | { kind: "error"; text: string }
  | { kind: "done" };

type StreamEvent = {
  kind: string;
  text?: string;
  err?: string;
  toolCall?: { name?: string; args?: Record<string, unknown> };
  toolResult?: { content?: string; isError?: boolean };
};

function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const path = typeof args.file_path === "string" ? args.file_path : undefined;
  if (path) return path;
  try {
    return JSON.stringify(args).slice(0, 200);
  } catch {
    return "";
  }
}

export default function SelfDevPage() {
  const [task, setTask] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  const run = useCallback(async () => {
    const text = task.trim();
    if (!text || running) return;
    setLog([]);
    setRunning(true);

    try {
      const res = await fetch("/api/agent/selfdev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: text }),
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
            setLog((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.kind === "text") {
                next[next.length - 1] = { kind: "text", text: last.text + delta };
                return next;
              }
              return [...next, { kind: "text", text: delta }];
            });
          } else if (evt.kind === "tool_call" && evt.toolCall) {
            setLog((prev) => [
              ...prev,
              { kind: "tool", name: evt.toolCall?.name ?? "tool", detail: summarizeArgs(evt.toolCall?.args) },
            ]);
          } else if (evt.kind === "tool_result" && evt.toolResult) {
            setLog((prev) => [
              ...prev,
              {
                kind: "result",
                detail: (evt.toolResult?.content ?? "").slice(0, 200),
                isError: !!evt.toolResult?.isError,
              },
            ]);
          } else if (evt.kind === "error") {
            setLog((prev) => [...prev, { kind: "error", text: evt.err ?? "Something went wrong." }]);
          }
        }
      }
    } catch (e) {
      setLog((prev) => [...prev, { kind: "error", text: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally {
      setRunning(false);
    }
  }, [task, running]);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4">
      <header className="py-6">
        <h1 className="text-lg font-medium text-neutral-100">Cockpit self-development</h1>
        <p className="text-sm text-neutral-400">
          Describe a change and Cockpit will edit its own source via the Vibe daemon (claude provider).
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pb-4 font-mono text-sm">
        {log.length === 0 && !running && (
          <p className="mt-16 text-center text-neutral-500">No run yet. Give it a task below.</p>
        )}
        {log.map((entry, i) => {
          if (entry.kind === "tool") {
            return (
              <div key={i} className="rounded-lg bg-neutral-900 px-3 py-2 text-sky-300 ring-1 ring-neutral-800">
                <span className="font-semibold">{entry.name}</span>
                {entry.detail && <span className="ml-2 text-neutral-400">{entry.detail}</span>}
              </div>
            );
          }
          if (entry.kind === "result") {
            return (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 ring-1 ${entry.isError ? "bg-red-950 text-red-300 ring-red-900" : "bg-neutral-900 text-emerald-300 ring-neutral-800"}`}
              >
                {entry.detail}
              </div>
            );
          }
          if (entry.kind === "error") {
            return (
              <p key={i} className="px-1 text-amber-400">
                {entry.text}
              </p>
            );
          }
          if (entry.kind === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap rounded-lg bg-neutral-950 px-3 py-2 text-neutral-100 ring-1 ring-neutral-800">
                {entry.text}
              </div>
            );
          }
          return null;
        })}
        {running && <p className="px-1 text-neutral-500">working…</p>}
      </div>

      <form
        className="sticky bottom-0 flex items-end gap-2 bg-transparent py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
          }}
          rows={2}
          placeholder="e.g. Add a /healthz route that returns ok"
          className="max-h-40 min-h-[3.5rem] flex-1 resize-none rounded-2xl bg-neutral-900 px-4 py-3 text-neutral-100 ring-1 ring-neutral-800 outline-none placeholder:text-neutral-500 focus:ring-neutral-600"
        />
        <button
          type="submit"
          disabled={running || !task.trim()}
          className="h-[3.5rem] rounded-2xl bg-neutral-100 px-5 font-medium text-neutral-900 disabled:opacity-40"
        >
          {running ? "…" : "Run"}
        </button>
      </form>
    </main>
  );
}
