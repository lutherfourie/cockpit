"use client";

import {
  FormEvent,
  KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  FileSearch,
  Loader2,
  Moon,
  Plus,
  Radio,
  Save,
  SendHorizonal,
  ShieldAlert,
  Sparkles,
  Sun,
  TerminalSquare,
} from "lucide-react";

import {
  COCKPIT_MODES,
  type CockpitAgentOutput,
  type CockpitMode,
  type CockpitPersistence,
  type CockpitTurnResult,
} from "@/lib/cockpit/schema";
import { CockpitPanels } from "@/components/cockpit/cockpit-panels";
import { AuthPanel } from "@/components/cockpit/auth-panel";
import { GeneratedSurfaceSlot } from "@/components/cockpit/generated-surface-slot";
import { ThoughtChatLane } from "@/components/cockpit/thought-chat-lane";
import {
  COCKPIT_STATE_STORAGE_KEY,
  createInitialKernelState,
  parseKernelState,
  reduceKernelState,
  serializeKernelState,
  type CockpitKernelState,
  type GeneratedSurface,
  type ThoughtChatMessage,
} from "@/lib/cockpit/kernel-state";

const INITIAL_PERSISTENCE: CockpitPersistence = {
  saved: false,
  source: "local",
};

const MODE_LABELS: Record<CockpitMode, string> = {
  auto: "Auto",
  clarify: "Clarify",
  plan: "Plan",
  focus: "Focus",
  recover: "Recover",
  review: "Review",
  handoff: "Handoff",
};

const MODE_LENSES: Record<CockpitMode, string> = {
  auto: "Focus",
  clarify: "Compress",
  plan: "Sketch",
  focus: "Move",
  recover: "Stabilize",
  review: "Inspect",
  handoff: "Save",
};

const COCKPIT_STATE_CHANGED_EVENT = "cockpit:state-changed";

type LowerSurface = "evidence" | "openui" | "handoff" | "review";

type CaptureIntent =
  | { kind: "url"; label: string; action: string }
  | { kind: "path"; label: string; action: string }
  | { kind: "command"; label: string; action: string }
  | { kind: "error"; label: string; action: string };

const SLASH_COMMANDS: {
  command: string;
  label: string;
  mode?: CockpitMode;
  surface?: LowerSurface;
  action?: "park" | "clear";
}[] = [
  { command: "/focus", label: "One action, one proof", mode: "focus" },
  { command: "/clarify", label: "Compress a messy thought", mode: "clarify" },
  { command: "/plan", label: "Sketch up to three steps", mode: "plan" },
  { command: "/recover", label: "Stabilize a stuck turn", mode: "recover" },
  { command: "/review", label: "Inspect proof and risk", mode: "review", surface: "review" },
  { command: "/handoff", label: "Save state for next session", mode: "handoff", surface: "handoff" },
  { command: "/openui", label: "Open generated surface", surface: "openui" },
  { command: "/park", label: "Park the draft", action: "park" },
  { command: "/clear", label: "Clear the draft", action: "clear" },
];

type PersistedCockpitState = CockpitKernelState & {
  persistence: CockpitPersistence;
};

const DEFAULT_COCKPIT_STATE: PersistedCockpitState = {
  ...createInitialKernelState(),
  persistence: INITIAL_PERSISTENCE,
};

