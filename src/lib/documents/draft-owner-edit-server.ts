import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { buildOwnerEditedDraftSource, draftOwnerEditRequestSchema, exactOwnerEditJson, ownerEditRequestSha256 } from "./draft-owner-edit";
import { readStoredDraftRenderSource } from "./draft-render-source-storage";
import { serializeDraftRenderSource } from "./draft-render-source";
import { serializeDraftingEvidencePacket } from "./drafting-evidence";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { readEncryptedDraftPayload, storeEncryptedDraftPayload } from "./draft-packet-worker";
import { readConfirmedDraftContact } from "./draft-owner-contact";
import { draftReferenceRequest, readConfirmedDraftReferences } from "./draft-owner-references";
import { validateDraftReferenceSource, type DraftReferenceInput } from "./draft-reference-source";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const jobColumns = "id,customer_id,material_line_id,line_revision_id,source_snapshot_id,state,active_version_id";
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.enum(["SOURCE_READY", "REVIEW_READY", "APPROVED"]), active_version_id: uuid }).strict();
const versionColumns = "id,job_id,customer_id,material_line_id,version,supersedes_id,packet_encrypted_payload_id,packet_sha256,context_sha256,encrypted_payload_id,source_sha256,invalidated_at,member_set_sha256,claim_review_sha256,approval_sha256,release_id";
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, version: z.number().int().positive(), supersedes_id: uuid.nullable(),
  packet_encrypted_payload_id: uuid, packet_sha256: hash, context_sha256: hash, encrypted_payload_id: uuid, source_sha256: hash, invalidated_at: time.nullable(),
  member_set_sha256: hash.nullable(), claim_review_sha256: hash.nullable(), approval_sha256: hash.nullable(), release_id: z.null() }).strict();
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, version: z.number().int().positive(), binding_sha256: hash,
  due_at: time, superseded_at: z.null() }).strict();
