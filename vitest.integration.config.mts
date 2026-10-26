import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["tests/integration/**/*.test.ts"],
    // The approved launch uses structural validation, not an antivirus claim.
    // ClamAV is a separate explicit provider integration, never a skipped gate.
    exclude: [
      // Runs in the required isolated PostgreSQL job with both route scenarios.
      "tests/integration/research-preparation-journey.test.ts",
      ...(process.env.SCANNER_INTEGRATION === "true" ? [] : ["tests/integration/clamav.integration.test.ts"]),
    ],
    setupFiles: ["./tests/setup.ts"],
  },
});
