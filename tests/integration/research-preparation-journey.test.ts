import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createResearchLocalDatabase } from "./research-local-database";
vi.mock("server-only", () => ({}));
const boundaries = vi.hoisted(() => ({ admin: null as unknown, operatorId: "a1000000-0000-4000-8000-000000000004" }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: async () => ({ ok: true, user: { id: boundaries.operatorId }, admin: boundaries.admin }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => boundaries.admin }));
import { processAutomaticResearchPreparation } from "@/lib/matching/research-preparation-server";
import { processPendingFeasibilityRequests } from "@/lib/matching/supabase-feasibility-store";
import { sourceCollectionScopeSha256 } from "@/lib/jobs/source-collection";
import { getSource } from "@/lib/jobs/source-registry";
import { POST as collectSources } from "@/app/api/cron/job-sources/route";
import { GET as readPreparation, POST as reviewPreparation } from "@/app/api/admin/research-preparation/route";
import { POST as reviewMatch } from "@/app/api/admin/matching-reviews/route";
import { POST as evaluateMatch } from "@/app/api/admin/matching-evaluations/route";
import { POST as issueInvitation } from "@/app/api/admin/search-checkout-invitations/route";

const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://applypack.work";
function post(path: string, body: unknown) { return new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function response(response: Response, status: number) { const body = await response.json(); expect(body, JSON.stringify(body)).toBeDefined(); expect(response.status, JSON.stringify(body)).toBe(status); return body; }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("produces automatic research through actual collection, owner-review, evaluation and feasibility routes without a manual plan", async () => {
  const qualified = process.env.AP_RESEARCH_TEST_CASE === "QUALIFIED", count = qualified ? 10 : 1, bound = qualified ? 20 : 10;
  const database = await createResearchLocalDatabase(); boundaries.admin = database.admin;
  const scope = sourceCollectionScopeSha256({ source: getSource("vipdesk-connect")!,
    authorization: { id: id(5), sourceId: "vipdesk-connect", state: "AUTHORIZED_AUTOMATED", accessMethod: "AUTOMATED", authorizationVersion: "research100-fixture", allowedActions: ["ENUMERATE_JOBS"], allowedHosts: ["api.lever.co", "jobs.lever.co"] },
    schedule: { id: id(6), source_id: "vipdesk-connect", source_authorization_id: id(5), authorization_head_revision: 1, scope_sha256: "", result_bound: bound,
      page_bound: 2, request_bound: 2, response_byte_bound: 100000, duration_ms_bound: 10000, host_concurrency_bound: 1, quota_unit_bound: 0,
      minimum_complete_misses: 2, visibility_window_seconds: 86400, enabled: true, paused_reason: null } });
  // Reuse the real create/save/confirm/finalize functions and separately approved
  // fictional source configuration. No plan, member, review or evaluation seed.
  const fixture = await readFile("tests/integration/automatic-research-preparation.sql", "utf8");
  let initial = fixture.slice(0, fixture.indexOf("create temp table claim"))
    .replaceAll("repeat('3',64)", `'${scope}'`).replaceAll('"capabilities":{}', '"capabilities":{"customer operations":"CAN_DO_NOW","coordinate service recovery":"CAN_DO_NOW","Excel":"CAN_DO_NOW"}');
  if (qualified) initial = initial.replaceAll('"resultBound":10', '"resultBound":20').replaceAll('14400,10,2,2,', '14400,20,2,2,').replaceAll("interval '1 day',10,", "interval '1 day',20,");
  await database.script(`${initial}\ncommit;`);
  expect(await database.sql("select count(*)::int from public.ap_research_rounds", true)).toBe(0);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("APP_AUTOMATIC_RESEARCH_ENABLED", "false");
  expect((await processAutomaticResearchPreparation()).status).toBe("DISABLED");
  vi.stubEnv("APP_AUTOMATIC_RESEARCH_ENABLED", "true");
  expect(await processAutomaticResearchPreparation()).toEqual({ status: "ADVANCED", processed: 1 });
  expect(await database.sql("select count(*)::int from public.ap_research_rounds", true)).toBe(1);
  expect(await database.sql("select count(*)::int from public.ap_research_cell_reviews", true)).toBe(0);
  vi.stubEnv("APP_FEASIBILITY_WORKER_ID", "research100-feasibility");
  expect((await processPendingFeasibilityRequests(database.admin)).results[0].status).toBe("deferred");
  const listing = qualified ? "Remote full-time role in Virginia.\nRequired: proficient with Excel.\nResponsibilities: coordinate service recovery.\nSalary: $60000 per year."
    : "Remote full-time role in Virginia.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinate service recovery.";
  const fetched: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://api.lever.co" || url.pathname !== `/v0/postings/${getSource("vipdesk-connect")!.adapterKey}`) throw new Error("unapproved fictional transport");
    fetched.push(url.href);
    return Response.json(Array.from({ length: count }, (_, i) => ({ id: `research100-fictional-${i}`, text: `Operations Coordinator ${i + 1}`, descriptionPlain: listing,
      hostedUrl: `https://jobs.lever.co/vipdesk/research100-fictional-${i}`, applyUrl: `https://jobs.lever.co/vipdesk/research100-fictional-${i}/apply`,
      categories: { location: "Remote, Virginia", commitment: "Full-time" } })));
  }));
  vi.stubEnv("CRON_SECRET", "fictional-research-cron"); vi.stubEnv("APP_JOB_SOURCE_SYNC_ENABLED", "true"); vi.stubEnv("APP_JOB_SOURCE_WORKER_ID", "research100-source");
  const collection = await response(await collectSources(new Request(`${origin}/api/cron/job-sources`, { method: "POST", headers: { authorization: "Bearer fictional-research-cron" } })), 200);
  expect(collection.jobSources.completed, JSON.stringify({ failures: database.failures, fetched,
    runs: await database.sql("select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.job_source_runs r", true),
    jobs: await database.sql("select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.ap_scheduled_jobs r", true) })).toBe(1);
  expect(fetched).toHaveLength(1);
  expect(await processAutomaticResearchPreparation()).toEqual({ status: "ADVANCED", processed: 1 });
  let prepared = await response(await readPreparation(new Request(`${origin}/api/admin/research-preparation?snapshotId=${id(2)}`)), 200);
  expect(prepared.state).toBe("OWNER_REVIEW"); expect(prepared.listings).toHaveLength(count); expect(prepared.listings[0].admitted).toBe(false);
  expect(prepared.listings[0].capturedText).toBe(listing);
  const coverageBody = { action: "COMPLETE_COVERAGE", preparationId: prepared.preparationId, snapshotId: id(2), reviewed: true, notes: "Reviewed the whole fictional source scope and every evaluated listing." };
  await response(await reviewPreparation(post("/api/admin/research-preparation", coverageBody)), 409);
  for (const captured of prepared.listings) {
  const promoted = await response(await reviewPreparation(post("/api/admin/research-preparation", { action: "VERIFY_SOURCE", preparationId: prepared.preparationId,
    verification: { projectionId: captured.projectionId, snapshotId: id(2), checkedAt: new Date().toISOString(), officialListingUrl: captured.listingUrl,
      officialApplicationUrl: captured.applicationUrl, capturedText: captured.capturedText,
      evidenceNotes: "Fictional operator checked current official identity, active listing and exact application path.",
      employerIdentityConfirmed: true, applicationPathConfirmed: true, listingActiveConfirmed: true, legitimacyConfirmed: true } })), 201);
  const nodes = await database.sql(`select jsonb_agg(to_jsonb(n)) from public.ap_requirement_nodes n where job_snapshot_id='${promoted.jobSnapshotId}' and node_kind='CRITERION'`, true);
  const facts = await database.sql(`select jsonb_agg(to_jsonb(f)) from public.ap_candidate_facts f where snapshot_id='${id(2)}'`, true);
  expect(facts.length).toBeGreaterThan(0);
  const factIds = facts.map((fact: { id: string }) => fact.id), evidenceReviewIds: string[] = [];
  const common = { snapshotId: id(2), jobSnapshotId: promoted.jobSnapshotId, inventoryMemberId: promoted.inventoryMemberId,
    candidateFactIds: factIds, evidenceChanges: ["Compared actual confirmed fictional capability with the exact employer criterion."], rationale: qualified
      ? "The confirmed Excel capability and service recovery responsibility directly support the exact fictional employer criteria."
      : "The confirmed capability has no supported duration; the required three years remain unknown." };
  for (const node of nodes.filter((node: { criterion_type: string }) => ["EXPERIENCE", "TOOL_CAPABILITY", "RESPONSIBILITY"].includes(node.criterion_type))) {
    const review = await response(await reviewMatch(post("/api/admin/matching-reviews", { ...common, reviewKind: "MATCH_EVIDENCE", sourceEvidenceNodeIds: [node.id],
      stableCriterionId: node.stable_criterion_id, candidateFactVersionIds: factIds, evidenceRelation: "DIRECT",
      disposition: node.criterion_type === "EXPERIENCE" ? "REQUIRES_MORE_EVIDENCE" : "RESOLVED_PASS" })), 200);
    evidenceReviewIds.push(review.reviewId);
  }
  expect(evidenceReviewIds.length).toBeGreaterThan(0);
  const nodeIds = nodes.map((node: { id: string }) => node.id), explanation = { sourceEvidenceNodeIds: nodeIds, candidateFactIds: factIds };
  const useful = await response(await reviewMatch(post("/api/admin/matching-reviews", { ...common, reviewKind: "CATEGORICAL_USEFULNESS", disposition: qualified ? "RESOLVED_PASS" : "RESOLVED_FAIL", sourceEvidenceNodeIds: nodeIds,
    explanationEvidence: Object.fromEntries(["whatJobInvolves", "whyMadeList", "howExperienceConnects", "whatMayBeNew", "whatToKnow"].map(key => [key, explanation])),
    applicationReadiness: qualified ? "READY" : "BLOCKED", presentationRisk: "LOW", presentationRiskReasons: [], reviewerWorthwhileReason: qualified ? "The exact confirmed Excel capability and service recovery responsibility support this distinct fictional current opportunity." : "Do not recommend this result while the required experience duration remains unknown; retain the evidence gap for review.", certifiedNotQuotaFiller: true })), 200);
  const evaluation = await response(await evaluateMatch(post("/api/admin/matching-evaluations", { snapshotId: id(2), inventoryMemberId: promoted.inventoryMemberId,
    jobSnapshotId: promoted.jobSnapshotId, evidenceReviewIds, usefulnessReviewId: useful.reviewId })), 201);
  expect(evaluation.evaluation.eligibility).toBe(qualified ? "ELIGIBLE" : "NEEDS_HUMAN_REVIEW");
  }
  expect(await database.sql("select count(*)::int from public.ap_source_verifications", true)).toBe(count);
  await response(await reviewPreparation(post("/api/admin/research-preparation", coverageBody)), 200);
  const feasibility = await processPendingFeasibilityRequests(database.admin);
  expect(feasibility.results[0], JSON.stringify(await database.sql("select jsonb_agg(to_jsonb(r)) from public.ap_feasibility_requests r", true))).toMatchObject({ status: "complete" });
  expect(await database.sql("select count(*)::int from public.ap_search_checkout_invitations", true)).toBe(0);
  if (qualified) {
    const assessment = await database.sql("select to_jsonb(a) from public.ap_feasibility_assessments a where state='COMPLETE'", true);
    expect(assessment).toMatchObject({ outcome: "LIKELY", preliminarily_deliverable_count: 10, reviewable_count: 0, excluded_count: 0 });
    await response(await issueInvitation(post("/api/admin/search-checkout-invitations", { draftId: id(1), snapshotId: id(2), assessmentId: assessment.id,
      rationale: "Reviewed all ten distinct fictional opportunities and their exact confirmed evidence before inviting payment." })), 201);
    expect(await database.sql("select count(*)::int from public.ap_search_checkout_invitations", true)).toBe(1);
  } else expect(await database.sql("select count(*)::int from public.ap_feasibility_assessments where state='COMPLETE' and outcome='LIMITED' and preliminarily_deliverable_count=0 and reviewable_count=0 and excluded_count=1", true)).toBe(1);
  prepared = await response(await readPreparation(new Request(`${origin}/api/admin/research-preparation?snapshotId=${id(2)}`)), 200);
  expect(prepared.listings[0].admitted).toBe(true);
});
