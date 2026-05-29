import { browser } from "wxt/browser";

import {
  captureActivePage,
  getExtensionStatus,
  rescueCurrentWindowTabs,
  signInWithEmail,
  signOut,
  verifyEmailOtp,
} from "../src/extension-actions";
import type { ExtensionMessage } from "../src/messages";
import { setBackendUrl } from "../src/settings";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    await browser.contextMenus.create({
      id: "cockpit-capture-page",
      title: "Send page to Cockpit",
      contexts: ["page"],
    });
    await browser.contextMenus.create({
      id: "cockpit-park-selection",
      title: "Park selection in Cockpit",
      contexts: ["selection"],
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "cockpit-capture-page") {
      void captureActivePage({
        target: "focus",
        origin: "contextMenu",
        pageOverride: tabToPage(tab, info.selectionText),
      });
    }

    if (info.menuItemId === "cockpit-park-selection") {
      void captureActivePage({
        target: "parking",
        origin: "contextMenu",
        pageOverride: tabToPage(tab, info.selectionText),
      });
    }
  });

  browser.runtime.onMessage.addListener((message: unknown) =>
    handleMessage(message as ExtensionMessage),
  );
});

async function handleMessage(message: ExtensionMessage) {
  switch (message.type) {
    case "cockpit:get-status":
      return getExtensionStatus();
    case "cockpit:open-panel": {
      const window = await browser.windows.getCurrent();
      await browser.sidePanel.open({ windowId: window.id });
      return { opened: true };
    }
    case "cockpit:capture-active-page":
      return captureActivePage(message.payload);
    case "cockpit:capture-note":
      return captureActivePage({
        ...message.payload,
        pageOverride: undefined,
      });
    case "cockpit:tab-rescue":
      return rescueCurrentWindowTabs(message.payload);
    case "cockpit:set-backend":
      await setBackendUrl(message.payload.backendUrl);
      return { saved: true };
    case "cockpit:sign-in":
      return signInWithEmail(message.payload.email);
    case "cockpit:verify-otp":
      return verifyEmailOtp(message.payload.email, message.payload.token);
    case "cockpit:sign-out":
      return signOut();
  }
}

function tabToPage(
  tab: Browser.tabs.Tab | undefined,
  selection?: string,
): { title?: string; url?: string; selection?: string } {
  return {
    title: tab?.title,
    url: tab?.url,
    selection,
  };
}
