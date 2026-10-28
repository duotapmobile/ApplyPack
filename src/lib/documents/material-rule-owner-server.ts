import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { deterministicUuid } from "@/lib/commerce/server";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { serializeDraftingEvidencePacket } from "./drafting-evidence";
import { readEncryptedDraftPayload, storeEncryptedDraftPayload } from "./draft-packet-worker";
import { materialRuleBasisSchema, materialRuleEvidenceProjectionSchema, materialRuleReceiptSchema,
  materialRuleReviewChecklistSchema, materialRuleProjectionForPacket } from "./material-rule-evidence";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const materialRuleRevalidateRequestSchema = z.object({ jobId: uuid, expectedVersionId: uuid.nullable(), receiptId: uuid,
  expectedBasis: materialRuleBasisSchema, checklist: materialRuleReviewChecklistSchema }).strict();
export const materialRuleRefreshRequestSchema = z.object({ jobId: uuid, expectedVersionId: uuid, expectedPacketSha256: hash,
  expectedContextSha256: hash, requestId: uuid }).strict();
const inspectSchema = z.object({ jobId: uuid }).strict();
const jobColumns = "id,customer_id,material_line_id,line_revision_id,source_snapshot_id,state,active_version_id,lease_generation";
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.enum(["EVIDENCE_PENDING", "PREPARING", "READY", "DRAFTING", "SOURCE_READY", "RENDERING", "REVIEW_READY", "APPROVED", "RELEASED", "RESULT_UNKNOWN", "OWNER_EXCEPTION", "SUPERSEDED", "CANCELED"]),
  active_version_id: uuid.nullable(), lease_generation: z.number().int().nonnegative() }).strict();
const versionColumns = "id,job_id,customer_id,material_line_id,version,supersedes_id,packet_encrypted_payload_id,packet_sha256,context_sha256,invalidated_at,release_id";
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, version: z.number().int().positive(),
  supersedes_id: uuid.nullable(), packet_encrypted_payload_id: uuid, packet_sha256: hash, context_sha256: hash,
  invalidated_at: time.nullable(), release_id: uuid.nullable() }).strict();
const revisionColumns = "id,line_id,source_snapshot_id,job_snapshot_id,employer_rule_snapshot_id,version,binding_sha256,due_at,superseded_at";
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, job_snapshot_id: uuid, employer_rule_snapshot_id: uuid,
  version: z.number().int().positive(), binding_sha256: hash, due_at: time, superseded_at: time.nullable() }).strict();
const ruleSchema = z.object({ id: uuid, job_snapshot_id: uuid, content_sha256: hash, checked_at: time }).strict();
const targetSchema = z.object({ id: uuid, content_sha256: hash }).strict();
const receiptColumns = "id,customer_id,material_line_id,job_id,line_revision_id,reviewed_version_id,reviewed_lease_generation,review_method,basis,review_checklist,checked_by,checked_at,receipt_sha256,created_at";
type Job = z.infer<typeof jobSchema>;
type Version = z.infer<typeof versionSchema>;
type ReviewRequest = z.infer<typeof materialRuleRevalidateRequestSchema>;
type RefreshRequest = z.infer<typeof materialRuleRefreshRequestSchema>;
type Receipt = z.infer<typeof materialRuleReceiptSchema>;

export class MaterialRuleOwnerError extends Error {
  constructor(readonly code: string) { super(`MATERIAL_RULE_OWNER_${code}`); this.name = "MaterialRuleOwnerError"; }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new MaterialRuleOwnerError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code = "RECEIPT_INVALID"): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}
function exact(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exact).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${exact(object[key])}`).join(",")}}`;
  }
  throw new MaterialRuleOwnerError("JSON_INVALID");
}
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Internal owner adapter. The HTTP/page caller first enforces fresh admin MFA
 * and passes only that session's reviewer ID. No method sends a document,
 * invokes a drafting provider, authorizes spending, or deletes a payload. */
