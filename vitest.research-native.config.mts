import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", include: [process.env.AP_RESEARCH_JOURNEY_STAGE === "PACK_LOCAL_DOC"
    ? "tests/integration/employer-question-local-doc-native-journey.test.ts" : process.env.AP_RESEARCH_JOURNEY_STAGE === "PACK_SOURCE"
    ? "tests/integration/employer-question-source-native-journey.test.ts" : process.env.AP_RESEARCH_JOURNEY_STAGE === "PACK_PACKET"
    ? "tests/integration/employer-question-pack-native-journey.test.ts" : process.env.AP_RESEARCH_JOURNEY_STAGE === "EMPLOYER_RULE"
    ? "tests/integration/employer-rule-owner-native-journey.test.ts" : process.env.AP_RESEARCH_JOURNEY_STAGE === "PAID_SEARCH"
    ? "tests/integration/verified-paid-search-native-journey.test.ts" : process.env.AP_RESEARCH_JOURNEY_STAGE === "NOTIFICATION"
    ? "tests/integration/intake-notification-native-journey.test.ts" : process.env.AP_RESEARCH_JOURNEY_STAGE === "CLARIFICATION"
    ? "tests/integration/material-clarification-route-journey.test.ts" : "tests/integration/research-preparation-journey.test.ts"], maxWorkers: 1, testTimeout: process.env.AP_RESEARCH_JOURNEY_STAGE === "PACK_LOCAL_DOC" ? 600_000 : process.env.AP_RESEARCH_JOURNEY_STAGE === "PACK_SOURCE" ? 420_000 : 240_000 },
});
