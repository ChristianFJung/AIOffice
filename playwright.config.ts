import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    headless: false,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run dev:server",
      port: 3003,
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: "npm run dev:web",
      port: 3000,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
