import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { catalog, sandbox, safeEvidenceOutputDirectory, verifySandboxLaunchEvidence } from "./verify-sandbox-launch-evidence.mjs";

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sha = "a".repeat(40);
const time = (minute) => `2026-10-23T12:${String(minute).padStart(2, "0")}:00.000Z`;
const environment = { AP_SANDBOX_SUPABASE_URL: sandbox.databaseOrigin,
  AP_SANDBOX_SUPABASE_SECRET_KEY: "sb_secret_privatefixture", AP_SANDBOX_STRIPE_SECRET_KEY: "sk_test_privatefixture" };

function fixture() {
  const manifest = { releaseSha: sha, purchases: [
    { productKind: "SEARCH", paymentAttemptId: id(1), deliveredReleaseId: id(3), refundId: "re_search" },
    { productKind: "MATERIALS", paymentAttemptId: id(2), deliveredReleaseId: id(4), refundId: "re_pack" },
  ] };
  const health = { status: "ready", releaseSha: sha, commerceConfigured: true, acceptingOrders: false, checkoutMode: "LOCKED_STAGING", checks: { database: true, releaseSha: true, maintenance: true } };
  const provider = { "/v1/account": { id: sandbox.accountId, object: "account", email: "never-export@example.test" } };
  const database = Object.fromEntries(["ap_payment_attempts", "ap_checkout_initiations", "ap_provider_events", "webhook_events", "ap_releases", "ap_refund_operations",
    "ap_release_members", "ap_search_services", "ap_material_lines", "ap_generated_artifacts"].map((table) => [table, []]));
  for (const [index, input] of manifest.purchases.entries()) {
    const name = index === 0 ? "search" : "pack";
    const item = catalog[input.productKind]; const offset = index * 20;
    const sessionId = `cs_test_${name}`; const paymentId = `pi_${name}`; const eventId = `evt_${name}`; const chargeId = `ch_${name}`;
    database.ap_payment_attempts.push({ id: input.paymentAttemptId, customer_id: id(5), amount_cents: item.amount,
      currency: "USD", provider: "stripe", settlement: "PAID", dispute: "NONE", immediate_charge_verified: true, payment_method_type: "card",
      payment_verified_at: time(offset), provider_checkout_session_id: sessionId, provider_payment_id: paymentId, provider_event_id: eventId,
      payer_receipt_email: "never-export@example.test" });
    database.ap_checkout_initiations.push({ id: id(10 + index), mode: "CANARY", customer_id: id(5), payment_attempt_id: input.paymentAttemptId,
      product_kind: input.productKind, resource_id: index === 0 ? id(30) : id(3), release_sha: sha, provider_session_id: sessionId, state: "PAID" });
    const session = { id: sessionId, object: "checkout.session", livemode: false, mode: "payment", status: "complete", payment_status: "paid",
      amount_total: item.amount, amount_subtotal: item.amount, currency: "usd", automatic_tax: { enabled: false },
      total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 }, payment_intent: paymentId,
      metadata: { initiation_id: id(10 + index), product_kind: item.metadataKind, contract_version: item.contract },
      customer_details: { email: "never-export@example.test", name: "Private Customer" } };
    provider[`/v1/checkout/sessions/${sessionId}`] = session;
    provider[`/v1/checkout/sessions/${sessionId}/line_items`] = { has_more: false, data: [{ quantity: 1, price: { id: item.price }, amount_total: item.amount, amount_subtotal: item.amount, currency: "usd" }] };
    provider[`/v1/prices/${item.price}`] = { id: item.price, object: "price", livemode: false, active: true, type: "one_time", recurring: null,
      currency: "usd", unit_amount: item.amount, tax_behavior: "inclusive", product: { id: item.product, active: true, livemode: false, name: item.name } };
    provider[`/v1/payment_intents/${paymentId}`] = { id: paymentId, object: "payment_intent", livemode: false, status: "succeeded", amount: item.amount, amount_received: item.amount, currency: "usd", latest_charge: chargeId };
    provider[`/v1/events/${eventId}`] = { id: eventId, object: "event", livemode: false, type: "checkout.session.completed", data: { object: structuredClone(session) } };
    provider[`/v1/refunds/${input.refundId}`] = { id: input.refundId, object: "refund", status: "succeeded", amount: item.amount, currency: "usd", payment_intent: paymentId, charge: chargeId, created: Date.parse(time(offset + 15)) / 1_000 };
    provider[`/v1/charges/${chargeId}`] = { id: chargeId, object: "charge", livemode: false, payment_intent: paymentId, status: "succeeded", paid: true, captured: true,
      amount: item.amount, amount_refunded: item.amount, refunded: true, currency: "usd" };
    database.ap_provider_events.push({ provider: "stripe", provider_event_id: eventId, event_type: "checkout.session.completed", signature_verified_at: time(offset), applied_at: time(offset), failure_code: null });
    database.webhook_events.push({ provider: "stripe", provider_event_id: eventId, event_type: "checkout.session.completed", processed_at: time(offset + 1), processing_status: "processed", last_error_code: null });
    database.ap_releases.push({ id: input.deliveredReleaseId, customer_id: id(5), order_id: id(6), material_line_id: index === 0 ? null : id(7),
      release_kind: index === 0 ? "SEARCH_EXACT_TEN" : "MATERIAL_PAIR", committed_at: time(offset + 10), active_due_at: "2026-10-24T12:00:00.000Z", human_approved_by: id(8) });
    database.ap_refund_operations.push({ id: id(40 + index), customer_id: id(5), payment_attempt_id: input.paymentAttemptId, material_line_id: index === 0 ? null : id(7),
      provider_refund_id: input.refundId, amount_cents: item.amount, currency: "USD", state: "SUCCEEDED", requested_at: time(offset + 15), completed_at: time(offset + 16), superseded_at: null });
  }
  database.ap_release_members.push(...Array.from({ length: 10 }, (_, index) => ({ release_id: id(3), member_type: "JOB_MATCH", member_id: id(100 + index) })),
    { release_id: id(4), member_type: "GENERATED_ARTIFACT", member_id: id(200) }, { release_id: id(4), member_type: "GENERATED_ARTIFACT", member_id: id(201) });
  database.ap_search_services.push({ id: id(9), customer_id: id(5), legacy_order_id: id(6), winning_payment_attempt_id: id(1), fulfillment: "DELIVERED" });
  database.ap_material_lines.push({ id: id(7), payment_attempt_id: id(2), allocated_amount_cents: 799, fulfillment: "DELIVERED", delivered_order_id: id(6), delivered_match_id: id(100) });
  database.ap_generated_artifacts.push(...["RESUME", "COVER_LETTER"].map((artifact_type, index) => ({ id: id(200 + index), customer_id: id(5), material_line_id: id(7), order_id: id(6), artifact_type })));
  const requests = [];
  async function fetchImpl(value, options) {
    const url = new URL(value); requests.push({ url, options });
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.body, undefined);
    let result;
    if (url.origin === sandbox.origin && url.pathname === "/api/health") result = health;
    else if (url.origin === "https://api.stripe.com") result = provider[url.pathname];
    else if (url.origin === sandbox.databaseOrigin) {
      const table = url.pathname.split("/").at(-1);
      result = database[table]?.filter((row) => [...url.searchParams.entries()].every(([key, filter]) => {
        if (["select", "limit"].includes(key)) return true;
        if (filter.startsWith("eq.")) return row[key] === filter.slice(3);
        if (filter.startsWith("in.(")) return filter.slice(4, -1).split(",").includes(row[key]);
        throw new Error("Unknown fixture filter");
      })).slice(0, Number(url.searchParams.get("limit")));
    }
    return { ok: result !== undefined, json: async () => structuredClone(result) };
  }
  return { manifest, database, provider, health, requests, fetchImpl };
}
const verify = (data, overrides = {}) => verifySandboxLaunchEvidence({ manifest: data.manifest, environment,
  fetchImpl: data.fetchImpl, now: () => new Date("2026-10-23T13:00:00.000Z"), ...overrides });

