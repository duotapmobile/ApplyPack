import { expect } from "vitest";
import { z } from "zod";
import Stripe from "stripe";
// Install the same explicit external boundaries before importing real handlers.
// This module does not create a paid graph or register a test on import.
import "./verified-paid-search-setup";
import type { VerifiedPaidSearchSetup } from "./verified-paid-search-setup";
import type { Database } from "@/lib/database.types";
import { POST as startPackCheckout } from "@/app/api/checkout/apply-packs/route";
import { POST as receiveStripeWebhook } from "@/app/api/stripe/webhook/route";
import { selectedJobResourceSha256 } from "@/lib/commerce/checkout-authorization";
import { canonicalApplicationOrigin } from "@/lib/commerce/server";
import { manualLaunchFixedTotalIsSafe } from "@/lib/commerce/fixed-total";
import { documentWorkerConfiguration, documentWorkerExecutionMode } from "@/lib/files/aws-document-worker";
import { submissionRuleSavedSchema, type SubmissionRuleSaved } from "@/lib/documents/submission-rule-proposal";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
const uuid = (value: unknown) => z.uuid().parse(value);
const checkoutResponse = z.object({ url: z.url(), expiresAt: z.iso.datetime(), lineCount: z.literal(1),
  amountCents: z.literal(799), currency: z.literal("USD"), taxInclusive: z.literal(true) }).strict();
const contactSchema = z.object({ displayName: z.string().trim().min(1).max(120), email: z.email(),
  phone: z.string().trim().min(7).max(40), cityState: z.string().trim().min(2).max(120) }).strict();

/** Reusable local paid-pack continuation with modeled external boundaries.
 * Requires the strict fictional Stripe transport to support Apply Pack Sessions
 * with independent PaymentIntent/charge IDs. The caller retains the original external
 * boundaries and runs cleanupVerifiedPaidSearch only after all continuations.
 * Only an explicit fictional MATERIALS rehearsal authorization is seeded here;
 * the actual HTTP/SQL/webhook path creates every purchase, line and paid job. */