export function createMaterialRuleOwnerServer(admin: SupabaseClient<Database>, trustedReviewerId: string, options: { now?: () => Date } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId, "REVIEWER_INVALID"), now = options.now ?? (() => new Date());
  async function bounded<T>(external: AbortSignal, operation: (signal: AbortSignal) => Promise<T>) {
    ensure(!external.aborted, "ABORTED");
    const controller = new AbortController(), abort = () => controller.abort();
    external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
    let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(new MaterialRuleOwnerError("ABORTED"));
      controller.signal.addEventListener("abort", stop, { once: true }); if (controller.signal.aborted) stop(); });
    const timer = setTimeout(abort, 60_000);
    try { ensure(Number.isFinite(now().getTime()), "CLOCK_INVALID"); const value = await Promise.race([operation(controller.signal), interrupted]); ensure(!controller.signal.aborted, "ABORTED"); return value; }
    catch (error) { if (error instanceof MaterialRuleOwnerError) throw error; throw new MaterialRuleOwnerError("UNCONFIRMED"); }
    finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  }
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted, "ABORTED"); const value = await query; ensure(!signal.aborted, "ABORTED"); ensure(!value.error, "UNCONFIRMED"); return value.data;
  }
  const authorize = (signal: AbortSignal) => data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal);
  const job = async (id: string, signal: AbortSignal) => {
    const row = parse(jobSchema, await data(admin.from("ap_material_draft_jobs").select(jobColumns).eq("id", id).abortSignal(signal).single(), signal));
    ensure(row.id === id, "JOB_MISMATCH"); return row;
  };
  const version = async (id: string, signal: AbortSignal) => {
    const row = parse(versionSchema, await data(admin.from("ap_material_draft_versions").select(versionColumns).eq("id", id).abortSignal(signal).single(), signal));
    ensure(row.id === id, "VERSION_MISMATCH"); return row;
  };
  const revision = async (current: Job, signal: AbortSignal) => {
    const row = parse(revisionSchema, await data(admin.from("ap_material_line_revisions").select(revisionColumns).eq("id", current.line_revision_id).abortSignal(signal).single(), signal));
    ensure(row.id === current.line_revision_id && row.line_id === current.material_line_id && row.source_snapshot_id === current.source_snapshot_id, "REVISION_MISMATCH"); return row;
  };
  const context = async (id: string, signal: AbortSignal) => parse(hash, await data(admin.rpc("ap_material_draft_context_sha256", { p_job_id: id }).abortSignal(signal), signal));
  function versionBelongs(v: Version, j: Job) {
    ensure(v.job_id === j.id && v.customer_id === j.customer_id && v.material_line_id === j.material_line_id, "VERSION_MISMATCH");
  }
  async function evidenceFor(current: Job, signal: AbortSignal) {
    const r = await revision(current, signal);
    ensure(!r.superseded_at && Date.parse(r.due_at) > now().getTime(), "REVISION_STALE");
    // This RPC deliberately accepts an expired original rule. Calling the full
    // context first would make the owner's honest renewal action unreachable.
    const evidence = parse(materialRuleEvidenceProjectionSchema, await data(admin.rpc("ap_material_draft_rule_evidence", { p_job_id: current.id }).abortSignal(signal), signal));
    const rule = parse(ruleSchema, await data(admin.from("ap_employer_submission_rules").select("id,job_snapshot_id,content_sha256,checked_at").eq("id", r.employer_rule_snapshot_id).abortSignal(signal).single(), signal));
    const target = parse(targetSchema, await data(admin.from("ap_job_snapshots").select("id,content_sha256").eq("id", r.job_snapshot_id).abortSignal(signal).single(), signal));
    ensure(evidence.jobId === current.id && evidence.activeVersionId === current.active_version_id && evidence.leaseGeneration === current.lease_generation
      && evidence.basis.lineRevisionId === r.id && evidence.basis.sourceSnapshotId === r.source_snapshot_id && evidence.basis.jobSnapshotId === r.job_snapshot_id
      && target.id === r.job_snapshot_id && target.content_sha256 === evidence.basis.jobContentSha256 && rule.id === r.employer_rule_snapshot_id
      && rule.job_snapshot_id === target.id && evidence.basis.ruleId === rule.id && evidence.basis.ruleSha256 === rule.content_sha256
      && Date.parse(evidence.originalCheckedAt) === Date.parse(rule.checked_at) && Date.parse(rule.checked_at) <= now().getTime(), "EVIDENCE_CHANGED");
    const binding = { jobId: current.id, customerId: current.customer_id, materialLineId: current.material_line_id, lineRevisionId: r.id,
      sourceSnapshotId: r.source_snapshot_id, jobSnapshotId: target.id, jobContentSha256: target.content_sha256,
      ruleId: rule.id, ruleSha256: rule.content_sha256, originalCheckedAt: rule.checked_at };
    const receipt = evidence.revalidation;
    ensure(!receipt || receipt.customer_id === current.customer_id && receipt.material_line_id === current.material_line_id && receipt.job_id === current.id
      && receipt.line_revision_id === r.id && exact(receipt.basis) === exact(evidence.basis)
      && Date.parse(receipt.checked_at) <= now().getTime() && Date.parse(receipt.created_at) >= Date.parse(receipt.checked_at)
      && Date.parse(receipt.created_at) <= now().getTime(), "EVIDENCE_CHANGED");
    ensure(Date.parse(evidence.effectiveCheckedAt) === Math.max(Date.parse(rule.checked_at), receipt ? Date.parse(receipt.checked_at) : -Infinity), "EVIDENCE_CHANGED");
    ensure(exact(await job(current.id, signal)) === exact(current), "EVIDENCE_CHANGED");
    let ruleCurrent = false;
    try { materialRuleProjectionForPacket(evidence, binding, now()); ruleCurrent = true; } catch { /* Expiry is displayed, never rewritten. */ }
    return { evidence, ruleCurrent, revision: r };
  }
  async function readReceipt(id: string, signal: AbortSignal) {
    const raw = await data(admin.from("ap_material_rule_revalidations").select(receiptColumns).eq("id", id).abortSignal(signal).maybeSingle(), signal);
    if (raw === null) return null;
    const receipt = parse(materialRuleReceiptSchema, raw); ensure(receipt.id === id, "RECEIPT_INVALID"); return receipt;
  }
  function matchesReceipt(receipt: Receipt, request: ReviewRequest, current: Job) {
    ensure(receipt.id === request.receiptId && receipt.job_id === current.id && receipt.customer_id === current.customer_id
      && receipt.material_line_id === current.material_line_id && receipt.line_revision_id === request.expectedBasis.lineRevisionId
      && receipt.reviewed_version_id === request.expectedVersionId && receipt.checked_by === reviewerId
      && exact(receipt.basis) === exact(request.expectedBasis) && exact(receipt.review_checklist) === exact(request.checklist)
      && Date.parse(receipt.checked_at) <= now().getTime() && Date.parse(receipt.created_at) >= Date.parse(receipt.checked_at)
      && Date.parse(receipt.created_at) <= now().getTime(), "RECEIPT_CONFLICT");
  }
  async function reviewResult(receipt: Receipt, replayed: boolean, signal: AbortSignal) {
    let current = false;
    try {
      const j = await job(receipt.job_id, signal), value = await evidenceFor(j, signal);
      current = j.active_version_id === receipt.reviewed_version_id && value.ruleCurrent && value.evidence.revalidation?.id === receipt.id
        && exact(value.evidence.revalidation) === exact(receipt);
    } catch { ensure(!signal.aborted, "ABORTED"); }
    return { recorded: true as const, receipt, replayed, current, packetRefreshRequired: receipt.reviewed_version_id !== null, deliveryAuthorized: false as const };
  }
  function refreshPayloadId(request: RefreshRequest) {
    return deterministicUuid(`applypack:material-rule-packet-refresh-v1:${request.jobId}:${request.expectedVersionId}:${request.requestId}`);
  }
  async function recordedRefresh(request: RefreshRequest, current: Job, prior: Version, signal: AbortSignal) {
    versionBelongs(prior, current);
    ensure(prior.id === request.expectedVersionId && prior.packet_sha256 === request.expectedPacketSha256, "VERSION_STALE");
    const rows = parse(z.array(versionSchema).max(1), await data(admin.from("ap_material_draft_versions").select(versionColumns)
      .eq("job_id", request.jobId).eq("supersedes_id", prior.id).eq("packet_encrypted_payload_id", refreshPayloadId(request)).limit(2).abortSignal(signal), signal));
    if (!rows.length) return null;
    const next = rows[0]; versionBelongs(next, current);
    ensure(next.id !== prior.id && next.supersedes_id === prior.id && next.version === prior.version + 1
      && next.packet_encrypted_payload_id === refreshPayloadId(request) && next.context_sha256 === request.expectedContextSha256 && prior.invalidated_at !== null, "REFRESH_CONFLICT");
    return next;
  }
  async function refreshResult(request: RefreshRequest, next: Version, replayed: boolean, signal: AbortSignal) {
    let current = false, bytes: Buffer | undefined;
    try {
      const j = await job(request.jobId, signal); versionBelongs(next, j);
      ensure(j.active_version_id === next.id && !next.invalidated_at && !next.release_id && !["RELEASED", "CANCELED", "SUPERSEDED"].includes(j.state), "VERSION_STALE");
      const r = await revision(j, signal); ensure(!r.superseded_at && Date.parse(r.due_at) > now().getTime(), "REVISION_STALE");
      ensure(await context(j.id, signal) === request.expectedContextSha256, "CONTEXT_CHANGED");
      bytes = await readEncryptedDraftPayload(admin, { customerId: j.customer_id, jobId: j.id, payloadId: next.packet_encrypted_payload_id,
        sha256: next.packet_sha256, purpose: "MATERIAL_DRAFT_PACKET" }, { signal });
      ensure(!signal.aborted && digest(bytes) === next.packet_sha256, "PACKET_CHANGED");
      const packet = await loadDraftingEvidencePacket(admin, { customerId: j.customer_id, materialLineId: j.material_line_id,
        revisionId: r.id, revisionVersion: r.version, bindingSha256: r.binding_sha256 }, { signal, now });
      current = packet.packetSha256 === next.packet_sha256 && serializeDraftingEvidencePacket(packet) === new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        && Date.parse(packet.validUntil) > now().getTime() && await context(j.id, signal) === request.expectedContextSha256
        && exact(await job(j.id, signal)) === exact(j) && exact(await version(next.id, signal)) === exact(next);
    } catch { ensure(!signal.aborted, "ABORTED"); }
    finally { bytes?.fill(0); }
    return { recorded: true as const, jobId: request.jobId, priorVersionId: request.expectedVersionId, versionId: next.id,
      packetSha256: next.packet_sha256, contextSha256: next.context_sha256, replayed, current, deliveryAuthorized: false as const };
  }
  return {
    inspectRuleEvidence: (raw: unknown, signal: AbortSignal) => bounded(signal, async (child) => {
      const request = parse(inspectSchema, raw, "INPUT_INVALID"); await authorize(child);
      const j = await job(request.jobId, child), inspected = await evidenceFor(j, child);
      let contextSha256: string | null = null;
      if (inspected.ruleCurrent) { try { contextSha256 = await context(j.id, child); } catch { ensure(!child.aborted, "ABORTED"); } }
      const after = await evidenceFor(j, child);
      ensure(exact(after.evidence) === exact(inspected.evidence) && after.ruleCurrent === inspected.ruleCurrent, "EVIDENCE_CHANGED");
      return { jobId: j.id, customerId: j.customer_id, materialLineId: j.material_line_id, lineRevisionId: j.line_revision_id,
        sourceSnapshotId: j.source_snapshot_id, evidence: inspected.evidence, ruleCurrent: inspected.ruleCurrent, contextSha256 };
    }),
    revalidate: (raw: unknown, signal: AbortSignal) => bounded(signal, async (child) => {
      const request = parse(materialRuleRevalidateRequestSchema, raw, "INPUT_INVALID"); await authorize(child);
      const j = await job(request.jobId, child), existing = await readReceipt(request.receiptId, child);
      // A durable completion may be reconciled after expiry. It is never a
      // second review and cannot make stale evidence usable again.
      if (existing) { matchesReceipt(existing, request, j); return reviewResult(existing, true, child); }
      const inspected = await evidenceFor(j, child);
      ensure(j.active_version_id === request.expectedVersionId && exact(inspected.evidence.basis) === exact(request.expectedBasis), "EVIDENCE_CHANGED");
      let reported: Receipt | null = null;
      try {
        // Actual CLI-generated UUID parameter types omit SQL nullability.
        //092 explicitly permits NULL only at the initial preparation stage.
        const expectedVersionId = request.expectedVersionId as Database["public"]["Functions"]["ap_revalidate_material_draft_rule"]["Args"]["p_expected_version_id"];
        const value = parse(z.object({ receipt: materialRuleReceiptSchema, replayed: z.boolean() }).strict(), await data(admin.rpc("ap_revalidate_material_draft_rule", {
          p_job_id: j.id, p_expected_version_id: expectedVersionId, p_receipt_id: request.receiptId,
          p_expected_basis: request.expectedBasis, p_review_checklist: request.checklist, p_reviewer_id: reviewerId }).abortSignal(child), child));
        reported = value.receipt;
      } catch { ensure(!child.aborted, "RESULT_UNKNOWN"); }
      const receipt = await readReceipt(request.receiptId, child); ensure(receipt, "RESULT_UNKNOWN"); matchesReceipt(receipt, request, j);
      ensure(!reported || exact(reported) === exact(receipt), "RESULT_UNKNOWN");
      return reviewResult(receipt, reported === null, child);
    }),
    refreshPacket: (raw: unknown, signal: AbortSignal) => bounded(signal, async (child) => {
      const request = parse(materialRuleRefreshRequestSchema, raw, "INPUT_INVALID"); await authorize(child);
      const j = await job(request.jobId, child), prior = await version(request.expectedVersionId, child);
      const recorded = await recordedRefresh(request, j, prior, child);
      if (recorded) return refreshResult(request, recorded, true, child);
      ensure(j.active_version_id === prior.id && !prior.invalidated_at && !prior.release_id, "VERSION_STALE");
      const r = await revision(j, child); ensure(!r.superseded_at && Date.parse(r.due_at) > now().getTime(), "REVISION_STALE");
      ensure(await context(j.id, child) === request.expectedContextSha256, "CONTEXT_CHANGED");
      const packet = await loadDraftingEvidencePacket(admin, { customerId: j.customer_id, materialLineId: j.material_line_id,
        revisionId: r.id, revisionVersion: r.version, bindingSha256: r.binding_sha256 }, { signal: child, now });
      ensure(!child.aborted && packet.expected.customerId === j.customer_id && packet.expected.materialLineId === j.material_line_id
        && packet.expected.revisionId === r.id && packet.expected.revisionVersion === r.version && packet.expected.bindingSha256 === r.binding_sha256
        && packet.binding.snapshotId === r.source_snapshot_id && packet.binding.dueAt === r.due_at && Date.parse(packet.validUntil) > now().getTime(), "PACKET_CHANGED");
      const body = serializeDraftingEvidencePacket(packet), payloadId = refreshPayloadId(request);
      ensure(await context(j.id, child) === request.expectedContextSha256 && exact(await job(j.id, child)) === exact(j)
        && exact(await version(prior.id, child)) === exact(prior), "CONTEXT_CHANGED");
      const stored = await storeEncryptedDraftPayload(admin, { customerId: j.customer_id, jobId: j.id, payloadId,
        purpose: "MATERIAL_DRAFT_PACKET", body, sha256: packet.packetSha256 }, { signal: child });
      ensure(!child.aborted && stored.payloadId === payloadId && stored.sha256 === packet.packetSha256, "PERSIST_MISMATCH");
      ensure(await context(j.id, child) === request.expectedContextSha256 && exact(await job(j.id, child)) === exact(j)
        && exact(await version(prior.id, child)) === exact(prior), "CONTEXT_CHANGED");
      ensure(Date.parse(packet.validUntil) > now().getTime(), "PACKET_EXPIRED");
      let reported: string | null = null;
      try { reported = parse(uuid, await data(admin.rpc("ap_refresh_material_draft_packet", { p_job_id: j.id,
        p_expected_version_id: prior.id, p_payload_id: payloadId, p_packet_sha256: packet.packetSha256,
        p_context_sha256: request.expectedContextSha256, p_reviewer_id: reviewerId }).abortSignal(child), child)); }
      catch { ensure(!child.aborted, "RESULT_UNKNOWN"); }
      const next = await recordedRefresh(request, await job(j.id, child), await version(prior.id, child), child);
      ensure(next && next.packet_sha256 === packet.packetSha256 && (!reported || reported === next.id), "RESULT_UNKNOWN");
      return refreshResult(request, next, reported === null, child);
    }),
  };
}
