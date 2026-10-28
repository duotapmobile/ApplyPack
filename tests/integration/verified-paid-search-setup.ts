import { readFile } from "node:fs/promises";
import { expect, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { createResearchLocalDatabase } from "./research-local-database";
import { paidSearchProviderFixture } from "./paid-search-provider-fixture";

type FictionalMailEnvelope = { from: string; to: string; replyTo: string; subject: string; text: string; html?: string };
vi.mock("server-only", () => ({}));
const boundary = vi.hoisted(() => ({ admin: null as unknown, cookie: "", selectedId: "",
  operatorId: "a1140000-0000-4000-8000-000000000004", customerId: "a1140000-0000-4000-8000-000000000090",
  email: "paid-search@example.invalid", verified: true, wrappedKeys: new Map<string, Uint8Array>(),
  mailValidate: null as ((body: unknown, options: unknown) => { body: FictionalMailEnvelope; key: string }) | null,
  mailAttempts: [] as Array<{ key: string; body: FictionalMailEnvelope }>,
  mailRejections: [] as string[], mailInvocations: 0,
  mailAccepted: new Map<string, { body: FictionalMailEnvelope; id: string }>(), mailLostResponses: new Set<string>(),
  stripeFetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(), after: [] as Array<() => unknown> }));
// Register before any application imports. A later continuation changes only
// the finite allowed envelope validator; prior modeled acceptance stays intact.
vi.mock("resend", () => ({ Resend: class {
  constructor(key: string) {
    if (key !== "fictional-no-mail") { boundary.mailRejections.push("KEY_REJECTED"); throw new Error("fictional_mail_key_rejected"); }
  }
  emails = { send: async (value: unknown, options: unknown) => {
    boundary.mailInvocations += 1;
    if (!boundary.mailValidate) { boundary.mailRejections.push("UNCONFIGURED"); throw new Error("fictional_mail_unconfigured"); }
    let validated: { body: FictionalMailEnvelope; key: string };
    try { validated = boundary.mailValidate(value, options); }
    catch (error) { boundary.mailRejections.push("ENVELOPE_REJECTED"); throw error; }
    const { body, key } = validated;
    const prior = boundary.mailAccepted.get(key);
    if (prior && JSON.stringify(prior.body) !== JSON.stringify(body)) {
      boundary.mailRejections.push("IDEMPOTENCY_BODY_CHANGED"); throw new Error("fictional_mail_idempotency_body_changed");
    }
    const receipt = prior ?? { body: structuredClone(body), id: `fictional-mail-${boundary.mailAccepted.size + 1}` };
    boundary.mailAttempts.push({ key, body: structuredClone(body) }); boundary.mailAccepted.set(key, receipt);
    if (boundary.mailLostResponses.delete(key)) throw new Error("fictional_provider_accepted_response_lost");
    return { data: { id: receipt.id }, error: null };
  } };
} }));
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  return { ...actual, default: class FixtureStripe extends actual.default {
    constructor(...args: ConstructorParameters<typeof actual.default>) {
      super(args[0], { ...args[1], maxNetworkRetries: 0, httpClient: actual.default.createFetchHttpClient(boundary.stripeFetch) });
    }
  } };
});
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: (work: () => unknown) => { boundary.after.push(work); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: boundary.cookie }) }),
  headers: async () => new Headers({ "x-applypack-draft-id": boundary.selectedId }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => boundary.admin }));
// Auth is the external session boundary. The application's actual owner RPCs,
// SDK, capability handling and local auth.users records remain authoritative.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: boundary.verified ? { id: boundary.customerId, email: boundary.email,
    email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: false } : null }, error: null }),
} }) }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: async () => ({ ok: true,
  user: { id: boundary.operatorId }, admin: boundary.admin }) }));
// Only credential presence and KMS/worker provider operations are modeled. The
// real encryption health probe round-trips AES-GCM through this key wrapper;
// worker configuration, approval hashes and every readiness aggregator execute.
vi.mock("@/lib/security/aws-workload-credentials", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/security/aws-workload-credentials")>(), awsWorkloadIdentityConfigured: () => true,
}));
vi.mock("@/lib/security/remote-kms", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/security/remote-kms")>(),
  remoteKmsAdapter: () => ({
    wrapDataKey: async (input: { plaintextDataKey: Uint8Array }) => {
      const token = `fictional-key-${boundary.wrappedKeys.size}`; boundary.wrappedKeys.set(token, Uint8Array.from(input.plaintextDataKey)); return Buffer.from(token);
    },
    unwrapDataKey: async (input: { encryptedDataKey: Uint8Array }) => {
      const value = boundary.wrappedKeys.get(Buffer.from(input.encryptedDataKey).toString());
      if (!value) throw new Error("fictional_kms_key_missing"); return Uint8Array.from(value);
    },
  }),
}));
vi.mock("@/lib/files/aws-document-worker", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/files/aws-document-worker")>(), probeDocumentWorker: async () => true,
}));

