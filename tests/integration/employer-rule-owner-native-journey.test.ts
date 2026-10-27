import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
// Runtime import installs the same explicit external boundaries before the
// production owner handlers. It does not create a paid graph on import.
import { cleanupVerifiedPaidSearch, setupVerifiedPaidSearch, type VerifiedPaidSearchSetup } from "./verified-paid-search-setup";
import { employerQuestionSourceFixture, type EmployerQuestionSourceFixture } from "./employer-question-source-fixture";
import { GET, POST } from "@/app/api/admin/job-snapshots/[id]/submission-rules/route";
import type { Database } from "@/lib/database.types";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { GreenhouseAdapter } from "@/lib/jobs/adapters/greenhouse";
import { bindGreenhouseQuestionCapture, deriveGreenhouseApplicationQuestions, questionResponseSha256 } from "@/lib/jobs/application-question-evidence";
import { validRawSourceEvidence } from "@/lib/jobs/raw-source-evidence";
import { buildEmployerQuestionInsights } from "@/lib/documents/employer-question-evidence";
import { submissionRuleConfirmationSchema, submissionRuleReviewBasisSchema, submissionRuleReviewViewSchema, submissionRuleSavedSchema,
  type SubmissionRuleReviewBasis } from "@/lib/documents/submission-rule-proposal";

