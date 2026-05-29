"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogIn, LogOut } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/cockpit/supabase-client";

const AUTH_CALLBACK_STATUS_MESSAGES = {
  "signed-in": "Signed in. Live state will sync shortly.",
  "missing-code": "Sign-in link was incomplete. Request a new email link.",
  "callback-error":
    "Sign-in link could not be confirmed. Request a new email link.",
  unconfigured: "Live state unavailable: Supabase is not configured.",
} as const;

type AuthCallbackStatus = keyof typeof AUTH_CALLBACK_STATUS_MESSAGES;

export function AuthPanel() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const callbackStatus = useMemo(() => getAuthCallbackStatus(), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(
    callbackStatus
      ? AUTH_CALLBACK_STATUS_MESSAGES[callbackStatus]
      : supabase
        ? "Checking live state"
        : "Live state unavailable: Supabase is not configured.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      setUser(data.session?.user ?? null);
      if (error) {
        setStatus("Could not check live state. Local mode still works.");
        return;
      }

      if (data.session) {
        setStatus("Live state on");
        return;
      }

      if (!isCallbackErrorStatus(callbackStatus)) {
        setStatus("Sign in to sync");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setStatus(session ? "Live state on" : "Sign in to sync");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [callbackStatus, supabase]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setStatus("Live state unavailable: Supabase is not configured.");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setStatus("Enter an email for the sign-in link.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setIsSubmitting(false);
    setStatus(
      error
        ? "We couldn't send the sign-in link. Check the email and try again."
        : "Check your email for the sign-in link.",
    );
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.signOut();
    setIsSubmitting(false);
    setStatus(
      error
        ? "We couldn't sign you out. Try again."
        : "Signed out. Local mode still works.",
    );
  }

  return (
    <div className="cockpit-surface-alt grid gap-2 border px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span>Live State</span>
        <strong>{user ? "On" : "Off"}</strong>
      </div>
      <p className="cockpit-muted leading-4">{status}</p>
      {user ? (
        <button
          type="button"
          onClick={signOut}
          disabled={isSubmitting}
          className="cockpit-button inline-flex min-h-8 items-center justify-center gap-2 border px-2 font-medium disabled:cursor-not-allowed"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      ) : (
        <form onSubmit={signIn} className="grid gap-2">
          <label className="sr-only" htmlFor="cockpit-auth-email">
            Email
          </label>
          <input
            id="cockpit-auth-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={!supabase || isSubmitting}
            placeholder="email@example.com"
            className="cockpit-input min-h-8 border px-2 text-xs outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!supabase || isSubmitting}
            className="cockpit-button inline-flex min-h-8 items-center justify-center gap-2 border px-2 font-medium disabled:cursor-not-allowed"
          >
            <LogIn className="size-4" />
            Email link
          </button>
        </form>
      )}
    </div>
  );
}

function getAuthCallbackStatus(): AuthCallbackStatus | null {
  if (typeof window === "undefined") {
    return null;
  }

  const status = new URLSearchParams(window.location.search).get("auth");
  return isAuthCallbackStatus(status) ? status : null;
}

function isAuthCallbackStatus(value: string | null): value is AuthCallbackStatus {
  return value !== null && value in AUTH_CALLBACK_STATUS_MESSAGES;
}

function isCallbackErrorStatus(status: AuthCallbackStatus | null): boolean {
  return (
    status === "missing-code" ||
    status === "callback-error" ||
    status === "unconfigured"
  );
}
