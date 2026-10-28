// Actual paid-graph continuation with fictional owner decisions and real local rendering.
// Actual owner HTTP/SQL plus actual LOCAL_QA documents; no AWS/file registration/Send.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import type { VerifiedPaidPackSourceSetup } from "./verified-paid-pack-source-setup";
import { POST as ownerAction } from "@/app/api/admin/material-draft-jobs/[id]/route";
import { createDraftOwnerView } from "@/lib/documents/draft-owner-view";
import { createDraftChangePort } from "@/lib/documents/draft-change-supabase";
import { readEncryptedDraftPayload } from "@/lib/documents/draft-packet-worker";
import { loadDraftingEvidencePacket } from "@/lib/documents/drafting-evidence-server";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { readStoredDraftRenderSource } from "@/lib/documents/draft-render-source-storage";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { prepareDraftRender } from "@/lib/documents/draft-render";
import { documentRendererConfiguration, renderDocumentLocallyForQa } from "@/lib/documents/renderer";
import { rendererFilesMatch } from "@/lib/operations/renderer-readiness";
import { STAGING_CHECKOUT_ORIGIN } from "@/lib/stripe/mode";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
const uuid = (value: unknown) => z.uuid().parse(value);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Continue one real paid source graph. Decisions are simulated on fictional
 * content; they prove protocol checks, not the user's human acceptance. */
