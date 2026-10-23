import { pathToFileURL } from "node:url";

export const STAGING_ORIGIN = "https://applypack-staging-staging.up.railway.app";
const modes = {
  locked: { checkoutMode: "LOCKED_STAGING", restrictedCheckoutMode: null, sessionCreationConfigured: false },
  rehearsal: { checkoutMode: "STAGING_REHEARSAL", restrictedCheckoutMode: "REHEARSAL", sessionCreationConfigured: true },
  canary: { checkoutMode: "STAGING_CANARY", restrictedCheckoutMode: "CANARY", sessionCreationConfigured: true },
};
const requiredChecks = ["checkoutMode", "supabase", "commerceConfigured", "email", "publicOrigin", "fileSafety",
  "encryption", "documentRendering", "maintenance", "database", "manualInventoryReady", "releaseSha", "legalContent"];

export async function collectStagingReadiness({ expectedSha, expectedMode = "locked", fetchImpl = fetch }) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha || "")) throw new Error("EXPECTED_FULL_RELEASE_SHA_REQUIRED");
  if (!Object.hasOwn(modes, expectedMode)) throw new Error("EXPECTED_STAGING_MODE_INVALID");
  async function probe(path, method = "GET") {
    try {
      const response = await fetchImpl(STAGING_ORIGIN + path, {
        method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
        ...(method === "POST" ? { headers: { "content-type": "application/json", origin: STAGING_ORIGIN }, body: "{}" } : {}),
      });
      let data = null;
      if (path === "/api/health") {
        const content = await response.text();
        if (content.length > 65_536) throw new Error("OVERSIZED_RESPONSE");
        data = JSON.parse(content);
      }
      return { status: response.status, data };
    } catch { return { status: null, data: null }; }
  }
  const [live, health, search, materials, board, boardMaterials] = await Promise.all([
    probe("/api/live"), probe("/api/health"), probe("/api/checkout/search", "POST"),
    probe("/api/checkout/apply-packs", "POST"), probe("/api/checkout/job-board", "POST"),
    probe("/api/checkout/board-materials/10000000-0000-4000-8000-000000000001", "POST"),
  ]);
  const payload = health.data && typeof health.data === "object" ? health.data : {};
  const checks = Object.fromEntries(requiredChecks.map((name) => [name, payload.checks?.[name] === true]));
  const identityMatches = payload.releaseSha === expectedSha;
  const modeMatches = Object.entries(modes[expectedMode]).every(([key, value]) => payload[key] === value);
  const anonymousDenials = [search, materials].every(({ status }) => [400, 401, 403, 404, 409, 423, 503].includes(status));
  const retiredCheckoutDenied = board.status === 410 && boardMaterials.status === 410;
  const ready = live.status === 200 && health.status === 200 && payload.status === "ready"
    && identityMatches && modeMatches && payload.acceptingOrders === false && payload.commerceConfigured === true
    && Object.values(checks).every(Boolean) && anonymousDenials && retiredCheckoutDenied;
  return {
    observedAt: new Date().toISOString(), collector: "report-staging-readiness-v2", environment: "staging",
    origin: STAGING_ORIGIN, expectedSha, expectedMode, ready,
    observedSha: /^[a-f0-9]{40}$/.test(payload.releaseSha || "") ? payload.releaseSha : null,
    identityMatches, modeMatches, publicAcceptanceDisabled: payload.acceptingOrders === false,
    commerceConfigured: payload.commerceConfigured === true, checks,
    probes: { liveness: live.status, health: health.status, anonymousSearch: search.status,
      anonymousMaterials: materials.status, retiredBoard: board.status, retiredBoardMaterials: boardMaterials.status },
    anonymousDenials, retiredCheckoutDenied,
    limitations: [
      "Anonymous negative probes do not prove denial for authenticated unauthorized customers or all deployed instances.",
      "Provider receipts, authorized journeys, document approval, recovery and human/device acceptance remain separate evidence.",
    ],
    freshness: "Point-in-time only; refresh after code, schema, configuration, provider identity or phase changes and before activation.",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await collectStagingReadiness({ expectedSha: process.env.APP_EXPECTED_RELEASE_SHA,
      expectedMode: process.env.APPLYPACK_READINESS_MODE || "locked" });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.ready) process.exitCode = 1;
  } catch {
    process.stderr.write("Readiness reporting requires APP_EXPECTED_RELEASE_SHA (40 lowercase hex characters) and APPLYPACK_READINESS_MODE (locked, rehearsal or canary).\n");
    process.exitCode = 1;
  }
}
