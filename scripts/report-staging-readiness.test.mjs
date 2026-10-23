import assert from "node:assert/strict";
import test from "node:test";
import { collectStagingReadiness, STAGING_ORIGIN } from "./report-staging-readiness.mjs";
const sha = "a".repeat(40);
const good = {
  status: "ready", releaseSha: sha, checkoutMode: "LOCKED_STAGING", restrictedCheckoutMode: null,
  sessionCreationConfigured: false, acceptingOrders: false, commerceConfigured: true,
  checks: Object.fromEntries(["checkoutMode", "supabase", "commerceConfigured", "email", "publicOrigin", "fileSafety",
    "encryption", "documentRendering", "maintenance", "database", "manualInventoryReady", "releaseSha", "legalContent"].map((key) => [key, true])),
};
function provider(data = good, statusOverride = {}) {
  return async (url, options) => {
    assert.equal(new URL(url).origin, STAGING_ORIGIN);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers?.authorization, undefined);
    const path = new URL(url).pathname;
    const status = statusOverride[path] ?? (path.startsWith("/api/checkout/board") || path === "/api/checkout/job-board" ? 410
      : path.startsWith("/api/checkout") ? 401 : 200);
    return new Response(JSON.stringify(data), { status });
  };
}
test("reports locked readiness from exact SHA, dependencies and negative probes", async () => {
  assert.equal((await collectStagingReadiness({ expectedSha: sha, fetchImpl: provider() })).ready, true);
});
test("accepts the search route's absent anonymous draft denial", async () => {
  const report = await collectStagingReadiness({ expectedSha: sha,
    fetchImpl: provider(good, { "/api/checkout/search": 404 }) });
  assert.equal(report.probes.anonymousSearch, 404);
  assert.equal(report.ready, true);
});
for (const change of [{ releaseSha: "b".repeat(40) }, { checkoutMode: "STAGING_CANARY" }, { acceptingOrders: true },
  { checks: {} }, { checks: { ...good.checks, manualInventoryReady: false } }, { sessionCreationConfigured: true }, { commerceConfigured: false }]) {
  test(`fails closed for ${Object.keys(change).join(",")}`, async () => {
    assert.equal((await collectStagingReadiness({ expectedSha: sha, fetchImpl: provider({ ...good, ...change }) })).ready, false);
  });
}
test("requires independently reported restricted mode", async () => {
  const report = await collectStagingReadiness({ expectedSha: sha, expectedMode: "rehearsal", fetchImpl: provider({
    ...good, checkoutMode: "STAGING_REHEARSAL", restrictedCheckoutMode: "REHEARSAL", sessionCreationConfigured: true,
  }) });
  assert.equal(report.ready, true);
});
test("anonymous purchase success or retired board success cannot pass", async () => {
  for (const path of ["/api/checkout/search", "/api/checkout/apply-packs", "/api/checkout/job-board"]) {
    assert.equal((await collectStagingReadiness({ expectedSha: sha, fetchImpl: provider(good, { [path]: 200 }) })).ready, false);
  }
});
test("sanitizes responses/errors and refuses invalid candidate before networking", async () => {
  const report = await collectStagingReadiness({ expectedSha: sha, fetchImpl: provider({ ...good, secret: "never-emit-this" }) });
  assert.equal(JSON.stringify(report).includes("never-emit-this"), false);
  const failed = await collectStagingReadiness({ expectedSha: sha, fetchImpl: async () => { throw Error("private-provider-error"); } });
  assert.equal(failed.ready, false);
  assert.equal(JSON.stringify(failed).includes("private-provider-error"), false);
  await assert.rejects(collectStagingReadiness({ expectedSha: "short", fetchImpl: () => { throw Error("must-not-run"); } }), /EXPECTED_FULL/);
});
