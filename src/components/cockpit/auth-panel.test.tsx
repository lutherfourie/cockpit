// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseBrowserClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cockpit/supabase-client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

import { AuthPanel } from "./auth-panel";

describe("AuthPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState(null, "", "/");
    createSupabaseBrowserClientMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("shows callback failures as friendly bounded status text", async () => {
    window.history.replaceState(
      null,
      "",
      "/?auth=callback-error&error_description=service_role-secret",
    );
    createSupabaseBrowserClientMock.mockReturnValue(makeSupabaseClient());

    await renderAuthPanel();

    expect(container.textContent).toContain(
      "Sign-in link could not be confirmed. Request a new email link.",
    );
    expect(container.textContent).not.toContain("service_role-secret");
  });

  it("redacts provider errors when sending a sign-in link fails", async () => {
    const supabase = makeSupabaseClient({
      signInWithOtp: vi.fn(async () => ({
        data: null,
        error: { message: "service_role secret from auth provider" },
      })),
    });
    createSupabaseBrowserClientMock.mockReturnValue(supabase);

    await renderAuthPanel();
    await enterEmailAndSubmit("person@example.com");

    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/callback",
      },
    });
    expect(container.textContent).toContain(
      "We couldn't send the sign-in link. Check the email and try again.",
    );
    expect(container.textContent).not.toContain("service_role");
  });

  async function renderAuthPanel() {
    await act(async () => {
      root.render(<AuthPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function enterEmailAndSubmit(email: string) {
    const input = container.querySelector<HTMLInputElement>("#cockpit-auth-email");
    const form = container.querySelector<HTMLFormElement>("form");

    if (!input || !form) {
      throw new Error("Auth form did not render");
    }

    await act(async () => {
      setInputValue(input, email);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }
});

function makeSupabaseClient(overrides: Partial<MockAuth> = {}) {
  const auth: MockAuth = {
    getSession: vi.fn(async () => ({
      data: { session: null },
      error: null,
    })),
    onAuthStateChange: vi.fn(() => ({
      data: {
        subscription: { unsubscribe: vi.fn() },
      },
    })),
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...overrides,
  };

  return { auth };
}

type MockAuth = {
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
  signInWithOtp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;

  nativeValueSetter?.call(input, value);
}
