import { createHash, randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { z } from "zod";
// Reuse the explicit external Auth/KMS/Stripe boundaries without creating data.
import "./verified-paid-search-setup";
import type { VerifiedPaidPackSetup } from "./verified-paid-pack-setup";
import type { Database } from "@/lib/database.types";
import { POST as ownerDraftAction } from "@/app/api/admin/material-draft-jobs/[id]/route";
import { draftQueueControls, processMaterialDraftQueue } from "@/lib/documents/draft-queue-server";
import { loadDraftingEvidencePacket } from "@/lib/documents/drafting-evidence-server";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import * as packetBuilder from "@/lib/documents/drafting-evidence";
import { readEncryptedDraftPayload } from "@/lib/documents/draft-packet-worker";
import * as packetWorker from "@/lib/documents/draft-packet-worker";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { deriveGreenhouseApplicationQuestions, validateGreenhouseQuestionCapture } from "@/lib/jobs/application-question-evidence";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
const uuid = (value: unknown) => z.uuid().parse(value);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => z.string().regex(/^[a-f0-9]{64}$/).parse(value);
const safePacketError = (error: unknown) => {
  const value = error instanceof Error ? error : null;
  const code = value && "code" in value ? value.code : value?.message;
  return { name: value && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value.name) ? value.name : "UnknownError",
    code: typeof code === "string" && /^[A-Z][A-Z0-9_]{1,119}$/.test(code) ? code : "UNCLASSIFIED" };
};

/** Reusable local evidence-packet continuation with modeled external boundaries.
 * Consumes an actual route/webhook-paid line and owner-confirmed employer rule.
 * No paid rows, state, packet, provider policy, approval, or files are seeded.
 * The surrounding harness exposes only the enumerated PREPARE SDK surface.
 * The caller owns graph teardown after all continuations. */
