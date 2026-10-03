import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  retries: process.env.CI ? 2 : 0,
  // Next's development acceptance server can perform document-replacing
  // compiles when multiple browser engines first visit the same fixture route.
  // Serialize projects so those reloads cannot corrupt another journey.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // The Turbopack development HMR client intermittently drops generated chunks
    // under the parallel WebKit matrix. Webpack keeps the acceptance server
    // deterministic while the production build remains a separate required gate.
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    env: { ...process.env, APP_E2E_FIXTURE_MODE: "true" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
