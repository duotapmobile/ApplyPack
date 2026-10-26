import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { requireAdmin } from "@/lib/auth/require-admin";
import { draftClaimReviewRequestSchema } from "@/lib/documents/draft-claim-review";
import { createDraftOwnerServer } from "@/lib/documents/draft-owner-server";
import { draftOwnerEditRequestSchema } from "@/lib/documents/draft-owner-edit";
import { createDraftOwnerEditServer, DraftOwnerEditServerError } from "@/lib/documents/draft-owner-edit-server";
import { createMaterialRuleOwnerServer } from "@/lib/documents/material-rule-owner-server";
import { materialRuleBasisSchema, materialRuleReviewChecklistSchema } from "@/lib/documents/material-rule-evidence";
import { isSameOriginRequest } from "@/lib/security/origin";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const binding = { versionId: uuid, packetSha256: hash, sourceSha256: hash, memberSetSha256: hash };
const checklist = z.object({ contentReviewed: z.literal(true), visualReviewed: z.literal(true), listingRechecked: z.literal(true),
  instructionsReparsed: z.literal(true), linksRechecked: z.literal(true), provenanceReviewed: z.literal(true), secureFilesConfirmed: z.literal(true) }).strict();
const inputSchema = z.discriminatedUnion("action", [
  draftOwnerEditRequestSchema.omit({ jobId: true }).extend({ action: z.literal("SAVE_OWNER_EDIT") }).strict(),
  z.object({ action: z.literal("PROMOTE_SOURCE"), expectedVersionId: uuid, expectedSourceSha256: hash, careerBreakFactId: uuid.optional() }).strict(),
  z.object({ action: z.literal("REVIEW_WORDING"), review: draftClaimReviewRequestSchema }).strict(),
  z.object({ action: z.literal("REVALIDATE_RULE"), expectedVersionId: uuid.nullable(), receiptId: uuid,
    expectedBasis: materialRuleBasisSchema, checklist: materialRuleReviewChecklistSchema }).strict(),
  z.object({ action: z.literal("REFRESH_PACKET"), expectedVersionId: uuid, expectedPacketSha256: hash,
    expectedContextSha256: hash, requestId: uuid }).strict(),
  z.object({ action: z.literal("LISTING_CHECK"), expectedVersionId: uuid.nullable(), checkId: uuid, phase: z.enum(["BEFORE_GENERATION", "BEFORE_RELEASE"]),
    result: z.enum(["ACTIVE", "CLOSED", "INSTRUCTION_BLOCKED"]), evidenceSha256: hash,
    listingOpened: z.literal(true), instructionsCompared: z.literal(true) }).strict()
    .refine((value) => value.expectedVersionId !== null || value.phase === "BEFORE_GENERATION"),
  z.object({ action: z.literal("APPROVE_PAIR"), ...binding, checklist, attestation: z.string().trim().min(20).max(4000) }).strict(),
  z.object({ action: z.literal("SEND_PAIR"), ...binding, approvalSha256: hash, releaseId: uuid, outboxId: uuid,
    rationale: z.string().trim().min(20).max(4000) }).strict(),
]);

function privateResponse(result: Response) {
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}
function response(body: unknown, status = 200) { return privateResponse(NextResponse.json(body, { status })); }

