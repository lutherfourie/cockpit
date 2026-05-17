"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogIn, LogOut } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/cockpit/supabase-client";

export function AuthPanel() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(
    supabase
      ? "Checking sync"
      : "Phone sync unavailable: Supabase is not configured.",
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
      setStatus(error ? error.message : data.session ? "Phone sync on" : "Sign in to sync");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setStatus(session ? "Phone sync on" : "Sign in to sync");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setStatus("Phone sync unavailable: Supabase is not configured.");
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
    setStatus(error ? error.message : "Check your email for the sign-in link.");
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.signOut();
    setIsSubmitting(false);
    setStatus(error ? error.message : "Signed out. Local mode still works.");
  }

  return (
    <div className="cockpit-surface-alt grid gap-2 border px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span>Phone Sync</span>
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
