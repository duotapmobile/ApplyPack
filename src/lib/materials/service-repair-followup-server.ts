import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { deterministicUuid } from "@/lib/commerce/server";
import { ServiceErrorContractError, resolveServiceErrorContract, serviceErrorSha256 } from "./service-error-contract";
import { boundedServiceErrorIo, readServiceErrorPayload, storeServiceErrorPayload } from "./service-error-payload";
import { REPAIR_CASE_EVENT_PURPOSE, REPAIR_FEEDBACK_PURPOSE, repairCaseReviewSchema, repairCaseStateBody, repairCaseStateRequestSchema,
  repairCaseStateReceiptSchema, repairFeedbackBody, repairFeedbackContextSchema, repairFeedbackFileSchema, repairFeedbackRequestSchema,
  repairFeedbackReceiptSchema, repairFollowupCanonicalJson, repairFollowupMemberSchema } from "./service-repair-followup";

type Admin = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const feedbackRowSchema = z.object({ id: uuid, case_id: uuid, customer_id: uuid, material_line_id: uuid, repair_release_id: uuid,
  sensitive_payload_id: uuid, content_sha256: hash, members: z.array(repairFollowupMemberSchema).min(1).max(3), created_at: time }).strict();
const eventRowSchema = z.object({ id: uuid, case_id: uuid, customer_id: uuid, material_line_id: uuid, kind: z.enum(["RESOLVED", "REOPENED"]),
  accepted_scope_sha256: hash, sensitive_payload_id: uuid, content_sha256: hash, reviewer_id: uuid, created_at: time }).strict();
const feedbackColumns = "id,case_id,customer_id,material_line_id,repair_release_id,sensitive_payload_id,content_sha256,members,created_at";
const eventColumns = "id,case_id,customer_id,material_line_id,kind,accepted_scope_sha256,sensitive_payload_id,content_sha256,reviewer_id,created_at";
function ensure(value: unknown, code = "FOLLOWUP_UNAVAILABLE"): asserts value { if (!value) throw new ServiceErrorContractError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code = "FOLLOWUP_UNAVAILABLE"): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}
async function data<T>(query: PromiseLike<{ data: T; error: unknown }>, signal: AbortSignal): Promise<T> {
  ensure(!signal.aborted, "ABORTED"); const result = await query; ensure(!signal.aborted, "ABORTED"); ensure(!result.error); return result.data;
}
const same = (a: unknown, b: unknown) => repairFollowupCanonicalJson(a) === repairFollowupCanonicalJson(b);
function feedbackReceipt(row: z.infer<typeof feedbackRowSchema>) {
  return repairFeedbackReceiptSchema.parse({ requestId: row.id, caseId: row.case_id, materialLineId: row.material_line_id,
    releaseId: row.repair_release_id, contentSha256: row.content_sha256, members: row.members, createdAt: row.created_at });
}
function eventReceipt(row: z.infer<typeof eventRowSchema>) {
  return repairCaseStateReceiptSchema.parse({ requestId: row.id, caseId: row.case_id, materialLineId: row.material_line_id,
    action: row.kind, acceptedScopeSha256: row.accepted_scope_sha256, contentSha256: row.content_sha256, reviewerId: row.reviewer_id, createdAt: row.created_at });
}

async function contract(admin: Admin, customerId: string, lineId: string, signal: AbortSignal) {
  const line = await data(admin.from("ap_material_lines").select("id,purchase_id").eq("id", lineId).abortSignal(signal).single(), signal);
  ensure(line?.id === lineId);
  const purchase = await data(admin.from("ap_material_purchases").select("id,customer_id,checkout_intent_id")
    .eq("id", line.purchase_id).eq("customer_id", customerId).abortSignal(signal).single(), signal);
  ensure(purchase?.id === line.purchase_id && purchase.customer_id === customerId && purchase.checkout_intent_id, "HISTORICAL_FLOW_REQUIRED");
  const intent = await data(admin.from("ap_material_checkout_intents").select("id,customer_id,purchase_id,source_snapshot_id")
    .eq("id", purchase.checkout_intent_id).abortSignal(signal).single(), signal);
  ensure(intent?.id === purchase.checkout_intent_id && intent.customer_id === customerId && intent.purchase_id === purchase.id);
  const acceptance = await data(admin.from("ap_snapshot_legal_acceptances").select("terms_version,privacy_version")
    .eq("snapshot_id", intent.source_snapshot_id).abortSignal(signal).single(), signal);
  const saved = await data(admin.from("ap_service_error_contracts").select("*").eq("material_line_id", lineId).abortSignal(signal).single(), signal);
  ensure(saved && acceptance, "HISTORICAL_FLOW_REQUIRED");
  ensure(resolveServiceErrorContract({ materialLineId: lineId, customerId, purchaseId: purchase.id, sourceSnapshotId: intent.source_snapshot_id,
    acceptedTermsVersion: acceptance.terms_version, acceptedPrivacyVersion: acceptance.privacy_version, contract: {
      materialLineId: saved.material_line_id, customerId: saved.customer_id, purchaseId: saved.purchase_id, sourceSnapshotId: saved.source_snapshot_id,
      legalReceiptId: saved.legal_receipt_id, intakeReviewId: saved.intake_review_id, intakeReviewSha256: saved.intake_review_sha256,
      contractVersion: saved.contract_version, termsVersion: saved.terms_version, termsContentSha256: saved.terms_content_sha256,
      privacyVersion: saved.privacy_version, privacyContentSha256: saved.privacy_content_sha256, confirmedIntakeVersion: saved.confirmed_intake_version,
      reportingTimeZone: saved.reporting_time_zone, boundAt: saved.bound_at,
    } }).kind === "SERVICE_ERROR_ONLY", "HISTORICAL_FLOW_REQUIRED");
}