async function readInput(request: Request): Promise<unknown> {
  if (!request.body || request.signal.aborted || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, bytes: Buffer | undefined, interrupt: () => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => { interrupt = () => {
    void reader.cancel().catch(() => undefined); reject(new Error("BODY_INTERRUPTED"));
  }; });
  const timer = setTimeout(interrupt, 5000);
  request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 96 * 1024) { chunk.value.fill(0); void reader.cancel().catch(() => undefined); return null; }
      chunks.push(chunk.value);
    }
    bytes = Buffer.concat(chunks);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch { return null; }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", interrupt); chunks.forEach((chunk) => chunk.fill(0)); bytes?.fill(0); reader.releaseLock(); }
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return privateResponse(auth.response);
    const jobId = uuid.safeParse((await route.params).id), input = inputSchema.safeParse(await readInput(request));
    if (!jobId.success || !input.success) return response({ error: "The document action is incomplete. Review the current version and try again." }, 400);
    const admin: SupabaseClient<Database> = auth.admin;
    const value = input.data;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    // These adapters reconcile exact immutable receipts even when the original
    // version is no longer current; their own service-only checks own the CAS.
    if (value.action === "REVALIDATE_RULE") {
      const result = await createMaterialRuleOwnerServer(admin, auth.user.id).revalidate({ jobId: jobId.data,
        expectedVersionId: value.expectedVersionId, receiptId: value.receiptId, expectedBasis: value.expectedBasis, checklist: value.checklist }, signal);
      return response({ action: value.action, result });
    }
    if (value.action === "REFRESH_PACKET") {
      const result = await createMaterialRuleOwnerServer(admin, auth.user.id).refreshPacket({ jobId: jobId.data,
        expectedVersionId: value.expectedVersionId, expectedPacketSha256: value.expectedPacketSha256,
        expectedContextSha256: value.expectedContextSha256, requestId: value.requestId }, signal);
      return response({ action: value.action, result });
    }
    if (value.action === "SAVE_OWNER_EDIT") {
      // Reconcile the exact saved successor after a lost response. The adapter
      // verifies both parent/job ownership and immutable request lineage.
      try {
        const result = await createDraftOwnerEditServer(admin, auth.user.id).saveEdit({ jobId: jobId.data,
          expectedVersionId: value.expectedVersionId, expectedSourceSha256: value.expectedSourceSha256,
          requestId: value.requestId, output: value.output }, signal);
        return response({ action: value.action, result });
      } catch (error) {
        // Only the adapter's pre-storage validation can establish rejection.
        // Timeouts, stale context and uncertain commits must remain uncertain.
        if (error instanceof DraftOwnerEditServerError && error.code === "EDIT_INVALID") {
          return response({ error: "The edited wording could not be validated against the confirmed sources. Review the wording and source selections.", editRejected: true }, 422);
        }
        throw error;
      }
    }
    const versionId = value.action === "REVIEW_WORDING" ? value.review.versionId
      : value.action === "PROMOTE_SOURCE" || value.action === "LISTING_CHECK" ? value.expectedVersionId : value.versionId;
    if (versionId === null) {
      const job = await admin.from("ap_material_draft_jobs").select("id,active_version_id,state").eq("id", jobId.data).abortSignal(signal).maybeSingle();
      if (job.error) throw new Error("JOB_UNCONFIRMED");
      if (!job.data || job.data.id !== jobId.data || job.data.active_version_id !== null || !["EVIDENCE_PENDING", "PREPARING", "OWNER_EXCEPTION"].includes(job.data.state)) {
        return response({ error: "Refresh this job before recording its initial listing check." }, 409);
      }
    } else {
      const version = await admin.from("ap_material_draft_versions").select("id,job_id").eq("id", versionId).eq("job_id", jobId.data).abortSignal(signal).maybeSingle();
      if (version.error) throw new Error("VERSION_UNCONFIRMED");
      if (!version.data || version.data.id !== versionId || version.data.job_id !== jobId.data) return response({ error: "This document version is unavailable for the selected job." }, 409);
    }
    switch (value.action) {
      case "PROMOTE_SOURCE": {
        const result = await createDraftOwnerServer(admin, auth.user.id).promoteSource({ jobId: jobId.data,
          expectedVersionId: value.expectedVersionId, expectedSourceSha256: value.expectedSourceSha256,
          ...(value.careerBreakFactId ? { careerBreakFactId: value.careerBreakFactId } : {}) }, signal);
        return response({ action: value.action, result });
      }
      case "REVIEW_WORDING": {
        const result = await createDraftOwnerServer(admin, auth.user.id).recordWordingReview({ jobId: jobId.data, request: value.review }, signal);
        return response({ action: value.action, result });
      }
      case "LISTING_CHECK": {
        //092 permits actual NULL only for the first BEFORE_GENERATION check.
        //The generated CLI argument type omits SQL parameter nullability.
        const expectedVersionId = value.expectedVersionId as Database["public"]["Functions"]["ap_record_material_draft_listing_check"]["Args"]["p_expected_version_id"];
        const result = await admin.rpc("ap_record_material_draft_listing_check", { p_job_id: jobId.data, p_expected_version_id: expectedVersionId,
          p_check_id: value.checkId, p_phase: value.phase, p_result: value.result, p_evidence_sha256: value.evidenceSha256, p_reviewer_id: auth.user.id }).abortSignal(signal);
        if (result.error || result.data !== value.checkId) throw new Error("CHECK_UNCONFIRMED");
        return response({ action: value.action, checkId: result.data });
      }
      case "APPROVE_PAIR": {
        const result = await admin.rpc("ap_approve_material_draft_pair", { p_version_id: value.versionId, p_packet_sha256: value.packetSha256,
          p_source_sha256: value.sourceSha256, p_member_set_sha256: value.memberSetSha256, p_checklist: value.checklist,
          p_attestation: value.attestation, p_reviewer_id: auth.user.id }).abortSignal(signal);
        if (result.error || !hash.safeParse(result.data).success) throw new Error("APPROVAL_UNCONFIRMED");
        return response({ action: value.action, approvalSha256: result.data, sent: false });
      }
      case "SEND_PAIR": {
        // The client retains these IDs across lost responses. Never generate a
        // different send identity or automatically retry an ambiguous result.
        const result = await admin.rpc("ap_send_material_draft_pair", { p_version_id: value.versionId, p_packet_sha256: value.packetSha256,
          p_source_sha256: value.sourceSha256, p_member_set_sha256: value.memberSetSha256, p_approval_sha256: value.approvalSha256,
          p_release_id: value.releaseId, p_outbox_id: value.outboxId, p_rationale: value.rationale, p_reviewer_id: auth.user.id }).abortSignal(signal);
        if (result.error || result.data !== value.releaseId) throw new Error("SEND_UNCONFIRMED");
        return response({ action: value.action, releaseId: result.data });
      }
    }
  } catch {
    return response({ error: "The action could not be confirmed. Refresh the document workspace before continuing; keep the same pending action when checking an uncertain result." }, 409);
  }
}
