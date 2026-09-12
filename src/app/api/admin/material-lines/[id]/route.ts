import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

const uuid = z.uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("LISTING_CHECK"), phase: z.enum(["BEFORE_GENERATION", "BEFORE_RELEASE"]), result: z.enum(["ACTIVE", "CLOSED", "INSTRUCTION_BLOCKED"]), submissionRuleId: uuid, evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  z.object({ action: z.literal("APPROVE"), fileVersionId: uuid, approvalKind: z.enum(["CONTENT", "VISUAL"]), attestation: z.string().trim().min(20).max(2_000) }).strict(),
  z.object({ action: z.literal("RELEASE"), rationale: z.string().trim().min(20).max(2_000) }).strict(),
  z.object({ action: z.literal("OFFER_SUBSTITUTION"), targetMatchId: uuid, targetRuleId: uuid, reasonCode: z.string().trim().min(3).max(100), proposalExpiresAt: z.iso.datetime(), estimateSeconds: z.number().int().min(60).max(86_400), idempotencyKey: uuid }).strict(),
  z.object({ action: z.literal("PROPOSE_FACT_CORRECTION"), correctedSnapshotId: uuid, factDiff: z.record(z.string(), z.unknown()), eligibilityPassed: z.boolean(), evidenceSufficient: z.boolean(), reasonCode: z.string().trim().min(3).max(100), proposalExpiresAt: z.iso.datetime(), estimateSeconds: z.number().int().min(60).max(86_400), idempotencyKey: uuid }).strict(),
  z.object({ action: z.literal("AMEND_REFERENCE_SCOPE"), includeReferenceSheet: z.boolean(), referencePermissionIds: z.array(uuid).max(3), idempotencyKey: uuid }).strict(),
  z.object({ action: z.literal("REFUND_LINE"), reasonCode: z.string().trim().min(3).max(100) }).strict(),
  z.object({ action: z.literal("COMMIT_REFERENCE_REGENERATION"), regenerationId: uuid }).strict(),
]);