/** Authenticated customer supplied by the server. Construction has no I/O. */
export function createCustomerRepairFollowups(admin: Admin, trustedCustomerId: string, now = () => new Date()) {
  const customerId = uuid.parse(trustedCustomerId);
  const readReceipt = async (lineId: string, requestId: string, signal: AbortSignal) => {
    const value = await data(admin.from("ap_service_repair_feedback").select(feedbackColumns).eq("id", requestId)
      .eq("customer_id", customerId).eq("material_line_id", lineId).abortSignal(signal).maybeSingle(), signal);
    if (value === null) return null;
    const row = parse(feedbackRowSchema, value); ensure(row.id === requestId && row.customer_id === customerId && row.material_line_id === lineId); return row;
  };
  const context = async (lineId: string, signal: AbortSignal) => {
    await contract(admin, customerId, lineId, signal);
    const list = async () => parse(z.array(repairFeedbackFileSchema.omit({ caseId: true })).max(300),
      await data(admin.rpc("ap_customer_service_repair_files", { p_customer_id: customerId, p_material_line_id: lineId }).abortSignal(signal), signal));
    const files = await list(), result = [];
    ensure(new Set(files.map((f) => f.fileVersionId)).size === files.length && new Set(files.map((f) => f.originalFileVersionId)).size === files.length);
    for (const file of files) {
      const release = await data(admin.from("ap_service_repair_releases").select("id,case_id,customer_id,material_line_id,repair_version_id,committed_at,access_expires_at")
        .eq("id", file.releaseId).eq("customer_id", customerId).eq("material_line_id", lineId).abortSignal(signal).single(), signal);
      ensure(release && release.id === file.releaseId && release.customer_id === customerId && release.material_line_id === lineId
        && Date.parse(release.committed_at) === Date.parse(file.deliveredAt) && Date.parse(release.access_expires_at) === Date.parse(file.accessExpiresAt));
      const row = await data(admin.from("ap_service_repair_files").select("id,repair_version_id,customer_id,material_line_id,artifact_id,original_file_version_id,artifact_type,checksum_sha256")
        .eq("id", file.fileVersionId).eq("customer_id", customerId).eq("material_line_id", lineId).abortSignal(signal).single(), signal);
      ensure(row && row.id === file.fileVersionId && row.repair_version_id === release.repair_version_id && row.customer_id === customerId
        && row.material_line_id === lineId && row.artifact_id === file.artifactId && row.original_file_version_id === file.originalFileVersionId
        && row.artifact_type === file.artifactType && row.checksum_sha256 === file.checksumSha256);
      const original = await data(admin.from("ap_generated_file_versions").select("id,artifact_id,version,superseded_at")
        .eq("id", file.originalFileVersionId).eq("artifact_id", file.artifactId).abortSignal(signal).single(), signal);
      const artifact = await data(admin.from("ap_generated_artifacts").select("id,customer_id,material_line_id,artifact_type,current_file_version")
        .eq("id", file.artifactId).eq("customer_id", customerId).eq("material_line_id", lineId).abortSignal(signal).single(), signal);
      ensure(original?.id === file.originalFileVersionId && original.artifact_id === file.artifactId && artifact?.id === file.artifactId
        && artifact.customer_id === customerId && artifact.material_line_id === lineId && artifact.artifact_type === file.artifactType);
      // Keep feedback aligned with the portal's actual replacement. A later
      // ordinary file version can supersede this historical repair lineage.
      if (original.superseded_at && original.version < artifact.current_file_version) continue;
      ensure(!original.superseded_at && original.version === artifact.current_file_version);
      const report = await data(admin.from("ap_service_error_reports").select("id,customer_id").eq("id", release.case_id).eq("customer_id", customerId).abortSignal(signal).single(), signal);
      ensure(report?.id === release.case_id && report.customer_id === customerId);
      if (Date.parse(file.deliveredAt) <= now().getTime() && Date.parse(file.accessExpiresAt) > now().getTime()) result.push({ ...file, caseId: release.case_id });
    }
    ensure(same(await list(), files), "CASE_CHANGED");
    return repairFeedbackContextSchema.parse({ materialLineId: lineId, files: result });
  };
  return {
    context: (lineId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, (child) => context(uuid.parse(lineId), child)),
    receipt: (lineId: string, requestId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      const row = await readReceipt(uuid.parse(lineId), uuid.parse(requestId), child); return row && feedbackReceipt(row);
    }),
    report: (raw: unknown, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      const input = parse(repairFeedbackRequestSchema, raw), bytes = Buffer.from(repairFollowupCanonicalJson(repairFeedbackBody(input)), "utf8");
      const sha256 = serviceErrorSha256(bytes), payloadId = deterministicUuid(`applypack:service-repair-feedback-v1:${customerId}:${input.requestId}`);
      const members = input.items.map(({ artifactId, fileVersionId }) => ({ artifactId, fileVersionId }));
      const match = (row: z.infer<typeof feedbackRowSchema>) => {
        ensure(row.case_id === input.caseId && row.repair_release_id === input.releaseId && row.sensitive_payload_id === payloadId
          && row.content_sha256 === sha256 && same(row.members, members), "FOLLOWUP_IDENTITY_CONFLICT"); return feedbackReceipt(row);
      };
      try {
        const prior = await readReceipt(input.materialLineId, input.requestId, child);
        if (prior) return { status: "RECORDED" as const, receipt: match(prior), replayed: true };
        const current = await context(input.materialLineId, child);
        ensure(members.every((member) => current.files.some((file) => file.caseId === input.caseId && file.releaseId === input.releaseId
          && file.artifactId === member.artifactId && file.fileVersionId === member.fileVersionId)), "DELIVERY_MISMATCH");
        const stored = await storeServiceErrorPayload(admin, { customerId, materialLineId: input.materialLineId, requestId: input.requestId,
          payloadId, purpose: REPAIR_FEEDBACK_PURPOSE, sha256 }, bytes, { signal: child });
        ensure(!child.aborted && stored.payloadId === payloadId && stored.sha256 === sha256, "FOLLOWUP_RESULT_UNKNOWN");
        // The atomic099 RPC rechecks current release, ownership and retention.
        // A lost acknowledgement is followed by one exact read, never a retry.
        try { await admin.rpc("ap_record_service_repair_feedback", { p_customer_id: customerId, p_case_id: input.caseId, p_request_id: input.requestId,
          p_release_id: input.releaseId, p_payload_id: payloadId, p_content_sha256: sha256, p_members: members }).abortSignal(child); } catch { /* Read below. */ }
        ensure(!child.aborted, "FOLLOWUP_RESULT_UNKNOWN");
        const saved = await readReceipt(input.materialLineId, input.requestId, child); ensure(saved, "FOLLOWUP_RESULT_UNKNOWN");
        return { status: "RECORDED" as const, receipt: match(saved), replayed: false };
      } finally { bytes.fill(0); }
    }),
  };
}

