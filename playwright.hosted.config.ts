import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.APPLYPACK_HOSTED_BASE_URL || "https://applypack-staging-staging.up.railway.app";
if (new URL(baseURL).origin !== "https://applypack-staging-staging.up.railway.app") {
  throw new Error("Hosted rehearsal is restricted to the verified ApplyPack staging service.");
}
export default defineConfig({
  testDir: "./tests/hosted", fullyParallel: false, workers: 1, retries: 0, timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "evidence/soft-opening/browser-artifacts",
  reporter: [["list"], ["html", { outputFolder: "evidence/soft-opening/browser-report", open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
});