export async function setupVerifiedPaidPackLocalDocuments(prior: VerifiedPaidPackSourceSetup, input: {
  evidenceDirectory: string; localRendererIdentity: string;
}) {
  if (!isAbsolute(input.evidenceDirectory) || !input.localRendererIdentity.includes("local-qa")) throw new Error("explicit_local_qa_target_required");
  const { prepared, generated } = prior, { pack } = prepared, { graph } = pack, { database, boundary } = graph;
  const jobId = uuid(pack.job.id), customerId = uuid(boundary.customerId), lineId = uuid(pack.line.id);
  const revisionId = uuid(pack.revision.id), oldVersionId = uuid(prepared.version.id), reviewerId = uuid(boundary.operatorId);
  const started = performance.now(), durationsMs: Record<string, number> = {};
  let completed = false;
  const timed = async <T>(phase: string, action: () => Promise<T>) => {
    const begin = performance.now(); let ok = false;
    try { const result = await action(); ok = true; return result; }
    finally { durationsMs[phase] = Math.round(performance.now() - begin);
      process.stdout.write("PACK_LOCAL_DOC_PHASE_TIMING " + JSON.stringify({ phase, completed: ok, elapsedMs: durationsMs[phase] }) + "\n"); }
  };
  const action = (body: unknown) => ownerAction(new Request(`${STAGING_CHECKOUT_ORIGIN}/api/admin/material-draft-jobs/${jobId}`, {
    method: "POST", headers: { origin: STAGING_CHECKOUT_ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: jobId }) });
  const state = () => database.sql(`select jsonb_build_object(
    'job',(select to_jsonb(x) from public.ap_material_draft_jobs x where id='${jobId}'),
    'versions',(select jsonb_agg(to_jsonb(x) order by version) from public.ap_material_draft_versions x where job_id='${jobId}'),
    'payloads',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_sensitive_payloads x where customer_id='${customerId}'),
    'members',(select count(*) from public.ap_material_draft_members x where material_line_id='${lineId}'),
    'artifacts',(select count(*) from public.ap_generated_artifacts x where material_line_id='${lineId}'),
    'files',(select count(*) from public.ap_generated_file_versions f join public.ap_generated_artifacts a on a.id=f.artifact_id where a.material_line_id='${lineId}'),
    'releases',(select count(*) from public.ap_releases x where material_line_id='${lineId}'))`, true);
  const history = () => database.sql(`select jsonb_build_object(
    'orders',(select jsonb_agg(to_jsonb(x) order by id) from public.orders x where customer_id='${customerId}'),
    'services',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_search_services x where customer_id='${customerId}'),
    'purchases',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_material_purchases x where customer_id='${customerId}'),
    'revision',(select to_jsonb(x) from public.ap_material_line_revisions x where id='${revisionId}'),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_payment_attempts x where customer_id='${customerId}'),
    'capacity',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_capacity_allocations x where customer_id='${customerId}'),
    'capacityMembers',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_capacity_allocation_members x where material_line_id='${lineId}'),
    'notices',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_outbox_messages x where customer_id='${customerId}'),
    'deadlines',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_scheduled_jobs x where
      (reference_id='${lineId}' and job_kind='MATERIAL_LINE_DEADLINE') or reference_id='${uuid(graph.searchServiceId)}'),
    'snapshot',(select to_jsonb(x) from public.ap_intake_snapshots x where id='${uuid(graph.intake.snapshotId)}'),
    'rule',(select to_jsonb(x) from public.ap_employer_submission_rules x where id='${uuid(pack.confirmed.ruleId)}'),
    'runtime',(select to_jsonb(x) from public.ap_material_draft_runtime x where singleton),
    'attempts',(select jsonb_agg(to_jsonb(x) order by id) from public.ap_material_draft_attempts x where job_id='${jobId}'),
    'observations',(select jsonb_agg(to_jsonb(x) order by request_id) from public.ap_material_draft_observations x where request_id='${uuid(generated.requestId)}'),
    'reconciliations',(select jsonb_agg(to_jsonb(x) order by request_id) from public.ap_material_draft_reconciliations x where request_id='${uuid(generated.requestId)}'))`, true);
  try {
    const runtime = documentRendererConfiguration();
    expect(runtime.identity).toBe(input.localRendererIdentity); expect(runtime.ready).toBe(true);
    expect(await rendererFilesMatch(runtime)).toBe(true);
    const before = await state(), paidBefore = await history();
    const lineBefore: Row<"ap_material_lines"> = await database.sql(`select to_jsonb(x) from public.ap_material_lines x where id='${lineId}'`, true);
    expect(before).toMatchObject({ members: 0, artifacts: 0, files: 0, releases: 0 });
    const view = createDraftOwnerView(database.admin, reviewerId, { changePort: createDraftChangePort(database.admin) });
    const proposal = await view.detail(jobId, new AbortController().signal);
    expect(proposal).toMatchObject({ status: "AVAILABLE", kind: "PROPOSAL", canPromote: true, canApprove: false, canSend: false });
    const badHash = generated.sourceSha256 === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);
    const stale = await action({ action: "PROMOTE_SOURCE", expectedVersionId: oldVersionId, expectedSourceSha256: badHash });
    expect(stale.status).toBe(409); expect(await state()).toEqual(before);
    const response = await timed("ownerPromotion", () => action({ action: "PROMOTE_SOURCE", expectedVersionId: oldVersionId, expectedSourceSha256: generated.sourceSha256 }));
    expect(response.status).toBe(200);
    const promoted = z.object({ action: z.literal("PROMOTE_SOURCE"), result: z.object({ jobId: z.uuid(), versionId: z.uuid(),
      packetSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
      state: z.literal("OWNER_REVIEW_REQUIRED"), reconciled: z.boolean(), deliveryAuthorized: z.literal(false) }).strict() }).strict().parse(await response.json());
    expect(promoted.result.jobId).toBe(jobId); expect(promoted.result.versionId).not.toBe(oldVersionId);
    expect(promoted.result.packetSha256).toBe(prepared.packet.packetSha256);
    const reviewedVersionId = promoted.result.versionId;
    const promotedState = await state();
    expect(promotedState.versions).toHaveLength(2);
    expect(promotedState.versions[0]).toEqual({ ...before.versions[0], invalidated_at: promotedState.versions[0].invalidated_at });
    expect(promotedState.versions[0].invalidated_at).not.toBeNull();
    expect(promotedState.job).toMatchObject({ active_version_id: reviewedVersionId, state: "SOURCE_READY", lease_token: null, lease_expires_at: null });
    const detail = await view.detail(jobId, new AbortController().signal);
    expect(detail).toMatchObject({ status: "AVAILABLE", kind: "RENDER_SOURCE", versionId: reviewedVersionId, dueAt: pack.revision.due_at,
      canPromote: false, canReviewWording: true, wordingReviewed: false, files: [], canApprove: false, canSend: false });
    if (detail.status !== "AVAILABLE") throw new Error("render_source_owner_view_missing");
    expect(detail.questions.items.map(x => x.id)).toEqual(prior.detail.questions.items.map(x => x.id));
    expect(detail.claims.length).toBeGreaterThan(0);
    expect(detail.claims.some(x => x.questionIds.includes(prior.fixture.questionId))).toBe(true);
    const review = { versionId: reviewedVersionId, packetSha256: detail.packetSha256, sourceSha256: detail.sourceSha256,
      claims: detail.claims.map(x => ({ claimId: x.id, wordingSha256: x.wordingSha256, decision: "APPROVED" as const })) };
    const incomplete = await action({ action: "REVIEW_WORDING", review: { ...review, claims: review.claims.slice(1) } });
    expect([400, 409]).toContain(incomplete.status); expect(await state()).toEqual(promotedState);
    const wordingResponse = await timed("ownerWording", () => action({ action: "REVIEW_WORDING", review }));
    expect(wordingResponse.status).toBe(200);
    const wording = z.object({ action: z.literal("REVIEW_WORDING"), result: z.object({ versionId: z.uuid(), reviewSha256: z.string().regex(/^[a-f0-9]{64}$/),
      reconciled: z.boolean(), deliveryAuthorized: z.literal(false) }).strict() }).strict().parse(await wordingResponse.json());
    expect(wording.result.versionId).toBe(reviewedVersionId);
    const reviewedState = await state();
    const repeated = await action({ action: "REVIEW_WORDING", review }); expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ action: "REVIEW_WORDING", result: { ...wording.result, reconciled: true } });
    expect(await state()).toEqual(reviewedState);
    const version: Row<"ap_material_draft_versions"> = reviewedState.versions[1];
    expect(version).toMatchObject({ id: reviewedVersionId, supersedes_id: oldVersionId, packet_sha256: prepared.packet.packetSha256,
      packet_encrypted_payload_id: prepared.version.packet_encrypted_payload_id, context_sha256: prepared.version.context_sha256,
      claim_review_sha256: wording.result.reviewSha256, claims_reviewed_by: reviewerId, approval_sha256: null, member_set_sha256: null, release_id: null });
    const packet = await loadDraftingEvidencePacket(database.admin, prepared.packet.expected);
    expect(serializeDraftingEvidencePacket(packet)).toBe(serializeDraftingEvidencePacket(prepared.packet));
    const plaintext = await readEncryptedDraftPayload(database.admin, { customerId, jobId, payloadId: uuid(version.encrypted_payload_id),
      purpose: "MATERIAL_DRAFT_SOURCE", sha256: promoted.result.sourceSha256 });
    let source;
    try { const body = plaintext.toString("utf8"); source = readStoredDraftRenderSource({ body, value: JSON.parse(body) as unknown }, promoted.result.sourceSha256, packet, () => new Date());
      expect(hash(plaintext)).toBe(promoted.result.sourceSha256); expect(serializeDraftRenderSource(source)).toBe(body); }
    finally { plaintext.fill(0); }
    expect(source.proposalSourceSha256).toBe(generated.sourceSha256);
    expect(source.resume.sections).toEqual([]); expect(source.resume.education).toEqual([]);
    expect(source.ownerReviewClaims.some(x => x.questionInsights.some(q => q.questionId === prior.fixture.questionId))).toBe(true);
    const beforeLocalRender = await state(), files: { type: string; format: string; filename: string; sha256: string }[] = [];
    const rendered = await timed("actualLocalRender", () => prepareDraftRender({ source, packet }, { render: renderDocumentLocallyForQa }));
    try {
      expect(rendered.referenceSheet).toBeUndefined(); expect(rendered.deliveryAuthorized).toBe(false);
      await mkdir(input.evidenceDirectory, { recursive: true });
      for (const [type, artifact] of Object.entries({ resume: rendered.resume, coverLetter: rendered.coverLetter })) {
        expect(artifact.render.rendererIdentity).toBe(input.localRendererIdentity);
        expect(artifact.qa.pdf.renderSourceSha256).toBe(promoted.result.sourceSha256);
        expect(artifact.deliveryAuthorized).toBe(false); expect(artifact.render.documentFontResolved).toBe(true);
        expect(artifact.render.pageImages).toHaveLength(artifact.render.pageCount);
        for (const [format, bytes] of [["docx", artifact.buffer], ["pdf", artifact.render.searchablePdf]] as const) {
          const filename = `${type}.${format}`; await writeFile(join(input.evidenceDirectory, filename), bytes, { flag: "wx" });
          expect(hash(await readFile(join(input.evidenceDirectory, filename)))).toBe(hash(bytes));
          files.push({ type, format, filename, sha256: hash(bytes) });
        }
        await writeFile(join(input.evidenceDirectory, `${type}-qa.json`), JSON.stringify(artifact.qa, null, 2) + "\n", { flag: "wx" });
        for (const [index, page] of artifact.render.pageImages.entries()) {
          expect(hash(page.bytes)).toBe(page.sha256); await writeFile(join(input.evidenceDirectory, `${type}-page-${index + 1}.png`), page.bytes, { flag: "wx" });
        }
      }
      expect(await state()).toEqual(beforeLocalRender); expect(await history()).toEqual(paidBefore);
      const lineAfter = await database.sql(`select to_jsonb(x) from public.ap_material_lines x where id='${lineId}'`, true);
      expect(lineAfter).toEqual({ ...lineBefore, fulfillment: "GENERATING" });
      const after = await view.detail(jobId, new AbortController().signal);
      expect(after).toMatchObject({ status: "AVAILABLE", kind: "RENDER_SOURCE", state: "SOURCE_READY", dueAt: pack.revision.due_at,
        wordingReviewed: true, files: [], canApprove: false, canSend: false });
      const receipt = { jobId, lineId, revisionId, versionId: reviewedVersionId, packetSha256: packet.packetSha256,
        proposalSourceSha256: generated.sourceSha256, renderSourceSha256: promoted.result.sourceSha256,
        reviewSha256: wording.result.reviewSha256, originalDueAt: pack.revision.due_at, rendererIdentity: input.localRendererIdentity,
        renderingBoundary: "LOCAL_QA", simulatedOwnerDecisions: true, humanAcceptance: false, files,
        registeredFiles: 0, approvedPairs: 0, customerDeliveries: 0, realProviderCalls: 0, hostedProof: false };
      await writeFile(join(input.evidenceDirectory, "local-doc-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
      process.stdout.write("PAID_PACK_OWNER_LOCAL_DOCUMENTS_RECEIPT " + JSON.stringify(receipt) + "\n");
      completed = true;
      return receipt;
    } finally {
      for (const artifact of [rendered.resume, rendered.coverLetter, ...(rendered.referenceSheet ? [rendered.referenceSheet] : [])]) {
        artifact.buffer.fill(0); artifact.render.searchablePdf.fill(0); artifact.render.pageImages.forEach(page => page.bytes.fill(0));
      }
    }
  } finally { process.stdout.write("PACK_LOCAL_DOC_TIMING_RECEIPT " + JSON.stringify({ completed, elapsedMs: Math.round(performance.now() - started), durationsMs }) + "\n"); }
}