type State = { job: z.infer<typeof jobSchema>; version: z.infer<typeof versionSchema>; revision: z.infer<typeof revisionSchema> };
export class DraftOwnerEditServerError extends Error { constructor(readonly code: string) { super(`DRAFT_OWNER_EDIT_SERVER_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftOwnerEditServerError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code = "UNCONFIRMED"): T { const result = schema.safeParse(value); ensure(result.success, code); return result.data; }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Instantiate only after fresh requireAdmin MFA, with the verified session ID.
 * Every write is an append-only source CAS. This cannot approve, send, change
 * paid scope, call a provider, or mutate customer-confirmed facts. */
export function createDraftOwnerEditServer(admin: SupabaseClient<Database>, trustedReviewerId: string, options: { now?: () => Date } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId, "REVIEWER_INVALID"), now = options.now ?? (() => new Date());
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted, "ABORTED"); const response = await query; ensure(!signal.aborted, "ABORTED"); ensure(!response.error, "UNCONFIRMED"); return response.data;
  }
  async function job(id: string, signal: AbortSignal) { const value = parse(jobSchema, await data(admin.from("ap_material_draft_jobs").select(jobColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(value.id === id, "JOB_MISMATCH"); return value; }
  async function version(id: string, signal: AbortSignal) { const value = parse(versionSchema, await data(admin.from("ap_material_draft_versions").select(versionColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(value.id === id, "VERSION_MISMATCH"); return value; }
  async function state(jobId: string, signal: AbortSignal): Promise<State> {
    const current = await job(jobId, signal), saved = await version(current.active_version_id, signal);
    ensure(saved.job_id === current.id && saved.customer_id === current.customer_id && saved.material_line_id === current.material_line_id && saved.invalidated_at === null, "VERSION_STALE");
    const revision = parse(revisionSchema, await data(admin.from("ap_material_line_revisions").select("id,line_id,source_snapshot_id,version,binding_sha256,due_at,superseded_at").eq("id", current.line_revision_id).abortSignal(signal).single(), signal));
    ensure(revision.id === current.line_revision_id && revision.line_id === current.material_line_id && revision.source_snapshot_id === current.source_snapshot_id
      && Date.parse(revision.due_at) > now().getTime(), "REVISION_STALE");
    const context = parse(hash, await data(admin.rpc("ap_material_draft_context_sha256", { p_job_id: jobId }).abortSignal(signal), signal));
    ensure(context === saved.context_sha256, "CONTEXT_STALE");
    return { job: current, version: saved, revision };
  }
  async function unchanged(before: State, signal: AbortSignal) {
    const after = await state(before.job.id, signal); ensure(exactOwnerEditJson(before) === exactOwnerEditJson(after), "STATE_CHANGED"); return after;
  }
  async function payload(current: State, id: string, digest: string, purpose: "MATERIAL_DRAFT_PACKET" | "MATERIAL_DRAFT_SOURCE", signal: AbortSignal) {
    let bytes: Buffer | undefined;
    try {
      bytes = await readEncryptedDraftPayload(admin, { customerId: current.job.customer_id, jobId: current.job.id, payloadId: id, sha256: digest, purpose }, { signal });
      ensure(!signal.aborted && bytes.length > 0 && bytes.length <= 4_000_000 && sha(bytes) === digest, "PAYLOAD_INVALID");
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return { body, value: JSON.parse(body) as unknown };
    } finally { bytes?.fill(0); }
  }
  async function perform(raw: unknown, signal: AbortSignal) {
    const request = parse(draftOwnerEditRequestSchema, raw, "INPUT_INVALID");
    parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal), "REVIEWER_UNCONFIRMED");
    const current = await state(request.jobId, signal), requestSha256 = ownerEditRequestSha256(request);
    const savedPacket = await payload(current, current.version.packet_encrypted_payload_id, current.version.packet_sha256, "MATERIAL_DRAFT_PACKET", signal);
    const packet = await loadDraftingEvidencePacket(admin, { customerId: current.job.customer_id, materialLineId: current.job.material_line_id,
      revisionId: current.revision.id, revisionVersion: current.revision.version, bindingSha256: current.revision.binding_sha256 }, { signal, now });
    ensure(!signal.aborted && packet.packetSha256 === current.version.packet_sha256 && serializeDraftingEvidencePacket(packet) === savedPacket.body
      && packet.binding.snapshotId === current.job.source_snapshot_id && packet.binding.dueAt === current.revision.due_at, "PACKET_CHANGED");
    const saved = await payload(current, current.version.encrypted_payload_id, current.version.source_sha256, "MATERIAL_DRAFT_SOURCE", signal);
    const source = readStoredDraftRenderSource(saved, current.version.source_sha256, packet, now);
    let contact: Buffer | undefined; let references: DraftReferenceInput[] = [];
    try {
      contact = await readConfirmedDraftContact(admin, { customerId: current.job.customer_id, payloadId: packet.binding.contactPayloadId, sha256: packet.binding.contactSha256 }, signal);
      ensure(!signal.aborted, "ABORTED");
      const referenceRequest = draftReferenceRequest(packet);
      if (referenceRequest) { references = await readConfirmedDraftReferences(admin, referenceRequest, signal, { now });
        ensure(!signal.aborted, "ABORTED"); validateDraftReferenceSource(source.referenceSheet, packet.ownerEvidence.referenceBindings, references, now()); }
      const receipt = (reconciled: boolean) => ({ jobId: current.job.id, versionId: current.version.id, packetSha256: current.version.packet_sha256,
        sourceSha256: current.version.source_sha256, requestId: request.requestId, state: "OWNER_REVIEW_REQUIRED" as const, reconciled, deliveryAuthorized: false as const });
      if (current.version.id !== request.expectedVersionId) {
        const prior = await version(request.expectedVersionId, signal), lineage = source.ownerEdit;
        ensure(lineage && lineage.requestId === request.requestId && lineage.requestSha256 === requestSha256 && lineage.reviewerId === reviewerId
          && lineage.priorVersionId === request.expectedVersionId && lineage.priorSourceSha256 === request.expectedSourceSha256
          && current.version.supersedes_id === prior.id && current.version.version === prior.version + 1 && prior.invalidated_at !== null
          && prior.source_sha256 === request.expectedSourceSha256 && prior.job_id === current.job.id && prior.customer_id === current.job.customer_id && prior.material_line_id === current.job.material_line_id
          && prior.packet_encrypted_payload_id === current.version.packet_encrypted_payload_id && prior.packet_sha256 === current.version.packet_sha256
          && prior.context_sha256 === current.version.context_sha256, "VERSION_STALE");
        await unchanged(current, signal); return receipt(true);
      }
      ensure(current.version.source_sha256 === request.expectedSourceSha256, "SOURCE_STALE");
      let next;
      try { next = buildOwnerEditedDraftSource({ request, source, packet, reviewerId, contact: { payloadId: packet.binding.contactPayloadId, plaintext: contact }, references }, now()); }
      catch { throw new DraftOwnerEditServerError("EDIT_INVALID"); } // No storage or version mutation has started.
      contact.fill(0); contact = undefined;
      const body = serializeDraftRenderSource(next), payloadId = randomUUID();
      await unchanged(current, signal);
      const stored = await storeEncryptedDraftPayload(admin, { customerId: current.job.customer_id, jobId: current.job.id, payloadId,
        purpose: "MATERIAL_DRAFT_SOURCE", body, sha256: next.renderSourceSha256 }, { signal });
      ensure(!signal.aborted && stored.payloadId === payloadId && stored.sha256 === next.renderSourceSha256, "PERSIST_MISMATCH");
      await unchanged(current, signal);
      let reported: string | null = null;
      try { reported = parse(uuid, await data(admin.rpc("ap_revise_material_draft_source", { p_version_id: current.version.id, p_expected_source_sha256: current.version.source_sha256,
        p_source_payload_id: payloadId, p_source_sha256: next.renderSourceSha256, p_reviewer_id: reviewerId }).abortSignal(signal), signal)); }
      catch { ensure(!signal.aborted, "RESULT_UNKNOWN"); }
      // One readback, never a blind repeat or deletion after an ambiguous commit.
      const after = await state(current.job.id, signal), prior = await version(current.version.id, signal);
      ensure((reported === null || reported === after.version.id) && after.job.state === "SOURCE_READY" && after.version.id !== prior.id
        && after.version.supersedes_id === prior.id && after.version.version === prior.version + 1 && prior.invalidated_at !== null
        && after.version.encrypted_payload_id === payloadId && after.version.source_sha256 === next.renderSourceSha256
        && after.version.packet_encrypted_payload_id === current.version.packet_encrypted_payload_id && after.version.packet_sha256 === current.version.packet_sha256
        && after.version.context_sha256 === current.version.context_sha256 && after.version.claim_review_sha256 === null
        && after.version.approval_sha256 === null && after.version.member_set_sha256 === null, "RESULT_UNKNOWN");
      return { ...receipt(reported === null), versionId: after.version.id, sourceSha256: after.version.source_sha256 };
    } finally { contact?.fill(0); references.forEach((reference) => reference.plaintext.fill(0)); }
  }
  return { saveEdit: async (raw: unknown, external: AbortSignal) => {
    const controller = new AbortController(), abort = () => controller.abort();
    external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
    const timer = setTimeout(abort, 60_000); let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(new DraftOwnerEditServerError("ABORTED"));
      controller.signal.addEventListener("abort", stop, { once: true }); if (controller.signal.aborted) stop(); });
    try { ensure(!controller.signal.aborted, "ABORTED"); const result = await Promise.race([perform(raw, controller.signal), interrupted]); ensure(!controller.signal.aborted, "ABORTED"); return result; }
    catch (error) { if (error instanceof DraftOwnerEditServerError) throw error; throw new DraftOwnerEditServerError("UNCONFIRMED"); }
    finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  } };
}