const id = (value: number) => `a1170000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

function confirmation(jobSnapshotId: string, basis: SubmissionRuleReviewBasis, requestId: string, sourceLine: string) {
  return submissionRuleConfirmationSchema.parse({ requestId, jobSnapshotId, expectedBasis: basis,
    choices: { resumeRequirement: "REQUIRED", coverLetterRequirement: "OPTIONAL", allowedFormats: ["DOCX", "PDF"],
      resumePageLimit: null, coverLetterPageLimit: null, resumeFilenameInstruction: null, coverLetterFilenameInstruction: null,
      referenceFilenameInstruction: null, referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null,
      submissionChannel: "HTTPS_UPLOAD", portfolioInstruction: null, workSampleInstruction: null },
    // The ordinary owner UI selects complete saved source lines, preserving
    // surrounding qualifications. This unchanged303 source has one full line.
    fieldEvidence: { resumeRequirement: sourceLine, coverLetterRequirement: sourceLine,
      allowedFormats: sourceLine, submissionChannel: sourceLine,
      resumePageLimit: null, coverLetterPageLimit: null, resumeFilenameInstruction: null, coverLetterFilenameInstruction: null,
      referenceFilenameInstruction: null, referenceTiming: null, referenceCount: null, portfolioInstruction: null, workSampleInstruction: null },
    checklist: { listingOpened: true, applicationOpened: true, sourceCompared: true, requirementsConfirmed: true,
      questionsReviewed: true, noUnsupportedDefaults: true } });
}

/** The caller must first run the entire setupVerifiedPaidSearch with the approved
 * Greenhouse source option, and retain its boundary until this verification ends.
 * No paid rows are inserted here. Register cleanupVerifiedPaidSearch afterEach
 * when this new stage is connected to the mandatory runner. */
export async function verifyEmployerRuleOwnerJourney(graph: VerifiedPaidSearchSetup, fixture: EmployerQuestionSourceFixture) {
  const { database, boundary, origin } = graph;
  const jobSnapshotId = graph.releaseEvaluations[0].job_snapshot_id;
  const url = `${origin}/api/admin/job-snapshots/${jobSnapshotId}/submission-rules`;
  const context = { params: Promise.resolve({ id: jobSnapshotId }) };
  const post = (value: unknown, requestOrigin = origin) => new Request(url, { method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(value) });
  const result = async (response: Response, expected: number) => {
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify({ body, failures: database.failures })).toBe(expected);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    return body;
  };
  const read = () => GET(new Request(url), context);
  const check = (requestId: string) => GET(new Request(`${url}?requestId=${requestId}`), context);
  const currentRules = () => database.sql(`select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]')
    from public.ap_employer_submission_rules r where job_snapshot_id='${jobSnapshotId}'`, true);
  const receipts = () => database.sql(`select coalesce(jsonb_agg(to_jsonb(r) order by r.request_id),'[]')
    from public.ap_employer_rule_review_receipts r where job_snapshot_id='${jobSnapshotId}'`, true);
  const paidState = () => database.sql(`select jsonb_build_object(
    'service',(select to_jsonb(s) from public.ap_search_services s where id='${graph.searchServiceId}'),
    'order',(select to_jsonb(o) from public.orders o where id='${graph.orderId}'),
    'release',(select to_jsonb(r) from public.ap_releases r where id='${graph.releaseId}'),
    'members',(select jsonb_agg(to_jsonb(m) order by m.position) from public.ap_release_members m where release_id='${graph.releaseId}'),
    'matches',(select jsonb_agg(to_jsonb(m) order by m.position) from public.job_matches m where search_order_id='${graph.orderId}'),
    'evaluations',(select jsonb_agg(to_jsonb(e) order by e.id) from public.ap_match_evaluations e where snapshot_id='${graph.intake.snapshotId}'),
    'payments',(select jsonb_agg(to_jsonb(p) order by p.id) from public.ap_payment_attempts p where customer_id='${boundary.customerId}'),
    'capacity',(select jsonb_agg(to_jsonb(a) order by a.id) from public.ap_capacity_allocations a where customer_id='${boundary.customerId}'),
    'facts',(select jsonb_agg(to_jsonb(f) order by f.id) from public.ap_candidate_facts f where snapshot_id='${graph.intake.snapshotId}'),
    'outbox',(select jsonb_agg(to_jsonb(m) order by m.id) from public.ap_outbox_messages m where order_id='${graph.orderId}'))`, true);
  const paidBefore = await paidState();
  const job: Row<"ap_job_snapshots"> = await database.sql(`select to_jsonb(j) from public.ap_job_snapshots j where id='${jobSnapshotId}'`, true);
  expect(job.discovery_source).toBe(fixture.sourceFixture.sourceId);
  expect(job.external_job_id).not.toBeNull();
  expect(job.source_run_id).not.toBeNull(); expect(job.source_authorization_id).not.toBeNull();
  expect(fixture.requests.filter(request => request.kind === "LIST")).toHaveLength(1);
  expect(fixture.requests.filter(request => request.kind === "QUESTIONS")).toHaveLength(10);
  expect(new Set(fixture.requests.filter(request => request.kind === "QUESTIONS").map(request => request.jobId))).toEqual(new Set(fixture.jobIds));
  const run: Row<"job_source_runs"> = await database.sql(`select to_jsonb(r) from public.job_source_runs r where id='${job.source_run_id}'`, true);
  const authorization: Row<"ap_source_authorizations"> = await database.sql(`select to_jsonb(a) from public.ap_source_authorizations a where id='${job.source_authorization_id}'`, true);
  const head: Row<"ap_source_authorization_heads"> = await database.sql(`select to_jsonb(h) from public.ap_source_authorization_heads h where source_id='${job.discovery_source}'`, true);
  expect(run).toMatchObject({ status: "succeeded", enumeration_status: "complete", adapter_version: GreenhouseAdapter.version,
    source_authorization_id: authorization.id, authorization_head_revision: head.revision });
  expect(authorization.allowed_actions).toContain("READ_APPLICATION_QUESTIONS");
  expect(head.current_authorization_id).toBe(authorization.id);
  const captured = z.object({ text: z.string(), rawSourceEvidence: z.object({ adapterVersion: z.string(), payload: z.json(), payloadSha256: z.string() }).strict(),
    applicationQuestionObservation: z.unknown() }).passthrough().parse(job.captured_listing);
  expect(canonicalSha256(job.captured_listing)).toBe(job.content_sha256);
  expect(captured.text).toBe(fixture.listingText);
  expect(validRawSourceEvidence(captured.rawSourceEvidence, GreenhouseAdapter.version)).toBe(true);
  const binding = { sourceId: job.discovery_source, boardToken: fixture.boardToken, externalJobId: z.string().parse(job.external_job_id),
    sourceRunId: run.id, authorizationId: authorization.id, authorizationVersion: authorization.authorization_version,
    authorizationHeadRevision: head.revision, scopeSha256: z.string().parse(run.scope_sha256), adapterVersion: z.string().parse(run.adapter_version) };
  const capture = bindGreenhouseQuestionCapture(captured.applicationQuestionObservation, { ...binding, observedAt: job.retrieved_at, rawSourcePayload: captured.rawSourceEvidence.payload });
  expect(capture.authority?.authorizationVersion).toBe(authorization.authorization_version);
  expect(capture).toMatchObject({ outcome: "RESPONSE", reasonCode: "CAPTURED", sourceId: job.discovery_source,
    rawResponseSha256: questionResponseSha256(fixture.responses.get(binding.externalJobId)), authority: { sourceRunId: run.id, authorizationId: authorization.id } });
  const questions = deriveGreenhouseApplicationQuestions(capture);
  expect(questions.status).toBe("OBSERVED"); expect(questions.questions).toHaveLength(2);
  // Literal prompt limits survive. Undocumented API fields cannot become
  // verified structured limits, and form requiredness is not a qualification.
  expect(questions.questions.map(({ prompt, required, wordLimit, characterLimit }) => ({ prompt, required, wordLimit, characterLimit })))
    .toEqual(fixture.questions.map(question => ({ prompt: question.label, required: question.required, wordLimit: null, characterLimit: null })));

  const unprepared = await result(await read(), 200);
  expect(unprepared).toMatchObject({ status: "PREPARATION_REQUIRED", jobSnapshotId });
  expect(await currentRules()).toEqual([]); expect(await receipts()).toEqual([]);
  const basisResponse = await database.admin.rpc("ap_employer_rule_review_basis", { p_job_snapshot_id: jobSnapshotId, p_reviewer_id: boundary.operatorId });
  expect(basisResponse.error).toBeNull();
  const priorBasis = z.object({ basis: submissionRuleReviewBasisSchema }).passthrough().parse(basisResponse.data).basis;
  expect(await result(await POST(post({ action: "PREPARE_SOURCE" }), context), 200)).toEqual({ prepared: true });
  expect(await result(await POST(post({ action: "PREPARE_SOURCE" }), context), 200)).toEqual({ prepared: true });
  expect(await database.sql(`select count(*)::int from public.ap_requirement_nodes where job_snapshot_id='${jobSnapshotId}'
    and classification_method='employer-instruction-source-v1'`, true)).toBe(1);
  expect(await currentRules()).toEqual([]); expect(await receipts()).toEqual([]);
  expect(await paidState()).toEqual(paidBefore);
  const view = submissionRuleReviewViewSchema.parse(await result(await read(), 200));
  expect(view.sourceText).toBe(fixture.listingText); expect(view.blockers).toEqual([]);
  expect(view.questions).toMatchObject({ status: "OBSERVED", scope: "INSPECTED_PUBLIC_SOURCE_ONLY", questions: questions.questions.map(({ id: questionId, prompt, required, wordLimit, characterLimit }) => ({ id: questionId, prompt, required, wordLimit, characterLimit })) });
  const stale = confirmation(jobSnapshotId, priorBasis, id(1), view.sourceText);
  expect(await result(await POST(post(stale), context), 409)).toMatchObject({ code: "REVIEW_CHANGED", saved: null });
  expect(await result(await check(stale.requestId), 200)).toEqual({ saved: null });
  expect(await receipts()).toEqual([]);
  const request = confirmation(jobSnapshotId, view.basis, id(2), view.sourceText);
  await result(await POST(post(request, "https://foreign.example.invalid"), context), 403);
  await result(await POST(post({ ...request, checkedAt: new Date().toISOString() }), context), 400);
  await result(await POST(post({ ...request, checklist: { ...request.checklist, questionsReviewed: false } }), context), 400);
  await result(await POST(post({ ...request, fieldEvidence: { ...request.fieldEvidence, resumeRequirement: "Invented resume instruction." } }), context), 409);
  expect(await receipts()).toEqual([]);
  const realReviewer = boundary.operatorId;
  boundary.operatorId = boundary.customerId;
  try { await result(await read(), 409); await result(await POST(post(request), context), 409); }
  finally { boundary.operatorId = realReviewer; }
  expect(await receipts()).toEqual([]);

  // Two original HTTP requests overlap. Their database request lock arbitrates
  // the commit; an uncertain pre-write read is reconciled with that same ID.
  const overlapping = await Promise.all([POST(post(request), context), POST(post(request), context)]);
  expect(overlapping.map(response => response.status)).toContain(200);
  for (const response of overlapping) {
    expect([200, 409]).toContain(response.status);
    if (response.status === 409) expect(await response.json()).toMatchObject({ code: "RESULT_UNCONFIRMED" });
    // Successful response bodies are deliberately lost before CHECK.
  }
  const checked = z.object({ saved: submissionRuleSavedSchema }).strict().parse(await result(await check(request.requestId), 200)).saved;
  const recorded = await receipts(); expect(recorded).toHaveLength(1);
  const replayed = z.object({ saved: submissionRuleSavedSchema }).strict().parse(await result(await POST(post(request), context), 200)).saved;
  expect(replayed).toEqual(checked); expect(await receipts()).toEqual(recorded);
  expect(await currentRules()).toHaveLength(1);
  const sourceBytes = Buffer.from(view.sourceText, "utf8");
  expect(checked.reviewEvidence.sourceTextSha256).toBe(sha(sourceBytes));
  for (const citation of checked.reviewEvidence.citations) {
    const quote = request.fieldEvidence[citation.field]; expect(quote).not.toBeNull();
    expect(sourceBytes.subarray(citation.startByte, citation.endByte).toString("utf8")).toBe(quote);
    expect(citation.quoteSha256).toBe(sha(quote!));
  }
  const resumeCitation = checked.reviewEvidence.citations.find(citation => citation.field === "resumeRequirement")!;
  expect(resumeCitation.startByte).toBe(0);
  expect(resumeCitation.endByte).toBe(Buffer.byteLength(view.sourceText, "utf8"));
  expect(resumeCitation.endByte).toBeGreaterThan(view.sourceText.length);
  expect(await result(await POST(post({ ...request, choices: { ...request.choices, coverLetterRequirement: "REQUIRED" } }), context), 409))
    .toMatchObject({ code: "RECEIPT_CONFLICT" });
  expect(await receipts()).toEqual(recorded);
  const after = submissionRuleReviewViewSchema.parse(await result(await read(), 200));
  expect(after.previous?.ruleId).toBe(checked.ruleId); expect(after.questions).toEqual(view.questions);
  const originalRuleRows = await currentRules();
  const equivalent = confirmation(jobSnapshotId, after.basis, id(3), after.sourceText);
  const reconfirmed = z.object({ saved: submissionRuleSavedSchema }).strict().parse(await result(await POST(post(equivalent), context), 200)).saved;
  expect(reconfirmed.ruleId).toBe(checked.ruleId);
  expect(await currentRules()).toEqual(originalRuleRows);
  expect(await receipts()).toHaveLength(2);
  expect(z.object({ saved: submissionRuleSavedSchema }).parse(await result(await check(request.requestId), 200)).saved).toEqual(checked);
  boundary.operatorId = boundary.customerId;
  try { await result(await check(request.requestId), 409); }
  finally { boundary.operatorId = realReviewer; }
  const rule: Row<"ap_employer_submission_rules"> = await database.sql(`select to_jsonb(r) from public.ap_employer_submission_rules r where id='${checked.ruleId}'`, true);
  const nodes: Row<"ap_requirement_nodes">[] = await database.sql(`select jsonb_agg(to_jsonb(n) order by id) from public.ap_requirement_nodes n where job_snapshot_id='${jobSnapshotId}'`, true);
  const insights = buildEmployerQuestionInsights(rule.application_questions, { jobSnapshotId, jobSha256: job.content_sha256,
    ruleId: rule.id, ruleSha256: rule.content_sha256, ruleCheckedAt: rule.checked_at, humanConfirmedAt: z.string().parse(rule.human_confirmed_at),
    ruleSourceEvidenceIds: rule.source_evidence_ids, rawSource: { sourceUrl: job.source_url, observedAt: job.retrieved_at, value: job.captured_listing }, nodes, captureBinding: binding });
  expect(insights.status).toBe("OBSERVED"); expect(insights.issues).toEqual([]);
  expect(insights.questions).toHaveLength(2);
  for (const question of insights.questions) expect(question).toMatchObject({ sourceRunId: run.id, jobSnapshotId,
    sourceSha256: capture.rawResponseSha256, sourceCaptureSha256: canonicalSha256(capture), wordLimit: null, characterLimit: null,
    metadataVerification: "REQUIREDNESS_FROM_PUBLIC_FORM_LIMITS_UNDOCUMENTED", interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION" });
  expect(await paidState()).toEqual(paidBefore);
  process.stdout.write("EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK " + JSON.stringify({ jobSnapshotId, orderId: graph.orderId, releaseId: graph.releaseId,
    ruleId: rule.id, requestId: request.requestId, sourceRunId: run.id, captureSha256: canonicalSha256(capture),
    questionIds: insights.questions.map(question => question.id), questionsAreCandidateFacts: false, structuredLimits: "UNDOCUMENTED_NULL",
    sourceRequests: fixture.requests.length, realProviderCalls: 0, paidSearchHistoryPreserved: true, paidPackContextProven: false }) + "\n");
  return { graph, jobSnapshotId, ruleId: rule.id, sourceRunId: run.id, capture, insights, saved: checked };
}

afterEach(cleanupVerifiedPaidSearch);

it("connects the actual paid search to permitted Greenhouse questions and ordinary owner rule confirmation", async () => {
  const fixture = employerQuestionSourceFixture();
  const graph = await setupVerifiedPaidSearch({ sourceFixture: fixture.sourceFixture });
  await verifyEmployerRuleOwnerJourney(graph, fixture);
});