export async function setupVerifiedPaidPackPacket(pack: VerifiedPaidPackSetup) {
  const { graph } = pack, { database, boundary, provider, origin } = graph;
  const customerId = uuid(boundary.customerId), jobId = uuid(pack.job.id), lineId = uuid(pack.line.id);
  const revisionId = uuid(pack.revision.id), snapshotId = uuid(graph.intake.snapshotId);
  const jobSnapshotId = uuid(pack.confirmed.jobSnapshotId), ruleId = uuid(pack.confirmed.ruleId);
  const orderId = uuid(graph.orderId), releaseId = uuid(graph.releaseId), searchServiceId = uuid(graph.searchServiceId);
  expect(pack.job).toMatchObject({ state: "EVIDENCE_PENDING", active_version_id: null, customer_id: customerId,
    material_line_id: lineId, line_revision_id: revisionId, source_snapshot_id: snapshotId });
  expect(pack.revision).toMatchObject({ source_snapshot_id: snapshotId, job_snapshot_id: jobSnapshotId,
    employer_rule_snapshot_id: ruleId, revision_kind: "ORIGINAL", version: 1 });
  expect(pack.line.selected_reference_sheet).toBe(false);

  const history = () => database.sql(`select jsonb_build_object(
    'line',(select to_jsonb(x) from public.ap_material_lines x where id='${lineId}'),
    'revision',(select to_jsonb(x) from public.ap_material_line_revisions x where id='${revisionId}'),
    'purchase',(select to_jsonb(x) from public.ap_material_purchases x where id='${uuid(pack.purchaseId)}'),
    'payment',(select to_jsonb(x) from public.ap_payment_attempts x where id='${uuid(pack.paymentAttemptId)}'),
    'intent',(select to_jsonb(x) from public.ap_material_checkout_intents x where id='${uuid(pack.checkoutIntentId)}'),
    'capacity',(select to_jsonb(x) from public.ap_capacity_allocations x where id='${uuid(pack.revision.capacity_allocation_id)}'),
    'capacityMembers',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_capacity_allocation_members x where material_line_id='${lineId}'),
    'deadline',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_scheduled_jobs x where reference_id='${lineId}' and job_kind='MATERIAL_LINE_DEADLINE'),
    'notices',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_outbox_messages x where order_id='${orderId}'),
    'sourceSnapshot',(select to_jsonb(x) from public.ap_intake_snapshots x where id='${snapshotId}'),
    'facts',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_candidate_facts x where snapshot_id='${snapshotId}'),
    'sourceJob',(select to_jsonb(x) from public.ap_job_snapshots x where id='${jobSnapshotId}'),
    'rule',(select to_jsonb(x) from public.ap_employer_submission_rules x where id='${ruleId}'),
    'ruleReceipt',(select to_jsonb(x) from public.ap_employer_rule_review_receipts x where request_id='${uuid(pack.confirmed.saved.requestId)}'),
    'searchService',(select to_jsonb(x) from public.ap_search_services x where id='${searchServiceId}'),
    'searchOrder',(select to_jsonb(x) from public.orders x where id='${orderId}'),
    'searchRelease',(select to_jsonb(x) from public.ap_releases x where id='${releaseId}'),
    'searchMembers',(select jsonb_agg(to_jsonb(x) order by position) from public.ap_release_members x where release_id='${releaseId}'),
    'searchMatches',(select jsonb_agg(to_jsonb(x) order by position) from public.job_matches x where search_order_id='${orderId}'),
    'searchPayment',(select to_jsonb(x) from public.ap_payment_attempts x join public.ap_search_services s on s.winning_payment_attempt_id=x.id where s.id='${searchServiceId}'),
    'searchCapacity',(select to_jsonb(x) from public.ap_capacity_allocations x join public.ap_search_services s on s.capacity_allocation_id=x.id where s.id='${searchServiceId}'))`, true);
  const packetState = () => database.sql(`select jsonb_build_object(
    'job',(select to_jsonb(x) from public.ap_material_draft_jobs x where id='${jobId}'),
    'versions',coalesce((select jsonb_agg(to_jsonb(x) order by version) from public.ap_material_draft_versions x where job_id='${jobId}'),'[]'::jsonb),
    'payloads',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.ap_sensitive_payloads x
      where id in(select packet_encrypted_payload_id from public.ap_material_draft_versions where job_id='${jobId}')),'[]'::jsonb))`, true);
  const noOutput = () => database.sql(`select jsonb_build_object(
    'attempts',(select count(*)::int from public.ap_material_draft_attempts where job_id='${jobId}'),
    'releases',(select count(*)::int from public.ap_releases where material_line_id='${lineId}'),
    'members',(select count(*)::int from public.ap_material_draft_members where material_line_id='${lineId}'),
    'artifacts',(select count(*)::int from public.ap_generated_artifacts where material_line_id='${lineId}'),
    'files',(select count(*)::int from public.ap_generated_file_versions f join public.ap_generated_artifacts a on a.id=f.artifact_id where a.material_line_id='${lineId}'))`, true);
  const payloadIds = async () => z.array(z.uuid()).parse(await database.sql(`select coalesce(jsonb_agg(id order by id),'[]'::jsonb)
    from public.ap_sensitive_payloads where customer_id='${customerId}'`, true));
  const originalHistory = await history(), originalPacketState = await packetState(), originalPayloads = await payloadIds();
  expect(originalHistory.line).toEqual(pack.line); expect(originalHistory.revision).toEqual(pack.revision);
  expect(originalHistory.purchase).toEqual(pack.state.purchase);
  expect(originalHistory.rule).toEqual(pack.state.rule); expect(originalHistory.ruleReceipt).toEqual(pack.state.ruleReceipt);
  expect(originalHistory.deadline).toEqual(pack.state.deadlines);
  expect(originalHistory.notices.filter((notice: Row<"ap_outbox_messages">) => notice.message_kind === "MATERIALS_PAYMENT_VERIFIED"
    && notice.recipient_ref === pack.purchaseId)).toEqual(pack.state.notices);
  expect(originalPacketState.job).toEqual(pack.job);
  expect(originalPacketState.versions).toEqual([]); expect(originalPacketState.payloads).toEqual([]);
  expect(await noOutput()).toEqual({ attempts: 0, releases: 0, members: 0, artifacts: 0, files: 0 });
  const runtime: Row<"ap_material_draft_runtime"> = await database.sql("select to_jsonb(x) from public.ap_material_draft_runtime x where singleton", true);
  expect(runtime.enabled).toBe(false);
  const rule: Row<"ap_employer_submission_rules"> = await database.sql(`select to_jsonb(x) from public.ap_employer_submission_rules x where id='${ruleId}'`, true);
  const sourceJob: Row<"ap_job_snapshots"> = await database.sql(`select to_jsonb(x) from public.ap_job_snapshots x where id='${jobSnapshotId}'`, true);
  const snapshot: Row<"ap_intake_snapshots"> = await database.sql(`select to_jsonb(x) from public.ap_intake_snapshots x where id='${snapshotId}'`, true);
  const facts: Row<"ap_candidate_facts">[] = await database.sql(`select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'::jsonb)
    from public.ap_candidate_facts x where snapshot_id='${snapshotId}' and semantic_key<>'document_contact.confirmed' and superseded_at is null`, true);
  expect(facts.length).toBeGreaterThan(0);
  expect(rule).toMatchObject({ job_snapshot_id: jobSnapshotId, is_current: true, superseded_at: null,
    human_confirmed_by: boundary.operatorId, injection_scan_state: "CLEAR", hard_block_reason: null });
  expect(sourceJob.content_sha256).toBe(canonicalSha256(sourceJob.captured_listing));
  const captureRecord = z.object({ applicationQuestionObservation: z.unknown() }).passthrough().parse(sourceJob.captured_listing);
  const capture = validateGreenhouseQuestionCapture(captureRecord.applicationQuestionObservation);
  const expectedQuestions = deriveGreenhouseApplicationQuestions(capture);
  expect(expectedQuestions.status).toBe("OBSERVED"); expect(expectedQuestions.questions.length).toBeGreaterThan(0);
  expect(capture.authority?.sourceRunId).toBe(sourceJob.source_run_id);
  expect(capture.authority?.authorizationId).toBe(sourceJob.source_authorization_id);
  const requestCount = provider.requests.length, failureOffset = database.failures.length;
  const previousControls = { queue: process.env.APP_MATERIAL_DRAFT_QUEUE_ENABLED,
    generate: process.env.APP_MATERIAL_DRAFTING_ENABLED, render: process.env.APP_MATERIAL_DRAFT_RENDERING_ENABLED };
  const uploadClientFactory = vi.fn(() => { throw new Error("packet_stage_must_not_access_file_storage"); });
  process.env.APP_MATERIAL_DRAFT_QUEUE_ENABLED = "true";
  process.env.APP_MATERIAL_DRAFTING_ENABLED = "false";
  process.env.APP_MATERIAL_DRAFT_RENDERING_ENABLED = "false";
  try {
    expect(draftQueueControls()).toEqual({ enabled: true, generate: false, render: false });
    const checkId = randomUUID();
    const response = await ownerDraftAction(new Request(`${origin}/api/admin/material-draft-jobs/${jobId}`, { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "LISTING_CHECK", expectedVersionId: null,
        checkId, phase: "BEFORE_GENERATION", result: "ACTIVE", evidenceSha256: hash(rule.content_sha256),
        listingOpened: true, instructionsCompared: true }) }), { params: Promise.resolve({ id: jobId }) });
    const checked: unknown = await response.json();
    expect(response.status, JSON.stringify({ checked, failures: database.failures.slice(failureOffset) })).toBe(200);
    expect(checked).toEqual({ action: "LISTING_CHECK", checkId });
    const listingCheck: Row<"ap_material_listing_checks"> = await database.sql(`select to_jsonb(x) from public.ap_material_listing_checks x where id='${uuid(checkId)}'`, true);
    expect(listingCheck).toMatchObject({ material_line_id: lineId, line_revision_id: revisionId, job_snapshot_id: jobSnapshotId,
      submission_rule_id: ruleId, evidence_sha256: rule.content_sha256, phase: "BEFORE_GENERATION", result: "ACTIVE" });
    expect(Date.now() - Date.parse(listingCheck.checked_at)).toBeGreaterThanOrEqual(0);
    expect(Date.now() - Date.parse(listingCheck.checked_at)).toBeLessThan(3_600_000);

    // Default spy behavior calls the real worker. Do not replace its services,
    // retry it, alter its claim or treat these diagnostics as a successful run.
    const workerSpy = vi.spyOn(packetWorker, "attachDraftPacketForClaim");
    const builderSpy = vi.spyOn(packetBuilder, "buildDraftingEvidencePacket");
    let prepared: Awaited<ReturnType<typeof processMaterialDraftQueue>>;
    const diagnostics: Record<string, unknown> = {};
    try {
      prepared = await processMaterialDraftQueue(database.admin, { uploadClientFactory });
      if (prepared.status !== "COMPLETE") {
        const outcomes = await Promise.allSettled(workerSpy.mock.results.map(async result => {
          if (result.type === "throw") throw result.value;
          return await result.value;
        }));
        diagnostics.workerCalls = workerSpy.mock.calls.length;
        diagnostics.workerResults = outcomes.map(result => result.status === "rejected"
          ? { outcome: "REJECTED", ...safePacketError(result.reason) }
          : { outcome: "FULFILLED", status: result.value?.status ?? "NO_RECEIPT" });
        try {
          diagnostics.job = z.object({ jobId: z.uuid(), state: z.string().regex(/^[A-Z_]{1,40}$/),
            activeVersionId: z.uuid().nullable(), versionIds: z.array(z.uuid()) }).strict().parse(await database.sql(
            `select jsonb_build_object('jobId',j.id,'state',j.state,'activeVersionId',j.active_version_id,
              'versionIds',coalesce((select jsonb_agg(v.id order by v.id) from public.ap_material_draft_versions v where v.job_id=j.id),'[]'::jsonb))
              from public.ap_material_draft_jobs j where j.id='${jobId}'`, true));
        } catch (error) { diagnostics.job = safePacketError(error); }
        try {
          const diagnosticPacket = await loadDraftingEvidencePacket(database.admin, { customerId, materialLineId: lineId,
            revisionId, revisionVersion: pack.revision.version, bindingSha256: hash(pack.revision.binding_sha256) });
          diagnostics.packet = { packetSha256: hash(diagnosticPacket.packetSha256) };
        } catch (error) { diagnostics.packet = safePacketError(error); }
        diagnostics.builderCalls = builderSpy.mock.calls.length;
        diagnostics.builderShapes = builderSpy.mock.calls.map(([raw, expected]) => {
          const records = packetBuilder.draftingEvidenceRecordsSchema.safeParse(raw);
          const expectation = packetBuilder.draftingEvidenceExpectationSchema.safeParse(expected);
          const shape = (result: typeof records | typeof expectation) => result.success ? { success: true } : {
            success: false, issueCount: result.error.issues.length, issues: result.error.issues.slice(0, 100).map(issue => ({
              path: issue.path.map(segment => typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0
                ? segment : typeof segment === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(segment) ? segment : "REDACTED_KEY"),
              code: issue.code,
            })),
          };
          return { records: shape(records), expectation: shape(expectation) };
        });
      }
    } finally { builderSpy.mockRestore(); workerSpy.mockRestore(); }
    expect(prepared, JSON.stringify({ databaseFailures: database.failures.slice(failureOffset).map(safePacketError), diagnostics })).toEqual({ status: "COMPLETE", claimed: 1,
      prepared: 1, generated: 0, rendered: 0, held: 0, unknown: 0, failed: 0 });
    const ready = await packetState();
    expect(ready.versions).toHaveLength(1); expect(ready.payloads).toHaveLength(1);
    const version: Row<"ap_material_draft_versions"> = ready.versions[0];
    const encrypted: Row<"ap_sensitive_payloads"> = ready.payloads[0];
    expect(ready.job).toMatchObject({ id: jobId, state: "READY", customer_id: customerId, material_line_id: lineId,
      line_revision_id: revisionId, source_snapshot_id: snapshotId, active_version_id: version.id });
    expect(version).toMatchObject({ job_id: jobId, customer_id: customerId, material_line_id: lineId, version: 1,
      invalidated_at: null, encrypted_payload_id: null, source_sha256: null, claim_review_encrypted_payload_id: null,
      claims_reviewed_by: null, approval_sha256: null, approved_by: null, release_id: null, member_set_sha256: null });
    expect(encrypted).toMatchObject({ id: version.packet_encrypted_payload_id, customer_id: customerId,
      content_sha256: version.packet_sha256, encryption_algorithm: "AES-256-GCM", retention_state: "ACTIVE" });
    const preparedPayloadIds = await payloadIds();
    expect(preparedPayloadIds.filter(id => !originalPayloads.includes(id))).toEqual([encrypted.id]);
    const packet = await loadDraftingEvidencePacket(database.admin, { customerId, materialLineId: lineId, revisionId,
      revisionVersion: pack.revision.version, bindingSha256: hash(pack.revision.binding_sha256) });
    expect(packet.packetSha256).toBe(version.packet_sha256);
    expect(packet.binding).toMatchObject({ snapshotId, snapshotSha256: snapshot.content_sha256, confirmationReceipt: snapshot.confirmed_review,
      jobSnapshotId, jobSha256: sourceJob.content_sha256, ruleId, ruleSha256: rule.content_sha256,
      listingCheckId: checkId, dueAt: pack.revision.due_at, referencePermissions: [] });
    expect(packet.binding.confirmationReceiptSha256).toBe(canonicalSha256(snapshot.confirmed_review));
    expect(packet.approvalState).toBe("UNREVIEWED"); expect(packet.providerTransferAuthorized).toBe(false);
    expect(packet.ownerEvidence.facts.map(fact => fact.id).sort()).toEqual(facts.map(fact => fact.id).sort());
    for (const fact of packet.ownerEvidence.facts) {
      const stored = facts.find(candidate => candidate.id === fact.id);
      expect(stored).toBeDefined();
      expect(fact).toMatchObject({ snapshot_id: snapshotId, typed_value: stored?.typed_value, semantic_key: stored?.semantic_key,
        verification: stored?.verification, confirmed_or_corrected_at: stored?.confirmed_or_corrected_at });
      expect(["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"]).toContain(fact.verification);
    }
    expect(packet.employerQuestionInsights).toMatchObject({ status: "OBSERVED", verification: "BOUND_SOURCE_EVIDENCE",
      answeredQuestionDeliverable: false, applicationSubmissionAuthorized: false, issues: [] });
    expect(packet.employerQuestionInsights.questions).toHaveLength(expectedQuestions.questions.length);
    for (const question of expectedQuestions.questions) {
      const insight = packet.employerQuestionInsights.questions.find(candidate => candidate.id === question.id);
      expect(insight).toMatchObject({ id: question.id, prompt: question.prompt, required: question.required,
        wordLimit: null, characterLimit: null, jobSnapshotId, jobSha256: sourceJob.content_sha256, ruleId,
        ruleSha256: rule.content_sha256, sourceRunId: sourceJob.source_run_id, sourceCaptureSha256: canonicalSha256(capture),
        sourceSha256: capture.rawResponseSha256, providerEligible: true,
        textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS", interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION" });
      expect(packet.providerView.employerQuestionInsights.questions.find(candidate => candidate.id === question.id))
        .toMatchObject({ prompt: question.prompt, required: question.required, wordLimit: null, characterLimit: null });
    }
    const serialized = serializeDraftingEvidencePacket(packet);
    const plaintext = await readEncryptedDraftPayload(database.admin, { customerId, jobId, payloadId: uuid(encrypted.id),
      purpose: "MATERIAL_DRAFT_PACKET", sha256: hash(version.packet_sha256) });
    try {
      expect(digest(plaintext)).toBe(version.packet_sha256);
      expect(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)).toBe(serialized);
      expect(encrypted.ciphertext).not.toBe(`\\x${plaintext.toString("hex")}`);
    } finally { plaintext.fill(0); }
    expect(Date.parse(packet.validUntil)).toBeGreaterThan(Date.now());
    expect(Date.parse(packet.validUntil)).toBeLessThanOrEqual(Date.parse(z.iso.datetime({ offset: true }).parse(pack.revision.due_at)));
    expect(Date.parse(packet.validUntil)).toBeLessThanOrEqual(Date.parse(rule.checked_at) + 3_600_000);
    expect(Date.parse(packet.validUntil)).toBeLessThanOrEqual(Date.parse(listingCheck.checked_at) + 3_600_000);

    expect(await processMaterialDraftQueue(database.admin, { uploadClientFactory })).toEqual({ status: "COMPLETE", claimed: 0,
      prepared: 0, generated: 0, rendered: 0, held: 0, unknown: 0, failed: 0 });
    expect(await packetState()).toEqual(ready);
    expect(await payloadIds()).toEqual(preparedPayloadIds);
    expect(await history()).toEqual(originalHistory);
    expect(await noOutput()).toEqual({ attempts: 0, releases: 0, members: 0, artifacts: 0, files: 0 });
    expect(await database.sql("select to_jsonb(x) from public.ap_material_draft_runtime x where singleton", true)).toEqual(runtime);
    expect(provider.requests).toHaveLength(requestCount);
    expect(uploadClientFactory).not.toHaveBeenCalled();
    expect(database.failures.slice(failureOffset)).toEqual([]);
    process.stdout.write("PAID_PACK_PREPARE_PACKET_RECEIPT " + JSON.stringify({ customerId, jobId, lineId, revisionId, snapshotId, jobSnapshotId,
      ruleId, checkId, versionId: version.id, packetPayloadId: encrypted.id, packetSha256: version.packet_sha256,
      contextSha256: version.context_sha256, dueAt: pack.revision.due_at, validUntil: packet.validUntil,
      confirmedFactCount: packet.ownerEvidence.facts.length, employerQuestionCount: packet.employerQuestionInsights.questions.length,
      sourceCaptureSha256: canonicalSha256(capture), aesGcmRoundTrip: true, providerAttempts: 0, releases: 0, files: 0,
      realProviderCalls: 0, hostedProof: false }) + "\n");
    return { pack, packet, version, encryptedPayloadId: encrypted.id, listingCheck };
  } finally {
    for (const [name, previous] of [["APP_MATERIAL_DRAFT_QUEUE_ENABLED", previousControls.queue],
      ["APP_MATERIAL_DRAFTING_ENABLED", previousControls.generate], ["APP_MATERIAL_DRAFT_RENDERING_ENABLED", previousControls.render]] as const) {
      if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
    }
  }
}

export type VerifiedPaidPackPacketSetup = Awaited<ReturnType<typeof setupVerifiedPaidPackPacket>>;
