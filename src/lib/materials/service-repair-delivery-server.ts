import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { boundedServiceErrorIo } from "./service-error-payload";
import { serviceErrorCanonicalJson } from "./service-error-contract";
import { serviceRepairVersionSchema, validateServiceRepairInspection, type ServiceRepairVersion } from "./service-repair-workflow";
import { repairDeliveryActionSchema, repairDeliveryExpectedSchema, repairDeliveryIdentitySchema, repairDeliveryMemberSchema,
  repairDeliverySummarySchema, repairReviewChecklistSchema, type RepairDeliveryAction, type RepairDeliveryExpected, type RepairDeliveryResult } from "./service-repair-delivery-client";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const fileColumns = "id,repair_version_id,customer_id,material_line_id,artifact_id,original_file_version_id,source_snapshot_id,artifact_type,storage_bucket,storage_path,safe_filename,checksum_sha256,render_source_sha256,preview_bucket,preview_path,preview_sha256,editable_bucket,editable_path,editable_sha256";
const fileSchema = z.object({ id: uuid, repair_version_id: uuid, customer_id: uuid, material_line_id: uuid, artifact_id: uuid,
  original_file_version_id: uuid, source_snapshot_id: uuid, artifact_type: repairDeliveryMemberSchema.shape.artifactType,
  storage_bucket: z.literal("customer-deliveries"), storage_path: z.string().min(1).max(1024), safe_filename: z.string().min(1).max(180),
  checksum_sha256: hash, render_source_sha256: hash, preview_bucket: z.literal("operator-render-previews"), preview_path: z.string().min(1).max(1024),
  preview_sha256: hash, editable_bucket: z.literal("operator-drafts"), editable_path: z.string().min(1).max(1024), editable_sha256: hash }).strict();
const releaseColumns = "id,repair_version_id,case_id,customer_id,material_line_id,outbox_id,accepted_scope_sha256,member_set_sha256,approval_sha256,approved_by";
const releaseSchema = z.object({ id: uuid, repair_version_id: uuid, case_id: uuid, customer_id: uuid, material_line_id: uuid,
  outbox_id: uuid, accepted_scope_sha256: hash, member_set_sha256: hash, approval_sha256: hash, approved_by: uuid }).strict();
const equal = (a: unknown, b: unknown) => serviceErrorCanonicalJson(a) === serviceErrorCanonicalJson(b);
export class ServiceRepairDeliveryError extends Error {
  constructor(readonly code: "CHANGED" | "NOT_READY" | "UNCONFIRMED" | "INVALID") { super(`SERVICE_REPAIR_DELIVERY_${code}`); }
}
function ensure(value: unknown, code: ServiceRepairDeliveryError["code"] = "UNCONFIRMED"): asserts value { if (!value) throw new ServiceRepairDeliveryError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: ServiceRepairDeliveryError["code"] = "UNCONFIRMED"): T {
  const result = schema.safeParse(raw); ensure(result.success, code); return result.data;
}
type Identity = z.infer<typeof repairDeliveryIdentitySchema>;
function member(file: z.infer<typeof fileSchema>) { return { fileVersionId: file.id, originalFileVersionId: file.original_file_version_id,
  artifactId: file.artifact_id, artifactType: file.artifact_type, checksumSha256: file.checksum_sha256,
  renderSourceSha256: file.render_source_sha256, previewSha256: file.preview_sha256, editableSha256: file.editable_sha256 }; }
function binding(version: ServiceRepairVersion, files: z.infer<typeof fileSchema>[]): RepairDeliveryExpected {
  return parse(repairDeliveryExpectedSchema, { caseId: version.case_id, materialLineId: version.material_line_id,
    versionId: version.id, sourceSha256: version.source_sha256, acceptedScopeSha256: version.accepted_scope_sha256,
    contextSha256: version.context_sha256, memberSetSha256: version.member_set_sha256, members: files.map(member) });
}

/** Fresh owner MFA is enforced by the HTTP caller. This adapter never approves
 * while loading, never sends while approving, and reconciles uncertain replies
 * by immutable identities without repeating a mutation. */
