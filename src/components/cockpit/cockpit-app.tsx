"use client";

import { FormEvent, useMemo, useState, useSyncExternalStore } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Crosshair,
  Gauge,
  Loader2,
  Moon,
  Plus,
  Radio,
  SendHorizonal,
  Sun,
} from "lucide-react";

import {
  COCKPIT_MODES,
  type CockpitAgentOutput,
  type CockpitMode,
  type CockpitPersistence,
  type CockpitTurnResult,
} from "@/lib/cockpit/schema";
import { CockpitOpenUiRenderer } from "@/lib/openui/cockpit-library";

const INITIAL_OUTPUT: CockpitAgentOutput = {
  currentGoal: "Capture the next development move without expanding the scope.",
  nextAction: "Paste the messy thought, choose a mode, and ask Cockpit to compress it.",
  proofNeeded:
    "The three primary panels update into one coherent, checkable slice.",
  parkingLot: [],
  assumptions: ["No assistant turn has run yet."],
  blockers: [],
};

const INITIAL_PERSISTENCE: CockpitPersistence = {
  saved: false,
  source: "local",
};

const MODE_LABELS: Record<CockpitMode, string> = {
  clarify: "Clarify",
  plan: "Plan",
  focus: "Focus",
  recover: "Recover",
  handoff: "Handoff",
  review: "Review",
};

type CockpitTheme = "dim" | "light";

const COCKPIT_STATE_STORAGE_KEY = "cockpit:v1:state";
const COCKPIT_STATE_CHANGED_EVENT = "cockpit:state-changed";
const COCKPIT_THEME_VALUES = ["dim", "light"] as const;

type PersistedCockpitState = {
  output: CockpitAgentOutput;
  sessionId?: string;
  persistence: CockpitPersistence;
  mode: CockpitMode;
  theme: CockpitTheme;
};

const DEFAULT_COCKPIT_STATE: PersistedCockpitState = {
  output: INITIAL_OUTPUT,
  persistence: INITIAL_PERSISTENCE,
  mode: "focus",
  theme: "dim",
};

const DEFAULT_COCKPIT_STATE_RAW = JSON.stringify(DEFAULT_COCKPIT_STATE);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCockpitMode(value: unknown): value is CockpitMode {
  return (
    typeof value === "string" &&
    (COCKPIT_MODES as readonly string[]).includes(value)
  );
}

function isCockpitTheme(value: unknown): value is CockpitTheme {
  return (
    typeof value === "string" &&
    (COCKPIT_THEME_VALUES as readonly string[]).includes(value)
  );
}

function isCockpitAgentOutput(value: unknown): value is CockpitAgentOutput {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.currentGoal === "string" &&
    typeof value.nextAction === "string" &&
    typeof value.proofNeeded === "string" &&
    isStringArray(value.parkingLot) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.blockers) &&
    (value.handoff === undefined || typeof value.handoff === "string")
  );
}

function isCockpitPersistence(value: unknown): value is CockpitPersistence {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.saved === "boolean" &&
    typeof value.source === "string" &&
    ["supabase", "local", "none"].includes(value.source) &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function parsePersistedCockpitState(
  rawState: string | null,
): PersistedCockpitState {
  try {
    if (!rawState) {
      return DEFAULT_COCKPIT_STATE;
    }

    const parsedState = JSON.parse(rawState) as unknown;
    if (!isRecord(parsedState)) {
      return DEFAULT_COCKPIT_STATE;
    }

    return {
      output: isCockpitAgentOutput(parsedState.output)
        ? parsedState.output
        : DEFAULT_COCKPIT_STATE.output,
      ...(typeof parsedState.sessionId === "string" &&
      parsedState.sessionId.length > 0
        ? { sessionId: parsedState.sessionId }
        : {}),
      mode: isCockpitMode(parsedState.mode)
        ? parsedState.mode
        : DEFAULT_COCKPIT_STATE.mode,
      persistence: isCockpitPersistence(parsedState.persistence)
        ? parsedState.persistence
        : DEFAULT_COCKPIT_STATE.persistence,
      theme: isCockpitTheme(parsedState.theme)
        ? parsedState.theme
        : DEFAULT_COCKPIT_STATE.theme,
    };
  } catch {
    return DEFAULT_COCKPIT_STATE;
  }
}

function getCockpitStateSnapshot() {
  if (typeof window === "undefined") {
    return DEFAULT_COCKPIT_STATE_RAW;
  }

  return (
    window.localStorage.getItem(COCKPIT_STATE_STORAGE_KEY) ??
    DEFAULT_COCKPIT_STATE_RAW
  );
}

function getServerCockpitStateSnapshot() {
  return DEFAULT_COCKPIT_STATE_RAW;
}

function subscribeToCockpitState(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const timeoutId = window.setTimeout(onStoreChange, 0);
  const handleLocalChange = () => onStoreChange();
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === COCKPIT_STATE_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener(COCKPIT_STATE_CHANGED_EVENT, handleLocalChange);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.clearTimeout(timeoutId);
    window.removeEventListener(COCKPIT_STATE_CHANGED_EVENT, handleLocalChange);
    window.removeEventListener("storage", handleStorageChange);
  };
}

