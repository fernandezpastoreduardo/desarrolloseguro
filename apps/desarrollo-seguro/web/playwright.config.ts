import { defineConfig, devices } from "@playwright/test";

const PORTAL_BASE_URL = "http://127.0.0.1:4173/app/";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: PORTAL_BASE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort",
    url: PORTAL_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