export function createServiceRepairDelivery(admin: SupabaseClient<Database>, trustedReviewerId: string) {
  const reviewerId = parse(uuid, trustedReviewerId, "INVALID");
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted); const result = await query; ensure(!signal.aborted && !result.error); return result.data;
  }
  async function run<T>(external: AbortSignal, work: (signal: AbortSignal) => Promise<T>) {
    try { return await boundedServiceErrorIo(external, async signal => {
      parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal));
      return work(signal);
    }, 20_000); } catch (error) { if (error instanceof ServiceRepairDeliveryError) throw error; throw new ServiceRepairDeliveryError("UNCONFIRMED"); }
  }
  async function version(id: string, identity: Identity, signal: AbortSignal) {
    const value = parse(serviceRepairVersionSchema, await data(admin.from("ap_service_repair_versions").select("*").eq("id", id).abortSignal(signal).single(), signal));
    ensure(value.case_id === identity.caseId && value.material_line_id === identity.materialLineId, "CHANGED"); return value;
  }
  async function files(value: ServiceRepairVersion, signal: AbortSignal) {
    const rows = parse(z.array(fileSchema).max(3), await data(admin.from("ap_service_repair_files").select(fileColumns)
      .eq("repair_version_id", value.id).order("original_file_version_id").limit(4).abortSignal(signal), signal));
    const prefix = `${value.customer_id}/materials/${value.material_line_id}/repairs/${value.id}/`;
    ensure(new Set(rows.map(row => row.id)).size === rows.length && new Set(rows.map(row => row.original_file_version_id)).size === rows.length, "CHANGED");
    for (const row of rows) ensure(row.repair_version_id === value.id && row.customer_id === value.customer_id && row.material_line_id === value.material_line_id
      && value.originals.some(original => original.fileVersionId === row.original_file_version_id && original.artifactId === row.artifact_id
        && original.sourceSnapshotId === row.source_snapshot_id && original.artifactType === row.artifact_type)
      && [row.storage_path, row.preview_path, row.editable_path].every(path => path.startsWith(prefix) && !/[\\%?#\u0000-\u001f\u007f]/u.test(path)
        && path.split("/").every(part => part !== "" && part !== "." && part !== "..")), "CHANGED");
    return rows;
  }
  async function load(identity: Identity, signal: AbortSignal) {
    const scoped = { caseId: identity.caseId, materialLineId: identity.materialLineId };
    const inspect = async () => validateServiceRepairInspection(await data(admin.rpc("ap_inspect_service_repair", {
      p_case_id: scoped.caseId, p_material_line_id: scoped.materialLineId, p_reviewer_id: reviewerId }).abortSignal(signal), signal), scoped);
    const before = await inspect(), current = before.version;
    const members = current ? await files(current, signal) : [];
    const after = await inspect(); ensure(equal(before, after), "CHANGED");
    return { inspection: after, version: current, files: members };
  }
  function current(value: Awaited<ReturnType<typeof load>>, expected: RepairDeliveryExpected) {
    const v = value.version; ensure(v && !v.invalidated_at && !v.release_id && v.claim_review_sha256 && v.claims_reviewed_at
      && v.source_sha256 && v.member_set_sha256 && value.files.length === v.originals.length, "NOT_READY");
    ensure(v.context_sha256 === value.inspection.contextSha256 && v.accepted_scope_sha256 === value.inspection.scope.acceptedScopeSha256
      && equal(binding(v, value.files), expected), "CHANGED"); return v;
  }
  async function recorded(request: RepairDeliveryAction, signal: AbortSignal): Promise<RepairDeliveryResult> {
    const expected = request.expected, v = await version(expected.versionId, expected, signal);
    ensure(equal(binding(v, await files(v, signal)), expected), "CHANGED");
    const present = request.action === "APPROVE" ? Boolean(v.approval_sha256) : Boolean(v.release_id);
    if (!present) return { status: "ABSENT", action: request.action, expected, approvalSha256: null, releaseId: null, outboxId: null };
    ensure(v.approved_by === reviewerId && v.approved_at, "CHANGED");
    if (request.action === "APPROVE") {
      ensure(equal(parse(repairReviewChecklistSchema, v.review_checklist), request.checklist), "CHANGED");
      return { status: "RECORDED", action: "APPROVE", expected, approvalSha256: v.approval_sha256, releaseId: null, outboxId: null };
    }
    ensure(v.release_id === request.releaseId && v.approval_sha256 === request.approvalSha256, "CHANGED");
    const release = parse(releaseSchema, await data(admin.from("ap_service_repair_releases").select(releaseColumns)
      .eq("id", request.releaseId).abortSignal(signal).single(), signal));
    ensure(release.id === request.releaseId && release.repair_version_id === v.id && release.case_id === v.case_id
      && release.customer_id === v.customer_id && release.material_line_id === v.material_line_id && release.outbox_id === request.outboxId
      && release.accepted_scope_sha256 === expected.acceptedScopeSha256 && release.member_set_sha256 === expected.memberSetSha256
      && release.approval_sha256 === request.approvalSha256 && release.approved_by === reviewerId, "CHANGED");
    return { status: "RECORDED", action: "SEND", expected, approvalSha256: release.approval_sha256, releaseId: release.id, outboxId: release.outbox_id };
  }
  return {
    inspect: (raw: unknown, signal: AbortSignal) => run(signal, async inner => {
      const identity = parse(repairDeliveryIdentitySchema, raw, "INVALID"), loaded = await load(identity, inner), v = loaded.version;
      const stale = Boolean(v && (v.invalidated_at || v.context_sha256 !== loaded.inspection.contextSha256 || v.accepted_scope_sha256 !== loaded.inspection.scope.acceptedScopeSha256));
      const ready = Boolean(v?.source_sha256 && v.member_set_sha256 && v.claim_review_sha256 && v.claims_reviewed_at && loaded.files.length === v.originals.length);
      const expected = v && ready ? binding(v, loaded.files) : null;
      return parse(repairDeliverySummarySchema, { ...identity, state: v?.release_id ? "SENT" : stale ? "STALE" : !ready ? "NOT_READY" : v?.approval_sha256 ? "APPROVED" : "REVIEW_REQUIRED",
        expected, approvalSha256: v?.approval_sha256 ?? null, canSend: Boolean(ready && !stale && !v?.release_id && v?.approval_sha256 && v.approved_by === reviewerId),
        releaseId: v?.release_id ?? null, files: expected ? loaded.files.map(file => ({ fileVersionId: file.id, originalFileVersionId: file.original_file_version_id,
          artifactType: file.artifact_type, filename: file.safe_filename,
          previewUrl: `/api/admin/service-errors/${identity.caseId}/repairs/${identity.materialLineId}/delivery?versionId=${v!.id}&previewFileId=${file.id}` })) : [] });
    }),
    act: (raw: unknown, checkOnly: boolean, signal: AbortSignal) => run(signal, async inner => {
      const request = parse(repairDeliveryActionSchema, raw, "INVALID"), prior = await recorded(request, inner);
      if (checkOnly || prior.status === "RECORDED") return prior;
      const loaded = await load(request.expected, inner), v = current(loaded, request.expected);
      if (request.action === "SEND") ensure(v.approved_by === reviewerId && v.approval_sha256 === request.approvalSha256, "CHANGED");
      let returned: unknown;
      try {
        if (request.action === "APPROVE") returned = await data(admin.rpc("ap_approve_service_repair", { p_version_id: v.id,
          p_source_sha256: request.expected.sourceSha256, p_member_set_sha256: request.expected.memberSetSha256,
          p_checklist: request.checklist, p_reviewer_id: reviewerId }).abortSignal(inner), inner);
        else {
          returned = await data(admin.rpc("ap_send_service_repair", { p_version_id: v.id, p_source_sha256: request.expected.sourceSha256,
            p_member_set_sha256: request.expected.memberSetSha256, p_approval_sha256: request.approvalSha256,
            p_release_id: request.releaseId, p_outbox_id: request.outboxId, p_reviewer_id: reviewerId }).abortSignal(inner), inner);
        }
      } catch { /* One readback may resolve a committed operation; never retry. */ }
      ensure(!inner.aborted); const result = await recorded(request, inner);
      ensure(result.status === "RECORDED" && (returned === undefined || returned === (request.action === "APPROVE" ? result.approvalSha256 : result.releaseId)));
      return result;
    }),
    preview: (raw: unknown, signal: AbortSignal) => run(signal, async inner => {
      const input = parse(repairDeliveryIdentitySchema.extend({ versionId: uuid, fileVersionId: uuid }).strict(), raw, "INVALID");
      const loaded = await load(input, inner), v = loaded.version;
      ensure(v?.id === input.versionId && !v.invalidated_at && v.context_sha256 === loaded.inspection.contextSha256
        && v.accepted_scope_sha256 === loaded.inspection.scope.acceptedScopeSha256, "CHANGED");
      const file = loaded.files.find(item => item.id === input.fileVersionId); ensure(file, "CHANGED");
      const signed = await admin.storage.from("operator-render-previews").createSignedUrl(file.preview_path, 60, { download: false });
      ensure(!inner.aborted && !signed.error && signed.data?.signedUrl);
      const after = await load(input, inner); ensure(equal(loaded, after), "CHANGED");
      const url = parse(z.url().startsWith("https://"), signed.data.signedUrl); return url;
    }),
  };
}
