import type { ExtensionCaptureInput } from "@cockpit/contracts";

export type CaptureActivePagePayload = Pick<
  ExtensionCaptureInput,
  "target" | "origin" | "note" | "sessionId"
> & {
  pageOverride?: ExtensionCaptureInput["page"];
};

export type ExtensionMessage =
  | { type: "cockpit:get-status" }
  | { type: "cockpit:open-panel" }
  | { type: "cockpit:capture-active-page"; payload: CaptureActivePagePayload }
  | {
      type: "cockpit:capture-note";
      payload: Pick<ExtensionCaptureInput, "target" | "origin" | "note" | "sessionId">;
    }
  | {
      type: "cockpit:tab-rescue";
      payload: Pick<ExtensionCaptureInput, "target" | "origin" | "note" | "sessionId">;
    }
  | { type: "cockpit:set-backend"; payload: { backendUrl: string } }
  | { type: "cockpit:sign-in"; payload: { email: string } }
  | { type: "cockpit:verify-otp"; payload: { email: string; token: string } }
  | { type: "cockpit:sign-out" };