export async function setupVerifiedPaidPack(graph: VerifiedPaidSearchSetup, confirmed: {
  jobSnapshotId: string; ruleId: string; saved: SubmissionRuleSaved;
}, fictionalCustomerConfirmation: {
  contact: z.input<typeof contactSchema>;
  keepExistingTimeline: true;
  omitCareerBreakFromCoverLetter: true;
  noReferencesSelected: true;
  documentContactConfirmed: true;
  documentFactsConfirmed: true;
  noAutoApplyAcknowledged: true;
  outcomesAcknowledged: true;
}) {
  const { database, boundary, provider, origin } = graph;
  const customerId = uuid(boundary.customerId), orderId = uuid(graph.orderId), releaseId = uuid(graph.releaseId);
  const sourceSnapshotId = uuid(graph.intake.snapshotId), jobSnapshotId = uuid(confirmed.jobSnapshotId), ruleId = uuid(confirmed.ruleId);
  const saved = submissionRuleSavedSchema.parse(confirmed.saved), contact = contactSchema.parse(fictionalCustomerConfirmation.contact);
  expect(saved).toMatchObject({ jobSnapshotId, ruleId, current: true });
  expect(fictionalCustomerConfirmation).toMatchObject({ keepExistingTimeline: true, omitCareerBreakFromCoverLetter: true, noReferencesSelected: true,
    documentContactConfirmed: true, documentFactsConfirmed: true, noAutoApplyAcknowledged: true, outcomesAcknowledged: true });
  expect(boundary.verified).toBe(true);

  const result = async (response: Response, status: number) => {
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify({ body, failures: database.failures,
      requiredTransport: "strict Apply Pack Stripe response and three named material RPCs" })).toBe(status);
    return body;
  };
  const post = (body: unknown) => new Request(`${origin}/api/checkout/apply-packs`, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  const searchHistory = () => database.sql(`select jsonb_build_object(
    'service',(select to_jsonb(s) from public.ap_search_services s where id='${uuid(graph.searchServiceId)}'),
    'order',(select to_jsonb(o) from public.orders o where id='${orderId}'),
    'release',(select to_jsonb(r) from public.ap_releases r where id='${releaseId}'),
    'members',(select jsonb_agg(to_jsonb(m) order by position) from public.ap_release_members m where release_id='${releaseId}'),
    'matches',(select jsonb_agg(to_jsonb(m) order by position) from public.job_matches m where search_order_id='${orderId}'),
    'payment',(select to_jsonb(p) from public.ap_payment_attempts p join public.ap_search_services s on s.winning_payment_attempt_id=p.id where s.id='${uuid(graph.searchServiceId)}'),
    'allocation',(select to_jsonb(a) from public.ap_capacity_allocations a join public.ap_search_services s on s.capacity_allocation_id=a.id where s.id='${uuid(graph.searchServiceId)}'),
    'notices',(select jsonb_agg(to_jsonb(m) order by id) from public.ap_outbox_messages m where order_id='${orderId}'
      and message_kind in('PAYMENT_VERIFIED_SEARCH_STARTED','SEARCH_EXACT_TEN_DELIVERED')))`, true);
  const originalSearch = await searchHistory();
  const rule: Row<"ap_employer_submission_rules"> = await database.sql(`select to_jsonb(r) from public.ap_employer_submission_rules r
    where id='${ruleId}' and job_snapshot_id='${jobSnapshotId}' and is_current`, true);
  expect(rule).toMatchObject({ id: ruleId, job_snapshot_id: jobSnapshotId, is_current: true,
    human_confirmed_by: boundary.operatorId, injection_scan_state: "CLEAR", hard_block_reason: null });
  const receipt: Row<"ap_employer_rule_review_receipts"> = await database.sql(`select to_jsonb(r) from public.ap_employer_rule_review_receipts r
    where request_id='${uuid(saved.requestId)}'`, true);
  expect(receipt).toMatchObject({ request_id: saved.requestId, job_snapshot_id: jobSnapshotId, reviewer_id: boundary.operatorId,
    expected_basis: saved.expectedBasis, review_checklist: saved.checklist, review_evidence: saved.reviewEvidence,
    rule_id: ruleId, rule_content_sha256: rule.content_sha256 });
  expect(receipt.confirmed_rules).toMatchObject(saved.choices);
  expect(Date.parse(receipt.checked_at)).toBe(Date.parse(saved.checkedAt));
  // Equivalent104 confirmations retain the original rule row and may have a
  // later receipt time. The receipt cannot renew this helper's paid-rule TTL.
  expect(Date.parse(receipt.checked_at)).toBeGreaterThanOrEqual(Date.parse(rule.checked_at));
  expect(Date.parse(receipt.checked_at)).toBeLessThanOrEqual(Date.now());
  // Do not refresh timestamps or replace the source snapshot to make checkout pass.
  const ruleAge = Date.now() - Date.parse(rule.checked_at);
  expect(ruleAge).toBeGreaterThanOrEqual(0); expect(ruleAge).toBeLessThan(3_600_000);
  const match: Row<"job_matches"> = await database.sql(`select to_jsonb(m) from public.job_matches m
    join public.ap_match_evaluations e on e.id=m.release_evaluation_id
    where m.search_order_id='${orderId}' and e.job_snapshot_id='${jobSnapshotId}'`, true);
  const matchId = uuid(match.id);
  expect(graph.releaseMembers.some(member => member.member_id === matchId)).toBe(true);
  expect(graph.releaseEvaluations.some(evaluation => evaluation.id === match.release_evaluation_id
    && evaluation.job_snapshot_id === jobSnapshotId)).toBe(true);
  expect(await database.sql(`select count(*)::int from public.ap_material_lines where delivered_order_id='${orderId}' and delivered_match_id='${matchId}'`, true)).toBe(0);

  const resourceSha256 = selectedJobResourceSha256([matchId]);
  const releaseSha = z.string().regex(/^[a-f0-9]{40}$/).parse(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA);
  // Explicit fictional fixture configuration, not a rule/source freshness edit.
  // Compare the entire row so this setup cannot silently alter another control.
  const beforeCommerce: Row<"ap_commerce_configuration"> = await database.sql("select to_jsonb(x) from public.ap_commerce_configuration x where singleton", true);
  await database.script("update public.ap_commerce_configuration set materials_rule_ttl_seconds=3600 where singleton;");
  const commerce: Row<"ap_commerce_configuration"> = await database.sql("select to_jsonb(x) from public.ap_commerce_configuration x where singleton", true);
  expect(commerce).toEqual({ ...beforeCommerce, materials_rule_ttl_seconds: 3600 });
  expect(commerce.checkout_enabled).toBe(false); // The separate exact rehearsal authorization remains required.
  expect(commerce.canonical_site_url).toBe(canonicalApplicationOrigin());
  expect(manualLaunchFixedTotalIsSafe(commerce)).toBe(true);
  expect(commerce).toMatchObject({ immediate_payment_methods: ["card"], materials_rule_ttl_seconds: 3600,
    materials_generation_approved: true, document_safety_policy: "generated-structural-v1" });
  for (const value of [commerce.pricing_version, commerce.tax_version, commerce.materials_generation_approval_reference])
    expect(z.string().trim().min(1).safeParse(value).success).toBe(true);
  expect(commerce.material_output_formats.length).toBeGreaterThan(0);
  expect(documentWorkerExecutionMode()).toBe("remote");
  const worker = documentWorkerConfiguration();
  expect(worker).toMatchObject({ ready: true, identity: commerce.document_renderer_identity,
    fontSha256: commerce.document_font_sha256, fontManifestSha256: commerce.document_font_manifest_sha256 });
  expect(await database.sql(`select to_jsonb(r) from public.ap_employer_submission_rules r where id='${ruleId}'`, true)).toEqual(rule);
  expect(await searchHistory()).toEqual(originalSearch);
  // Reuse the administrator who authorized this exact paid SEARCH rehearsal.
  // The document reviewer is an operator and must not be elevated for this setup.
  const searchSessionId = z.string().regex(/^cs_test_[A-Za-z0-9_]+$/).parse(graph.providerSessionId);
  const [rehearsalAdmin] = z.array(z.object({ actorId: z.uuid(), role: z.literal("admin") }).strict()).length(1).parse(
    await database.sql(`select coalesce(jsonb_agg(jsonb_build_object('actorId',a.authorized_by,'role',p.role)),'[]'::jsonb)
      from public.ap_checkout_initiations i
      join public.ap_staging_rehearsal_authorizations a on a.id=i.authorization_id
      join public.profiles p on p.id=a.authorized_by
      join public.ap_search_services s on s.winning_payment_attempt_id=i.payment_attempt_id
      where i.provider_session_id='${searchSessionId}' and i.state='PAID' and i.mode='REHEARSAL'
        and i.product_kind='SEARCH' and i.customer_id='${customerId}' and i.resource_id='${uuid(graph.intake.draftId)}'
        and i.release_sha='${releaseSha}' and s.id='${uuid(graph.searchServiceId)}'
        and a.product_kind=i.product_kind and a.customer_id=i.customer_id and a.resource_id=i.resource_id
        and a.release_sha=i.release_sha and a.resource_sha256 is null and a.revoked_at is null
        and a.expires_at>clock_timestamp()`, true));
  await database.script(`select public.ap_authorize_staging_rehearsal_checkout('${releaseSha}','MATERIALS',
    '${customerId}','${releaseId}','${resourceSha256}','${rehearsalAdmin.actorId}',
    'Fictional local single-pack continuation after actual paid search and owner rule confirmation',clock_timestamp()+interval '20 minutes');`);
  const body = { deliveredOrderId: orderId, deliveredReleaseId: releaseId, sourceSnapshotId, contact,
    items: [{ jobMatchId: matchId, ruleId, selectedReferenceSheet: false, referencePermissionIds: [], emphasisNote: "", doNotMentionNote: "" }],
    careerBreakChoice: "KEEP_EXISTING_TIMELINE", coverLetterBreakConsent: false,
    documentContactConfirmed: fictionalCustomerConfirmation.documentContactConfirmed,
    documentFactsConfirmed: fictionalCustomerConfirmation.documentFactsConfirmed,
    noAutoApplyAcknowledged: fictionalCustomerConfirmation.noAutoApplyAcknowledged,
    outcomesAcknowledged: fictionalCustomerConfirmation.outcomesAcknowledged };
  const priorSessions = new Set(provider.sessions.keys()), priorCommands = provider.commands.size, failureOffset = database.failures.length;
  const checkout = checkoutResponse.parse(await result(await startPackCheckout(post(body)), 200));
  expect(provider.sessions.size).toBe(priorSessions.size + 1); expect(provider.commands.size).toBe(priorCommands + 1);
  expect(await result(await startPackCheckout(post(body)), 200)).toEqual(checkout);
  expect(provider.sessions.size).toBe(priorSessions.size + 1); expect(provider.commands.size).toBe(priorCommands + 1);
  const created = [...provider.sessions.keys()].filter(value => !priorSessions.has(value));
  expect(created).toHaveLength(1);
  const providerSessionId = z.string().min(1).parse(created[0]);
  const session = provider.sessions.get(providerSessionId);
  expect(session).toMatchObject({ amount_total: 799, metadata: { product_kind: "apply_pack" } });
  const checkoutIntentId = uuid(z.string().parse(session?.metadata.checkout_intent_id));
  const intent: Row<"ap_material_checkout_intents"> = await database.sql(`select to_jsonb(i) from public.ap_material_checkout_intents i where id='${checkoutIntentId}'`, true);
  expect(intent).toMatchObject({ customer_id: customerId, delivered_order_id: orderId, delivered_release_id: releaseId,
    source_snapshot_id: sourceSnapshotId, provider_checkout_session_id: providerSessionId, line_count: 1, amount_cents: 799, state: "OPEN" });
  expect(Date.parse(z.string().parse(intent.expires_at))).toBe(Date.parse(checkout.expiresAt));
  const paid = provider.complete(providerSessionId);
  expect(paid.amount_total).toBe(799);
  const paidEventCreated = Math.floor(Date.now() / 1000);
  const webhook = async (eventId: string, validSignature = true) => {
    // Model an older signed completion arriving after the newer completion.
    // A repeated event ID keeps exactly the same payload bytes on every call.
    const createdAt = eventId === "evt_FictionalPaidPackReordered" ? paidEventCreated : paidEventCreated + 1;
    const payload = JSON.stringify({ id: eventId, object: "event", type: "checkout.session.completed", livemode: false,
      created: createdAt, data: { object: paid } });
    const secret = validSignature ? z.string().min(1).parse(process.env.STRIPE_WEBHOOK_SECRET) : "whsec_wrong_pack";
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return receiveStripeWebhook(new Request(`${origin}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": header }, body: payload }));
  };
  await result(await webhook("evt_FictionalPaidPackInvalid", false), 400);
  expect(await database.sql(`select to_jsonb(settlement) from public.ap_payment_attempts where id='${uuid(intent.payment_attempt_id)}'`, true)).toBe("UNPAID");
  await result(await webhook("evt_FictionalPaidPack"), 200);
  for (const work of boundary.after.splice(0)) await work();
  const paidState = () => database.sql(`select jsonb_build_object(
    'intent',(select jsonb_build_object('state',state,'completedAt',completed_at,'amountCents',amount_cents,'lineCount',line_count) from public.ap_material_checkout_intents where id='${checkoutIntentId}'),
    'purchase',(select to_jsonb(p) from public.ap_material_purchases p where id='${uuid(intent.purchase_id)}'),
    'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from public.ap_material_lines l where purchase_id='${uuid(intent.purchase_id)}'),
    'revisions',(select jsonb_agg(to_jsonb(r) order by r.id) from public.ap_material_line_revisions r join public.ap_material_lines l on l.id=r.line_id where l.purchase_id='${uuid(intent.purchase_id)}'),
    'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.ap_material_draft_jobs j join public.ap_material_lines l on l.id=j.material_line_id where l.purchase_id='${uuid(intent.purchase_id)}'),
    'payment',(select to_jsonb(p) from public.ap_payment_attempts p where id='${uuid(intent.payment_attempt_id)}'),
    'allocation',(select to_jsonb(a) from public.ap_capacity_allocations a where id='${uuid(intent.capacity_allocation_id)}'),
    'capacityMembers',(select jsonb_agg(to_jsonb(m) order by m.id) from public.ap_capacity_allocation_members m where allocation_id='${uuid(intent.capacity_allocation_id)}'),
    'notices',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.ap_outbox_messages m where message_kind='MATERIALS_PAYMENT_VERIFIED' and recipient_ref='${uuid(intent.purchase_id)}'),'[]'::jsonb),
    'deadlines',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.ap_scheduled_jobs s join public.ap_material_lines l on l.id=s.reference_id where l.purchase_id='${uuid(intent.purchase_id)}' and s.job_kind='MATERIAL_LINE_DEADLINE'),'[]'::jsonb),
    'rule',(select to_jsonb(r) from public.ap_employer_submission_rules r where id='${ruleId}'),
    'ruleReceipt',(select to_jsonb(r) from public.ap_employer_rule_review_receipts r where request_id='${uuid(saved.requestId)}'))`, true);
  const state = await paidState();
  expect(state.intent).toMatchObject({ state: "COMPLETED", amountCents: 799, lineCount: 1 });
  expect(state.purchase).toMatchObject({ id: intent.purchase_id, customer_id: customerId, payment_attempt_id: intent.payment_attempt_id,
    checkout_intent_id: checkoutIntentId, amount_cents: 799, currency: "USD" });
  expect(state.rule).toEqual(rule); expect(state.ruleReceipt).toEqual(receipt);
  expect(state.lines).toHaveLength(1); expect(state.revisions).toHaveLength(1); expect(state.jobs).toHaveLength(1);
  const line: Row<"ap_material_lines"> = state.lines[0], revision: Row<"ap_material_line_revisions"> = state.revisions[0], job: Row<"ap_material_draft_jobs"> = state.jobs[0];
  expect(line).toMatchObject({ delivered_order_id: orderId, delivered_match_id: matchId, allocated_amount_cents: 799,
    fulfillment: "PAID", active_revision: 1, selected_reference_sheet: false, payment_attempt_id: intent.payment_attempt_id });
  expect(revision).toMatchObject({ line_id: line.id, version: 1, revision_kind: "ORIGINAL", source_snapshot_id: sourceSnapshotId,
    job_snapshot_id: jobSnapshotId, employer_rule_snapshot_id: ruleId, capacity_allocation_id: intent.capacity_allocation_id,
    started_at: line.materials_started_at, due_at: line.materials_due_at });
  expect(job).toMatchObject({ customer_id: customerId, material_line_id: line.id, line_revision_id: revision.id,
    source_snapshot_id: sourceSnapshotId, state: "EVIDENCE_PENDING", active_version_id: null });
  const started = Date.parse(z.string().parse(line.materials_started_at)), due = Date.parse(z.string().parse(line.materials_due_at));
  expect(started).toBe(Math.max(Date.parse(z.string().parse(line.selection_confirmed_at)), Date.parse(z.string().parse(line.materials_payment_verified_at))));
  expect(due - started).toBe(86_400_000);
  expect(state.payment).toMatchObject({ customer_id: customerId, amount_cents: 799, currency: "USD", settlement: "PAID", immediate_charge_verified: true });
  expect(state.allocation).toMatchObject({ units: 1, lifecycle: "CONSUMED", debit_disposition: "SPENT" });
  expect(state.capacityMembers).toHaveLength(1);
  expect(state.capacityMembers[0]).toMatchObject({ material_line_id: line.id, revision_id: revision.id, units: 1, member_lifecycle: "CONSUMED", member_debit_disposition: "SPENT" });
  expect(state.notices).toHaveLength(1); expect(state.deadlines).toHaveLength(1);
  expect(state.notices[0]).toMatchObject({ customer_id: customerId, order_id: orderId,
    message_kind: "MATERIALS_PAYMENT_VERIFIED", recipient_ref: intent.purchase_id });
  expect(state.deadlines[0]).toMatchObject({ job_kind: "MATERIAL_LINE_DEADLINE", reference_id: line.id, run_at: line.materials_due_at });
  await result(await webhook("evt_FictionalPaidPack"), 200);
  await result(await webhook("evt_FictionalPaidPackReordered"), 200);
  for (const work of boundary.after.splice(0)) await work();
  expect(await paidState()).toEqual(state);
  expect(await searchHistory()).toEqual(originalSearch);
  expect(database.failures.slice(failureOffset).filter(value => !value.includes('duplicate key value violates unique constraint "webhook_events_provider_event_id_key"'))).toEqual([]);
  process.stdout.write("PAID_PACK_ROUTE_DELIVERY_OBLIGATION_RECEIPT " + JSON.stringify({ orderId, releaseId, sourceSnapshotId, jobSnapshotId,
    matchId, ruleId, checkoutIntentId, providerSessionId, paymentAttemptId: intent.payment_attempt_id, purchaseId: intent.purchase_id,
    lineId: line.id, revisionId: revision.id, draftJobId: job.id, amountCents: 799, startedAt: line.materials_started_at,
    dueAt: line.materials_due_at, realProviderCalls: 0, modeledStripeRequests: provider.requests.length, hostedProof: false }) + "\n");
  return { graph, confirmed, checkout, providerSessionId, checkoutIntentId, paymentAttemptId: intent.payment_attempt_id,
    purchaseId: intent.purchase_id, line, revision, job, state };
}

export type VerifiedPaidPackSetup = Awaited<ReturnType<typeof setupVerifiedPaidPack>>;
