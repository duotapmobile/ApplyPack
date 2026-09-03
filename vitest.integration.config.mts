import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