import { POST as accessAction } from "@/app/api/intake/access/route";
import { GET as readDraft, PUT as saveDraft } from "@/app/api/intake/anonymous-draft/route";
import { POST as reviewDraft } from "@/app/api/intake/anonymous-draft/review/route";
import { POST as finalizeDraft } from "@/app/api/intake/anonymous-draft/finalize/route";
import { POST as collectSources } from "@/app/api/cron/job-sources/route";
import { GET as readPreparation, POST as reviewPreparation } from "@/app/api/admin/research-preparation/route";
import { POST as reviewMatch } from "@/app/api/admin/matching-reviews/route";
import { POST as evaluateMatch } from "@/app/api/admin/matching-evaluations/route";
import { POST as issueInvitation } from "@/app/api/admin/search-checkout-invitations/route";
import { POST as startCheckout } from "@/app/api/checkout/search/route";
import { POST as receiveStripeWebhook } from "@/app/api/stripe/webhook/route";
import { POST as deliverSearch } from "@/app/api/admin/search-orders/[id]/deliver/route";
import { processAutomaticResearchPreparation } from "@/lib/matching/research-preparation-server";
import { processPendingFeasibilityRequests } from "@/lib/matching/supabase-feasibility-store";
import { sourceCollectionScopeSha256 } from "@/lib/jobs/source-collection";
import { getSource } from "@/lib/jobs/source-registry";
import { parseDraftCapability } from "@/lib/security/draft-capability";
import { emptyFourStepDraft, hardEmployerCriteria, normalizedFourStepDraft, type FourStepDraft } from "@/lib/intake/four-step";
import { currentLegalContentBinding } from "@/lib/legal/content-hash";
import { STAGING_CHECKOUT_ORIGIN, STAGING_SUPABASE_ORIGIN } from "@/lib/stripe/mode";
import { hashCapabilitySecret } from "@/lib/commerce/server";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import { evaluateLaunchInfrastructure } from "@/lib/operations/launch-readiness";
import { loadPersistedEvaluationsForOrder, selectPersistedEvaluations } from "@/lib/matching/persisted-runtime";
import Stripe from "stripe";

