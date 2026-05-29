import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, expect, test, type BrowserContext } from "@playwright/test";

const extensionPath = path.resolve("apps/browser-extension/.output/chrome-mv3");

test.describe("browser extension", () => {
  test("loads the unpacked extension and captures a new-tab note", async ({
    isMobile,
  }) => {
    test.skip(
      Boolean(isMobile),
      "The unpacked Chrome extension is verified in the desktop Chromium project.",
    );
    ensureExtensionBuild();
    expect(existsSync(path.join(extensionPath, "manifest.json"))).toBe(true);

    const userDataDir = mkdtempSync(path.join(tmpdir(), "cockpit-extension-"));
    let context: BrowserContext | undefined;

    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: "chromium",
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });

      const extensionId = await getExtensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await page.evaluate(() =>
        chrome.storage.local.set({
          "cockpit:backend-url": "http://127.0.0.1:3100",
        }),
      );

      await page.goto(`chrome-extension://${extensionId}/newtab.html`);
      await expect(
        page.getByRole("heading", { exact: true, name: "Cockpit" }),
      ).toBeVisible();
      await expect(page.getByPlaceholder("Search or enter address")).toBeVisible();
      await expect(page.getByRole("button", { name: "Park Thought" })).toBeVisible();

      const captureResult = await page.evaluate(() =>
        chrome.runtime.sendMessage({
          type: "cockpit:capture-note",
          payload: {
            target: "parking",
            origin: "newtab",
            note: "E2E capture from the Cockpit new tab",
          },
        }),
      );

      expect(captureResult, JSON.stringify(captureResult)).toMatchObject({
        queued: false,
        result: {
          output: {
            nextAction:
              "State what is known, what is blocked, and the one restart step.",
          },
          persistence: {
            saved: false,
            source: "none",
          },
        },
      });
    } finally {
      await context?.close();
      rmSync(userDataDir, { force: true, recursive: true });
    }
  });
});

function ensureExtensionBuild() {
  execSync("pnpm ext:build", {
    cwd: path.resolve("."),
    stdio: "inherit",
  });
}

async function getExtensionId(context: BrowserContext): Promise<string> {
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  return new URL(serviceWorker.url()).host;
}
