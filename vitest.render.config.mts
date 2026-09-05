import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/rendering/**/*.test.ts", "tests/rendering/**/*.test.tsx"],
    testTimeout: 60_000,
  },
});
