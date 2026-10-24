import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

export const sandbox = Object.freeze({
  projectRef: "fmugizadzdnqfckujqlw",
  databaseOrigin: "https://fmugizadzdnqfckujqlw.supabase.co",
  origin: "https://applypack-staging-staging.up.railway.app",
  accountId: "acct_1UTeOMJBHv2xRTvu",
});
export const catalog = Object.freeze({
  SEARCH: { amount: 1_899, price: "price_1UTkYBJBHv2xRTvu8oQ7H9wg", product: "prod_VUk2iNfZrwb6Zq", name: "Job Match Search", contract: "manual-launch-search-v2", metadataKind: "job_search" },
  MATERIALS: { amount: 799, price: "price_1UTkaTJBHv2xRTvug7ibWWau", product: "prod_VUk3Vqm4pZjwIy", name: "Tailored Resume + Cover Letter", contract: "manual-launch-pack-v2", metadataKind: "apply_pack" },
});
const uuid = z.uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const manifestSchema = z.object({
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/),
  purchases: z.array(z.object({ productKind: z.enum(["SEARCH", "MATERIALS"]), paymentAttemptId: uuid,
    deliveredReleaseId: uuid, refundId: z.string().max(255).regex(/^re_[A-Za-z0-9]+$/) }).strict()).length(2),
}).strict().refine((value) => ["productKind", "paymentAttemptId", "deliveredReleaseId", "refundId"]
  .every((key) => new Set(value.purchases.map((purchase) => purchase[key])).size === 2));

class VerificationError extends Error {}
function check(condition, code) { if (!condition) throw new VerificationError(code); }
function instant(value, code) { const result = typeof value === "string" ? Date.parse(value) : NaN; check(Number.isFinite(result), code); return result; }
function providerId(value) { return typeof value === "string" ? value : value?.id; }
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