/** Exact102 port: connect using genuine generated declarations after the
 * forward migration passes CI. There is intentionally no legacy setter fallback. */
export type RepairCaseStatePort = {
  review(caseId: string, reviewerId: string, signal: AbortSignal): Promise<unknown>;
  set(input: { caseId: string; requestId: string; scopeSha256: string; expectedReviewContextSha256: string; resolved: boolean;
    payloadId: string; contentSha256: string; reviewerId: string }, signal: AbortSignal): Promise<Result>;
};
export function createOwnerRepairFollowups(admin: Admin, trustedReviewerId: string, port: RepairCaseStatePort) {
  const reviewerId = uuid.parse(trustedReviewerId);
  const authorized = async (signal: AbortSignal) => parse(z.literal(true),
    await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal), "REVIEWER_UNCONFIRMED");
  const review = async (caseId: string, signal: AbortSignal) => {
    const value = parse(repairCaseReviewSchema.omit({ feedback: true, events: true }).extend({
      feedback: z.array(feedbackRowSchema).max(3000), events: z.array(eventRowSchema).max(3000) }).strict(), await port.review(caseId, reviewerId, signal));
    ensure(value.caseId === caseId && value.feedback.every((f) => f.case_id === caseId && f.customer_id === value.customerId)
      && value.events.every((e) => e.case_id === caseId && e.customer_id === value.customerId));
    return value;
  };
  const event = async (caseId: string, requestId: string, signal: AbortSignal) => {
    const value = await data(admin.from("ap_service_repair_case_events").select(eventColumns).eq("id", requestId).eq("case_id", caseId).abortSignal(signal).maybeSingle(), signal);
    if (value === null) return null; const row = parse(eventRowSchema, value); ensure(row.id === requestId && row.case_id === caseId); return row;
  };
  return {
    review: (caseId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      await authorized(child); const current = await review(uuid.parse(caseId), child); await authorized(child);
      return repairCaseReviewSchema.parse({ ...current, feedback: current.feedback.map(feedbackReceipt), events: current.events.map(eventReceipt) });
    }),
    receipt: (caseId: string, requestId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      await authorized(child); const row = await event(uuid.parse(caseId), uuid.parse(requestId), child); await authorized(child); return row && eventReceipt(row);
    }),
    feedback: (caseId: string, requestId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      await authorized(child); const current = await review(uuid.parse(caseId), child), row = current.feedback.find((f) => f.id === uuid.parse(requestId)); ensure(row);
      let bytes: Buffer | undefined;
      try {
        bytes = await readServiceErrorPayload(admin, { customerId: current.customerId, materialLineId: row.material_line_id,
          requestId: row.id, payloadId: row.sensitive_payload_id, purpose: REPAIR_FEEDBACK_PURPOSE, sha256: row.content_sha256 }, { signal: child });
        const parsed = parse(repairFeedbackRequestSchema.safeExtend({ schemaVersion: z.literal("applypack-service-repair-feedback-v1") }).strict(),
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
        const request = repairFeedbackRequestSchema.parse(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "schemaVersion")));
        ensure(repairFollowupCanonicalJson(repairFeedbackBody(request)) === bytes.toString("utf8") && request.requestId === row.id
          && request.caseId === caseId && request.materialLineId === row.material_line_id && request.releaseId === row.repair_release_id
          && same(request.items.map(({ artifactId, fileVersionId }) => ({ artifactId, fileVersionId })), row.members));
        const again = await review(caseId, child); ensure(again.reviewContextSha256 === current.reviewContextSha256, "CASE_CHANGED");
        await authorized(child); return { receipt: feedbackReceipt(row), request };
      } finally { bytes?.fill(0); }
    }),
    set: (raw: unknown, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      await authorized(child); const request = parse(repairCaseStateRequestSchema, raw);
      const bytes = Buffer.from(repairFollowupCanonicalJson(repairCaseStateBody(request)), "utf8"), sha256 = serviceErrorSha256(bytes);
      const payloadId = deterministicUuid(`applypack:service-repair-case-event-v1:${reviewerId}:${request.requestId}`);
      const match = (row: z.infer<typeof eventRowSchema>) => {
        ensure(row.kind === request.action && row.accepted_scope_sha256 === request.acceptedScopeSha256 && row.sensitive_payload_id === payloadId
          && row.content_sha256 === sha256 && row.reviewer_id === reviewerId, "FOLLOWUP_IDENTITY_CONFLICT"); return eventReceipt(row);
      };
      try {
        const prior = await event(request.caseId, request.requestId, child);
        if (prior) { await authorized(child); return { status: "RECORDED" as const, receipt: match(prior), replayed: true }; }
        const current = await review(request.caseId, child);
        ensure(current.reviewContextSha256 === request.expectedReviewContextSha256 && current.acceptedScopeSha256 === request.acceptedScopeSha256, "CASE_CHANGED");
        ensure(request.action !== "RESOLVED" || current.canResolve, "ACCEPTED_REPAIR_UNFINISHED");
        const stored = await storeServiceErrorPayload(admin, { customerId: current.customerId, materialLineId: current.materialLineId,
          requestId: request.requestId, payloadId, purpose: REPAIR_CASE_EVENT_PURPOSE, sha256 }, bytes, { signal: child });
        ensure(!child.aborted && stored.payloadId === payloadId && stored.sha256 === sha256, "FOLLOWUP_RESULT_UNKNOWN");
        let outcome: Result | undefined;
        try { outcome = await port.set({ caseId: request.caseId, requestId: request.requestId, scopeSha256: request.acceptedScopeSha256,
          expectedReviewContextSha256: request.expectedReviewContextSha256, resolved: request.action === "RESOLVED", payloadId, contentSha256: sha256, reviewerId }, child); }
        catch { /* Exact immutable readback below; never repeat the mutation. */ }
        ensure(!child.aborted, "FOLLOWUP_RESULT_UNKNOWN");
        const saved = await event(request.caseId, request.requestId, child); await authorized(child);
        if (!saved && z.object({ message: z.literal("service_repair_case_review_changed") }).safeParse(outcome?.error).success)
          throw new ServiceErrorContractError("CASE_CHANGED");
        ensure(saved, "FOLLOWUP_RESULT_UNKNOWN"); return { status: "RECORDED" as const, receipt: match(saved), replayed: false };
      } finally { bytes.fill(0); }
    }),
  };
}
