import { createHash } from "node:crypto";
import { expect, vi } from "vitest";
import { z } from "zod";
// Shared setup installs the existing explicit fictional external boundaries.
import "./verified-paid-search-setup";
import type { VerifiedPaidPackPacketSetup } from "./verified-paid-pack-packet-setup";
import type { Database } from "@/lib/database.types";
import { createDraftWorkflowServer } from "@/lib/documents/draft-workflow-server";
import { createDraftChangePort } from "@/lib/documents/draft-change-supabase";
import { generateDraftForClaim } from "@/lib/documents/draft-generation-worker";
import { createDraftOwnerView } from "@/lib/documents/draft-owner-view";
import { readEncryptedDraftPayload } from "@/lib/documents/draft-packet-worker";
import { serializeDraftProposal, validateDraftOutput } from "@/lib/documents/draft-output";
import { processMaterialDraftQueue } from "@/lib/documents/draft-queue-server";
import { draftProviderFixture, FICTIONAL_DRAFT_KEY, FICTIONAL_DRAFT_MODEL, FICTIONAL_OUTPUT_CAP } from "./draft-provider-fixture";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
const uuid = (value: unknown) => z.uuid().parse(value);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Real service/SDK/SQL generation continuation using a finite
 * no-network provider transport. Stops at unapproved source and owner PROPOSAL.
 * This explicitly reuses the PREPARE worker's live claim; it is not proof of a
 * later scheduler acquiring a fresh generation lease. No timestamps are moved. */
