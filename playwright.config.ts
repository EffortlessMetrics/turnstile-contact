import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  retries: 0,
  outputDir: ".qualification/client-browser",
  use: { baseURL: "http://127.0.0.1:3478", browserName: "chromium" },
  webServer: {
    command: "node scripts/serve-client.mjs",
    url: "http://127.0.0.1:3478",
    reuseExistingServer: false,
  },
});