/** All remote operations are GET requests. Responses are reduced to non-sensitive proof before export. */
export async function verifySandboxLaunchEvidence({ manifest, environment = process.env, fetchImpl = fetch, now = () => new Date() }) {
  const parsed = manifestSchema.safeParse(manifest);
  check(parsed.success, "input_manifest_invalid");
  manifest = parsed.data;
  check(environment.AP_SANDBOX_SUPABASE_URL === sandbox.databaseOrigin, "sandbox_database_target_required");
  check(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(environment.AP_SANDBOX_STRIPE_SECRET_KEY || ""), "sandbox_test_credential_required");
  check(typeof environment.AP_SANDBOX_SUPABASE_SECRET_KEY === "string" && environment.AP_SANDBOX_SUPABASE_SECRET_KEY.length >= 16, "sandbox_database_credential_required");
  const startedAt = now().toISOString();
  let readCount = 0;

  async function get(url, headers, code) {
    let response;
    try { response = await fetchImpl(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new VerificationError(`${code}_read_failed`); }
    readCount += 1;
    check(response.ok, `${code}_read_failed`);
    try { return await response.json(); } catch { throw new VerificationError(`${code}_response_invalid`); }
  }
  const stripe = (path, parameters = {}) => get(`https://api.stripe.com/v1/${path}?${new URLSearchParams(parameters)}`, {
    Authorization: `Bearer ${environment.AP_SANDBOX_STRIPE_SECRET_KEY}`,
    "Stripe-Version": "2026-08-26.dahlia",
  }, "stripe");
  async function rows(table, fields, filters, limit = 3) {
    const query = new URLSearchParams({ select: fields, ...filters, limit: String(limit) });
    const key = environment.AP_SANDBOX_SUPABASE_SECRET_KEY;
    const data = await get(`${sandbox.databaseOrigin}/rest/v1/${table}?${query}`, {
      apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
    }, "sandbox_database");
    check(Array.isArray(data), "sandbox_database_rows_invalid");
    return data;
  }
  async function one(table, fields, filters) {
    const data = await rows(table, fields, filters);
    check(data.length === 1, `${table}_unique_record_required`);
    return data[0];
  }
  async function health() {
    const result = await get(`${sandbox.origin}/api/health`, {}, "staging_health");
    check(result.status === "ready" && result.releaseSha === manifest.releaseSha && result.commerceConfigured === true
      && result.acceptingOrders === false && ["LOCKED_STAGING", "STAGING_REHEARSAL", "STAGING_CANARY"].includes(result.checkoutMode)
      && result.checks?.database === true && result.checks?.releaseSha === true
      && Object.values(result.checks).every((value) => value === true), "staging_health_or_release_mismatch");
    return { releaseSha: result.releaseSha, checkoutMode: result.checkoutMode, checks: result.checks };
  }

  const before = await health();
  const account = await stripe("account");
  check(account.id === sandbox.accountId && account.object === "account", "stripe_account_mismatch");
  const internal = [];
  for (const input of [...manifest.purchases].sort((a, b) => (a.productKind === "SEARCH" ? 0 : 1) - (b.productKind === "SEARCH" ? 0 : 1))) {
    const expected = catalog[input.productKind];
    const payment = await one("ap_payment_attempts", "id,customer_id,amount_cents,currency,provider,settlement,dispute,immediate_charge_verified,payment_method_type,payment_verified_at,provider_checkout_session_id,provider_payment_id,provider_event_id", { id: `eq.${input.paymentAttemptId}` });
    check(payment.id === input.paymentAttemptId && payment.provider === "stripe" && payment.settlement === "PAID"
      && payment.amount_cents === expected.amount && payment.currency === "USD" && payment.immediate_charge_verified === true
      && payment.payment_method_type === "card" && payment.dispute === "NONE" && uuid.safeParse(payment.customer_id).success,
    "payment_record_mismatch");
    check(/^pi_[A-Za-z0-9]+$/.test(payment.provider_payment_id || "") && /^evt_[A-Za-z0-9]+$/.test(payment.provider_event_id || ""), "payment_provider_ids_missing");
    const paidAt = instant(payment.payment_verified_at, "payment_timestamp_missing");
    const initiation = await one("ap_checkout_initiations", "id,mode,customer_id,payment_attempt_id,product_kind,resource_id,release_sha,provider_session_id,state", { payment_attempt_id: `eq.${input.paymentAttemptId}` });
    check(initiation.payment_attempt_id === input.paymentAttemptId && initiation.customer_id === payment.customer_id
      && initiation.product_kind === input.productKind && initiation.release_sha === manifest.releaseSha
      && ["CANARY", "REHEARSAL"].includes(initiation.mode) && initiation.state === "PAID"
      && /^cs_test_[A-Za-z0-9]+$/.test(initiation.provider_session_id || "")
      && (payment.provider_checkout_session_id === null || payment.provider_checkout_session_id === initiation.provider_session_id), "checkout_initiation_mismatch");
    const [session, price, intent, event, refund] = await Promise.all([
      stripe(`checkout/sessions/${initiation.provider_session_id}`), stripe(`prices/${expected.price}`, { "expand[]": "product" }),
      stripe(`payment_intents/${payment.provider_payment_id}`), stripe(`events/${payment.provider_event_id}`), stripe(`refunds/${input.refundId}`),
    ]);
    check(price.id === expected.price && price.object === "price" && price.livemode === false && price.active === true
      && price.type === "one_time" && price.recurring === null && price.currency === "usd" && price.unit_amount === expected.amount
      && price.tax_behavior === "inclusive" && price.product?.id === expected.product && price.product?.active === true
      && price.product?.livemode === false && price.product?.name === expected.name, "sandbox_catalog_mismatch");
    check(session.id === initiation.provider_session_id && session.object === "checkout.session" && session.livemode === false
      && session.mode === "payment" && session.status === "complete" && session.payment_status === "paid"
      && session.amount_total === expected.amount && session.amount_subtotal === expected.amount && session.currency === "usd"
      && session.automatic_tax?.enabled === false && session.total_details?.amount_tax === 0
      && session.total_details?.amount_shipping === 0 && session.total_details?.amount_discount === 0
      && providerId(session.payment_intent) === payment.provider_payment_id
      && session.metadata?.initiation_id === initiation.id && session.metadata?.product_kind === expected.metadataKind
      && session.metadata?.contract_version === expected.contract, "checkout_session_mismatch");
    const lineItems = await stripe(`checkout/sessions/${session.id}/line_items`, { limit: "2" });
    check(lineItems.has_more === false && lineItems.data?.length === 1 && lineItems.data[0].quantity === 1
      && lineItems.data[0].price?.id === expected.price && lineItems.data[0].amount_total === expected.amount
      && lineItems.data[0].amount_subtotal === expected.amount && lineItems.data[0].currency === "usd", "checkout_line_items_mismatch");
    check(intent.id === payment.provider_payment_id && intent.object === "payment_intent" && intent.livemode === false
      && intent.status === "succeeded" && intent.amount === expected.amount && intent.amount_received === expected.amount
      && intent.currency === "usd" && /^ch_[A-Za-z0-9]+$/.test(providerId(intent.latest_charge) || ""), "payment_intent_mismatch");
    check(event.id === payment.provider_event_id && event.object === "event" && event.livemode === false
      && (!event.account || event.account === sandbox.accountId) && event.type === "checkout.session.completed"
      && event.data?.object?.id === session.id && event.data.object.livemode === false
      && event.data.object.payment_status === "paid" && providerId(event.data.object.payment_intent) === intent.id
      && event.data.object.amount_total === expected.amount && event.data.object.currency === "usd", "completion_event_mismatch");
    const [appliedEvent, webhook, release, refundOperation, charge] = await Promise.all([
      one("ap_provider_events", "provider,provider_event_id,event_type,signature_verified_at,applied_at,failure_code", { provider_event_id: `eq.${event.id}` }),
      one("webhook_events", "provider,provider_event_id,event_type,processed_at,processing_status,last_error_code", { provider_event_id: `eq.${event.id}` }),
      one("ap_releases", "id,customer_id,order_id,material_line_id,release_kind,committed_at,active_due_at,human_approved_by", { id: `eq.${input.deliveredReleaseId}` }),
      one("ap_refund_operations", "id,customer_id,payment_attempt_id,material_line_id,provider_refund_id,amount_cents,currency,state,requested_at,completed_at,superseded_at", { payment_attempt_id: `eq.${input.paymentAttemptId}`, provider_refund_id: `eq.${input.refundId}` }),
      stripe(`charges/${providerId(intent.latest_charge)}`),
    ]);
    check(appliedEvent.provider === "stripe" && appliedEvent.provider_event_id === event.id && appliedEvent.event_type === event.type
      && appliedEvent.failure_code === null && webhook.provider === "stripe" && webhook.provider_event_id === event.id
      && webhook.event_type === event.type && webhook.processing_status === "processed" && webhook.last_error_code === null,
    "signed_webhook_not_applied");
    const signatureAt = instant(appliedEvent.signature_verified_at, "webhook_signature_evidence_missing");
    check(instant(appliedEvent.applied_at, "webhook_application_missing") >= signatureAt
      && instant(webhook.processed_at, "webhook_processing_missing") >= signatureAt, "webhook_order_invalid");
    const deliveredAt = instant(release.committed_at, "delivery_timestamp_missing");
    check(release.id === input.deliveredReleaseId && release.customer_id === payment.customer_id
      && uuid.safeParse(release.human_approved_by).success && deliveredAt >= paidAt
      && deliveredAt <= instant(release.active_due_at, "delivery_deadline_missing"), "delivery_release_mismatch");
    const members = await rows("ap_release_members", "release_id,member_type,member_id", { release_id: `eq.${release.id}` }, 11);
    let searchOrderId; let selectedMatchId;
    if (input.productKind === "SEARCH") {
      const service = await one("ap_search_services", "id,customer_id,legacy_order_id,winning_payment_attempt_id,fulfillment", { winning_payment_attempt_id: `eq.${payment.id}` });
      check(service.winning_payment_attempt_id === payment.id && service.customer_id === payment.customer_id
        && service.legacy_order_id === release.order_id && service.fulfillment === "DELIVERED"
        && release.release_kind === "SEARCH_EXACT_TEN" && release.material_line_id === null
        && members.length === 10 && members.every((member) => member.release_id === release.id && member.member_type === "JOB_MATCH" && uuid.safeParse(member.member_id).success)
        && new Set(members.map((member) => member.member_id)).size === 10, "search_delivery_mismatch");
      searchOrderId = service.legacy_order_id;
      check(refundOperation.material_line_id === null, "search_refund_scope_mismatch");
    } else {
      const line = await one("ap_material_lines", "id,payment_attempt_id,allocated_amount_cents,fulfillment,delivered_order_id,delivered_match_id", { payment_attempt_id: `eq.${payment.id}` });
      check(line.payment_attempt_id === payment.id && line.allocated_amount_cents === expected.amount && line.fulfillment === "DELIVERED"
        && release.release_kind === "MATERIAL_PAIR" && release.material_line_id === line.id && release.order_id === line.delivered_order_id
        && members.length === 2 && members.every((member) => member.release_id === release.id && member.member_type === "GENERATED_ARTIFACT" && uuid.safeParse(member.member_id).success)
        && new Set(members.map((member) => member.member_id)).size === 2 && refundOperation.material_line_id === line.id,
      "materials_delivery_mismatch");
      const artifacts = await rows("ap_generated_artifacts", "id,customer_id,material_line_id,order_id,artifact_type", { id: `in.(${members.map((member) => member.member_id).join(",")})` });
      check(artifacts.length === 2 && artifacts.every((artifact) => members.some((member) => member.member_id === artifact.id)
        && artifact.customer_id === payment.customer_id && artifact.material_line_id === line.id && artifact.order_id === release.order_id)
        && new Set(artifacts.map((artifact) => artifact.artifact_type)).size === 2
        && artifacts.every((artifact) => ["RESUME", "COVER_LETTER"].includes(artifact.artifact_type)), "materials_artifact_pair_mismatch");
      searchOrderId = line.delivered_order_id; selectedMatchId = line.delivered_match_id;
      const search = internal.find((entry) => entry.proof.productKind === "SEARCH");
      check(search && initiation.resource_id === search.proof.deliveredReleaseId && search.searchOrderId === searchOrderId
        && search.members.some((member) => member.member_id === selectedMatchId), "materials_search_selection_mismatch");
    }
    check(refund.id === input.refundId && refund.object === "refund" && refund.status === "succeeded"
      && refund.amount === expected.amount && refund.currency === "usd" && providerId(refund.payment_intent) === intent.id
      && providerId(refund.charge) === charge.id && refundOperation.customer_id === payment.customer_id
      && refundOperation.payment_attempt_id === payment.id && refundOperation.provider_refund_id === refund.id
      && refundOperation.state === "SUCCEEDED" && refundOperation.amount_cents === expected.amount && refundOperation.currency === "USD"
      && refundOperation.superseded_at === null && instant(refundOperation.requested_at, "refund_requested_at_missing") >= deliveredAt
      && instant(refundOperation.completed_at, "refund_completed_at_missing") >= instant(refundOperation.requested_at, "refund_requested_at_missing")
      && Number.isInteger(refund.created) && refund.created * 1_000 >= deliveredAt - 999, "full_refund_mismatch");
    // Refund objects have no livemode field. Their retrieved charge and PaymentIntent prove test mode.
    check(charge.id === providerId(intent.latest_charge) && charge.object === "charge" && charge.livemode === false
      && providerId(charge.payment_intent) === intent.id && charge.status === "succeeded" && charge.paid === true
      && charge.captured === true && charge.amount === expected.amount && charge.amount_refunded === expected.amount
      && charge.refunded === true && charge.currency === "usd", "refunded_charge_mismatch");
    const proof = { productKind: input.productKind, units: 1, amountCents: expected.amount, paymentAttemptId: payment.id,
      checkoutSessionId: session.id, paymentIntentId: intent.id, checkoutCompletedEventId: event.id,
      deliveredReleaseId: release.id, refundId: refund.id, refundAmountCents: refund.amount, refundStatus: refund.status };
    internal.push({ proof, customerId: payment.customer_id, searchOrderId, members,
      observation: { ...proof, initiationMode: initiation.mode, paidAt: payment.payment_verified_at, deliveredAt: release.committed_at,
        refundCompletedAt: refundOperation.completed_at, checks: { account: true, exactPrice: true, testMode: true, signedWebhookApplied: true,
          customerOwnership: true, humanApprovedDelivery: true, deliveryBeforeDeadline: true, fullRefundAfterDelivery: true } } });
  }
  check(internal[0].customerId === internal[1].customerId, "proof_customer_mismatch");
  check(["checkoutSessionId", "paymentIntentId", "checkoutCompletedEventId"].every((key) => new Set(internal.map((entry) => entry.proof[key])).size === 2), "proof_transaction_reused");
  const after = await health();
  const verifiedAt = now().toISOString();
  check(instant(verifiedAt, "verification_clock_invalid") >= instant(startedAt, "verification_clock_invalid")
    && internal.every((entry) => instant(entry.observation.refundCompletedAt, "refund_timestamp_invalid") <= Date.parse(verifiedAt)), "verification_clock_invalid");
  const bundle = { schemaVersion: "applypack-sandbox-evidence-bundle-v1", evidenceKind: "read-only-reviewed-evidence-not-provider-attestation",
    sourceEnvironment: "staging", sourceProjectRef: sandbox.projectRef, sourceOrigin: sandbox.origin, stripeAccountId: sandbox.accountId,
    releaseSha: manifest.releaseSha, startedAt, verifiedAt, readOnlyRequests: readCount, healthBefore: before, healthAfter: after,
    sameCustomerAndSearchRelease: true, purchases: internal.map((entry) => entry.observation) };
  const bundleJson = serialize(bundle);
  const receipt = { schemaVersion: "applypack-sandbox-validation-v1", sourceEnvironment: "staging", sourceProjectRef: sandbox.projectRef,
    sourceOrigin: sandbox.origin, stripeAccountId: sandbox.accountId, livemode: false, currency: "USD", releaseSha: manifest.releaseSha,
    verifiedAt, proofBundleSha256: hash(bundleJson), purchases: internal.map((entry) => entry.proof) };
  return { receipt, bundle, bundleJson };
}

export function safeEvidenceOutputDirectory(directory, repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const requested = resolve(directory); let ancestor = requested;
  while (!existsSync(ancestor)) { const parent = dirname(ancestor); check(parent !== ancestor, "output_directory_invalid"); ancestor = parent; }
  const destination = resolve(realpathSync(ancestor), relative(ancestor, requested));
  const root = realpathSync(repositoryRoot); const child = relative(root, destination);
  if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) {
    for (const name of ["sandbox-proof-bundle.json", "sandbox-validation-receipt.json"]) {
      const file = resolve(destination, name);
      try { execFileSync("git", ["check-ignore", "--quiet", "--", file], { cwd: root, stdio: "pipe" }); }
      catch { throw new VerificationError("evidence_output_must_be_outside_source_or_git_ignored"); }
    }
  }
  check(!["sandbox-proof-bundle.json", "sandbox-validation-receipt.json"].some((name) => existsSync(resolve(destination, name))), "evidence_output_already_exists");
  return destination;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    check(args.length === 4 && args[0] === "--manifest" && args[2] === "--out", "usage: node scripts/verify-sandbox-launch-evidence.mjs --manifest <private-input.json> --out <new-private-directory>");
    const destination = safeEvidenceOutputDirectory(args[3]);
    let manifest;
    try { manifest = JSON.parse(readFileSync(resolve(args[1]), "utf8")); } catch { throw new VerificationError("input_manifest_unreadable"); }
    const result = await verifySandboxLaunchEvidence({ manifest });
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(destination, "sandbox-proof-bundle.json"), result.bundleJson, { flag: "wx", mode: 0o600 });
    writeFileSync(resolve(destination, "sandbox-validation-receipt.json"), serialize(result.receipt), { flag: "wx", mode: 0o600 });
    process.stdout.write(`Sandbox evidence verified for release ${result.receipt.releaseSha}. Receipt requires administrator review and fresh MFA; no provider or database writes occurred.\n`);
  } catch (error) {
    process.stderr.write(`Sandbox evidence not verified: ${error instanceof VerificationError ? error.message : "verification_failed"}.\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
