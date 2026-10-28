import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { deterministicUuid } from "@/lib/commerce/server";
import { materialContactSchema } from "@/lib/materials/server";
import { draftChangeRequestSchema } from "./draft-change-contract";
import { buildDraftChangePayload, draftChangeRequestSha256 } from "./draft-change-request";
import { draftChangeRecordSchema, type DraftChangePort, type DraftChangeRecord } from "./draft-change-port";
import { loadDraftChangeForVersion } from "./draft-change-loader";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { serializeDraftingEvidencePacket } from "./drafting-evidence";
import { readStoredDraftRenderSource } from "./draft-render-source-storage";
import { readEncryptedDraftPayload, storeEncryptedDraftPayload } from "./draft-packet-worker";
import { readConfirmedDraftContact } from "./draft-owner-contact";
import { draftReferenceRequest, readConfirmedDraftReferences } from "./draft-owner-references";
import { readDraftReferenceSources, validateDraftReferenceSource, type DraftReferenceInput } from "./draft-reference-source";
import { exactOwnerEditJson } from "./draft-owner-edit";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const jobColumns = "id,customer_id,material_line_id,line_revision_id,source_snapshot_id,state,active_version_id";
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.string().min(1).max(40), active_version_id: uuid }).strict();
const versionColumns = "id,job_id,customer_id,material_line_id,version,supersedes_id,packet_encrypted_payload_id,packet_sha256,context_sha256,encrypted_payload_id,source_sha256,invalidated_at,release_id";
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, version: z.number().int().positive(), supersedes_id: uuid.nullable(),
  packet_encrypted_payload_id: uuid, packet_sha256: hash, context_sha256: hash, encrypted_payload_id: uuid.nullable(), source_sha256: hash.nullable(), invalidated_at: time.nullable(), release_id: uuid.nullable() }).strict();
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, version: z.number().int().positive(), binding_sha256: hash, due_at: time, superseded_at: z.null() }).strict();
export class DraftChangeServerError extends Error { constructor(readonly code: string) { super(`DRAFT_CHANGE_SERVER_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftChangeServerError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code = "UNCONFIRMED"): T { const result = schema.safeParse(raw); ensure(result.success, code); return result.data; }

/** Fresh MFA precedes construction. The097 port never grants provider authority;
 * it records one explicit owner request and appends an unapproved successor. */
export function createDraftChangeServer(admin: SupabaseClient<Database>, trustedReviewerId: string,
  port: DraftChangePort, options: { now?: () => Date } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId, "REVIEWER_INVALID"), now = options.now ?? (() => new Date());
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) { ensure(!signal.aborted, "ABORTED"); const result = await query; ensure(!signal.aborted && !result.error, "UNCONFIRMED"); return result.data; }
  async function job(id: string, signal: AbortSignal) { const row = parse(jobSchema, await data(admin.from("ap_material_draft_jobs").select(jobColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(row.id === id, "JOB_MISMATCH"); return row; }
  async function version(id: string, signal: AbortSignal) { const row = parse(versionSchema, await data(admin.from("ap_material_draft_versions").select(versionColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(row.id === id, "VERSION_MISMATCH"); return row; }
  async function state(id: string, signal: AbortSignal) {
    const j = await job(id, signal), v = await version(j.active_version_id, signal);
    ensure(["SOURCE_READY", "REVIEW_READY", "APPROVED"].includes(j.state) && v.job_id === j.id && v.customer_id === j.customer_id && v.material_line_id === j.material_line_id
      && !v.invalidated_at && !v.release_id && v.encrypted_payload_id && v.source_sha256, "PARENT_STALE");
    const r = parse(revisionSchema, await data(admin.from("ap_material_line_revisions").select("id,line_id,source_snapshot_id,version,binding_sha256,due_at,superseded_at").eq("id", j.line_revision_id).abortSignal(signal).single(), signal));
    ensure(r.id === j.line_revision_id && r.line_id === j.material_line_id && r.source_snapshot_id === j.source_snapshot_id && Date.parse(r.due_at) > now().getTime(), "REVISION_STALE");
    ensure(parse(hash, await data(admin.rpc("ap_material_draft_context_sha256", { p_job_id: id }).abortSignal(signal), signal)) === v.context_sha256, "CONTEXT_STALE");
    return { job: j, version: v, revision: r };
  }
  async function payload(current: Awaited<ReturnType<typeof state>>, id: string, digest: string, purpose: "MATERIAL_DRAFT_PACKET" | "MATERIAL_DRAFT_SOURCE", signal: AbortSignal) {
    let bytes: Buffer | undefined;
    try { bytes = await readEncryptedDraftPayload(admin, { customerId: current.job.customer_id, jobId: current.job.id, payloadId: id, sha256: digest, purpose }, { signal });
      ensure(!signal.aborted, "ABORTED"); const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return { body, value: JSON.parse(body) as unknown };
    } finally { bytes?.fill(0); }
  }
  async function perform(raw: unknown, signal: AbortSignal) {
    const request = parse(draftChangeRequestSchema, raw, "INPUT_INVALID"), requestSha256 = draftChangeRequestSha256(request);
    parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal), "REVIEWER_UNCONFIRMED");
    const checkRecord = (record: DraftChangeRecord) => ensure(record.id === request.requestId && record.job_id === request.jobId
      && record.parent_version_id === request.expectedVersionId && record.parent_source_sha256 === request.expectedSourceSha256
      && record.request_sha256 === requestSha256 && record.reviewer_id === reviewerId && Date.parse(record.created_at) <= now().getTime(), "REQUEST_CONFLICT");
    const receipt = async (record: DraftChangeRecord, reconciled: boolean) => {
      checkRecord(record); const j = await job(record.job_id, signal), parent = await version(record.parent_version_id, signal), next = await version(record.successor_version_id, signal);
      ensure(j.customer_id === record.customer_id && j.material_line_id === record.material_line_id
        && parent.job_id === j.id && next.job_id === j.id && parent.customer_id === j.customer_id && next.customer_id === j.customer_id
        && parent.material_line_id === j.material_line_id && next.material_line_id === j.material_line_id
        && next.supersedes_id === parent.id && next.version === parent.version + 1 && parent.invalidated_at !== null
        && parent.source_sha256 === record.parent_source_sha256 && next.packet_sha256 === record.packet_sha256
        && next.context_sha256 === record.context_sha256, "RECEIPT_MISMATCH");
      return { jobId: j.id, requestId: record.id, versionId: next.id, parentVersionId: parent.id,
        requestSha256: record.request_sha256, recorded: true as const, reconciled,
        current: j.active_version_id === next.id && next.invalidated_at === null && next.release_id === null,
        state: "CHANGES_REQUESTED" as const, deliveryAuthorized: false as const };
    };
    const prior = await port.readRequest(request.requestId, signal); ensure(!signal.aborted, "ABORTED");
    if (prior !== null) return receipt(parse(draftChangeRecordSchema, prior), true);
    const current = await state(request.jobId, signal);
    ensure(current.version.id === request.expectedVersionId && current.version.source_sha256 === request.expectedSourceSha256, "PARENT_STALE");
    const packetBytes = await payload(current, current.version.packet_encrypted_payload_id, current.version.packet_sha256, "MATERIAL_DRAFT_PACKET", signal);
    const packet = await loadDraftingEvidencePacket(admin, { customerId: current.job.customer_id, materialLineId: current.job.material_line_id,
      revisionId: current.revision.id, revisionVersion: current.revision.version, bindingSha256: current.revision.binding_sha256 }, { signal, now });
    ensure(packet.packetSha256 === current.version.packet_sha256 && serializeDraftingEvidencePacket(packet) === packetBytes.body, "PACKET_CHANGED");
    const saved = await payload(current, current.version.encrypted_payload_id!, current.version.source_sha256!, "MATERIAL_DRAFT_SOURCE", signal);
    const source = readStoredDraftRenderSource(saved, current.version.source_sha256!, packet, now);
    const priorChange = await loadDraftChangeForVersion(admin, port, { jobId: current.job.id, versionId: current.version.id,
      customerId: current.job.customer_id, materialLineId: current.job.material_line_id }, packet, signal, now);
    ensure(exactOwnerEditJson(source.changeRequest ?? null) === exactOwnerEditJson(priorChange?.lineage ?? null), "CHANGE_LINEAGE_MISMATCH");
    let contact: Buffer | undefined; let references: DraftReferenceInput[] = [];
    try {
      contact = await readConfirmedDraftContact(admin, { customerId: current.job.customer_id, payloadId: packet.binding.contactPayloadId, sha256: packet.binding.contactSha256 }, signal);
      ensure(!signal.aborted, "ABORTED");
      const contactFields = materialContactSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contact)));
      const referenceRequest = draftReferenceRequest(packet);
      if (referenceRequest) references = await readConfirmedDraftReferences(admin, referenceRequest, signal, { now });
      validateDraftReferenceSource(source.referenceSheet, packet.ownerEvidence.referenceBindings, references, now());
      const localIdentityValues = Object.values(contactFields).filter((value): value is string => typeof value === "string");
      if (references.length) for (const reference of readDraftReferenceSources(packet.ownerEvidence.referenceBindings!, references, now())) localIdentityValues.push(...reference.fields.map((field) => field.value));
      const built = buildDraftChangePayload({ request, source, packet, contextSha256: current.version.context_sha256, reviewerId, localIdentityValues }, now());
      const payloadId = deterministicUuid(`applypack:draft-change:${request.jobId}:${request.requestId}:${requestSha256}`);
      const unchanged = async () => ensure(exactOwnerEditJson(await state(current.job.id, signal)) === exactOwnerEditJson(current), "STATE_CHANGED");
      await unchanged();
      const stored = await storeEncryptedDraftPayload(admin, { customerId: current.job.customer_id, jobId: current.job.id, payloadId,
        purpose: "MATERIAL_DRAFT_CHANGE_REQUEST", body: built.body, sha256: built.payloadSha256 }, { signal });
      ensure(!signal.aborted && stored.payloadId === payloadId && stored.sha256 === built.payloadSha256, "PERSIST_MISMATCH");
      await unchanged(); let reported: string | null = null;
      try { reported = parse(uuid, await port.commit({ p_job_id: request.jobId, p_expected_version_id: request.expectedVersionId,
        p_expected_source_sha256: request.expectedSourceSha256, p_request_id: request.requestId, p_payload_id: payloadId,
        p_request_sha256: requestSha256, p_payload_sha256: built.payloadSha256, p_parent_proposal_sha256: source.proposalSourceSha256,
        p_reviewer_id: reviewerId }, signal)); } catch { ensure(!signal.aborted, "RESULT_UNKNOWN"); }
      const record = parse(draftChangeRecordSchema, await port.readRequest(request.requestId, signal), "RESULT_UNKNOWN");
      ensure(!signal.aborted && (reported === null || reported === record.successor_version_id) && record.encrypted_payload_id === payloadId
        && record.payload_sha256 === built.payloadSha256 && record.packet_sha256 === current.version.packet_sha256
        && record.context_sha256 === current.version.context_sha256 && record.parent_proposal_sha256 === source.proposalSourceSha256, "RESULT_UNKNOWN");
      return receipt(record, reported === null);
    } finally { contact?.fill(0); references.forEach((item) => item.plaintext.fill(0)); }
  }
  return { requestChanges: async (raw: unknown, external: AbortSignal) => {
    const controller = new AbortController(), abort = () => controller.abort(); external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
    const timer = setTimeout(abort, 60_000); let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(new DraftChangeServerError("ABORTED")); controller.signal.addEventListener("abort", stop, { once: true }); if (controller.signal.aborted) stop(); });
    try { ensure(!controller.signal.aborted, "ABORTED"); const result = await Promise.race([perform(raw, controller.signal), interrupted]); ensure(!controller.signal.aborted, "ABORTED"); return result; }
    catch (error) { if (error instanceof DraftChangeServerError) throw error; throw new DraftChangeServerError("UNCONFIRMED"); }
    finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  } };
}