export async function setupVerifiedPaidPackSource(prepared: VerifiedPaidPackPacketSetup) {
  const { pack, packet, version } = prepared, { graph } = pack, { database, boundary, provider } = graph;
  const jobId = uuid(pack.job.id), customerId = uuid(boundary.customerId), versionId = uuid(version.id);
  const lineId = uuid(pack.line.id), revisionId = uuid(pack.revision.id), reviewerId = uuid(boundary.operatorId);
  expect(graph.intake.answers.noPriorEmployment).toBe(true);
  const history = () => database.sql(`select jsonb_build_object(
    'orders',(select jsonb_agg(to_jsonb(x) order by id) from public.orders x where customer_id='${customerId}'),
    'services',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_search_services x where customer_id='${customerId}'),
    'purchases',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_material_purchases x where customer_id='${customerId}'),
    'lines',(select jsonb_agg(to_jsonb(x) order by x.id) from public.ap_material_lines x join public.ap_material_purchases p on p.id=x.purchase_id where p.customer_id='${customerId}'),
    'revision',(select to_jsonb(x) from public.ap_material_line_revisions x where id='${revisionId}'),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_payment_attempts x where customer_id='${customerId}'),
    'capacity',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_capacity_allocations x where customer_id='${customerId}'),
    'members',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_capacity_allocation_members x where material_line_id='${lineId}'),
    'notices',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_outbox_messages x where customer_id='${customerId}'),
    'deadlines',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_scheduled_jobs x
      where (reference_id='${lineId}' and job_kind='MATERIAL_LINE_DEADLINE')
        or reference_id='${uuid(graph.searchServiceId)}'),
    'snapshot',(select to_jsonb(x) from public.ap_intake_snapshots x where id='${uuid(graph.intake.snapshotId)}'),
    'rule',(select to_jsonb(x) from public.ap_employer_submission_rules x where id='${uuid(pack.confirmed.ruleId)}'))`, true);
  const outputCounts = () => database.sql(`select jsonb_build_object(
    'members',(select count(*) from public.ap_material_draft_members where draft_version_id='${versionId}'),
    'artifacts',(select count(*) from public.ap_generated_artifacts where material_line_id='${lineId}'),
    'files',(select count(*) from public.ap_generated_file_versions f join public.ap_generated_artifacts a on a.id=f.artifact_id where a.material_line_id='${lineId}'),
    'releases',(select count(*) from public.ap_releases where material_line_id='${lineId}'))`, true);
  const beforeHistory = await history(), beforeOutput = await outputCounts();
  expect(beforeOutput).toEqual({ members: 0, artifacts: 0, files: 0, releases: 0 });
  const liveJob: Row<"ap_material_draft_jobs"> = await database.sql(`select to_jsonb(x) from public.ap_material_draft_jobs x where id='${jobId}'`, true);
  expect(liveJob).toMatchObject({ state: "READY", active_version_id: versionId, customer_id: customerId, material_line_id: lineId,
    line_revision_id: revisionId, source_snapshot_id: graph.intake.snapshotId });
  const claim = { jobId, ownerId: uuid(liveJob.lease_owner), leaseToken: uuid(liveJob.lease_token) };
  expect(liveJob.lease_generation).toBeGreaterThan(0); expect(Date.parse(liveJob.lease_expires_at!)).toBeGreaterThan(Date.now());
  const runtime: Row<"ap_material_draft_runtime"> = await database.sql("select to_jsonb(x) from public.ap_material_draft_runtime x where singleton", true);
  expect(runtime.enabled).toBe(false);
  const policy = { provider: "openai", model: FICTIONAL_DRAFT_MODEL,
    privacyReferenceSha256: digest("FICTIONAL local no-network privacy fixture; not provider approval"),
    evaluationReferenceSha256: digest("FICTIONAL deterministic source-linked output; not quality acceptance"),
    quoteReferenceSha256: digest("FICTIONAL zero external spend; not an approved real provider quote"),
    maxInputTokens: 20000, maxOutputTokens: FICTIONAL_OUTPUT_CAP, inputMicrousdPerMillion: 1000000,
    outputMicrousdPerMillion: 1000000, maxAttemptMicrousd: 100000, rollingDayMicrousd: 1000000, maxAttempts: 1 };
  // Explicit synthetic setup through the actual guarded RPC, not row insertion.
  const policyId = uuid(await database.sql(`select to_jsonb(public.ap_register_material_draft_policy('${JSON.stringify(policy)}'::jsonb,'${reviewerId}'))`, true));
  const oldEnv = Object.fromEntries(["APP_MATERIAL_DRAFT_QUEUE_ENABLED", "APP_MATERIAL_DRAFTING_ENABLED", "APP_MATERIAL_DRAFT_RENDERING_ENABLED", "OPENAI_API_KEY"]
    .map(key => [key, process.env[key]]));
  const fixture = draftProviderFixture(packet), stripeRequestCount = provider.requests.length;
  const uploadClientFactory = vi.fn(() => { throw new Error("source generation must not render or upload"); });
  const ledger = () => database.sql(`select jsonb_build_object(
    'attempts',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_material_draft_attempts x where job_id='${jobId}'),
    'reconciliations',(select jsonb_agg(to_jsonb(x) order by request_id) from public.ap_material_draft_reconciliations x
      where request_id in(select id from public.ap_material_draft_attempts where job_id='${jobId}')))`, true);
  const generationState = () => database.sql(`select jsonb_build_object(
    'job',(select to_jsonb(x) from public.ap_material_draft_jobs x where id='${jobId}'),
    'versions',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_material_draft_versions x where job_id='${jobId}'),
    'attempts',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_material_draft_attempts x where job_id='${jobId}'),
    'observations',(select jsonb_agg(to_jsonb(x) order by request_id,receipt_sha256) from public.ap_material_draft_observations x
      where request_id in(select id from public.ap_material_draft_attempts where job_id='${jobId}')),
    'payloads',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_sensitive_payloads x where customer_id='${customerId}'))`, true);
  let successfulReceipt: Record<string, unknown> | null = null;
  try {
    process.env.APP_MATERIAL_DRAFT_QUEUE_ENABLED = "true"; process.env.APP_MATERIAL_DRAFTING_ENABLED = "true";
    process.env.APP_MATERIAL_DRAFT_RENDERING_ENABLED = "false"; process.env.OPENAI_API_KEY = FICTIONAL_DRAFT_KEY;
    await database.script(`select public.ap_set_material_draft_runtime(true,'${policyId}','${reviewerId}');`);
    // No new scheduler claim, token rewrite, artificial time advancement or lease
    // refresh is performed here. The real worker may renew its valid lease.
    const workflow = createDraftWorkflowServer(database.admin, { changePort: createDraftChangePort(database.admin) });
    const generated = await generateDraftForClaim(workflow.generation, claim, { enabled: true, fetchImpl: fixture.fetchImpl });
    expect(generated, JSON.stringify(database.failures)).toMatchObject({ status: "SOURCE_READY", versionId, reconciled: false });
    if (generated.status !== "SOURCE_READY") throw new Error("source continuation did not commit");
    expect(fixture.requests).toEqual([{ stage: "COUNT", requestId: generated.requestId }, { stage: "GENERATE", requestId: generated.requestId }]);
    const savedVersion: Row<"ap_material_draft_versions"> = await database.sql(`select to_jsonb(x) from public.ap_material_draft_versions x where id='${versionId}'`, true);
    const savedJob: Row<"ap_material_draft_jobs"> = await database.sql(`select to_jsonb(x) from public.ap_material_draft_jobs x where id='${jobId}'`, true);
    expect(savedJob).toMatchObject({ state: "SOURCE_READY", active_version_id: versionId, lease_owner: claim.ownerId,
      lease_token: claim.leaseToken, lease_generation: liveJob.lease_generation });
    expect(savedVersion).toMatchObject({ packet_sha256: packet.packetSha256, packet_encrypted_payload_id: version.packet_encrypted_payload_id,
      context_sha256: version.context_sha256, source_sha256: generated.sourceSha256, approval_sha256: null,
      approved_by: null, claim_review_sha256: null, claims_reviewed_by: null, member_set_sha256: null, release_id: null, invalidated_at: null });
    const recorded = await database.sql(`select jsonb_build_object(
      'attempts',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_material_draft_attempts x where job_id='${jobId}'),
      'observations',(select jsonb_agg(to_jsonb(x) order by request_id) from public.ap_material_draft_observations x where request_id='${uuid(generated.requestId)}'),
      'payload',(select to_jsonb(x) from public.ap_sensitive_payloads x where id='${uuid(savedVersion.encrypted_payload_id)}'))`, true);
    expect(recorded.attempts).toHaveLength(1); expect(recorded.observations).toHaveLength(1);
    expect(recorded.attempts[0]).toMatchObject({ id: generated.requestId, job_id: jobId, draft_version_id: versionId,
      state: "RESULT_RECORDED", policy_id: policyId, lease_generation: liveJob.lease_generation });
    expect(recorded.observations[0]).toMatchObject({ request_id: generated.requestId, outcome: "PROPOSAL_VALIDATED",
      provider_response_id: "resp_FictionalApplyPackSource1", response_model: FICTIONAL_DRAFT_MODEL, input_tokens: 1500, output_tokens: 200, total_tokens: 1700 });
    expect(recorded.payload).toMatchObject({ customer_id: customerId, encryption_algorithm: "AES-256-GCM", content_sha256: generated.sourceSha256, retention_state: "ACTIVE" });
    const expectedProposal = validateDraftOutput(fixture.output, packet);
    expect(expectedProposal.sourceSha256).toBe(generated.sourceSha256);
    expect(expectedProposal.output.resume.sections).toEqual([]); expect(expectedProposal.output.resume.educationFactIds).toEqual([]);
    expect(expectedProposal.state).toBe("OWNER_REVIEW_REQUIRED");
    expect(expectedProposal.reviews.every(review => review.state === "OWNER_REVIEW_REQUIRED")).toBe(true);
    expect(new Set(expectedProposal.reviews.flatMap(review => review.sources.map(source => source.factId))))
      .toEqual(new Set(fixture.capabilityFactIds));
    expect(expectedProposal.reviews.some(review => review.questionInsights.some(question => question.questionId === fixture.questionId))).toBe(true);
    const plaintext = await readEncryptedDraftPayload(database.admin, { customerId, jobId, payloadId: uuid(savedVersion.encrypted_payload_id),
      purpose: "MATERIAL_DRAFT_SOURCE", sha256: generated.sourceSha256 });
    try {
      expect(digest(plaintext)).toBe(generated.sourceSha256);
      expect(plaintext.toString("utf8")).toBe(serializeDraftProposal(expectedProposal));
      expect(recorded.payload.ciphertext).not.toBe(`\\x${plaintext.toString("hex")}`);
    } finally { plaintext.fill(0); }
    const view = createDraftOwnerView(database.admin, reviewerId, { changePort: createDraftChangePort(database.admin) });
    const detail = await view.detail(jobId, new AbortController().signal);
    expect(detail).toMatchObject({ status: "AVAILABLE", kind: "PROPOSAL", state: "SOURCE_READY", versionId,
      packetSha256: packet.packetSha256, sourceSha256: generated.sourceSha256, dueAt: pack.revision.due_at,
      files: [], wordingReviewed: false, canPromote: true, canReviewWording: false, canApprove: false, canSend: false });
    if (detail.status !== "AVAILABLE") throw new Error("owner proposal unavailable");
    expect(detail.documents).toHaveLength(2);
    expect(detail.facts.map(fact => fact.id).sort()).toEqual(packet.ownerEvidence.facts.map(fact => fact.id).sort());
    expect(detail.questions.items.map(question => question.id).sort()).toEqual(packet.employerQuestionInsights.questions.map(question => question.id).sort());
    const unwrap = vi.spyOn(boundary.wrappedKeys, "get");
    try {
      expect(await createDraftOwnerView(database.admin, customerId).detail(jobId, new AbortController().signal)).toMatchObject({ status: "UNAVAILABLE" });
      expect(unwrap).not.toHaveBeenCalled();
    } finally { unwrap.mockRestore(); }
    const committedState = await generationState();
    const committedLedger = await ledger();
    const repeat = await processMaterialDraftQueue(database.admin, { uploadClientFactory });
    expect(repeat).toEqual({ status: "COMPLETE", claimed: 0, prepared: 0, generated: 0, rendered: 0, held: 0, unknown: 0, failed: 0 });
    expect(fixture.requests).toHaveLength(2); expect(uploadClientFactory).not.toHaveBeenCalled();
    expect(provider.requests).toHaveLength(stripeRequestCount);
    expect(await generationState()).toEqual(committedState);
    expect(await ledger()).toEqual(committedLedger);
    expect(await history()).toEqual(beforeHistory); expect(await outputCounts()).toEqual(beforeOutput);
    successfulReceipt = { jobId, lineId, revisionId, versionId,
      requestId: generated.requestId, packetSha256: packet.packetSha256, sourceSha256: generated.sourceSha256,
      dueAt: pack.revision.due_at, leaseBranch: "REUSED_LIVE_PREPARE_CLAIM", sourceState: "SOURCE_READY", ownerView: "PROPOSAL",
      wordingApproved: false, renderedFiles: 0, customerDeliveries: 0, realProviderCalls: 0, hostedProof: false };
    return { prepared, generated, source: expectedProposal, detail, fixture };
  } finally {
    const oldPolicy = runtime.policy_id === null ? "null" : `'${uuid(runtime.policy_id)}'`;
    try {
      let beforeTeardownLedger: unknown, ledgerReadError: unknown;
      try { beforeTeardownLedger = await ledger(); } catch (error) { ledgerReadError = error; }
      await database.script(`select public.ap_set_material_draft_runtime(false,${oldPolicy},'${reviewerId}');`);
      expect(await database.sql("select to_jsonb(x) from public.ap_material_draft_runtime x where singleton", true)).toEqual(runtime);
      if (ledgerReadError) throw ledgerReadError;
      expect(await ledger()).toEqual(beforeTeardownLedger);
      // Success is emitted only after the exact runtime restore and immutable
      // reservation/reconciliation checks have passed as well.
      if (successfulReceipt) process.stdout.write("PAID_PACK_SOURCE_READY_PROPOSAL_RECEIPT " + JSON.stringify(successfulReceipt) + "\n");
    }
    finally { for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  }
}

export type VerifiedPaidPackSourceSetup = Awaited<ReturnType<typeof setupVerifiedPaidPackSource>>;
