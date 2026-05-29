import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Cockpit",
    description: "Capture browser context into Cockpit and recover focus from every new tab.",
    version: "0.1.0",
    permissions: ["sidePanel", "storage", "contextMenus", "activeTab", "scripting"],
    optional_permissions: ["tabs"],
    host_permissions: [
      "http://127.0.0.1:3000/*",
      "http://localhost:3000/*",
      "http://127.0.0.1:3100/*",
      "http://localhost:3100/*",
    ],
    action: {
      default_title: "Cockpit",
    },
  },
});