const DEFAULT_COCKPIT_STATE_RAW = serializeKernelState(DEFAULT_COCKPIT_STATE);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const kernelState = parseKernelState(rawState);

  try {
    if (!rawState) {
      return { ...kernelState, persistence: INITIAL_PERSISTENCE };
    }

    const parsedState = JSON.parse(rawState) as unknown;
    if (!isRecord(parsedState)) {
      return { ...kernelState, persistence: INITIAL_PERSISTENCE };
    }

    return {
      ...kernelState,
      persistence: isCockpitPersistence(parsedState.persistence)
        ? parsedState.persistence
        : INITIAL_PERSISTENCE,
    };
  } catch {
    return { ...kernelState, persistence: INITIAL_PERSISTENCE };
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
      serializeKernelState(state),
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
  const { mode, theme, output, sessionId, persistence, generatedSurface, thoughtChat } =
    cockpitState;
  const [message, setMessage] = useState("");
  const [parkingDraft, setParkingDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lowerSurface, setLowerSurface] = useState<LowerSurface>("evidence");
  const [focusMode, setFocusMode] = useState(false);

  const statusText = useMemo(() => {
    if (isSubmitting) {
      return "Compressing";
    }
    if (error) {
      return "Needs attention";
    }
    return sessionId ? "Session active" : "Local session";
  }, [error, isSubmitting, sessionId]);

  const memoryStatus = (() => {
    if (persistence.source === "supabase" && persistence.saved) {
      return "Memory linked";
    }
    if (persistence.source === "local") {
      return "Local cache";
    }
    return "Not synced";
  })();

  const captureIntent = useMemo(() => detectCaptureIntent(message), [message]);
  const slashCommands = useMemo(() => {
    const trimmed = message.trimStart();
    if (!trimmed.startsWith("/")) {
      return [];
    }

    return SLASH_COMMANDS.filter((command) =>
      command.command.startsWith(trimmed.toLowerCase()),
    ).slice(0, 5);
  }, [message]);

  const proactiveNudge = (() => {
    if (isSubmitting) {
      return null;
    }
    if (output.blockers.length > 0) {
      return {
        label: "Recover",
        text: "Threat detected. Switch to Recover if this is blocking the next move.",
        run: () => updateMode("recover"),
      };
    }
    if (output.parkingLot.length >= 4) {
      return {
        label: "Handoff",
        text: `${output.parkingLot.length} side quests parked. Save state before the loop gets noisy.`,
        run: () => {
          updateMode("handoff");
          setLowerSurface("handoff");
        },
      };
    }
    if (mode === "auto") {
      return {
        label: "Focus",
        text: "Auto is steering as Focus until the input clearly asks for another lens.",
        run: () => updateMode("focus"),
      };
    }
    return null;
  })();

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "?" && !isTyping) {
        event.preventDefault();
        return;
      }

      if (event.key.toLowerCase() === "f" && !isTyping) {
        event.preventDefault();
        setFocusMode((current) => !current);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function updateCockpitState(
    updater: (current: PersistedCockpitState) => PersistedCockpitState,
  ) {
    writePersistedCockpitState(
      updater(parsePersistedCockpitState(getCockpitStateSnapshot())),
    );
  }

  function updateMode(nextMode: CockpitMode) {
    updateCockpitState((current) => ({
      ...reduceKernelState(current, {
        type: "setMode",
        mode: nextMode,
      }),
      persistence: current.persistence,
    }));
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
        ...reduceKernelState(current, {
          type: "setOutput",
          output: nextOutput,
          sessionId: payload.sessionId,
        }),
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
      ...reduceKernelState(current, { type: "park", content: trimmed }),
      persistence: current.persistence,
    }));
    setParkingDraft("");
  }

  function parkText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    updateCockpitState((current) => ({
      ...reduceKernelState(current, { type: "park", content: trimmed }),
      persistence: current.persistence,
    }));
  }

  function runSlashCommand(command: (typeof SLASH_COMMANDS)[number]) {
    if (command.mode) {
      updateMode(command.mode);
    }
    if (command.surface) {
      setLowerSurface(command.surface);
    }
    if (command.action === "park") {
      parkText(message.replace(command.command, "").trim());
    }
    if (command.action === "clear") {
      setMessage("");
      return;
    }
    setMessage("");
  }

  function applyCaptureIntent(intent: CaptureIntent) {
    if (intent.kind === "error") {
      updateMode("recover");
      setLowerSurface("review");
      return;
    }
    if (intent.kind === "path") {
      setLowerSurface("openui");
      return;
    }
    if (intent.kind === "command") {
      setLowerSurface("review");
      return;
    }
    parkText(intent.label);
    setMessage("");
    setLowerSurface("evidence");
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && slashCommands.length > 0) {
      event.preventDefault();
      runSlashCommand(slashCommands[0]);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.currentTarget.form?.requestSubmit();
    }
  }

  function toggleTheme() {
    updateCockpitState((current) => ({
      ...reduceKernelState(current, {
        type: "setTheme",
        theme: current.theme === "dim" ? "light" : "dim",
      }),
      persistence: current.persistence,
    }));
  }

  function appendThoughtMessage(thoughtMessage: ThoughtChatMessage) {
    updateCockpitState((current) => ({
      ...reduceKernelState(current, {
        type: "appendThoughtMessage",
        message: thoughtMessage,
      }),
      persistence: current.persistence,
    }));
  }

  function promoteThoughtChatText(promoteText: string) {
    setMessage(promoteText);
  }

  return (
    <div
      className={[
        `theme-${theme} cockpit-shell min-h-screen overflow-x-hidden lg:h-screen lg:overflow-hidden`,
        focusMode ? "is-focus-mode" : "",
      ].join(" ")}
    >
      <div
        className={[
          "grid min-h-screen lg:h-screen",
          focusMode
            ? "lg:grid-cols-1"
            : "lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(0,1fr)_320px]",
        ].join(" ")}
      >
        {!focusMode ? (
          <aside className="cockpit-surface cockpit-rail hidden border-b px-4 py-4 lg:block lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2">
              <div className="cockpit-logo flex size-9 items-center justify-center border text-sm font-bold">
                C
              </div>
              <div>
                <p className="text-sm font-semibold">Cockpit</p>
                <p className="cockpit-muted text-xs">Focus loop</p>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <p className="cockpit-muted text-xs font-semibold uppercase tracking-normal">
                Active
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

            <nav className="mt-5 space-y-2" aria-label="Cockpit screens">
              <p className="cockpit-muted text-xs font-semibold uppercase tracking-normal">
                Screens
              </p>
              <RailButton
                label="Loop"
                active={lowerSurface === "evidence"}
                onClick={() => setLowerSurface("evidence")}
              />
              <RailButton
                label="OpenUI"
                active={lowerSurface === "openui"}
                onClick={() => setLowerSurface("openui")}
              />
              <RailButton
                label="Handoff"
                active={lowerSurface === "handoff"}
                onClick={() => setLowerSurface("handoff")}
              />
              <RailButton
                label="Review"
                active={lowerSurface === "review"}
                onClick={() => setLowerSurface("review")}
              />
            </nav>

            <div className="cockpit-readout-stack mt-5 space-y-2 text-xs">
              <div className="cockpit-mini-readout border px-3 py-2">
                <Crosshair className="size-4" />
                <span>Lens</span>
                <strong>{MODE_LABELS[mode]}</strong>
              </div>
              <div className="cockpit-mini-readout border px-3 py-2">
                <CheckCircle2 className="size-4" />
                <span>Memory</span>
                <strong>{memoryStatus}</strong>
              </div>
              <AuthPanel />
            </div>
          </aside>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-col lg:h-screen">
          <header className="cockpit-surface cockpit-topbar border-b px-4 py-3">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="cockpit-muted mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
                  <Activity className="size-4" />
                  {MODE_LABELS[mode]} lens - {MODE_LENSES[mode]}
                </p>
                <h1 className="text-xl font-semibold tracking-normal md:text-2xl">
                  {mode === "auto"
                    ? "You are in auto focus."
                    : `You are in ${MODE_LABELS[mode].toLowerCase()}.`}
                </h1>
              </div>
              <div className="cockpit-header-actions flex flex-wrap items-center gap-2 md:justify-end">
                <ModeSelector mode={mode} onModeChange={updateMode} />
                <button
                  type="button"
                  onClick={() => setFocusMode((current) => !current)}
                  className="cockpit-button inline-flex min-h-9 items-center justify-center gap-2 border px-3 text-xs font-medium"
                >
                  Clean view <ShortcutMark>F</ShortcutMark>
                </button>
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

          <section className="cockpit-main-scroll min-h-0 flex-1 overflow-auto p-4">
            <div className="mx-auto grid max-w-[1400px] gap-3">
              {proactiveNudge ? (
                <button
                  type="button"
                  onClick={proactiveNudge.run}
                  className="cockpit-nudge border px-3 py-2 text-left text-sm"
                >
                  <span className="mr-2 font-semibold uppercase">
                    {proactiveNudge.label}
                  </span>
                  {proactiveNudge.text}
                </button>
              ) : null}

              <CockpitPanels output={output} />

              {!focusMode ? (
                <>
                  <GlanceStrip
                    output={output}
                    generatedSurfaceStatus={generatedSurface.status}
                    lowerSurface={lowerSurface}
                    onSurfaceChange={setLowerSurface}
                  />
                  <LowerSurface
                    surface={lowerSurface}
                    output={output}
                    generatedSurface={generatedSurface}
                    parkingDraft={parkingDraft}
                    onParkingDraftChange={setParkingDraft}
                    onSaveParkingLotItem={saveParkingLotItem}
                  />
                  <div className="2xl:hidden">
                    <ThoughtChatLane
                      messages={thoughtChat}
                      onAppendMessage={appendThoughtMessage}
                      onPromote={promoteThoughtChatText}
                      compact
                    />
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <section className="cockpit-surface cockpit-dock border-t px-4 py-3">
            {error ? (
              <div className="cockpit-alert mb-3 border px-3 py-2 text-sm">
                {error}
              </div>
            ) : null}

            <form onSubmit={submit} className="mx-auto grid max-w-[1400px] gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cockpit-live-pill">{MODE_LABELS[mode]}</span>
                  <span className="cockpit-muted">Composing turn</span>
                </div>
                <div className="cockpit-muted flex flex-wrap items-center gap-2">
                  <span>
                    Send <ShortcutMark>Ctrl+Enter</ShortcutMark>
                  </span>
                  <span>
                    Commands <ShortcutMark>/</ShortcutMark>
                  </span>
                </div>
              </div>

              {slashCommands.length > 0 ? (
                <div className="cockpit-slash-menu border p-2">
                  {slashCommands.map((command) => (
                    <button
                      key={command.command}
                      type="button"
                      onClick={() => runSlashCommand(command)}
                      className="cockpit-button flex w-full items-center justify-between gap-3 border px-3 py-2 text-left text-sm"
                    >
                      <span className="font-mono">{command.command}</span>
                      <span className="cockpit-muted">{command.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {captureIntent ? (
                <button
                  type="button"
                  onClick={() => applyCaptureIntent(captureIntent)}
                  className="cockpit-intent-chip border px-3 py-2 text-left text-sm"
                >
                  <Sparkles className="size-4" />
                  <span>{captureIntent.action}</span>
                </button>
              ) : null}

              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                <label className="sr-only" htmlFor="cockpit-message">
                  Scattered thought
                </label>
                <textarea
                  id="cockpit-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={handleMessageKeyDown}
                  placeholder="Drop the messy thought. Try / for commands."
                  rows={2}
                  className="cockpit-input min-h-14 resize-none border px-3 py-3 text-sm leading-5 outline-none"
                />

                <button
                  type="button"
                  onClick={() => {
                    parkText(message);
                    setMessage("");
                    setLowerSurface("evidence");
                  }}
                  className="cockpit-button inline-flex min-h-12 items-center justify-center gap-2 border px-4 text-sm font-semibold"
                >
                  <Plus className="size-4" />
                  Park
                </button>
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
              </div>
            </form>
          </section>
        </main>

        {!focusMode ? (
          <aside className="cockpit-surface cockpit-pulse-rail hidden min-h-0 overflow-auto border-l px-4 py-4 2xl:block">
            <RightRail
              output={output}
              messages={thoughtChat}
              onAppendMessage={appendThoughtMessage}
              onPromote={promoteThoughtChatText}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ModeSelector({
  mode,
  onModeChange,
}: {
  mode: CockpitMode;
  onModeChange: (mode: CockpitMode) => void;
}) {
  return (
    <fieldset className="cockpit-mode-grid flex flex-wrap gap-1 border p-1">
      <legend className="sr-only">Mode</legend>
      {COCKPIT_MODES.map((cockpitMode) => (
        <button
          key={cockpitMode}
          type="button"
          aria-pressed={mode === cockpitMode}
          onClick={() => onModeChange(cockpitMode)}
          className={[
            "cockpit-mode-button min-h-8 px-3 text-xs font-semibold",
            mode === cockpitMode ? "cockpit-mode-button-active" : "",
          ].join(" ")}
        >
          {MODE_LABELS[cockpitMode]}
        </button>
      ))}
    </fieldset>
  );
}

function RailButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "cockpit-rail-button flex min-h-9 w-full items-center justify-between border px-3 text-left text-sm font-medium",
        active ? "cockpit-rail-button-active" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <ChevronRight className="size-4" />
    </button>
  );
}

function GlanceStrip({
  output,
  generatedSurfaceStatus,
  lowerSurface,
  onSurfaceChange,
}: {
  output: CockpitAgentOutput;
  generatedSurfaceStatus: GeneratedSurface["status"];
  lowerSurface: LowerSurface;
  onSurfaceChange: (surface: LowerSurface) => void;
}) {
  const chips: {
    label: string;
    value: string | number;
    surface: LowerSurface;
    icon: ReactNode;
  }[] = [
    {
      label: "Proof",
      value: output.proofNeeded ? "open" : "none",
      surface: "evidence",
      icon: <CheckCircle2 className="size-4" />,
    },
    {
      label: "Side quests",
      value: output.parkingLot.length,
      surface: "evidence",
      icon: <Plus className="size-4" />,
    },
    {
      label: "OpenUI",
      value: generatedSurfaceStatus,
      surface: "openui",
      icon: <FileSearch className="size-4" />,
    },
    {
      label: "Save",
      value: output.handoff ? "draft" : "empty",
      surface: "handoff",
      icon: <Save className="size-4" />,
    },
  ];

  return (
    <div className="cockpit-glance-strip border p-2">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => onSurfaceChange(chip.surface)}
          className={[
            "cockpit-glance-chip border px-3 py-2 text-xs font-semibold",
            lowerSurface === chip.surface ? "cockpit-glance-chip-active" : "",
          ].join(" ")}
        >
          {chip.icon}
          <span>{chip.label}</span>
          <strong>{chip.value}</strong>
        </button>
      ))}
    </div>
  );
}

function LowerSurface({
  surface,
  output,
  generatedSurface,
  parkingDraft,
  onParkingDraftChange,
  onSaveParkingLotItem,
}: {
  surface: LowerSurface;
  output: CockpitAgentOutput;
  generatedSurface: GeneratedSurface;
  parkingDraft: string;
  onParkingDraftChange: (value: string) => void;
  onSaveParkingLotItem: () => void;
}) {
  if (surface === "openui") {
    return <GeneratedSurfaceSlot surface={generatedSurface} />;
  }

  if (surface === "handoff") {
    return (
      <section
        className="cockpit-panel cockpit-panel-handoff border p-4"
        data-testid="handoff"
      >
        <div className="cockpit-panel-heading mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
          <Save className="size-4" />
          <h2>Handoff</h2>
        </div>
        <p className="text-sm leading-6">
          {output.handoff || "No handoff drafted for this turn."}
        </p>
      </section>
    );
  }

  if (surface === "review") {
    return (
      <section className="cockpit-panel cockpit-panel-blocker border p-4">
        <div className="cockpit-panel-heading mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
          <TerminalSquare className="size-4" />
          <h2>Review Surface</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ReviewList
            title="Blockers"
            emptyText="No blockers recorded."
            items={output.blockers}
          />
          <ReviewList
            title="Assumptions"
            emptyText="No assumptions recorded."
            items={output.assumptions}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      className="cockpit-panel cockpit-panel-parking border p-4"
      data-testid="parking-lot"
    >
      <div className="cockpit-panel-heading mb-3 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-normal">
        <span className="inline-flex items-center gap-2">
          <Plus className="size-4" />
          <h2>Parking Lot</h2>
        </span>
        <span>{output.parkingLot.length} parked</span>
      </div>
      <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          value={parkingDraft}
          onChange={(event) => onParkingDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSaveParkingLotItem();
            }
          }}
          placeholder="Park a distracting-but-valid idea"
          className="cockpit-input min-h-10 border px-3 text-sm outline-none"
        />
        <button
          type="button"
          aria-label="Add parking lot item"
          onClick={onSaveParkingLotItem}
          className="cockpit-button inline-flex min-h-10 items-center justify-center gap-2 border px-3 text-sm font-medium"
        >
          <Plus className="size-4" />
          Park
        </button>
      </div>
      {output.parkingLot.length > 0 ? (
        <ul className="space-y-2 text-sm leading-6">
          {output.parkingLot.map((item, index) => (
            <li
              key={`${index}-${item}`}
              className="cockpit-list-item border-l-2 pl-3"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cockpit-muted text-sm leading-6">No parked items yet.</p>
      )}
    </section>
  );
}

function ReviewList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <div className="cockpit-surface-alt border p-3">
      <h3 className="cockpit-muted mb-2 text-xs font-semibold uppercase tracking-normal">
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="grid gap-2 text-sm leading-5">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="cockpit-muted text-sm">{emptyText}</p>
      )}
    </div>
  );
}

function RightRail({
  output,
  messages,
  onAppendMessage,
  onPromote,
}: {
  output: CockpitAgentOutput;
  messages: ThoughtChatMessage[];
  onAppendMessage: (message: ThoughtChatMessage) => void;
  onPromote: (text: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <section className="cockpit-panel cockpit-panel-blocker border p-4">
        <div className="cockpit-panel-heading mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
          <ShieldAlert className="size-4" />
          <h2>Threats</h2>
        </div>
        {output.blockers.length > 0 ? (
          <ul className="grid gap-2 text-sm leading-5">
            {output.blockers.map((blocker, index) => (
              <li key={`${index}-${blocker}`}>{blocker}</li>
            ))}
          </ul>
        ) : (
          <p className="cockpit-muted text-sm leading-6">
            No blockers recorded.
          </p>
        )}
      </section>

      <section className="cockpit-panel border p-4">
        <div className="cockpit-panel-heading mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal">
          <Sparkles className="size-4" />
          <h2>Assistant</h2>
        </div>
        <p className="cockpit-muted mb-3 text-sm leading-5">
          MCP-enabled thought chat. Use it to phrase the messy bit before sending
          it into the focus loop.
        </p>
        <ThoughtChatLane
          messages={messages}
          onAppendMessage={onAppendMessage}
          onPromote={onPromote}
          compact
          testId="right-thought-chat"
        />
      </section>
    </div>
  );
}

function ShortcutMark({ children }: { children: ReactNode }) {
  return <kbd className="cockpit-shortcut-mark">{children}</kbd>;
}

function detectCaptureIntent(text: string): CaptureIntent | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const url = trimmed.match(/https?:\/\/\S+/i)?.[0];
  if (url) {
    return { kind: "url", label: url, action: "Park link and keep focus" };
  }

  const path = trimmed.match(
    /(?:src|app|lib|supabase|public|tests|docs)\/[\w./-]+(?:\.\w+)?/i,
  )?.[0];
  if (path) {
    return { kind: "path", label: path, action: "Open scanner context" };
  }

  if (/^\s*(?:\$|pnpm|npm|git|node|python|npx)\b/i.test(trimmed)) {
    return { kind: "command", label: trimmed, action: "Attach as review evidence" };
  }

  if (/error|exception|traceback|failed|crash|broken/i.test(trimmed)) {
    return { kind: "error", label: trimmed, action: "Switch to Recover" };
  }

  return null;
}
