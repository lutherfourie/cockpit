import { useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";

import type { ExtensionStateResponse } from "@cockpit/contracts";

import type { ExtensionMessage } from "../messages";
import { DEFAULT_BACKEND_URL } from "../settings";

type Surface = "sidepanel" | "popup" | "newtab" | "options";

type StatusResponse = {
  state?: ExtensionStateResponse;
  queuedCount: number;
  authenticated: boolean;
  status: string;
  error?: string;
};

const SURFACE_TITLES: Record<Surface, string> = {
  sidepanel: "Cockpit Panel",
  popup: "Cockpit",
  newtab: "Cockpit",
  options: "Cockpit Options",
};

export function CockpitExtensionSurface({ surface }: { surface: Surface }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [message, setMessage] = useState("Loading Cockpit state...");

  useEffect(() => {
    void refresh();
  }, []);

  const output = status?.state?.output;
  const compact = surface === "popup";
  const isOptions = surface === "options";
  const shellClass = useMemo(
    () => `cockpit-extension cockpit-extension-${surface}`,
    [surface],
  );

  async function refresh() {
    try {
      const result = await sendMessage({ type: "cockpit:get-status" });
      setStatus(result as StatusResponse);
      setMessage((result as StatusResponse).status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load state.");
    }
  }

  async function runAction(action: () => Promise<unknown>, done: string) {
    setMessage("Working...");
    try {
      await action();
      setNote("");
      setMessage(done);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    }
  }

  return (
    <main className={shellClass}>
      <header className="ce-header">
        <div>
          <p className="ce-kicker">{status?.status ?? message}</p>
          <h1>{SURFACE_TITLES[surface]}</h1>
        </div>
        <button className="ce-icon-button" onClick={() => void refresh()} title="Refresh">
          ↻
        </button>
      </header>

      {isOptions ? (
        <section className="ce-section">
          <h2>Connection</h2>
          <label className="ce-label" htmlFor="backend-url">
            Backend URL
          </label>
          <input
            id="backend-url"
            value={backendUrl}
            onChange={(event) => setBackendUrl(event.target.value)}
            placeholder={DEFAULT_BACKEND_URL}
          />
          <button
            onClick={() =>
              void runAction(
                () =>
                  sendMessage({
                    type: "cockpit:set-backend",
                    payload: { backendUrl },
                  }),
                "Backend saved",
              )
            }
          >
            Save URL
          </button>
        </section>
      ) : null}

      <section className="ce-section ce-focus">
        <h2>{output?.currentGoal ?? "No active Cockpit session"}</h2>
        <div className="ce-panel-row">
          <article>
            <span>Next Action</span>
            <p>{output?.nextAction ?? "Capture a page or thought to start."}</p>
          </article>
          {!compact ? (
            <article>
              <span>Proof Needed</span>
              <p>{output?.proofNeeded ?? "A saved capture appears in Cockpit."}</p>
            </article>
          ) : null}
        </div>
      </section>

      <section className="ce-section">
        <h2>Capture</h2>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            surface === "newtab"
              ? "What are you trying to resume or park?"
              : "Add context before sending this page..."
          }
        />
        <div className="ce-actions">
          <button
            onClick={() =>
              void runAction(
                () =>
                  sendMessage({
                    type: "cockpit:capture-active-page",
                    payload: { target: "focus", origin: surface, note },
                  }),
                "Captured for focus",
              )
            }
          >
            Capture Page
          </button>
          <button
            onClick={() =>
              void runAction(
                () =>
                  sendMessage({
                    type: "cockpit:capture-note",
                    payload: { target: "parking", origin: surface, note },
                  }),
                "Parked",
              )
            }
          >
            Park Thought
          </button>
          {!compact ? (
            <button
              onClick={() =>
                void runAction(
                  () =>
                    sendMessage({
                      type: "cockpit:tab-rescue",
                      payload: { target: "parking", origin: surface, note },
                    }),
                  "Tabs captured",
                )
              }
            >
              Rescue Tabs
            </button>
          ) : null}
          {surface === "popup" ? (
            <button
              onClick={() =>
                void runAction(
                  () => sendMessage({ type: "cockpit:open-panel" }),
                  "Panel opened",
                )
              }
            >
              Open Panel
            </button>
          ) : null}
        </div>
      </section>

      {surface === "newtab" ? (
        <section className="ce-section ce-search-section">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const query = String(data.get("q") ?? "").trim();
              if (query) {
                window.location.href = query.includes(".")
                  ? `https://${query.replace(/^https?:\/\//, "")}`
                  : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
              }
            }}
          >
            <input name="q" placeholder="Search or enter address" autoFocus />
          </form>
        </section>
      ) : null}

      <section className="ce-section">
        <h2>Sign In</h2>
        <div className="ce-auth-grid">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="email@example.com"
            type="email"
          />
          <button
            onClick={() =>
              void runAction(
                () => sendMessage({ type: "cockpit:sign-in", payload: { email } }),
                "OTP sent",
              )
            }
          >
            Send OTP
          </button>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="6 digit code"
            inputMode="numeric"
          />
          <button
            onClick={() =>
              void runAction(
                () =>
                  sendMessage({
                    type: "cockpit:verify-otp",
                    payload: { email, token },
                  }),
                "Signed in",
              )
            }
          >
            Verify
          </button>
        </div>
      </section>

      <footer className="ce-footer">
        <span>{status?.queuedCount ?? 0} queued</span>
        <span>{status?.authenticated ? "Authenticated" : "Auth required"}</span>
      </footer>
    </main>
  );
}

function sendMessage(message: ExtensionMessage): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}
