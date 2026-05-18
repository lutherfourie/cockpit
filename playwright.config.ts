import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    // Use port 3100 (not 3000) so Playwright always starts its own dev server
    // with the injected env vars, instead of accidentally reusing a developer's
    // dev server on 3000 that wouldn't have COCKPIT_PLUGIN_* configured.
    command: "pnpm dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      COCKPIT_PLUGINS: "vibe",
      COCKPIT_PLUGIN_VIBE_ROOTS: path.resolve("tests/fixtures"),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