function response(body: unknown, status = 200) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Referrer-Policy", "no-referrer");
  return result;
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This staff action was rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const lineId = uuid.safeParse((await route.params).id);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!lineId.success || !input.success) return response({ error: "The material-line action is incomplete." }, 400);
  const { data: line } = await auth.admin.from("ap_material_lines").select("id,purchase_id").eq("id", lineId.data).maybeSingle();
  if (!line) return response({ error: "Materials line not found." }, 404);
  try {
    switch (input.data.action) {
      case "LISTING_CHECK": {
        const result = await auth.admin.rpc("ap_record_material_listing_check", {
          p_material_line_id: line.id,
          p_reviewer_id: auth.user.id,
          p_phase: input.data.phase,
          p_result: input.data.result,
          p_submission_rule_id: input.data.submissionRuleId,
          p_evidence_sha256: input.data.evidenceSha256,
        });
        if (result.error || typeof result.data !== "string") throw result.error || new Error("listing_check_failed");
        return response({ action: input.data.action, checkId: result.data });
      }
      case "APPROVE": {
        const result = await auth.admin.rpc("ap_record_material_human_approval", {
          p_file_version_id: input.data.fileVersionId,
          p_reviewer_id: auth.user.id,
          p_approval_kind: input.data.approvalKind,
          p_attestation: input.data.attestation,
        });
        if (result.error || !result.data) throw result.error || new Error("approval_failed");
        return response({ action: input.data.action, result: result.data });
      }
      case "RELEASE": {
        const result = await auth.admin.rpc("ap_commit_material_release_v2", {
          p_material_line_id: line.id,
          p_reviewer_id: auth.user.id,
          p_release_id: randomUUID(),
          p_review_checklist: {
            contentReviewed: true,
            visualReviewed: true,
            listingRechecked: true,
            instructionsReparsed: true,
            linksRechecked: true,
            provenanceReviewed: true,
            secureFilesConfirmed: true,
          },
          p_reviewer_rationale: input.data.rationale,
          p_outbox_id: randomUUID(),
        });
        if (result.error || typeof result.data !== "string") throw result.error || new Error("release_failed");
        return response({ action: input.data.action, releaseId: result.data });
      }
      case "OFFER_SUBSTITUTION": {
        const result = await auth.admin.rpc("ap_offer_material_substitution", {
          p_material_line_id: line.id,
          p_reviewer_id: auth.user.id,
          p_target_match_id: input.data.targetMatchId,
          p_target_rule_id: input.data.targetRuleId,
          p_reason_code: input.data.reasonCode,
          p_proposal_expires_at: input.data.proposalExpiresAt,
          p_estimate_seconds: input.data.estimateSeconds,
          p_idempotency_key: `${line.id}:${input.data.idempotencyKey}`,
        });
        if (result.error || typeof result.data !== "string") throw result.error || new Error("substitution_failed");
        return response({ action: input.data.action, proposalId: result.data });
      }
      case "PROPOSE_FACT_CORRECTION": {
        const result = await auth.admin.rpc("ap_propose_material_fact_correction", {
          p_material_line_id: line.id,
          p_reviewer_id: auth.user.id,
          p_corrected_snapshot_id: input.data.correctedSnapshotId,
          p_fact_diff: input.data.factDiff,
          p_eligibility_passed: input.data.eligibilityPassed,
          p_evidence_sufficient: input.data.evidenceSufficient,
          p_reason_code: input.data.reasonCode,
          p_proposal_expires_at: input.data.proposalExpiresAt,
          p_estimate_seconds: input.data.estimateSeconds,
          p_idempotency_key: `${line.id}:${input.data.idempotencyKey}`,
        });
        if (result.error || typeof result.data !== "string") throw result.error || new Error("fact_correction_failed");
        return response({ action: input.data.action, proposalId: result.data });
      }
      case "AMEND_REFERENCE_SCOPE": {
        if (input.data.includeReferenceSheet !== (input.data.referencePermissionIds.length > 0)
          || new Set(input.data.referencePermissionIds).size !== input.data.referencePermissionIds.length) {
          return response({ error: "The reference scope is invalid." }, 400);
        }
        const { data: purchase } = await auth.admin.from("ap_material_purchases").select("customer_id").eq("id", line.purchase_id).maybeSingle();
        if (!purchase) throw new Error("purchase_missing");
        const result = await auth.admin.rpc("ap_amend_material_reference_scope", {
          p_material_line_id: line.id,
          p_customer_id: purchase.customer_id,
          p_include_reference_sheet: input.data.includeReferenceSheet,
          p_reference_permission_ids: input.data.referencePermissionIds,
          p_idempotency_key: `${line.id}:${input.data.idempotencyKey}`,
        });
        if (result.error || !result.data) throw result.error || new Error("reference_scope_failed");
        return response({ action: input.data.action, result: result.data });
      }
      case "REFUND_LINE": {
        const { data: purchase } = await auth.admin.from("ap_material_purchases").select("customer_id").eq("id", line.purchase_id).maybeSingle();
        if (!purchase) throw new Error("purchase_missing");
        const result = await auth.admin.rpc("ap_start_material_line_refund", {
          p_material_line_id: line.id,
          p_customer_id: purchase.customer_id,
          p_reason_code: input.data.reasonCode,
          p_require_overdue: false,
        });
        if (result.error) throw result.error;
        return response({ action: input.data.action, refundId: result.data });
      }
      case "COMMIT_REFERENCE_REGENERATION": {
        const result = await auth.admin.rpc("ap_commit_reference_regeneration", {
          p_regeneration_id: input.data.regenerationId,
          p_reviewer_id: auth.user.id,
          p_release_id: randomUUID(),
          p_outbox_id: randomUUID(),
        });
        if (result.error || typeof result.data !== "string") throw result.error || new Error("reference_release_failed");
        return response({ action: input.data.action, releaseId: result.data });
      }
    }
  } catch {
    return response({ error: "The action failed a current payment, ownership, capacity, evidence, deadline, or release guard." }, 409);
  }
}