const id = (n: number) => `a1140000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = STAGING_CHECKOUT_ORIGIN;
function post(path: string, body: unknown) { return new Request(`${origin}${path}`, { method: "POST",
  headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function result(response: Response, expected: number, diagnostics?: unknown) {
  const body = await response.json(); expect(response.status, JSON.stringify({ body, diagnostics })).toBe(expected); return body;
}
export function cleanupVerifiedPaidSearch() {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); boundary.cookie = ""; boundary.selectedId = "";
  for (const key of boundary.wrappedKeys.values()) key.fill(0); boundary.wrappedKeys.clear(); boundary.after.length = 0;
  boundary.mailValidate = null; boundary.mailAttempts.length = 0; boundary.mailAccepted.clear(); boundary.mailLostResponses.clear();
  boundary.mailRejections.length = 0; boundary.mailInvocations = 0;
}

export type PaidSearchSourceFixture = {
  sourceId: string;
  allowedActions: ("ENUMERATE_JOBS" | "READ_APPLICATION_QUESTIONS")[];
  allowedHosts: string[];
  requestBound: number;
  durationMsBound: number;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

// Runs the complete original route/SDK/SQL journey once in a fresh owned database.
// Keep its provider boundaries alive until the caller finishes any pack continuation;
// each test must register cleanupVerifiedPaidSearch with afterEach, including failures.
export async function setupVerifiedPaidSearch(options: { sourceFixture?: PaidSearchSourceFixture } = {}) {
  const sourceFixture = options.sourceFixture;
  const database = await createResearchLocalDatabase(); boundary.admin = database.admin;
  const provider = paidSearchProviderFixture(); boundary.stripeFetch.mockImplementation(provider.fetch);
  expect(boundary.mailAttempts).toEqual([]); expect(boundary.mailAccepted.size).toBe(0);
  expect(boundary.mailRejections).toEqual([]); expect(boundary.mailInvocations).toBe(0);
  boundary.mailValidate = (value, options) => {
    const key = typeof options === "object" && options !== null && "idempotencyKey" in options ? options.idempotencyKey : null;
    expect(typeof key === "string" && /^search_qa_ready\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(key)).toBe(true);
    if (typeof key !== "string") throw new Error("fictional_search_notice_key_rejected");
    expect(options).toEqual({ idempotencyKey: key });
    const body = { from: "orders@applypack.work", to: "approved-owner@example.invalid", replyTo: "help@applypack.work",
      subject: "ApplyPack search candidates need review", text: [
        "Automated discovery collected 10 reviewable candidates.",
        "Review every listing and approve exactly 10 before customer release.", "",
        `Open the operator review queue: ${origin}/admin#order-${key.slice("search_qa_ready/".length)}`,
      ].join("\n") };
    expect(value).toEqual(body); return { body, key };
  };
  // Only independently approved fictional configuration and auth identities are
  // seeded. No snapshot, assessment, listing, review, invitation or order seed.
  await database.script(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    ('${id(4)}','authenticated','authenticated','paid-search-operator@example.invalid',now(),false,'{}','{}',now(),now()),
    ('${id(80)}','authenticated','authenticated','paid-search-admin@example.invalid',now(),false,'{}','{}',now(),now()),
    ('${id(90)}','authenticated','authenticated','${boundary.email}',now(),false,'{}','{}',now(),now());
    update public.profiles set role='operator' where id='${id(4)}'; update public.profiles set role='admin' where id='${id(80)}';`);
  const legal = currentLegalContentBinding();
  await database.script(`update public.ap_commerce_configuration set
    terms_version='${legal.termsVersion}',terms_content_sha256='${legal.termsContentSha256}',privacy_version='${legal.privacyVersion}',privacy_content_sha256='${legal.privacyContentSha256}',
    legal_acceptance_copy_version='${legal.acceptanceCopyVersion}',legal_acceptance_copy_sha256='${legal.acceptanceCopySha256}',
    legal_content_canonicalization_version='${legal.contentCanonicalizationVersion}',legal_receipt_schema_version='${legal.receiptSchemaVersion}' where singleton;`);
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_ORIGIN,
    APP_DEPLOYMENT_ENV: "staging", APP_ANONYMOUS_DRAFT_SESSION_SECONDS: "86400", APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED: "true",
    APP_KMS_KEY_IDENTITY: "arn:aws:kms:us-east-1:838445019912:key/11111111-2222-4333-8444-555555555555", APP_KMS_KEY_VERSION: "1", APP_KMS_ENCRYPTION_CONTEXT_VERSION: "fixture-v1",
    APP_AUTOMATIC_RESEARCH_ENABLED: "true", APP_FEASIBILITY_WORKER_ID: "paid-search114-feasibility" })) vi.stubEnv(key, value);
  const opened = await accessAction(post("/api/intake/access", { action: "START", requestId: id(91), expectedBrowserDraftId: null }));
  const entry = await result(opened, 200, database.failures);
  boundary.cookie = decodeURIComponent(opened.headers.get("set-cookie")!.split(";", 1)[0].split("=").slice(1).join("="));
  boundary.selectedId = parseDraftCapability(boundary.cookie)!.draftId;
  expect(entry.draftId).toBe(boundary.selectedId);
  let draft = (await result(await readDraft(), 200, database.failures)).draft;
  const answers: FourStepDraft = { ...structuredClone(emptyFourStepDraft), entryMode: "GUIDED", fullName: "Fictional Paid Search Customer",
    email: boundary.email, documentContactEmail: "documents-paid-search@example.invalid", backgroundReviewed: true, noPriorEmployment: true,
    desiredActivities: ["SUPPORTING_CUSTOMERS"], workModes: ["REMOTE"], stateOrDc: "VA", employmentTypes: ["FULL_TIME"], termsAccepted: true,
    capabilities: { "customer operations": "CAN_DO_NOW", "coordinate service recovery": "CAN_DO_NOW", Excel: "CAN_DO_NOW" } };
  answers.employerUnknownPolicies = Object.fromEntries(hardEmployerCriteria(answers).map(criterion => [criterion.key, "EXCLUDE_IF_UNKNOWN"]));
  draft = (await result(await saveDraft(post("/api/intake/anonymous-draft", { expectedVersion: draft.version, currentStep: 3, answers })), 200, database.failures)).draft;
  const review = await result(await reviewDraft(post("/api/intake/anonymous-draft/review", { expectedVersion: draft.version })), 200, database.failures);
  expect(review.receipt.answersSha256).toMatch(/^[a-f0-9]{64}$/u);
  const finalized = await result(await finalizeDraft(post("/api/intake/anonymous-draft/finalize", { expectedVersion: draft.version,
    answers: normalizedFourStepDraft(answers), confirmation: review.receipt, factsConfirmed: true })), 201, database.failures);
  const snapshotId = finalized.snapshotId as string, draftId = boundary.selectedId;
  expect(await database.sql(`select jsonb_build_object('schema',schema_version,'draftId',draft_id,'contact',document_contact_email) from public.ap_intake_snapshots where id='${snapshotId}'`, true))
    .toEqual({ schema: "applypack-intake-v4", draftId, contact: answers.documentContactEmail });
  expect(await database.sql(`select count(*)::int from public.ap_research_preparations where snapshot_id='${snapshotId}'`, true)).toBe(1);
  const source = getSource(sourceFixture?.sourceId ?? "vipdesk-connect")!;
  if (sourceFixture) {
    expect(source).toBeDefined();
    expect(source.adapterKind).toBe("greenhouse");
    expect(sourceFixture.allowedActions).toEqual(["ENUMERATE_JOBS", "READ_APPLICATION_QUESTIONS"]);
    expect(sourceFixture.allowedHosts.every(host => /^[a-z0-9.-]+$/u.test(host))).toBe(true);
    expect(sourceFixture.requestBound).toBe(11); expect(sourceFixture.durationMsBound).toBe(60000);
  }
  const allowedActions = sourceFixture?.allowedActions ?? ["ENUMERATE_JOBS"];
  const allowedHosts = sourceFixture?.allowedHosts ?? ["api.lever.co", "jobs.lever.co"];
  const requestBound = sourceFixture?.requestBound ?? 2, durationMsBound = sourceFixture?.durationMsBound ?? 10000;
  const scope = sourceCollectionScopeSha256({ source,
    authorization: { id: id(5), sourceId: source.id, state: "AUTHORIZED_AUTOMATED", accessMethod: "AUTOMATED", authorizationVersion: "paidsearch114-fixture",
      allowedActions, allowedHosts },
    schedule: { id: id(6), source_id: source.id, source_authorization_id: id(5), authorization_head_revision: 1, scope_sha256: "", result_bound: 20,
      page_bound: 2, request_bound: requestBound, response_byte_bound: 100000, duration_ms_bound: durationMsBound, host_concurrency_bound: 1, quota_unit_bound: 0,
      minimum_complete_misses: 2, visibility_window_seconds: 86400, enabled: true, paused_reason: null } });
  const sourceSqlFixture = await readFile("tests/integration/automatic-research-preparation.sql", "utf8");
  const configStart = sourceSqlFixture.indexOf("-- Local fictional permission fixture only."), configEnd = sourceSqlFixture.indexOf("savepoint retention_queue_order;");
  expect(configStart).toBeGreaterThan(0); expect(configEnd).toBeGreaterThan(configStart);
  let sourceConfiguration = sourceSqlFixture.slice(configStart, configEnd).replaceAll("a1000000", "a1140000").replaceAll("research100-fixture", "paidsearch114-fixture")
    .replaceAll("repeat('3',64)", `'${scope}'`).replaceAll('"resultBound":10', '"resultBound":20')
    .replaceAll('14400,10,2,2,', '14400,20,2,2,').replaceAll("interval '1 day',10,", "interval '1 day',20,");
  if (sourceFixture) {
    const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
    expect(sourceConfiguration).toContain("array['api.lever.co','jobs.lever.co'],array['ENUMERATE_JOBS']");
    expect(sourceConfiguration).toContain('"requestBound":2'); expect(sourceConfiguration).toContain('"durationMsBound":10000');
    expect(sourceConfiguration).toContain("14400,20,2,2,100000,10000");
    sourceConfiguration = sourceConfiguration.replaceAll("'vipdesk-connect'", sqlLiteral(source.id))
      .replaceAll("array['api.lever.co','jobs.lever.co'],array['ENUMERATE_JOBS']",
        `array[${allowedHosts.map(sqlLiteral).join(",")}],array[${allowedActions.map(sqlLiteral).join(",")}]`)
      .replaceAll('"requestBound":2', `"requestBound":${requestBound}`).replaceAll('"durationMsBound":10000', `"durationMsBound":${durationMsBound}`)
      .replaceAll("14400,20,2,2,100000,10000", `14400,20,2,${requestBound},100000,${durationMsBound}`);
  }
  await database.script(sourceConfiguration);
  expect(await processAutomaticResearchPreparation()).toEqual({ status: "ADVANCED", processed: 1 });
  const listing = "Remote full-time role in Virginia.\nRequired: proficient with Excel.\nResponsibilities: coordinate service recovery.\nSalary: $60000 per year.";
  if (sourceFixture) vi.stubGlobal("fetch", vi.fn(sourceFixture.fetch));
  else vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://api.lever.co" || url.pathname !== `/v0/postings/${source.adapterKey}`) throw new Error("unexpected_paid_search_external_request");
    return Response.json(Array.from({ length: 10 }, (_, index) => ({ id: `paidsearch114-${index}`, text: `Operations Coordinator ${index + 1}`, descriptionPlain: listing,
      hostedUrl: `https://jobs.lever.co/vipdesk/paidsearch114-${index}`, applyUrl: `https://jobs.lever.co/vipdesk/paidsearch114-${index}/apply`,
      categories: { location: "Remote, Virginia", commitment: "Full-time" } })));
  }));
  vi.stubEnv("CRON_SECRET", "fictional-paid-search-cron"); vi.stubEnv("APP_JOB_SOURCE_SYNC_ENABLED", "true"); vi.stubEnv("APP_JOB_SOURCE_WORKER_ID", "paid-search114-source");
  const collection = await result(await collectSources(new Request(`${origin}/api/cron/job-sources`, { method: "POST",
    headers: { authorization: "Bearer fictional-paid-search-cron" } })), 200, database.failures);
  expect(collection.jobSources.completed).toBe(1);
  expect(await processAutomaticResearchPreparation()).toEqual({ status: "ADVANCED", processed: 1 });
  const prepared = await result(await readPreparation(new Request(`${origin}/api/admin/research-preparation?snapshotId=${snapshotId}`)), 200, database.failures);
  expect(prepared.state).toBe("OWNER_REVIEW"); expect(prepared.listings).toHaveLength(10);
  const evaluationIds: string[] = [];
  for (const captured of prepared.listings) {
    const promoted = await result(await reviewPreparation(post("/api/admin/research-preparation", { action: "VERIFY_SOURCE", preparationId: prepared.preparationId,
      verification: { projectionId: captured.projectionId, snapshotId, checkedAt: new Date().toISOString(), officialListingUrl: captured.listingUrl,
        officialApplicationUrl: captured.applicationUrl, capturedText: captured.capturedText, evidenceNotes: "Fictional owner verified current official listing identity and application path.",
        employerIdentityConfirmed: true, applicationPathConfirmed: true, listingActiveConfirmed: true, legitimacyConfirmed: true } })), 201, database.failures);
    const nodes = await database.sql(`select jsonb_agg(to_jsonb(n)) from public.ap_requirement_nodes n where job_snapshot_id='${promoted.jobSnapshotId}' and node_kind='CRITERION'`, true);
    const facts = await database.sql(`select jsonb_agg(to_jsonb(f)) from public.ap_candidate_facts f where snapshot_id='${snapshotId}'`, true);
    expect(facts.length).toBeGreaterThan(0);
    const factIds = facts.map((fact: { id: string }) => fact.id), evidenceReviewIds: string[] = [];
    const common = { snapshotId, jobSnapshotId: promoted.jobSnapshotId, inventoryMemberId: promoted.inventoryMemberId, candidateFactIds: factIds,
      evidenceChanges: ["Compared confirmed customer capability with exact employer criterion."],
      rationale: "The confirmed Excel capability and service recovery responsibility support this exact fictional opportunity." };
    for (const node of nodes.filter((node: { criterion_type: string }) => ["EXPERIENCE", "TOOL_CAPABILITY", "RESPONSIBILITY"].includes(node.criterion_type))) {
      const reviewed = await result(await reviewMatch(post("/api/admin/matching-reviews", { ...common, reviewKind: "MATCH_EVIDENCE", sourceEvidenceNodeIds: [node.id],
        stableCriterionId: node.stable_criterion_id, candidateFactVersionIds: factIds, evidenceRelation: "DIRECT",
        disposition: node.criterion_type === "EXPERIENCE" ? "REQUIRES_MORE_EVIDENCE" : "RESOLVED_PASS" })), 200, database.failures);
      evidenceReviewIds.push(reviewed.reviewId);
    }
    expect(evidenceReviewIds.length).toBeGreaterThan(0);
    const nodeIds = nodes.map((node: { id: string }) => node.id), explanation = { sourceEvidenceNodeIds: nodeIds, candidateFactIds: factIds };
    const usefulness = await result(await reviewMatch(post("/api/admin/matching-reviews", { ...common, reviewKind: "CATEGORICAL_USEFULNESS", disposition: "RESOLVED_PASS",
      sourceEvidenceNodeIds: nodeIds, explanationEvidence: Object.fromEntries(["whatJobInvolves", "whyMadeList", "howExperienceConnects", "whatMayBeNew", "whatToKnow"].map(key => [key, explanation])),
      applicationReadiness: "READY", presentationRisk: "LOW", presentationRiskReasons: [],
      reviewerWorthwhileReason: "Confirmed capabilities support this distinct current opportunity; it is not quota filler.", certifiedNotQuotaFiller: true })), 200, database.failures);
    const evaluated = await result(await evaluateMatch(post("/api/admin/matching-evaluations", { snapshotId, inventoryMemberId: promoted.inventoryMemberId,
      jobSnapshotId: promoted.jobSnapshotId, evidenceReviewIds, usefulnessReviewId: usefulness.reviewId })), 201, database.failures);
    expect(evaluated.evaluation.eligibility).toBe("ELIGIBLE"); evaluationIds.push(evaluated.evaluation.id);
  }
  await result(await reviewPreparation(post("/api/admin/research-preparation", { action: "COMPLETE_COVERAGE", preparationId: prepared.preparationId, snapshotId,
    reviewed: true, notes: "Reviewed complete fictional source coverage and all ten distinct evaluated listings." })), 200, database.failures);
  expect((await processPendingFeasibilityRequests(database.admin)).results[0]).toMatchObject({ status: "complete" });
  const assessment = await database.sql(`select to_jsonb(a) from public.ap_feasibility_assessments a where snapshot_id='${snapshotId}' and state='COMPLETE'`, true);
  expect(assessment).toMatchObject({ outcome: "LIKELY", preliminarily_deliverable_count: 10, reviewable_count: 0, excluded_count: 0 });
  expect(await database.sql(`select to_jsonb(public.ap_set_manual_launch_capacity_state('SEARCH',true,'${id(80)}','Fictional isolated paid-search staffing approval.'))`)).toBe(true);
  expect(await database.sql(`select to_jsonb(public.ap_set_manual_launch_capacity_state('MATERIALS',true,'${id(80)}','Fictional approved two-pack daily staffing readiness.'))`)).toBe(true);
  // Exercise the real invitation gate without exhausting the browser's five
  // attempts/hour. Invalid paths must fail before the downstream quote IDs are
  // used. The brief invitation expires by real elapsed time, not a clock edit.
  const invitationGate = (invitationId: string, secretHash: string) => `select to_jsonb(v) from public.ap_begin_invited_search_checkout(
    '${invitationId}','${secretHash}','${draftId}','${hashCapabilitySecret(parseDraftCapability(boundary.cookie)!.secret)}',
    '${snapshotId}','${assessment.id}','fictional-negative-invitation',null,null,null,null,null,null,null,null,null) v`;
  await database.sql(`select to_jsonb(public.ap_issue_search_checkout_invitation('${id(92)}','${draftId}','${snapshotId}','${assessment.id}',
    repeat('f2',32),clock_timestamp()+interval '1 second','${id(4)}','Fictional expiring invitation guard verification.'))`, true);
  await new Promise(resolve => setTimeout(resolve, 1100));
  await expect(database.sql(invitationGate(id(92), "f2".repeat(32)), true)).rejects.toThrow("checkout_invitation_invalid");
  const invitation = await result(await issueInvitation(post("/api/admin/search-checkout-invitations", { draftId, snapshotId, assessmentId: assessment.id,
    rationale: "Reviewed all ten distinct fictional opportunities and confirmed evidence before inviting this customer." })), 201, database.failures);
  expect(invitation.recipientEmail).toBe(boundary.email);
  const invitationSecret = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get("invitationSecret")!;
  const heldBefore = await database.sql(`select to_jsonb(a) from public.ap_capacity_allocations a join public.ap_search_checkout_invitations i
    on i.capacity_allocation_id=a.id where i.id='${invitation.invitationId}'`, true);
  // The real release function changes an unpaid reservation inside this test
  // transaction. Its expected failure rolls back the release and its audit;
  // the original paid-history-free reservation must remain byte-identical.
  await expect(database.sql(`select public.ap_release_unconsumed_capacity('${heldBefore.id}','FICTIONAL_GUARD_PROBE');
    ${invitationGate(invitation.invitationId, hashCapabilitySecret(invitationSecret))}`, true)).rejects.toThrow("checkout_invitation_capacity_invalid");
  expect(await database.sql(`select to_jsonb(a) from public.ap_capacity_allocations a where id='${heldBefore.id}'`, true)).toEqual(heldBefore);
  expect(await database.sql(`select jsonb_build_object('expired',expires_at<=clock_timestamp(),'revoked',revoked_at is not null)
    from public.ap_search_checkout_invitations where id='${id(92)}'`, true)).toEqual({ expired: true, revoked: true });
  for (const [key, value] of Object.entries({ APP_PAYMENT_MODE: "test", STRIPE_SECRET_KEY: "sk_test_fictional_paid_search",
    STRIPE_EXPECTED_ACCOUNT_ID: "acct_FictionalPaidSearch", STRIPE_WEBHOOK_SECRET: "whsec_fictional_paid_search", STRIPE_JOB_SEARCH_PRICE_ID: "price_fictional_search",
    STRIPE_APPLY_PACK_PRICE_ID: "price_fictional_pack", APP_RELEASE_SHA: "a".repeat(40), APP_EXPECTED_RELEASE_SHA: "a".repeat(40),
    APP_CHECKOUT_ENABLED: "false", APP_REHEARSAL_CHECKOUT_ENABLED: "true", APP_CANARY_CHECKOUT_ENABLED: "false", APP_LIVE_PAYMENTS_ENABLED: "false",
    APP_JOB_BOARD_CHECKOUT_ENABLED: "false", APP_JOB_SOURCE_SYNC_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fictional-local-public", SUPABASE_SECRET_KEY: "fictional-local-secret", APP_KMS_PROVIDER: "aws",
    AWS_REGION: "us-east-1", APP_AWS_ACCOUNT_ID: "838445019912", APP_SERVICE_RETENTION_ENABLED: "true",
    RESEND_API_KEY: "fictional-no-mail", EMAIL_FROM_ADDRESS: "orders@applypack.work", EMAIL_REPLY_TO: "help@applypack.work",
    APP_ADMIN_ALERT_EMAIL: "approved-owner@example.invalid", APP_SAFE_TEST_EMAILS: `approved-owner@example.invalid,${boundary.email}`,
    APP_EMAIL_DELIVERY_VERIFIED_AT: new Date().toISOString(),
    APP_FILE_SCAN_MODE: "document_validation", APP_FILE_PROCESSING_ENABLED: "true", APP_MALWARE_SCANNER_IDENTITY: "fixture-structural-only",
    APP_PERMITTED_MODEL_POLICY: "fixture-local-only", APP_SANDBOXED_PARSER_IDENTITY: "fictional-worker", APP_PARSER_MAX_EXPANDED_BYTES: "10000000",
    APP_PARSER_MAX_PAGES: "20", APP_PARSER_MAX_MILLISECONDS: "10000", APP_PARSER_MAX_MEMORY_BYTES: "134217728",
    APP_DOCUMENT_WORKER_DEPLOYMENT_ENV: "staging", APP_DOCUMENT_WORKER_FUNCTION_ARN: "arn:aws:lambda:us-east-1:838445019912:function:applypack-staging-document-worker:1",
    APP_DOCUMENT_WORKER_BUCKET: "applypack-838445019912-staging-document-worker-temp", APP_DOCUMENT_WORKER_TEMPORARY_PREFIX: "ephemeral/",
    APP_DOCUMENT_WORKER_IDENTITY: "applypack-document-worker-v2-liberation-sans-2.1.5", APP_DOCUMENT_WORKER_FONT_SHA256: DOCUMENT_FONT_CONTRACT.styles.regular,
    APP_DOCUMENT_WORKER_FONT_MANIFEST_SHA256: DOCUMENT_FONT_CONTRACT.manifestSha256, APP_DOCUMENT_WORKER_IMAGE_DIGEST: "c".repeat(64),
    APP_DOCUMENT_WORKER_PREFLIGHT_RECEIPT_SHA256: "d".repeat(64), APP_DOCUMENT_WORKER_PROBE_RECEIPT_SHA256: "e".repeat(64),
    APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256: "b".repeat(64), APP_RELEASE_VERIFICATION_TTL_SECONDS: "3600" })) vi.stubEnv(key, value);
  await database.script(`update public.ap_commerce_configuration set canonical_site_url='${origin}',access_callback_url='${origin}/auth/callback',
    tax_inclusive=true,tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT',tax_version='tax-inclusive-v1',payment_provider='stripe',payment_api_version='2026-08-27.basil',
    immediate_payment_methods=array['card'],release_verification_ttl_seconds=3600,provider_idempotent_email_approved=true,
    provider_email_approval_reference='fictional paid-search local transport',document_worker_network_attestation_sha256=repeat('b',64),
    materials_generation_approved=true,materials_generation_approval_reference='fictional isolated provider approval only',material_output_formats=array['DOCX','PDF'],
    document_renderer_identity='applypack-document-worker-v2-liberation-sans-2.1.5',document_font_family='Liberation Sans',
    document_font_sha256='${DOCUMENT_FONT_CONTRACT.styles.regular}',document_font_manifest_sha256='${DOCUMENT_FONT_CONTRACT.manifestSha256}',
    document_safety_policy='generated-structural-v1' where singleton;
    insert into public.operational_heartbeats(task_name,last_succeeded_at,summary) values('maintenance',clock_timestamp(),'{"fictionalLocalReadiness":true}');
    select public.ap_set_checkout_mode('REHEARSAL',repeat('a',40),'${id(80)}','Fictional local paid-search rehearsal authorization');
    select public.ap_authorize_staging_rehearsal_checkout(repeat('a',40),'SEARCH','${id(90)}','${draftId}',null,'${id(80)}',
      'Fictional local paid-search approved customer and release',clock_timestamp()+interval '20 minutes');`);
  const capability = parseDraftCapability(boundary.cookie)!;
  const view = await database.admin.rpc("ap_read_current_feasibility", { p_draft_id: draftId, p_secret_hash: hashCapabilitySecret(capability.secret) });
  expect(view.error).toBeNull();
  expect(view.data).toMatchObject({ snapshotId, assessmentId: assessment.id, state: "COMPLETE", outcome: "LIKELY", checkoutEligible: false });
  expect(await database.sql(`select jsonb_build_object('mode',m.mode,'publicCheckout',c.checkout_enabled,'activation',c.sales_activation_approved,
    'heldInvitation',exists(select 1 from public.ap_search_checkout_invitations i join public.ap_capacity_allocations a on a.id=i.capacity_allocation_id
      where i.id='${invitation.invitationId}' and i.draft_id='${draftId}' and i.snapshot_id='${snapshotId}' and i.assessment_id='${assessment.id}'
        and a.lifecycle='RESERVED' and a.debit_disposition='HELD' and a.units=1 and i.expires_at>clock_timestamp()),
    'authorized',exists(select 1 from public.ap_staging_rehearsal_authorizations where resource_id='${draftId}' and customer_id='${id(90)}'
      and release_sha=repeat('a',40) and revoked_at is null and expires_at>clock_timestamp()))
    from public.ap_checkout_mode_configuration m cross join public.ap_commerce_configuration c where m.singleton and c.singleton`, true))
    .toEqual({ mode: "REHEARSAL", publicCheckout: false, activation: false, heldInvitation: true, authorized: true });
  console.log("PAID_SEARCH_PRE_CHECKOUT_EVIDENCE", JSON.stringify({ draftId, snapshotId, assessmentId: assessment.id, invitationId: invitation.invitationId,
    evaluationIds, view: view.data, failures: database.failures }));
  const readiness = await evaluateLaunchInfrastructure(database.admin);
  expect(readiness, JSON.stringify({ readiness, failures: database.failures,
    capacity: (await database.admin.rpc("ap_manual_launch_capacity_readiness")).data,
    schema: (await database.admin.rpc("ap_manual_launch_schema_readiness")).data })).toMatchObject({ ready: true,
    checks: { permittedInventoryReady: true }, environmentAcceptingOrders: false });
  const checkoutBody = { snapshotId, assessmentId: assessment.id, invitationId: invitation.invitationId, invitationSecret };
  // Changing the public/rehearsal switch must never turn this held invitation
  // into purchasing permission. None of the rejected attempts calls Stripe.
  vi.stubEnv("APP_REHEARSAL_CHECKOUT_ENABLED", "false");
  await result(await startCheckout(post("/api/checkout/search", checkoutBody)), 503, database.failures);
  expect(provider.commands.size).toBe(0); vi.stubEnv("APP_REHEARSAL_CHECKOUT_ENABLED", "true");
  await result(await startCheckout(post("/api/checkout/search", { ...checkoutBody, invitationSecret: "z".repeat(43) })), 409, database.failures);
  expect(provider.commands.size).toBe(0);
  const checkout = await result(await startCheckout(post("/api/checkout/search", checkoutBody)), 200, database.failures);
  expect(checkout).toMatchObject({ amountCents: 1899, currency: "USD", taxInclusive: true });
  expect(provider.commands.size).toBe(1); expect(provider.sessions.size).toBe(1);
  const retried = await result(await startCheckout(post("/api/checkout/search", checkoutBody)), 200, database.failures);
  expect(retried).toEqual(checkout); expect(provider.commands.size).toBe(1);
  await expect(database.sql(invitationGate(invitation.invitationId, hashCapabilitySecret(invitationSecret)), true))
    .rejects.toThrow("checkout_invitation_consumed"); // A new operation cannot reuse the consumed invite; the exact HTTP retry above can.
  const [sessionId] = provider.sessions.keys(); const paid = provider.complete(sessionId);
  const webhook = async (eventId: string, signatureValid = true) => {
    const payload = JSON.stringify({ id: eventId, object: "event", type: "checkout.session.completed", livemode: false,
      created: Math.floor(Date.now() / 1000), data: { object: paid } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: signatureValid ? "whsec_fictional_paid_search" : "whsec_wrong" });
    return receiveStripeWebhook(new Request(`${origin}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": header }, body: payload }));
  };
  await result(await webhook("evt_FictionalInvalid", false), 400, database.failures);
  expect(await database.sql(`select count(*)::int from public.orders where customer_id='${id(90)}'`, true)).toBe(0);
  await result(await webhook("evt_FictionalPaidSearch"), 200, database.failures);
  for (const work of boundary.after.splice(0)) await work();
  const service = await database.sql(`select to_jsonb(s) from public.ap_search_services s where customer_id='${id(90)}'`, true);
  expect(service.original_snapshot_id).toBe(snapshotId);
  expect(Date.parse(service.delivery_due_at) - Date.parse(service.service_started_at)).toBe(24 * 60 * 60 * 1000);
  const searchAdminEvents = () => database.sql(`select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb)
    from public.email_events e join public.orders o on o.id=e.order_id where o.customer_id='${id(90)}'`, true);
  const firstAdminEvents: Database["public"]["Tables"]["email_events"]["Row"][] = await searchAdminEvents();
  expect(firstAdminEvents).toHaveLength(1);
  expect(firstAdminEvents[0]).toMatchObject({ order_id: service.legacy_order_id, recipient: "approved-owner@example.invalid",
    template: "search_qa_ready", status: "sent", idempotency_key: `search_qa_ready/${service.legacy_order_id}`,
    provider_message_id: "fictional-mail-1", attempt_count: 1 });
  expect(boundary.mailAttempts).toHaveLength(1); expect(boundary.mailAccepted.size).toBe(1);
  expect(boundary.mailRejections).toEqual([]); expect(boundary.mailInvocations).toBe(boundary.mailAttempts.length);
  expect(boundary.mailAttempts[0].key).toBe(firstAdminEvents[0].idempotency_key);
  await result(await webhook("evt_FictionalPaidSearch"), 200, database.failures);
  await result(await webhook("evt_FictionalPaidSearchReordered"), 200, database.failures);
  for (const work of boundary.after.splice(0)) await work();
  expect(await searchAdminEvents()).toEqual(firstAdminEvents);
  expect(boundary.mailAttempts).toHaveLength(1); expect(boundary.mailAccepted.size).toBe(1);
  expect(boundary.mailRejections).toEqual([]); expect(boundary.mailInvocations).toBe(boundary.mailAttempts.length);
  expect(await database.sql(`select count(*)::int from public.ap_search_services where customer_id='${id(90)}'`, true)).toBe(1);
  const orderId = service.legacy_order_id as string;
  expect(await database.sql(`select jsonb_build_object('state',status,'count',(summary->>'candidates')::int,'error',last_error_code)
    from public.workflow_tasks where order_id='${orderId}' and task_kind='search_discovery'`, true))
    .toEqual({ state: "awaiting_review", count: 10, error: null });
  // This is the actual admin page's preview path and ordering. Collection order
  // is not the persisted selector rank approved by the owner or release RPC.
  const preview = selectPersistedEvaluations(await loadPersistedEvaluationsForOrder(database.admin, orderId), 10);
  const releaseEvaluationIds = preview.selected.map(evaluation => evaluation.id);
  expect(new Set(releaseEvaluationIds)).toEqual(new Set(evaluationIds));
  const checklist = { criteriaCompared: true, allListingsRechecked: true, exactlyTenApplicationWorthy: true, noPadding: true, humanReleaseApproved: true,
    reviewerNote: "Reviewed all ten distinct current fictional listings against the exact confirmed intake and evidence before release." };
  await result(await deliverSearch(post(`/api/admin/search-orders/${orderId}/deliver`, { evaluationIds: evaluationIds.slice(0, 9), reviewChecklist: checklist }),
    { params: Promise.resolve({ id: orderId }) }), 400, database.failures);
  // A valid permutation approves the same set; the server keeps its canonical
  // persisted positions instead of trusting caller-provided ordering.
  const delivered = await result(await deliverSearch(post(`/api/admin/search-orders/${orderId}/deliver`, { evaluationIds: [...releaseEvaluationIds].reverse(), reviewChecklist: checklist }),
    { params: Promise.resolve({ id: orderId }) }), 200, database.failures);
  expect(delivered.ok).toBe(true);
  const persistedDelivery = () => database.sql(`select jsonb_build_object('serviceId',s.id,'orderId',s.legacy_order_id,
    'originalSnapshotId',s.original_snapshot_id,'activeSnapshotId',s.active_snapshot_id,'dueAt',s.delivery_due_at,'startedAt',s.service_started_at,
    'fulfillment',s.fulfillment,'orderState',o.status,'releaseId',r.id,'releaseSnapshotId',r.version_bundle->>'activeSnapshotId',
    'releaseDueAt',r.active_due_at,'releaseCount',(select count(*) from public.ap_releases where order_id=o.id),
    'memberCount',(select count(*) from public.ap_release_members where release_id=r.id),
    'distinctJobs',(select count(distinct job_id) from public.job_matches where search_order_id=o.id),
    'evaluationIds',(select jsonb_agg(release_evaluation_id order by position) from public.job_matches where search_order_id=o.id),
    'paymentCount',(select count(*) from public.ap_payment_attempts where customer_id=s.customer_id and draft_id='${draftId}'),
    'winningPaymentVerified',exists(select 1 from public.ap_payment_attempts where id=s.winning_payment_attempt_id
      and customer_id=s.customer_id and amount_cents=1899 and currency='USD' and immediate_charge_verified and payment_verified_at is not null),
    'capacityState',a.lifecycle,'capacityDebit',a.debit_disposition,'capacityUnits',a.units,
    'spentAllocations',(select count(*) from public.ap_capacity_allocations where customer_id=s.customer_id and debit_disposition='SPENT'),
    'notices',(select jsonb_object_agg(message_kind,n) from (select message_kind,count(*) n from public.ap_outbox_messages where order_id=o.id group by message_kind) counts))
    from public.ap_search_services s join public.orders o on o.id=s.legacy_order_id join public.ap_releases r on r.order_id=o.id
    join public.ap_capacity_allocations a on a.id=s.capacity_allocation_id where s.id='${service.id}'`, true);
  const deliveryState = await persistedDelivery();
  expect(deliveryState).toMatchObject({ serviceId: service.id, orderId, originalSnapshotId: snapshotId, activeSnapshotId: snapshotId,
    dueAt: service.delivery_due_at, startedAt: service.service_started_at, fulfillment: "DELIVERED", orderState: "delivered",
    releaseId: delivered.releaseId, releaseSnapshotId: snapshotId, releaseDueAt: service.delivery_due_at, releaseCount: 1,
    memberCount: 10, distinctJobs: 10, evaluationIds: releaseEvaluationIds, paymentCount: 1, winningPaymentVerified: true,
    capacityState: "COMPLETED", capacityDebit: "SPENT", capacityUnits: 1, spentAllocations: 1,
    notices: { PAYMENT_VERIFIED_SEARCH_STARTED: 1, SEARCH_EXACT_TEN_DELIVERED: 1 } });
  expect(Object.keys(deliveryState.notices).sort()).toEqual(["PAYMENT_VERIFIED_SEARCH_STARTED", "SEARCH_EXACT_TEN_DELIVERED"]);
  // HTTP replay rejects an already-delivered order; the committed deliverable,
  // paid obligation, deadline and both customer notices remain byte-identical.
  await result(await deliverSearch(post(`/api/admin/search-orders/${orderId}/deliver`, { evaluationIds: releaseEvaluationIds, reviewChecklist: checklist }),
    { params: Promise.resolve({ id: orderId }) }), 409, database.failures);
  expect(await persistedDelivery()).toEqual(deliveryState);
  expect(await searchAdminEvents()).toEqual(firstAdminEvents);
  expect(boundary.mailAttempts).toHaveLength(1); expect(boundary.mailAccepted.size).toBe(1);
  expect(boundary.mailRejections).toEqual([]); expect(boundary.mailInvocations).toBe(boundary.mailAttempts.length);
  expect(database.failures.filter(failure => !failure.includes("checkout_invitation_invalid")
    && !failure.includes('duplicate key value violates unique constraint "webhook_events_provider_event_id_key"'))).toEqual([]);
  const releaseMembers: Database["public"]["Tables"]["ap_release_members"]["Row"][] = await database.sql(`select jsonb_agg(to_jsonb(m) order by position)
    from public.ap_release_members m where release_id='${delivered.releaseId}'`, true);
  expect(releaseMembers).toHaveLength(10);
  expect(releaseMembers.every(member => member.release_id === delivered.releaseId && member.member_type === "JOB_MATCH")).toBe(true);
  console.log("PAID_SEARCH_ROUTE_DELIVERY_RECEIPT", JSON.stringify({ draftId, snapshotId, assessmentId: assessment.id, invitationId: invitation.invitationId,
    orderId, searchServiceId: service.id, releaseId: delivered.releaseId, evaluationIds: releaseEvaluationIds, providerSessionId: sessionId, deliveryState,
    legalTerms: legal.termsVersion, intakeSchema: "applypack-intake-v4", realProviderCalls: 0, modeledStripeRequests: provider.requests.length,
    modeledAdminMailAcceptances: boundary.mailAccepted.size, inboxDeliveryProven: false,
    modeledBoundary: "Auth, AWS credential/KMS/probe, permitted job-source, Stripe and finite mail transport" }));
  return {
    database, provider, boundary, origin,
    intake: { draftId, snapshotId, answers },
    assessmentId: assessment.id as string, invitationId: invitation.invitationId as string,
    orderId, searchServiceId: service.id as string, releaseId: delivered.releaseId as string,
    providerSessionId: sessionId, checkout, service, deliveryState, legal,
    releaseEvaluations: preview.selected, releaseMembers,
  };
}

export type VerifiedPaidSearchSetup = Awaited<ReturnType<typeof setupVerifiedPaidSearch>>;