test("verifies both real graph shapes with GET only and emits a redacted hash-bound receipt", async () => {
  const data = fixture(); const result = await verify(data);
  assert.equal(result.receipt.schemaVersion, "applypack-sandbox-validation-v1");
  assert.equal(result.receipt.releaseSha, sha); assert.equal(result.receipt.livemode, false);
  assert.equal(result.receipt.proofBundleSha256, createHash("sha256").update(result.bundleJson).digest("hex"));
  assert.deepEqual(result.receipt.purchases.map((entry) => [entry.productKind, entry.units, entry.amountCents, entry.refundAmountCents]), [["SEARCH", 1, 1899, 1899], ["MATERIALS", 1, 799, 799]]);
  assert.equal(data.requests.filter(({ url }) => url.pathname === "/api/health").length, 2);
  assert.equal(result.bundle.readOnlyRequests, data.requests.length);
  for (const forbidden of ["never-export@example.test", "Private Customer", environment.AP_SANDBOX_STRIPE_SECRET_KEY, environment.AP_SANDBOX_SUPABASE_SECRET_KEY, id(5)]) {
    assert.ok(!JSON.stringify(result).includes(forbidden));
  }
});

const mismatches = [
  ["wrong account", (f) => { f.provider["/v1/account"].id = "acct_other"; }],
  ["wrong deployed SHA", (f) => { f.health.releaseSha = "b".repeat(40); }],
  ["unhealthy dependency", (f) => { f.health.checks.maintenance = false; }],
  ["public staging checkout", (f) => { f.health.acceptingOrders = true; }],
  ["unverified payment", (f) => { f.database.ap_payment_attempts[0].immediate_charge_verified = false; }],
  ["open dispute", (f) => { f.database.ap_payment_attempts[0].dispute = "OPEN"; }],
  ["wrong payment amount", (f) => { f.database.ap_payment_attempts[0].amount_cents = 2000; }],
  ["wrong payment customer", (f) => { f.database.ap_payment_attempts[0].customer_id = id(55); }],
  ["wrong initiation release", (f) => { f.database.ap_checkout_initiations[0].release_sha = "b".repeat(40); }],
  ["public initiation", (f) => { f.database.ap_checkout_initiations[0].mode = "PUBLIC"; }],
  ["unsettled initiation", (f) => { f.database.ap_checkout_initiations[0].state = "OPEN"; }],
  ["live Session", (f) => { f.provider["/v1/checkout/sessions/cs_test_search"].livemode = true; }],
  ["added tax", (f) => { f.provider["/v1/checkout/sessions/cs_test_search"].automatic_tax.enabled = true; }],
  ["wrong Session initiation", (f) => { f.provider["/v1/checkout/sessions/cs_test_search"].metadata.initiation_id = id(60); }],
  ["wrong Session PI", (f) => { f.provider["/v1/checkout/sessions/cs_test_search"].payment_intent = "pi_other"; }],
  ["wrong price mode", (f) => { f.provider[`/v1/prices/${catalog.SEARCH.price}`].livemode = true; }],
  ["wrong product", (f) => { f.provider[`/v1/prices/${catalog.SEARCH.price}`].product.id = "prod_other"; }],
  ["wrong line-item price", (f) => { f.provider["/v1/checkout/sessions/cs_test_search/line_items"].data[0].price.id = "price_other"; }],
  ["wrong quantity", (f) => { f.provider["/v1/checkout/sessions/cs_test_search/line_items"].data[0].quantity = 2; }],
  ["truncated line items", (f) => { f.provider["/v1/checkout/sessions/cs_test_search/line_items"].has_more = true; }],
  ["unpaid intent", (f) => { f.provider["/v1/payment_intents/pi_search"].status = "processing"; }],
  ["live intent", (f) => { f.provider["/v1/payment_intents/pi_search"].livemode = true; }],
  ["event for different Session", (f) => { f.provider["/v1/events/evt_search"].data.object.id = "cs_test_other"; }],
  ["live event", (f) => { f.provider["/v1/events/evt_search"].livemode = true; }],
  ["connected wrong-account event", (f) => { f.provider["/v1/events/evt_search"].account = "acct_other"; }],
  ["missing signature verification", (f) => { f.database.ap_provider_events[0].signature_verified_at = null; }],
  ["unapplied completion event", (f) => { f.database.ap_provider_events[0].applied_at = null; }],
  ["unprocessed webhook", (f) => { f.database.webhook_events[0].processing_status = "processing"; }],
  ["wrong release owner", (f) => { f.database.ap_releases[0].customer_id = id(50); }],
  ["missing human approval", (f) => { f.database.ap_releases[0].human_approved_by = null; }],
  ["late delivery", (f) => { f.database.ap_releases[0].committed_at = "2026-10-25T12:00:00Z"; }],
  ["wrong winning search payment", (f) => { f.database.ap_search_services[0].winning_payment_attempt_id = id(50); }],
  ["only nine search jobs", (f) => { f.database.ap_release_members.splice(0, 1); }],
  ["duplicate search job", (f) => { f.database.ap_release_members[0].member_id = f.database.ap_release_members[1].member_id; }],
  ["material release for another line", (f) => { f.database.ap_releases[1].material_line_id = id(50); }],
  ["two purchased material lines", (f) => { f.database.ap_material_lines.push({ ...f.database.ap_material_lines[0], id: id(50) }); }],
  ["material from unselected job", (f) => { f.database.ap_material_lines[0].delivered_match_id = id(50); }],
  ["wrong source search release", (f) => { f.database.ap_checkout_initiations[1].resource_id = id(50); }],
  ["artifact for another customer", (f) => { f.database.ap_generated_artifacts[0].customer_id = id(50); }],
  ["two resumes without letter", (f) => { f.database.ap_generated_artifacts[1].artifact_type = "RESUME"; }],
  ["partial provider refund", (f) => { f.provider["/v1/refunds/re_search"].amount = 100; }],
  ["pending provider refund", (f) => { f.provider["/v1/refunds/re_search"].status = "pending"; }],
  ["refund for another PI", (f) => { f.provider["/v1/refunds/re_search"].payment_intent = "pi_other"; }],
  ["refund for another charge", (f) => { f.provider["/v1/refunds/re_search"].charge = "ch_other"; }],
  ["unreconciled application refund", (f) => { f.database.ap_refund_operations[0].state = "PENDING"; }],
  ["refund before delivery", (f) => { f.database.ap_refund_operations[0].requested_at = time(1); }],
  ["refund completion before request", (f) => { f.database.ap_refund_operations[0].completed_at = time(14); }],
  ["superseded refund", (f) => { f.database.ap_refund_operations[0].superseded_at = time(19); }],
  ["live refunded charge", (f) => { f.provider["/v1/charges/ch_search"].livemode = true; }],
  ["partial refunded charge", (f) => { f.provider["/v1/charges/ch_search"].amount_refunded = 100; }],
];
for (const [name, change] of mismatches) test(`rejects ${name}`, async () => { const data = fixture(); change(data); await assert.rejects(verify(data)); });

