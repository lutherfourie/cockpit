import type { ExtensionCaptureInput } from "@cockpit/contracts";

export type BrowserTabLike = {
  title?: string;
  url?: string;
};

export function normalizeTabsForCapture(
  tabs: BrowserTabLike[],
): NonNullable<ExtensionCaptureInput["tabs"]> {
  return tabs.flatMap((tab) => {
    const url = tab.url?.trim();
    if (!url) {
      return [];
    }

    return [
      {
        title: tab.title?.replace(/\s+/g, " ").trim() || "Untitled tab",
        url,
      },
    ];
  });
}

export function summarizeQueueStatus({
  queuedCount,
  authenticated,
}: {
  queuedCount: number;
  authenticated: boolean;
}): string {
  if (!authenticated) {
    return "Auth required";
  }

  if (queuedCount > 0) {
    return `${queuedCount} queued`;
  }

  return "Synced";
}