function writePersistedCockpitState(state: PersistedCockpitState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      COCKPIT_STATE_STORAGE_KEY,
      JSON.stringify(state),
    );
    window.dispatchEvent(new Event(COCKPIT_STATE_CHANGED_EVENT));
  } catch {
    // Local persistence is a convenience cache; Supabase remains the durable store.
  }
}

export function CockpitApp() {
  const persistedStateRaw = useSyncExternalStore(
    subscribeToCockpitState,
    getCockpitStateSnapshot,
    getServerCockpitStateSnapshot,
  );
  const cockpitState = useMemo(
    () => parsePersistedCockpitState(persistedStateRaw),
    [persistedStateRaw],
  );
  const { mode, theme, output, sessionId, persistence } = cockpitState;
  const [message, setMessage] = useState("");
  const [parkingDraft, setParkingDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const statusText = useMemo(() => {
    if (isSubmitting) {
      return "Compressing";
    }
    if (error) {
      return "Needs attention";
    }
    return sessionId ? "Session active" : "Local session";
  }, [error, isSubmitting, sessionId]);

  const memoryStatus =
    persistence.saved && persistence.source === "supabase"
      ? "Memory linked"
      : "Local saved";

  function updateCockpitState(
    updater: (current: PersistedCockpitState) => PersistedCockpitState,
  ) {
    writePersistedCockpitState(
      updater(parsePersistedCockpitState(getCockpitStateSnapshot())),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Add a thought before submitting.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/cockpit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, mode, sessionId }),
      });
      const payload = (await response.json()) as Partial<CockpitTurnResult> & {
        error?: string;
      };

      const nextOutput = payload.output;

      if (!response.ok || !nextOutput) {
        throw new Error(payload.error ?? "Cockpit request failed.");
      }

      updateCockpitState((current) => ({
        ...current,
        output: nextOutput,
        sessionId: payload.sessionId ?? current.sessionId,
        persistence: payload.persistence ?? current.persistence,
      }));
      setMessage("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Cockpit request failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function saveParkingLotItem() {
    const trimmed = parkingDraft.trim();
    if (!trimmed) {
      return;
    }

    updateCockpitState((current) => ({
      ...current,
      output: {
        ...current.output,
        parkingLot: [...current.output.parkingLot, trimmed].slice(-5),
      },
    }));
    setParkingDraft("");
  }

  function toggleTheme() {
    updateCockpitState((current) => ({
      ...current,
      theme: current.theme === "dim" ? "light" : "dim",
    }));
  }

  return (
    <div className={`theme-${theme} cockpit-shell min-h-screen lg:h-screen lg:overflow-hidden`}>
      <div className="grid min-h-screen lg:h-screen lg:grid-cols-[260px_1fr]">
        <aside className="cockpit-surface cockpit-rail border-b px-4 py-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2">
            <div className="cockpit-logo flex size-9 items-center justify-center border">
              <Brain className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Cockpit</p>
              <p className="cockpit-muted text-xs">ADHD dev assistant</p>
            </div>
          </div>

          <div className="cockpit-meter mt-6 border p-3">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="cockpit-muted font-semibold uppercase tracking-normal">
                Focus Signal
              </span>
              <span className="cockpit-strong font-mono">
                {isSubmitting ? "RUN" : "READY"}
              </span>
            </div>
            <div className="cockpit-meter-track">
              <span className={isSubmitting ? "is-running" : ""} />
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <p className="cockpit-muted text-xs font-semibold uppercase tracking-normal">
              Sessions
            </p>
            <button className="cockpit-button cockpit-session-button w-full border px-3 py-3 text-left text-sm font-medium">
              <span className="flex items-center justify-between gap-3">
                Active session
                <Radio className="size-4" />
              </span>
              <span className="cockpit-muted mt-2 block text-xs font-normal">
                {statusText}
              </span>
            </button>
          </div>

          <div className="cockpit-readout-stack mt-5 space-y-2 text-xs">
            <div className="cockpit-mini-readout border px-3 py-2">
              <Gauge className="size-4" />
              <span>Mode</span>
              <strong>{MODE_LABELS[mode]}</strong>
            </div>
            <div className="cockpit-mini-readout border px-3 py-2">
              <CheckCircle2 className="size-4" />
              <span>Memory</span>
              <strong>{memoryStatus}</strong>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 flex-col lg:h-screen">
          <header className="cockpit-surface cockpit-topbar border-b px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="cockpit-muted mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
                  <Activity className="size-4" />
                  Focus Loop
                </p>
                <h1 className="text-xl font-semibold tracking-normal">
                  Development Cockpit
                </h1>
                <p className="cockpit-muted text-sm">
                  One goal, one next action, one proof target.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="cockpit-status-chip border px-3 py-2 text-xs">
                  <Crosshair className="size-4" />
                  <span>{statusText}</span>
                </div>
                <button
                  type="button"
                  aria-label="Toggle color theme"
                  onClick={toggleTheme}
                  className="cockpit-button inline-flex min-h-9 items-center justify-center gap-2 border px-3 text-xs font-medium"
                >
                  {theme === "dim" ? (
                    <Sun className="size-4" />
                  ) : (
                    <Moon className="size-4" />
                  )}
                  {theme === "dim" ? "Light" : "Dim"}
                </button>
                {error ? (
                  <span className="inline-flex items-center gap-2">
                    <AlertTriangle className="size-4 text-amber-500" />
                  </span>
                ) : null}
              </div>
            </div>
          </header>

          <section className="min-h-0 flex-1 overflow-auto p-4">
            <CockpitOpenUiRenderer output={output} isStreaming={isSubmitting} />
          </section>

          <section className="cockpit-surface border-t px-4 py-3">
            {error ? (
              <div className="cockpit-alert mb-3 border px-3 py-2 text-sm">
                {error}
              </div>
            ) : null}

            <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                value={parkingDraft}
                onChange={(event) => setParkingDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveParkingLotItem();
                  }
                }}
                placeholder="Park a distracting-but-valid idea"
                className="cockpit-input min-h-10 border px-3 text-sm outline-none"
              />
              <button
                type="button"
                aria-label="Add parking lot item"
                onClick={saveParkingLotItem}
                className="cockpit-button inline-flex min-h-10 items-center justify-center gap-2 border px-3 text-sm font-medium"
              >
                <Plus className="size-4" />
                Park
              </button>
            </div>

            <form
              onSubmit={submit}
              className="grid gap-2 lg:grid-cols-[minmax(300px,360px)_1fr_auto]"
            >
              <fieldset className="cockpit-mode-grid grid grid-cols-3 gap-1 border p-1">
                <legend className="sr-only">Mode</legend>
                {COCKPIT_MODES.map((cockpitMode) => (
                  <button
                    key={cockpitMode}
                    type="button"
                    aria-pressed={mode === cockpitMode}
                    onClick={() =>
                      updateCockpitState((current) => ({
                        ...current,
                        mode: cockpitMode,
                      }))
                    }
                    className={[
                      "cockpit-mode-button min-h-10 px-2 text-xs font-semibold",
                      mode === cockpitMode ? "cockpit-mode-button-active" : "",
                    ].join(" ")}
                  >
                    {MODE_LABELS[cockpitMode]}
                  </button>
                ))}
              </fieldset>

              <label className="sr-only" htmlFor="cockpit-message">
                Scattered thought
              </label>
              <textarea
                id="cockpit-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Drop the messy thought here. Cockpit will compress it."
                rows={2}
                className="cockpit-input min-h-12 resize-none border px-3 py-3 text-sm leading-5 outline-none"
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
                Send
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