test("rejects source or live credentials before network access", async () => {
  for (const changes of [{ AP_SANDBOX_SUPABASE_URL: "https://other.supabase.co" }, { AP_SANDBOX_STRIPE_SECRET_KEY: "sk_live_secret" }, { AP_SANDBOX_SUPABASE_SECRET_KEY: "" }]) {
    const data = fixture(); await assert.rejects(verify(data, { environment: { ...environment, ...changes } })); assert.equal(data.requests.length, 0);
  }
});
test("rejects malformed, duplicate or mixed-product manifests before network access", async () => {
  for (const changes of [{ releaseSha: "branch-name" }, { purchases: [] }, { unknown: true }]) {
    const data = fixture(); await assert.rejects(verify(data, { manifest: { ...data.manifest, ...changes } })); assert.equal(data.requests.length, 0);
  }
  const data = fixture(); data.manifest.purchases[1] = { ...data.manifest.purchases[0] };
  await assert.rejects(verify(data)); assert.equal(data.requests.length, 0);
});
test("rejects mixing separate customers even when each purchase is internally consistent", async () => {
  const data = fixture();
  for (const table of ["ap_payment_attempts", "ap_checkout_initiations", "ap_releases", "ap_refund_operations"]) data.database[table][1].customer_id = id(55);
  for (const artifact of data.database.ap_generated_artifacts) artifact.customer_id = id(55);
  await assert.rejects(verify(data), /proof_customer_mismatch/);
});
test("fails closed if the deployed revision changes during verification", async () => {
  const data = fixture(); let healthReads = 0;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === "/api/health" && ++healthReads === 2) data.health.releaseSha = "b".repeat(40);
    return data.fetchImpl(url, options);
  };
  await assert.rejects(verify(data, { fetchImpl }), /staging_health_or_release_mismatch/);
});
test("sanitizes provider errors and does not serialize their response body", async () => {
  const data = fixture();
  await assert.rejects(verify(data, { fetchImpl: async () => { throw new Error(`${environment.AP_SANDBOX_STRIPE_SECRET_KEY} never-export@example.test`); } }), /^Error: staging_health_read_failed$/);
  await assert.rejects(verify(data, { fetchImpl: async () => ({ ok: false, json: async () => { throw new Error("must not read"); } }) }), /^Error: staging_health_read_failed$/);
});
test("refuses tracked-source output while allowing a new external evidence directory without overwriting", () => {
  assert.throws(() => safeEvidenceOutputDirectory(resolve("scripts")), /evidence_output_must_be_outside_source_or_git_ignored/);
  const directory = mkdtempSync(resolve(tmpdir(), "applypack-sandbox-proof-"));
  try {
    assert.equal(safeEvidenceOutputDirectory(directory), directory);
    writeFileSync(resolve(directory, "sandbox-validation-receipt.json"), "existing");
    assert.throws(() => safeEvidenceOutputDirectory(directory), /evidence_output_already_exists/);
  } finally {
    assert.ok(directory.startsWith(resolve(tmpdir(), "applypack-sandbox-proof-")));
    rmSync(directory, { recursive: true, force: true });
  }
});
